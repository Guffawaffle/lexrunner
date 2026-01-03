/**
 * Issues command - Check status of GitHub issues with batch support
 */

import { Command } from "commander";
import chalk from "chalk";
import { GitHubClientImpl } from "../github/client.js";
import { parseIssueRefs, batchGetIssues, type IssueRef } from "../github/batch-ops.js";
import { getIssueCache } from "../cache/issue-cache.js";
import type { GitHubIssue } from "../github/types.js";

// Default repository configuration (can be overridden by environment variables)
const DEFAULT_OWNER = "Guffawaffle";
const DEFAULT_REPO = "lexrunner";

// Output formatting constants
const KEY_COLUMN_WIDTH = 25;
const STATE_COLUMN_WIDTH = 15;

interface IssuesStatusOptions {
  cache?: boolean;
  cacheTtl?: number;
}

/**
 * Register the issues command with Commander
 */
export function registerIssuesCommand(program: Command): void {
  const issuesCmd = program.command("issues").description("Check status of GitHub issues");

  issuesCmd
    .command("status")
    .description("Check status of one or more issues")
    .argument("<refs...>", "Issue references (e.g., #123, repo#456, owner/repo#789, #100-105)")
    .option("--no-cache", "Disable caching")
    .option("--cache-ttl <ms>", "Cache TTL in milliseconds", "60000")
    .action(async (refs: string[], options: IssuesStatusOptions) => {
      try {
        await handleIssuesStatus(refs, options);
      } catch (error) {
        console.error(chalk.red("Error:"), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

/**
 * Handle the issues status command
 */
async function handleIssuesStatus(
  refStrings: string[],
  options: IssuesStatusOptions
): Promise<void> {
  // Detect repository from environment
  const owner = process.env.GITHUB_REPOSITORY_OWNER || DEFAULT_OWNER;
  const repo = process.env.GITHUB_REPOSITORY_NAME || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN environment variable is required");
  }

  // Create GitHub client
  const client = new GitHubClientImpl({ token, owner, repo });

  // Parse issue references
  const refs = parseIssueRefs(refStrings, owner, repo);

  // Setup cache if enabled
  const cache =
    options.cache !== false
      ? getIssueCache({ ttl: parseInt(String(options.cacheTtl || 60000), 10) })
      : null;

  // Check cache first
  const uncachedRefs: IssueRef[] = [];
  const cachedIssues = new Map<string, GitHubIssue>();

  if (cache) {
    for (const ref of refs) {
      const cached = cache.get(ref.key);
      if (cached) {
        cachedIssues.set(ref.key, cached);
      } else {
        uncachedRefs.push(ref);
      }
    }
  } else {
    uncachedRefs.push(...refs);
  }

  // Fetch uncached issues
  let batchResult;
  if (uncachedRefs.length > 0) {
    batchResult = await batchGetIssues(client, uncachedRefs);

    // Store in cache
    if (cache) {
      for (const [key, issue] of batchResult.issues) {
        cache.set(key, issue);
      }
    }
  } else {
    batchResult = {
      issues: new Map(),
      timing: { parallel: 0, sequential: 0 },
      errors: new Map(),
    };
  }

  // Combine cached and fresh issues
  const allIssues = new Map([...cachedIssues, ...batchResult.issues]);

  // Calculate timing
  const totalSaved = batchResult.timing.sequential - batchResult.timing.parallel;
  const cacheHits = cachedIssues.size;
  const cacheMisses = uncachedRefs.length;

  // Display results
  console.log(
    chalk.bold(`Issue Status (fetched in ${batchResult.timing.parallel}ms, saved ${totalSaved}ms)`)
  );

  if (cache && (cacheHits > 0 || cacheMisses > 0)) {
    console.log(chalk.dim(`  Cache: ${cacheHits} hits, ${cacheMisses} misses`));
  }

  console.log();

  // Show issues in order requested
  let closedCount = 0;
  let openCount = 0;

  for (const ref of refs) {
    const issue = allIssues.get(ref.key);
    const error = batchResult.errors.get(ref.key);

    if (error) {
      console.log(
        `  ${chalk.red("✗")} ${chalk.cyan(ref.key)}  ${chalk.red("ERROR")}  ${error.message}`
      );
    } else if (!issue) {
      console.log(`  ${chalk.yellow("?")} ${chalk.cyan(ref.key)}  ${chalk.yellow("NOT FOUND")}`);
    } else {
      const stateIcon = issue.state === "closed" ? chalk.green("✅") : chalk.yellow("⏳");
      const stateText = issue.state === "closed" ? chalk.green("CLOSED") : chalk.yellow("OPEN");

      console.log(
        `  ${stateIcon} ${chalk.cyan(ref.key).padEnd(KEY_COLUMN_WIDTH)}  ${stateText.padEnd(STATE_COLUMN_WIDTH)}  ${chalk.white(issue.title)}`
      );

      if (issue.state === "closed") {
        closedCount++;
      } else {
        openCount++;
      }
    }
  }

  // Summary
  console.log();
  console.log(
    chalk.bold(`Summary: ${closedCount}/${refs.length} closed, ${openCount}/${refs.length} open`)
  );
}
