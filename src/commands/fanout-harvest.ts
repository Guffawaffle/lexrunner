/**
 * D0 Harvest Command - Replayable Analysis Pipeline Phase 0
 *
 * Fetches and normalizes external state into a pinned HarvestBundle.
 * This is the only phase that touches external APIs (GitHub).
 *
 * Non-negotiable invariants enforced:
 * - §4 (Pinned Reality): All SHAs are pinned at fetch time
 * - §3 (Unknown is not False): Missing data marked as "unknown" or "unavailable"
 *
 * @module
 */

import { Command } from "commander";
import { createHash } from "node:crypto";
import { createGitHubAPI, GitHubAPI } from "../github/api.js";
import { throwExit } from "../cli/exitHandler.js";

// =============================================================================
// TYPES - Matching harvest-bundle.v1.schema.json
// =============================================================================

interface HarvestBundle {
  schemaVersion: "1.0.0";
  phase: "D0";
  timestamp: string;
  inputDigest: string;
  bundle: Bundle;
  outputDigest: string;
}

interface Bundle {
  repository: Repository;
  pullRequests: PullRequest[];
  issues: Issue[];
  harvestedAt: string;
}

interface Repository {
  owner: string;
  name: string;
  defaultBranch: string;
  defaultBranchSha: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  headSha: string;
  baseSha: string;
  mergeBaseSha: string | "unknown" | "unavailable";
  author: string;
  labels: string[];
  ciStatus: "pass" | "fail" | "pending" | "unknown" | "unavailable";
  reviewStatus: "approved" | "changes_requested" | "pending" | "none" | "unknown" | "unavailable";
  conflictStatus: "clean" | "conflicted" | "unknown" | "unavailable";
  updatedAt: string;
  body: string | "truncated";
  changedFiles: number | "unknown" | "unavailable";
  additions: number | "unknown" | "unavailable";
  deletions: number | "unknown" | "unavailable";
}

interface Issue {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  labels: string[];
  updatedAt: string;
  body: string | "truncated";
  assignees: string[];
}

// =============================================================================
// HARVEST LOGIC
// =============================================================================

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function computeInputDigest(owner: string, repo: string, state: string): string {
  const input = JSON.stringify({ owner, repo, state, timestamp: new Date().toISOString() });
  return sha256(input);
}

function canonicalStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort(), 2);
}

/**
 * Harvest external state from GitHub into a pinned bundle
 */
