/**
 * D0 Harvest Module — Deterministic World-State Collection
 *
 * Fetches and normalizes GitHub data into a HarvestBundle that can be:
 * - Cached for replay
 * - Used as deterministic input to D1 analysis
 * - Audited for provenance
 *
 * Design principles:
 * - Pin reality hard: capture SHAs at harvest time
 * - Truncation as first-class truth: record what we couldn't get
 * - Explicit source tracking: never claim "no vulns" when actually "unknown"
 *
 * @module
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { GitHubClient } from "../github/client.js";
import { HarvestGitHubAdapter } from "./github-adapter.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

import type {
  HarvestBundle,
  HarvestOptions,
  HarvestedIssue,
  HarvestedPR,
  HarvestedComment,
  QueryParams,
  RepoPin,
  SecuritySignals,
  Vulnerability,
  CIStatus,
  ReviewComment,
} from "./types.js";
import { parseHarvestBundle } from "./types.js";

const execAsync = promisify(exec);

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Max diff size before we consider it truncated (3MB) */
const MAX_DIFF_SIZE = 3 * 1024 * 1024;

/** Tool version for provenance */
function getToolVersion(): string {
  // In a real implementation, read from package.json
  // For now, hardcode to avoid sync file read
  return "lexrunner@0.8.0";
}

// =============================================================================
// INPUT DIGEST (CANONICALIZATION)
// =============================================================================

/**
 * Compute deterministic digest of query params for replay verification.
 *
 * Rules:
 * - Sort object keys alphabetically
 * - Sort arrays of primitives
 * - Remove undefined values
 * - SHA256 the canonical JSON
 */
