/**
 * Agent Stall Detection and Monitoring
 *
 * Monitors Copilot agent PRs for activity and detects stalls.
 * Provides automatic nudging and escalation when agents take too long.
 *
 * Design principles:
 * - Deterministic thresholds (no guessing)
 * - Explicit state tracking (active, stalled, complete)
 * - Actionable outputs (nudge, escalate)
 *
 * @module
 */

import { z } from "zod";
import { GitHubAPI } from "../github/api.js";

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * Agent monitor status
 */
export const AgentStatusSchema = z.enum(["active", "stalled", "complete"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Single agent monitor tracking a PR
 */
export const AgentMonitorSchema = z.object({
  /** PR number being monitored */
  prNumber: z.number(),
  /** PR title */
  title: z.string(),
  /** When the PR was assigned/created (ISO timestamp) */
  assignedAt: z.string().datetime(),
  /** When the last commit was made (ISO timestamp), null if no commits */
  lastCommitAt: z.string().datetime().nullable(),
  /** Threshold in minutes before warning */
  stallThresholdMinutes: z.number().min(1),
  /** Current status */
  status: AgentStatusSchema,
  /** Author/assignee of the PR */
  author: z.string(),
  /** PR state */
  prState: z.enum(["open", "draft", "ready_for_review"]),
});

export type AgentMonitor = z.infer<typeof AgentMonitorSchema>;

/**
 * Monitoring configuration
 */
export const MonitorConfigSchema = z.object({
  /** Warning threshold in minutes (no commits = warning) */
  warningThresholdMinutes: z.number().min(1).default(10),
  /** Stall threshold in minutes (no commits = stalled) */
  stallThresholdMinutes: z.number().min(1).default(20),
  /** Enable automatic nudging */
  autoNudge: z.boolean().default(false),
  /** Enable escalation notifications */
  autoEscalate: z.boolean().default(false),
});

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>;

/**
 * Monitor summary with all tracked PRs
 */
export const MonitorSummarySchema = z.object({
  timestamp: z.string().datetime(),
  totalPRs: z.number(),
  activePRs: z.number(),
  stalledPRs: z.number(),
  completePRs: z.number(),
  monitors: z.array(AgentMonitorSchema),
});

export type MonitorSummary = z.infer<typeof MonitorSummarySchema>;

// =============================================================================
// MONITORING LOGIC
// =============================================================================

/**
 * Calculate agent status based on activity
 */
export function calculateStatus(
  monitor: AgentMonitor,
  config: MonitorConfig,
  now: Date = new Date()
): AgentStatus {
  // If PR is ready for review, it's complete
  if (monitor.prState === "ready_for_review") {
    return "complete";
  }

  const assignedTime = new Date(monitor.assignedAt).getTime();
  const lastCommitTime = monitor.lastCommitAt ? new Date(monitor.lastCommitAt).getTime() : null;
  const nowTime = now.getTime();

  // Calculate minutes since last activity
  const referenceTime = lastCommitTime ?? assignedTime;
  const minutesSinceActivity = (nowTime - referenceTime) / (1000 * 60);

  // Check thresholds
  if (minutesSinceActivity >= config.stallThresholdMinutes) {
    return "stalled";
  }

  return "active";
}

/**
 * Determine if a nudge is needed
 */
export function shouldNudge(
  monitor: AgentMonitor,
  config: MonitorConfig,
  now: Date = new Date()
): boolean {
  if (monitor.status !== "active") {
    return false;
  }

  const assignedTime = new Date(monitor.assignedAt).getTime();
  const lastCommitTime = monitor.lastCommitAt ? new Date(monitor.lastCommitAt).getTime() : null;
  const nowTime = now.getTime();

  const referenceTime = lastCommitTime ?? assignedTime;
  const minutesSinceActivity = (nowTime - referenceTime) / (1000 * 60);

  return minutesSinceActivity >= config.warningThresholdMinutes;
}

/**
 * Fetch PR activity from GitHub using Octokit directly
 */
export async function fetchPRActivity(
  githubAPI: GitHubAPI,
  prNumber: number
): Promise<{
  title: string;
  author: string;
  createdAt: string;
  lastCommitAt: string | null;
  prState: "open" | "draft" | "ready_for_review";
}> {
  // Get PR details using existing method
  const pr = await githubAPI.getPullRequest(prNumber);
  if (!pr) {
    throw new Error(`PR #${prNumber} not found`);
  }

  // Get commits to find last commit time - use octokit directly
  const octokit = (githubAPI as any).octokit;
  const config = githubAPI.config;

  let lastCommitAt: string | null = null;
  try {
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner: config.owner,
      repo: config.repo,
      pull_number: prNumber,
      per_page: 100,
    });

    if (commits.length > 0) {
      // Get the most recent commit
      lastCommitAt = commits[commits.length - 1].commit.author.date;
    }
  } catch (error) {
    // If we can't get commits, use PR updated time as fallback
    lastCommitAt = pr.updatedAt;
  }

  // Determine PR state - GitHubPullRequest doesn't have draft field
  // We'll check via raw octokit call
  let prState: "open" | "draft" | "ready_for_review" = "open";
  try {
    const { data: rawPR } = await octokit.rest.pulls.get({
      owner: config.owner,
      repo: config.repo,
      pull_number: prNumber,
    });

    if (rawPR.draft) {
      prState = "draft";
    } else if (!rawPR.draft && rawPR.state === "open") {
      prState = "ready_for_review";
    }
  } catch {
    // Fallback to open state
    prState = "open";
  }

  return {
    title: pr.title,
    author: pr.author,
    createdAt: pr.createdAt,
    lastCommitAt,
    prState,
  };
}

