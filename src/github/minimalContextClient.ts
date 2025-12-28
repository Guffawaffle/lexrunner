/**
 * GitHub client extensions for minimal context packaging
 * Provides high-level methods to get PRs with minimal context
 */

import type { GitHubClient } from "./client.js";
import type { PullRequest } from "./types.js";
import {
  buildMinimalContext,
  buildMinimalPRContext,
  type CompleteMinimalContext,
} from "./contextDiet.js";

export interface MinimalContextOptions {
  /** Include diff hunks */
  includeDiff?: boolean;
  /** Include symbol maps */
  includeSymbols?: boolean;
}

/**
 * Get minimal context for a single PR
 */
export async function getPRMinimalContext(
  client: GitHubClient,
  prNumber: number,
  options: MinimalContextOptions = {}
): Promise<CompleteMinimalContext> {
  // Get PR details
  const pr = await client.getPRDetails(prNumber);

  // Get diff if requested
  let diff: string | undefined;
  if (options.includeDiff) {
    try {
      diff = await client.getPRDiff(prNumber);
    } catch (error) {
      console.warn(`Failed to fetch diff for PR #${prNumber}:`, error);
    }
  }

  // Get files if requested
  let files: Array<{ path: string; content: string }> | undefined;
  if (options.includeSymbols) {
    try {
      files = await client.getPRFiles(prNumber);
    } catch (error) {
      console.warn(`Failed to fetch files for PR #${prNumber}:`, error);
    }
  }

  return buildMinimalPRContext(pr as PullRequest, diff, files);
}

/**
 * Get minimal context for multiple PRs
 */
export async function getPRsMinimalContext(
  client: GitHubClient,
  prNumbers: number[],
  options: MinimalContextOptions = {}
): Promise<CompleteMinimalContext> {
  // Get PR details for all PRs
  const prs = await Promise.all(
    prNumbers.map(async (num) => {
      try {
        return await client.getPRDetails(num);
      } catch (error) {
        console.warn(`Failed to fetch PR #${num}:`, error);
        return null;
      }
    })
  );

  const validPRs = prs.filter((pr): pr is NonNullable<typeof pr> => pr !== null);

  // For multiple PRs, we don't include individual diffs/files
  // Instead, we just filter the metadata
  return buildMinimalContext(validPRs as PullRequest[]);
}

/**
 * Get minimal context for all open PRs with optional filters
 */
export async function getOpenPRsMinimalContext(
  client: GitHubClient,
  options: MinimalContextOptions & {
    labels?: string[];
    excludeDrafts?: boolean;
  } = {}
): Promise<CompleteMinimalContext> {
  // List all open PRs
  const prs = await client.listOpenPRs({
    state: "open",
    labels: options.labels,
  });

  // Filter out drafts if requested
  let filteredPRs = prs;
  if (options.excludeDrafts) {
    filteredPRs = prs.filter((pr) => !pr.draft);
  }

  return buildMinimalContext(filteredPRs);
}
