/**
 * Batch GitHub operations for parallel API calls
 * Supports fetching multiple issues in parallel with rate limiting
 */

import type { GitHubClient } from "./client.js";
import type { GitHubIssue } from "./types.js";

/**
 * Issue reference in owner/repo#number format
 */
export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
  key: string; // Composite key: "owner/repo#number"
}

/**
 * Result of batch issue fetch
 */
export interface BatchIssueResult {
  issues: Map<string, GitHubIssue>;
  timing: {
    parallel: number;
    sequential: number;
  };
  errors: Map<string, Error>;
}

/**
 * Parse an issue reference string into components
 * Supports formats:
 * - #123 (current repo)
 * - repo#123 (same owner)
 * - owner/repo#123 (full reference)
 * - #123-125 (range in current repo)
 * - repo#123-125 (range in same owner)
 *
 * @param ref - Issue reference string
 * @param defaultOwner - Default owner if not specified
 * @param defaultRepo - Default repo if not specified
 * @returns Array of IssueRef objects
 */
export function parseIssueRef(ref: string, defaultOwner: string, defaultRepo: string): IssueRef[] {
  const refs: IssueRef[] = [];

  // Handle range format (e.g., #123-125 or repo#123-125)
  const rangeMatch = ref.match(/^(?:([^/]+)\/)?([^#]+)?#(\d+)-(\d+)$/);
  if (rangeMatch) {
    const owner = rangeMatch[1] || defaultOwner;
    const repo = rangeMatch[2] || defaultRepo;
    const start = parseInt(rangeMatch[3], 10);
    const end = parseInt(rangeMatch[4], 10);

    for (let num = start; num <= end; num++) {
      const key = `${owner}/${repo}#${num}`;
      refs.push({ owner, repo, number: num, key });
    }
    return refs;
  }

  // Handle single issue format
  const singleMatch = ref.match(/^(?:([^/]+)\/)?([^#]+)?#(\d+)$/);
  if (singleMatch) {
    const owner = singleMatch[1] || defaultOwner;
    const repo = singleMatch[2] || defaultRepo;
    const number = parseInt(singleMatch[3], 10);
    const key = `${owner}/${repo}#${number}`;
    refs.push({ owner, repo, number, key });
    return refs;
  }

  throw new Error(`Invalid issue reference format: ${ref}`);
}

/**
 * Parse multiple issue reference strings
 *
 * @param refs - Array of issue reference strings
 * @param defaultOwner - Default owner if not specified
 * @param defaultRepo - Default repo if not specified
 * @returns Array of IssueRef objects
 */
export function parseIssueRefs(
  refs: string[],
  defaultOwner: string,
  defaultRepo: string
): IssueRef[] {
  const allRefs: IssueRef[] = [];

  for (const ref of refs) {
    const parsed = parseIssueRef(ref, defaultOwner, defaultRepo);
    allRefs.push(...parsed);
  }

  return allRefs;
}

/**
 * Fetch multiple issues in parallel with rate limiting
 *
 * @param client - GitHub client instance
 * @param refs - Array of issue references to fetch
 * @returns Batch result with issues, timing, and errors
 */
export async function batchGetIssues(
  client: GitHubClient,
  refs: IssueRef[]
): Promise<BatchIssueResult> {
  const start = Date.now();
  const issues = new Map<string, GitHubIssue>();
  const errors = new Map<string, Error>();

  // Estimate sequential time (200ms per API call)
  const estimatedSequential = refs.length * 200;

  // Group refs by repository to minimize client switches
  const byRepo = new Map<string, IssueRef[]>();
  for (const ref of refs) {
    const repoKey = `${ref.owner}/${ref.repo}`;
    if (!byRepo.has(repoKey)) {
      byRepo.set(repoKey, []);
    }
    byRepo.get(repoKey)!.push(ref);
  }

  // Fetch all issues in parallel (with internal rate limiting handled by client)
  await Promise.all(
    Array.from(byRepo.entries()).map(async ([repoKey, repoRefs]) => {
      // For cross-repo fetches, we'll need to create separate clients
      // For now, assume same repo or client can handle it via getIssue
      for (const ref of repoRefs) {
        try {
          const issue = await getIssue(client, ref.owner, ref.repo, ref.number);
          if (issue) {
            issues.set(ref.key, issue);
          }
        } catch (error) {
          errors.set(ref.key, error instanceof Error ? error : new Error(String(error)));
        }
      }
    })
  );

  const parallel = Date.now() - start;

  return {
    issues,
    timing: {
      parallel,
      sequential: estimatedSequential,
    },
    errors,
  };
}

/**
 * Get a single issue from the GitHub API
 * This is a helper that adds getIssue functionality to the client
 *
 * @param client - GitHub client instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue number
 * @returns Issue data or null if not found
 */
async function getIssue(
  client: GitHubClient,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubIssue | null> {
  try {
    const octokit = client.getOctokit();
    const response = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const issue = response.data;

    // Filter out pull requests
    if (issue.pull_request) {
      return null;
    }

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state as "open" | "closed",
      labels: issue.labels.map((label: any) => ({
        name: typeof label === "string" ? label : label.name,
        color: typeof label === "string" ? "" : label.color,
      })),
      user: {
        login: issue.user.login,
      },
      assignees: issue.assignees.map((assignee: any) => ({
        login: assignee.login,
      })),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    };
  } catch (error: any) {
    // Return null for 404s, throw for other errors
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}