export function computeInputDigest(params: QueryParams): string {
  const canonical = canonicalJSONStringify(params);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// =============================================================================
// REPO PINNING
// =============================================================================

/**
 * Pin the repository state (default branch SHA)
 */
async function harvestRepoPin(adapter: HarvestGitHubAdapter): Promise<RepoPin> {
  // Get repository info to find default branch
  const repoInfo = await adapter.getRepository();
  const defaultBranch = repoInfo.default_branch;

  // Get the SHA of the default branch
  const branchInfo = await adapter.getBranch(defaultBranch);

  return {
    defaultBranch,
    defaultBranchSha: branchInfo.commit.sha,
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// ISSUE HARVESTING
// =============================================================================

/**
 * Harvest issues from GitHub
 */
async function harvestIssues(
  adapter: HarvestGitHubAdapter,
  options: HarvestOptions,
  filter?: { state?: string; labels?: string[] }
): Promise<HarvestedIssue[]> {
  const state = (filter?.state as "open" | "closed" | "all") || "open";
  const labels = filter?.labels;

  // Fetch issues (paginated)
  const rawIssues = await adapter.listIssues({
    state,
    labels: labels?.join(","),
    per_page: 100,
  });

  // Apply limit if specified
  const issuesToProcess = options.issueLimit ? rawIssues.slice(0, options.issueLimit) : rawIssues;

  // Filter out PRs (GitHub API returns PRs in issues endpoint)
  const issuesOnly = issuesToProcess.filter((issue) => !issue.pull_request);

  const harvested: HarvestedIssue[] = [];

  for (const issue of issuesOnly) {
    // Fetch comments if not skipped
    let comments: HarvestedComment[] = [];
    let commentsFetched = false;

    if (!options.skipComments && issue.comments > 0) {
      try {
        const rawComments = await adapter.listIssueComments(issue.number);
        comments = rawComments.map((c) => ({
          id: c.id,
          author: c.user?.login || "unknown",
          body: c.body || "",
          createdAt: c.created_at,
        }));
        commentsFetched = true;
      } catch {
        // Comment fetch failed, continue without
        commentsFetched = false;
      }
    } else if (options.skipComments) {
      commentsFetched = false;
    } else {
      // No comments to fetch
      commentsFetched = true;
    }

    harvested.push({
      number: issue.number,
      nodeId: issue.node_id,
      title: issue.title,
      body: issue.body,
      state: issue.state as "open" | "closed",
      labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name || "")),
      assignees: issue.assignees?.map((a) => a.login) || [],
      author: issue.user?.login || "unknown",
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      comments,
      commentsFetched,
      commentsCount: issue.comments,
    });
  }

  return harvested;
}

// =============================================================================
// PR HARVESTING
// =============================================================================

/**
 * Harvest pull requests from GitHub
 */
async function harvestPRs(
  adapter: HarvestGitHubAdapter,
  options: HarvestOptions,
  filter?: { state?: string }
): Promise<HarvestedPR[]> {
  const state = (filter?.state as "open" | "closed" | "all") || "open";

  // Fetch PRs (paginated)
  const rawPRs = await adapter.listPullRequests({ state, per_page: 100 });

  // Apply limit if specified
  const prsToProcess = options.prLimit ? rawPRs.slice(0, options.prLimit) : rawPRs;

  const harvested: HarvestedPR[] = [];

  for (const pr of prsToProcess) {
    // Get detailed PR info for SHAs
    const prDetail = await adapter.getPullRequest(pr.number);

    // Get diff if not skipped
    let diff: string | null = null;
    let diffTruncated = false;
    let diffBytesCaptured = 0;

    if (!options.skipDiffs) {
      try {
        const rawDiff = await adapter.getPullRequestDiff(pr.number);
        diff = rawDiff;
        diffBytesCaptured = Buffer.byteLength(rawDiff, "utf-8");
        // Check for truncation (heuristic: very large or ends mid-line)
        if (diffBytesCaptured >= MAX_DIFF_SIZE) {
          diffTruncated = true;
        }
      } catch {
        // Diff fetch failed
        diff = null;
        diffTruncated = false;
      }
    }

    // Always get touched files (fallback if diff is truncated)
    let touchedFiles: string[] = [];
    try {
      const files = await adapter.listPullRequestFiles(pr.number);
      touchedFiles = files.map((f) => f.filename);
    } catch {
      // Files fetch failed, extract from diff if available
      if (diff) {
        touchedFiles = extractFilesFromDiff(diff);
      }
    }

    // Get review comments
    let reviewComments: ReviewComment[] = [];
    if (!options.skipComments) {
      try {
        const rawReviews = await adapter.listPullRequestReviewComments(pr.number);
        reviewComments = rawReviews.map((r) => ({
          id: r.id,
          author: r.user?.login || "unknown",
          body: r.body || "",
          path: r.path,
          line: r.line || null,
        }));
      } catch {
        // Review comments fetch failed
      }
    }

    // Get CI status
    let ciStatus: CIStatus = {
      state: null,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
    };
    try {
      const status = await adapter.getCombinedStatus(prDetail.head.sha);
      ciStatus = {
        state: status.state as CIStatus["state"],
        totalChecks: status.total_count,
        passedChecks: status.statuses.filter((s) => s.state === "success").length,
        failedChecks: status.statuses.filter((s) => s.state === "failure" || s.state === "error")
          .length,
      };
    } catch {
      // Status fetch failed
    }

    // Compute merge-base SHA if possible
    let mergeBaseSha: string | null = null;
    try {
      const comparison = await adapter.compareCommits(prDetail.base.sha, prDetail.head.sha);
      mergeBaseSha = comparison.merge_base_commit?.sha || null;
    } catch {
      // Merge base computation failed
    }

    harvested.push({
      number: pr.number,
      nodeId: pr.node_id,
      title: pr.title,
      body: pr.body,
      state: prDetail.merged ? "merged" : (prDetail.state as "open" | "closed"),
      labels: pr.labels.map((l) => l.name || ""),
      assignees: pr.assignees?.map((a) => a.login) || [],
      author: pr.user?.login || "unknown",
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      headSha: prDetail.head.sha,
      baseSha: prDetail.base.sha,
      mergeBaseSha,
      baseBranch: prDetail.base.ref,
      headBranch: prDetail.head.ref,
      diff,
      diffTruncated,
      diffBytesCaptured,
      touchedFiles,
      reviewComments,
      ciStatus,
    });
  }

  return harvested;
}

/**
 * Extract file paths from a unified diff
 */
function extractFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  const diffPattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;

  let match;
  while ((match = diffPattern.exec(diff)) !== null) {
    files.add(match[2]); // Use the "b" path (new file path)
  }

  return Array.from(files).sort();
}

// =============================================================================
// SECURITY SIGNALS
// =============================================================================

/**
 * Harvest security signals via npm audit
 */
