/**
 * Fanout Monitor Command - Agent Stall Detection
 *
 * Monitors Copilot agent PRs for activity and detects stalls.
 * Can run in check mode (one-time) or watch mode (continuous).
 *
 * @module
 */

import { Command } from "commander";
import { createGitHubAPI } from "../github/api.js";
import { throwExit } from "../cli/exitHandler.js";
import { MonitorConfig, monitorPRs, executeActions, AgentMonitor } from "../fanout/monitor.js";

interface MonitorOptions {
  owner?: string;
  repo?: string;
  prs?: string;
  timeout?: string;
  action?: string;
  interval?: string;
  json?: boolean;
  warningThreshold?: string;
  stallThreshold?: string;
}

/**
 * Parse timeout string (e.g., "15m", "20m") to minutes
 */
function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)m$/);
  if (!match) {
    throw new Error(`Invalid timeout format: ${timeout}. Use format like "15m"`);
  }
  return parseInt(match[1], 10);
}

/**
 * Format monitor for human-readable output
 */
function formatMonitor(monitor: AgentMonitor): string {
  const statusIcon =
    monitor.status === "active" ? "🟢" : monitor.status === "stalled" ? "🔴" : "✅";
  const minutesSinceAssigned = Math.floor(
    (new Date().getTime() - new Date(monitor.assignedAt).getTime()) / (1000 * 60)
  );
  const lastActivity = monitor.lastCommitAt
    ? `${Math.floor((new Date().getTime() - new Date(monitor.lastCommitAt).getTime()) / (1000 * 60))}m ago`
    : "no commits";

  return `${statusIcon} PR #${monitor.prNumber}: ${monitor.title}
   Author: ${monitor.author}
   Status: ${monitor.status}
   Assigned: ${minutesSinceAssigned}m ago
   Last activity: ${lastActivity}
   PR state: ${monitor.prState}`;
}

/**
 * Run monitor in check mode (one-time)
 */
async function runCheck(opts: MonitorOptions): Promise<void> {
  let githubAPI = await createGitHubAPI();

  // Override with command line options if provided
  if (opts.owner && opts.repo) {
    const { GitHubAPI } = await import("../github/api.js");
    githubAPI = new GitHubAPI({
      owner: opts.owner,
      repo: opts.repo,
      token: process.env.GITHUB_TOKEN,
    });
  }

  if (!githubAPI) {
    console.error("\n❌ Error: Could not detect GitHub repository\n");
    console.error("Solutions:");
    console.error("  1. Run from a Git repository with GitHub remote");
    console.error("  2. Specify repository explicitly:");
    console.error("     lex-pr fanout monitor --owner <owner> --repo <repo>\n");
    throwExit(1);
  }

  // Check authentication
  const authStatus = await githubAPI.checkAuth();
  if (!authStatus.authenticated) {
    console.error("❌ Error: GitHub API not authenticated. Set GITHUB_TOKEN.\n");
    throwExit(1);
  }

  // Parse PR numbers
  const prNumbers = opts.prs ? opts.prs.split(",").map((n) => parseInt(n.trim(), 10)) : [];

  if (prNumbers.length === 0) {
    console.error("❌ Error: No PRs specified. Use --prs flag (e.g., --prs 123,456).\n");
    throwExit(1);
  }

  // Build config
  const config: MonitorConfig = {
    warningThresholdMinutes: opts.warningThreshold ? parseTimeout(opts.warningThreshold) : 10,
    stallThresholdMinutes: opts.stallThreshold ? parseTimeout(opts.stallThreshold) : 20,
    autoNudge: opts.action === "nudge" || opts.action === "all",
    autoEscalate: opts.action === "escalate" || opts.action === "all",
  };

  // Monitor PRs
  const summary = await monitorPRs(githubAPI, prNumbers, config);

  // Execute actions
  const actions = await executeActions(githubAPI, summary, config);

  // Output
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          summary,
          actions,
        },
        null,
        2
      )
    );
  } else {
    console.log("\n📊 Agent Monitor Summary\n");
    console.log(`Total PRs: ${summary.totalPRs}`);
    console.log(`Active: ${summary.activePRs}`);
    console.log(`Stalled: ${summary.stalledPRs}`);
    console.log(`Complete: ${summary.completePRs}\n`);

    if (summary.monitors.length > 0) {
      console.log("PRs:\n");
      for (const monitor of summary.monitors) {
        console.log(formatMonitor(monitor));
        console.log("");
      }
    }

    if (actions.nudged.length > 0) {
      console.log(`\n💬 Nudged PRs: ${actions.nudged.join(", ")}`);
    }

    if (actions.escalated.length > 0) {
      console.log(`\n⚠️  Escalated PRs: ${actions.escalated.join(", ")}`);
    }

    if (summary.stalledPRs > 0) {
      console.log(`\n⚠️  ${summary.stalledPRs} PR(s) stalled - consider manual intervention`);
    }
  }
}

/**
 * Run monitor in watch mode (continuous)
 */
async function runWatch(opts: MonitorOptions): Promise<void> {
  const intervalMinutes = opts.interval ? parseTimeout(opts.interval) : 5;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`\n👀 Starting watch mode (checking every ${intervalMinutes}m)...\n`);
  console.log("Press Ctrl+C to stop\n");

  // Run initial check
  await runCheck(opts);

  // Set up interval
  setInterval(async () => {
    console.log(`\n⏰ Running check at ${new Date().toISOString()}\n`);
    await runCheck(opts);
  }, intervalMs);
}

/**
 * Register fanout monitor command
 */
export function registerMonitorCommand(fanoutCommand: Command): void {
  fanoutCommand
    .command("monitor")
    .description("Monitor agent PRs for stalls and automatically nudge or escalate")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--prs <numbers>", "Comma-separated PR numbers to monitor (e.g., 123,456)")
    .option("--timeout <duration>", "Stall timeout (e.g., 15m, 20m)", "20m")
    .option("--action <type>", "Action to take on stall: nudge, escalate, all, or none", "none")
    .option("--interval <duration>", "Check interval for watch mode (e.g., 5m)", "5m")
    .option("--watch", "Run in watch mode (continuous monitoring)")
    .option("--json", "Output JSON format")
    .option("--warning-threshold <duration>", "Warning threshold (e.g., 10m)", "10m")
    .option("--stall-threshold <duration>", "Stall threshold (e.g., 20m)", "20m")
    .addHelpText(
      "after",
      `
Examples:
  # Check PRs once
  $ lex-pr fanout monitor --prs 123,456

  # Check with custom thresholds
  $ lex-pr fanout monitor --prs 123 --warning-threshold 5m --stall-threshold 15m

  # Auto-nudge stalled PRs
  $ lex-pr fanout monitor --prs 123,456 --action nudge

  # Watch mode with auto-escalation
  $ lex-pr fanout monitor --prs 123,456 --watch --interval 5m --action escalate

  # JSON output for automation
  $ lex-pr fanout monitor --prs 123,456 --json
`
    )
    .action(async (opts: MonitorOptions) => {
      try {
        if (opts.watch) {
          await runWatch(opts);
        } else {
          await runCheck(opts);
        }
      } catch (error) {
        console.error(`\n❌ Monitor failed: ${error instanceof Error ? error.message : error}\n`);
        throwExit(1);
      }
    });
}
