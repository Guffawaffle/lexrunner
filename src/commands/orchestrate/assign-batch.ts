/**
 * CLI command for batch agent assignment
 * Command: lex-pr orchestrate:assign-batch
 */

import { Command } from "commander";
import {
  assignAgentsToBatch,
  formatAssignmentLog,
  AssignmentLog,
} from "../../orchestration/index.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import * as fs from "fs";

/**
 * Mock agent assignment function (placeholder for actual GitHub API integration)
 * In production, this would call the GitHub Copilot agent assignment API
 */
async function mockAssignCopilotAgent(repo: string, issueNumber: number): Promise<any> {
  // This is a placeholder - in production this would make an actual API call
  // For now, we just simulate success
  return {
    url: `https://github.com/${repo}/issues/${issueNumber}`,
  };
}

/**
 * Parse issue numbers from comma-separated string
 */
function parseIssueNumbers(issuesArg: string): number[] {
  return issuesArg
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
}

/**
 * Load issue numbers from batch plan JSON
 */
function loadIssuesFromBatchPlan(batchPlanPath: string): number[] {
  const content = fs.readFileSync(batchPlanPath, "utf-8");
  const batchPlan = JSON.parse(content);

  // Extract issue numbers from batch plan
  // Expected format: { items: [{ issueNumber: 123 }, ...] } or similar
  if (Array.isArray(batchPlan.items)) {
    return batchPlan.items
      .map((item: any) => item.issueNumber || item.issue || item.number)
      .filter((n: any) => typeof n === "number");
  }

  if (Array.isArray(batchPlan.issues)) {
    return batchPlan.issues;
  }

  throw new Error('Batch plan must contain "items" or "issues" array');
}

/**
 * Get repository from environment or git config
 */
async function getRepository(): Promise<string> {
  // Try GITHUB_REPOSITORY environment variable (set in CI)
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  // Try to get from git remote
  try {
    const { simpleGit } = await import("simple-git");
    const git = simpleGit();
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");

    if (origin?.refs?.fetch) {
      // Parse GitHub URL: https://github.com/owner/repo.git or git@github.com:owner/repo.git
      const match = origin.refs.fetch.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    // Ignore git errors
  }

  throw new Error(
    "Could not determine repository. Set GITHUB_REPOSITORY environment variable or run in a git repository."
  );
}

/**
 * Register orchestrate:assign-batch command
 */
export function registerAssignBatchCommand(program: Command): void {
  const assignBatch = program
    .command("orchestrate:assign-batch")
    .description(
      "Bulk-assign GitHub Copilot agents to batched issues [DEPRECATED: Use 'lexrunner fanout assign']"
    )
    .option("--batch <file>", "Batch plan JSON file")
    .option("--issues <numbers>", "Comma-separated issue numbers (e.g., 156,157,160)")
    .option("--repo <owner/repo>", "GitHub repository (default: auto-detect)")
    .option("--dry-run", "Show what would be assigned without actually doing it")
    .option("--stagger <seconds>", "Wait N seconds between assignments (default: 5)", "5")
    .action(async (options, command) => {
      // Get global options for JSON mode
      const globalOpts = command.optsWithGlobals();
      const isJsonMode = globalOpts.json || false;

      try {
        // Validate inputs
        if (!options.batch && !options.issues) {
          throw new Error("Must specify either --batch or --issues");
        }

        if (options.batch && options.issues) {
          throw new Error("Cannot specify both --batch and --issues");
        }

        // Get issue numbers
        let issues: number[];
        if (options.batch) {
          issues = loadIssuesFromBatchPlan(options.batch);
        } else {
          issues = parseIssueNumbers(options.issues);
        }

        if (issues.length === 0) {
          throw new Error("No issues to assign");
        }

        // Get repository
        const repo = options.repo || (await getRepository());

        // Parse stagger option
        const stagger = parseInt(options.stagger, 10);
        if (isNaN(stagger) || stagger < 0) {
          throw new Error("Stagger must be a non-negative number");
        }

        // Dry-run output
        if (options.dryRun) {
          if (isJsonMode) {
            const dryRunResult = {
              dryRun: true,
              issues,
              repo,
              stagger,
            };
            console.log(canonicalJSONStringify(dryRunResult));
            process.exit(0);
          } else {
            console.log(`Dry-Run: Would assign ${issues.length} issue(s)`);
            for (const issueNumber of issues) {
              console.log(`- ${repo}#${issueNumber}`);
            }
            process.exit(0);
          }
          return;
        }

        // Assign agents
        const log = await assignAgentsToBatch(
          issues,
          {
            repo,
            dryRun: false,
            stagger,
          },
          mockAssignCopilotAgent
        );

        // Output results
        if (isJsonMode) {
          console.log(canonicalJSONStringify(log));
        } else {
          console.log(formatAssignmentLog(log, repo));
        }

        // Exit with appropriate code
        if (log.summary.failed > 0) {
          process.exit(1);
        }
      } catch (error: any) {
        if (isJsonMode) {
          console.error(
            canonicalJSONStringify({
              error: error.message || String(error),
            })
          );
        } else {
          console.error(`❌ Error: ${error.message || String(error)}`);
        }
        process.exit(1);
      }
    });
}
