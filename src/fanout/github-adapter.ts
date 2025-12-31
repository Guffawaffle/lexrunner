/**
 * GitHub API Adapter for D0 Harvest
 *
 * Provides harvest-specific methods by wrapping a GitHubClient.
 * Uses getOctokit() for operations not in the main interface.
 *
 * This adapter exists to:
 * 1. Keep the main GitHubClient interface focused on PR management
 * 2. Provide harvest-specific methods without interface pollution
 * 3. Handle Octokit response normalization for harvest needs
 *
 * @module
 */

import type { GitHubClient } from "../github/client.js";
import type { Octokit } from "@octokit/rest";

/**
 * Raw issue from GitHub API (subset of fields we care about)
 */
export interface RawIssue {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name?: string } | string>;
  assignees?: Array<{ login: string }>;
  user?: { login: string };
  created_at: string;
  updated_at: string;
  comments: number;
  pull_request?: unknown; // Present if issue is actually a PR
}

/**
 * Raw comment from GitHub API
 */
export interface RawComment {
  id: number;
  user?: { login: string };
  body?: string;
  created_at: string;
}

/**
 * Raw PR from GitHub API (subset)
 */
export interface RawPR {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name?: string }>;
  assignees?: Array<{ login: string }>;
  user?: { login: string };
  created_at: string;
  updated_at: string;
  merged?: boolean;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
}

/**
 * Raw PR file from GitHub API
 */
export interface RawPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

/**
 * Raw review comment from GitHub API
 */
export interface RawReviewComment {
  id: number;
  user?: { login: string };
  body?: string;
  path: string;
  line?: number | null;
}

/**
 * Raw combined status from GitHub API
 */
export interface RawCombinedStatus {
  state: string;
  total_count: number;
  statuses: Array<{ state: string }>;
}

/**
 * Raw commit comparison from GitHub API
 */
export interface RawComparison {
  merge_base_commit?: { sha: string };
}

/**
 * Adapter for harvest-specific GitHub operations
 */
export class HarvestGitHubAdapter {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(client: GitHubClient) {
    this.octokit = client.getOctokit() as Octokit;
    this.owner = client.getOwner();
    this.repo = client.getRepo();
  }

  /**
   * Get repository info (for default branch)
   */
  async getRepository(): Promise<{ default_branch: string }> {
    const { data } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return { default_branch: data.default_branch };
  }

  /**
   * Get branch info (for HEAD SHA)
   */
  async getBranch(branchName: string): Promise<{ commit: { sha: string } }> {
    const { data } = await this.octokit.rest.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch: branchName,
    });
    return { commit: { sha: data.commit.sha } };
  }

  /**
   * List issues (filtering out PRs happens in caller)
   */
  async listIssues(options?: {
    state?: "open" | "closed" | "all";
    labels?: string;
    per_page?: number;
  }): Promise<RawIssue[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state: options?.state || "open",
      labels: options?.labels,
      per_page: options?.per_page || 100,
    });
    return data as RawIssue[];
  }

  /**
   * List issue comments
   */
  async listIssueComments(issueNumber: number): Promise<RawComment[]> {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    return data as RawComment[];
  }

  /**
   * List pull requests
   */
  async listPullRequests(options?: {
    state?: "open" | "closed" | "all";
    per_page?: number;
  }): Promise<RawPR[]> {
    const { data } = await this.octokit.rest.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: options?.state || "open",
      per_page: options?.per_page || 100,
    });
    return data as RawPR[];
  }

  /**
   * Get single PR details
   */
  async getPullRequest(prNumber: number): Promise<RawPR> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    return data as RawPR;
  }

  /**
   * Get PR diff as unified diff text
   */
  async getPullRequestDiff(prNumber: number): Promise<string> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });
    return data as unknown as string;
  }

  /**
   * List files changed in PR
   */
  async listPullRequestFiles(prNumber: number): Promise<RawPRFile[]> {
    const { data } = await this.octokit.rest.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return data as RawPRFile[];
  }

  /**
   * List review comments on PR (inline code comments)
   */
  async listPullRequestReviewComments(prNumber: number): Promise<RawReviewComment[]> {
    const { data } = await this.octokit.rest.pulls.listReviewComments({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return data as RawReviewComment[];
  }

  /**
   * Get combined commit status
   */
  async getCombinedStatus(sha: string): Promise<RawCombinedStatus> {
    const { data } = await this.octokit.rest.repos.getCombinedStatusForRef({
      owner: this.owner,
      repo: this.repo,
      ref: sha,
    });
    return data as RawCombinedStatus;
  }

  /**
   * Compare two commits (for merge-base)
   */
  async compareCommits(baseSha: string, headSha: string): Promise<RawComparison> {
    const { data } = await this.octokit.rest.repos.compareCommits({
      owner: this.owner,
      repo: this.repo,
      base: baseSha,
      head: headSha,
    });
    return data as RawComparison;
  }
}