async function harvestSecuritySignals(workspaceRoot?: string): Promise<SecuritySignals> {
  if (!workspaceRoot) {
    return {
      source: "none",
      fetchedAt: null,
      vulnerabilities: null,
      fetchError: "No workspace root provided for security scan",
    };
  }

  // Check if package.json exists
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  try {
    await fs.access(packageJsonPath);
  } catch {
    return {
      source: "none",
      fetchedAt: null,
      vulnerabilities: null,
      fetchError: "No package.json found in workspace",
    };
  }

  try {
    // Run npm audit --json
    const { stdout } = await execAsync("npm audit --json", {
      cwd: workspaceRoot,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large audit output
    });

    const auditResult = JSON.parse(stdout);
    const vulnerabilities: Vulnerability[] = [];

    // Parse npm audit JSON format
    if (auditResult.vulnerabilities) {
      for (const [pkgName, vuln] of Object.entries(auditResult.vulnerabilities)) {
        const v = vuln as {
          severity: string;
          fixAvailable: boolean | { name: string };
          via: Array<{ url?: string }>;
        };
        vulnerabilities.push({
          severity: v.severity as Vulnerability["severity"],
          package: pkgName,
          fixAvailable: typeof v.fixAvailable === "boolean" ? v.fixAvailable : !!v.fixAvailable,
          advisory: v.via?.[0]?.url,
        });
      }
    }

    return {
      source: "npm_audit",
      fetchedAt: new Date().toISOString(),
      vulnerabilities,
      fetchError: null,
    };
  } catch (error) {
    // npm audit exits with non-zero when vulnerabilities found
    // Try to parse the output anyway
    const execError = error as { stdout?: string; stderr?: string; message?: string };

    if (execError.stdout) {
      try {
        const auditResult = JSON.parse(execError.stdout);
        const vulnerabilities: Vulnerability[] = [];

        if (auditResult.vulnerabilities) {
          for (const [pkgName, vuln] of Object.entries(auditResult.vulnerabilities)) {
            const v = vuln as {
              severity: string;
              fixAvailable: boolean | { name: string };
              via: Array<{ url?: string }>;
            };
            vulnerabilities.push({
              severity: v.severity as Vulnerability["severity"],
              package: pkgName,
              fixAvailable: typeof v.fixAvailable === "boolean" ? v.fixAvailable : !!v.fixAvailable,
              advisory: v.via?.[0]?.url,
            });
          }
        }

        return {
          source: "npm_audit",
          fetchedAt: new Date().toISOString(),
          vulnerabilities,
          fetchError: null,
        };
      } catch {
        // Parse failed
      }
    }

    return {
      source: "npm_audit",
      fetchedAt: new Date().toISOString(),
      vulnerabilities: null,
      fetchError: execError.message || "npm audit failed",
    };
  }
}

// =============================================================================
// MAIN HARVEST FUNCTION
// =============================================================================

/**
 * Harvest GitHub world-state into a deterministic bundle.
 *
 * @param client - GitHub client for API calls
 * @param params - Query parameters (owner, repo, filters)
 * @param options - Harvest options (skip flags, limits)
 * @returns HarvestBundle ready for analysis
 */
export async function harvest(
  client: GitHubClient,
  params: QueryParams,
  options: HarvestOptions = {}
): Promise<HarvestBundle> {
  const harvestedAt = new Date().toISOString();

  // Create adapter for harvest-specific API calls
  const adapter = new HarvestGitHubAdapter(client);

  // Pin the repository
  const repoPin = await harvestRepoPin(adapter);

  // Harvest issues
  const issues = await harvestIssues(adapter, options, params.issueFilter);

  // Harvest PRs
  const pullRequests = await harvestPRs(adapter, options, params.prFilter);

  // Harvest security signals
  const securitySignals = options.skipSecurity
    ? {
        source: "none" as const,
        fetchedAt: null,
        vulnerabilities: null,
        fetchError: "Security scan skipped by option",
      }
    : await harvestSecuritySignals(options.workspaceRoot);

  // Compute input digest
  const inputDigest = computeInputDigest(params);

  return {
    schemaVersion: "1.0.0",
    provenance: {
      harvestedAt,
      toolVersion: getToolVersion(),
      inputDigest,
    },
    queryParams: params,
    repoPin,
    issues,
    pullRequests,
    securitySignals,
  };
}

// =============================================================================
// BUNDLE PERSISTENCE
// =============================================================================

/**
 * Save a HarvestBundle to a file
 */
export async function saveHarvestBundle(bundle: HarvestBundle, filePath: string): Promise<void> {
  const json = canonicalJSONStringify(bundle);
  await fs.writeFile(filePath, json, "utf-8");
}

/**
 * Load and validate a HarvestBundle from a file
 */
export async function loadHarvestBundle(filePath: string): Promise<HarvestBundle> {
  const content = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(content);
  return parseHarvestBundle(data);
}

/**
 * Compute digest of a bundle for provenance linking
 */
export function computeBundleDigest(bundle: HarvestBundle): string {
  const canonical = canonicalJSONStringify(bundle);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