/**
 * Create a monitor from PR data
 */
export async function createMonitor(
  githubAPI: GitHubAPI,
  prNumber: number,
  config: MonitorConfig
): Promise<AgentMonitor> {
  const activity = await fetchPRActivity(githubAPI, prNumber);

  const monitor: AgentMonitor = {
    prNumber,
    title: activity.title,
    assignedAt: activity.createdAt,
    lastCommitAt: activity.lastCommitAt,
    stallThresholdMinutes: config.stallThresholdMinutes,
    status: "active",
    author: activity.author,
    prState: activity.prState,
  };

  // Calculate actual status
  monitor.status = calculateStatus(monitor, config);

  return monitor;
}

/**
 * Nudge action - post comment to PR
 */
export async function nudgePR(githubAPI: GitHubAPI, prNumber: number): Promise<void> {
  const message = `@copilot please continue with the implementation`;

  // Use octokit directly to create comment
  const octokit = (githubAPI as any).octokit;
  const config = githubAPI.config;

  await octokit.rest.issues.createComment({
    owner: config.owner,
    repo: config.repo,
    issue_number: prNumber,
    body: message,
  });
}

/**
 * Escalate action - notify human via PR comment
 */
export async function escalatePR(
  githubAPI: GitHubAPI,
  prNumber: number,
  author: string
): Promise<void> {
  const message = `⚠️ **Agent Stall Detected**

This PR has been inactive for an extended period. @${author} please review.

Possible actions:
- Check if the agent encountered an error
- Manually continue the work
- Close and reassign to a new agent`;

  // Use octokit directly to create comment
  const octokit = (githubAPI as any).octokit;
  const config = githubAPI.config;

  await octokit.rest.issues.createComment({
    owner: config.owner,
    repo: config.repo,
    issue_number: prNumber,
    body: message,
  });
}

/**
 * Monitor a batch of PRs
 */
export async function monitorPRs(
  githubAPI: GitHubAPI,
  prNumbers: number[],
  config: MonitorConfig
): Promise<MonitorSummary> {
  const monitors: AgentMonitor[] = [];

  for (const prNumber of prNumbers) {
    try {
      const monitor = await createMonitor(githubAPI, prNumber, config);
      monitors.push(monitor);
    } catch (error) {
      // Skip PRs that can't be fetched
      console.warn(`Failed to monitor PR #${prNumber}: ${error}`);
    }
  }

  const summary: MonitorSummary = {
    timestamp: new Date().toISOString(),
    totalPRs: monitors.length,
    activePRs: monitors.filter((m) => m.status === "active").length,
    stalledPRs: monitors.filter((m) => m.status === "stalled").length,
    completePRs: monitors.filter((m) => m.status === "complete").length,
    monitors,
  };

  return summary;
}

/**
 * Execute actions based on monitor state
 */
export async function executeActions(
  githubAPI: GitHubAPI,
  summary: MonitorSummary,
  config: MonitorConfig
): Promise<{
  nudged: number[];
  escalated: number[];
}> {
  const nudged: number[] = [];
  const escalated: number[] = [];

  for (const monitor of summary.monitors) {
    // Nudge if needed and enabled
    if (config.autoNudge && shouldNudge(monitor, config)) {
      try {
        await nudgePR(githubAPI, monitor.prNumber);
        nudged.push(monitor.prNumber);
      } catch (error) {
        console.warn(`Failed to nudge PR #${monitor.prNumber}: ${error}`);
      }
    }

    // Escalate if stalled and enabled
    if (config.autoEscalate && monitor.status === "stalled") {
      try {
        await escalatePR(githubAPI, monitor.prNumber, monitor.author);
        escalated.push(monitor.prNumber);
      } catch (error) {
        console.warn(`Failed to escalate PR #${monitor.prNumber}: ${error}`);
      }
    }
  }

  return { nudged, escalated };
}