async function harvestFromGitHub(
  githubAPI: GitHubAPI,
  options: { state: "open" | "closed" | "all"; includeIssues: boolean; maxBody: number }
): Promise<HarvestBundle> {
  const timestamp = new Date().toISOString();
  const inputDigest = computeInputDigest(
    githubAPI.config.owner,
    githubAPI.config.repo,
    options.state
  );

  // Fetch repository info
  const repoInfo = await githubAPI.getRepository();
  const defaultBranch = repoInfo.default_branch;
  const defaultBranchRef = await githubAPI.getRef(`heads/${defaultBranch}`);

  const repository: Repository = {
    owner: githubAPI.config.owner,
    name: githubAPI.config.repo,
    defaultBranch,
    defaultBranchSha: defaultBranchRef.object.sha,
  };

  // Fetch pull requests
  const rawPRs = await githubAPI.discoverPullRequests(options.state);
  const pullRequests: PullRequest[] = await Promise.all(
    rawPRs.map(async (pr: any) => {
      // Get merge base SHA using compare API
      let mergeBaseSha: string | "unknown" | "unavailable" = "unknown";
      try {
        // Use the sha from the PR object (which contains both head and base)
        const comparison = await githubAPI.compare(pr.baseBranch, pr.sha);
        mergeBaseSha = comparison.merge_base_commit?.sha ?? "unavailable";
      } catch {
        mergeBaseSha = "unavailable";
      }

      // Determine CI status
      let ciStatus: PullRequest["ciStatus"] = "unknown";
      try {
        const checks = await githubAPI.getCheckRuns(pr.head.sha);
        if (checks.total_count === 0) {
          ciStatus = "pending";
        } else {
          const allComplete = checks.check_runs.every((c: any) => c.status === "completed");
          if (!allComplete) {
            ciStatus = "pending";
          } else {
            const anyFailed = checks.check_runs.some(
              (c: any) => c.conclusion !== "success" && c.conclusion !== "skipped"
            );
            ciStatus = anyFailed ? "fail" : "pass";
          }
        }
      } catch {
        ciStatus = "unavailable";
      }

      // Determine review status
      let reviewStatus: PullRequest["reviewStatus"] = "unknown";
      try {
        const reviews = await githubAPI.getReviews(pr.number);
        const latestByUser = new Map<string, string>();
        for (const review of reviews) {
          if (review.state !== "COMMENTED" && review.user?.login) {
            latestByUser.set(review.user.login, review.state);
          }
        }
        const states = Array.from(latestByUser.values());
        if (states.includes("CHANGES_REQUESTED")) {
          reviewStatus = "changes_requested";
        } else if (states.includes("APPROVED")) {
          reviewStatus = "approved";
        } else if (states.length > 0) {
          reviewStatus = "pending";
        } else {
          reviewStatus = "none";
        }
      } catch {
        reviewStatus = "unavailable";
      }

      // Determine conflict status
      let conflictStatus: PullRequest["conflictStatus"] = "unknown";
      if (pr.mergeable === true) {
        conflictStatus = "clean";
      } else if (pr.mergeable === false) {
        conflictStatus = "conflicted";
      }

      // Truncate body if too long
      let body: string | "truncated" = pr.body ?? "";
      if (body.length > options.maxBody) {
        body = "truncated";
      }

      return {
        number: pr.number,
        title: pr.title,
        state: pr.merged_at ? "merged" : pr.state,
        draft: pr.draft ?? false,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        mergeBaseSha,
        author: pr.user.login,
        labels: pr.labels.map((l: any) => l.name),
        ciStatus,
        reviewStatus,
        conflictStatus,
        updatedAt: pr.updated_at,
        body,
        changedFiles: pr.changed_files ?? "unknown",
        additions: pr.additions ?? "unknown",
        deletions: pr.deletions ?? "unknown",
      };
    })
  );

  // Fetch issues if requested
  let issues: Issue[] = [];
  if (options.includeIssues) {
    try {
      const rawIssues = await githubAPI.listIssues({ state: options.state });
      issues = rawIssues
        .filter((i: any) => !i.pull_request) // Exclude PRs
        .map((i: any) => {
          let body: string | "truncated" = i.body ?? "";
          if (body.length > options.maxBody) {
            body = "truncated";
          }
          return {
            number: i.number,
            title: i.title,
            state: i.state,
            author: i.user.login,
            labels: i.labels.map((l: any) => l.name),
            updatedAt: i.updated_at,
            body,
            assignees: i.assignees?.map((a: any) => a.login) ?? [],
          };
        });
    } catch {
      // Issues not critical - continue without them
    }
  }

  const bundle: Bundle = {
    repository,
    pullRequests,
    issues,
    harvestedAt: timestamp,
  };

  const outputDigest = sha256(canonicalStringify(bundle));

  return {
    schemaVersion: "1.0.0",
    phase: "D0",
    timestamp,
    inputDigest,
    bundle,
    outputDigest,
  };
}

// =============================================================================
// CLI COMMAND
// =============================================================================

export function registerHarvestCommand(fanoutCommand: Command): void {
  fanoutCommand
    .command("harvest")
    .description("D0: Harvest external state into pinned bundle")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--state <state>", "PR state filter (open|closed|all)", "open")
    .option("--include-issues", "Include issues in harvest", false)
    .option("--max-body <chars>", "Max body length before truncation", "4096")
    .option("--json", "Output JSON format (default)")
    .option("--output <file>", "Write output to file")
    .action(async (opts) => {
      try {
        let githubAPI = await createGitHubAPI();

        // Override with command line options if provided
        if (opts.owner && opts.repo) {
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
          console.error("     lex-pr fanout harvest --owner <owner> --repo <repo>\n");
          throwExit(1);
        }

        // Check authentication
        const authStatus = await githubAPI.checkAuth();
        if (!authStatus.authenticated) {
          console.warn(
            "⚠️  Warning: GitHub API not authenticated. Set GITHUB_TOKEN for better rate limits.\n"
          );
        }

        const harvestBundle = await harvestFromGitHub(githubAPI, {
          state: opts.state as "open" | "closed" | "all",
          includeIssues: opts.includeIssues,
          maxBody: parseInt(opts.maxBody, 10),
        });

        const output = JSON.stringify(harvestBundle, null, 2);

        if (opts.output) {
          const fs = await import("node:fs/promises");
          await fs.writeFile(opts.output, output, "utf-8");
          console.error(`✓ Harvest bundle written to ${opts.output}`);
          console.error(`  ${harvestBundle.bundle.pullRequests.length} PRs`);
          console.error(`  ${harvestBundle.bundle.issues.length} issues`);
          console.error(`  Digest: ${harvestBundle.outputDigest.slice(0, 20)}...`);
        } else {
          // Output to stdout (JSON only)
          console.log(output);
        }
      } catch (error) {
        console.error(`\n❌ Harvest failed: ${error instanceof Error ? error.message : error}\n`);
        throwExit(1);
      }
    });
}
