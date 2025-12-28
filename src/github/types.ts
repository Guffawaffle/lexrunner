/**
 * GitHub API integration types
 * Defines data structures for PR metadata and repository information
 */

export interface RepositoryInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  head: {
    ref: string; // branch name
    sha: string;
  };
  base: {
    ref: string; // target branch
    sha: string;
  };
  state: "open" | "closed" | "merged";
  labels: Array<{
    name: string;
    color: string;
  }>;
  draft: boolean;
  mergeable?: boolean | null;
  user: {
    login: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestDetails extends PullRequest {
  dependencies: string[]; // Parsed from "Depends-on:" footers and other formats
  tags: string[]; // Extracted from labels
  requiredGates: string[]; // Extracted from labels or body
  metadata?: {
    priority?: string;
    labels?: string[];
    [key: string]: any;
  };
  gateOverrides?: {
    skip?: string[];
    required?: string[];
  };
}

export interface PRQueryOptions {
  state?: "open" | "closed" | "all";
  labels?: string[];
  query?: string; // GitHub search query syntax
  base?: string; // base branch filter
  head?: string; // head branch filter
  sort?: "created" | "updated" | "popularity" | "long-running";
  direction?: "asc" | "desc";
  per_page?: number;
  page?: number;
}

/**
 * Error types for GitHub API integration
 */
export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "GitHubAPIError";
  }
}

export class GitHubRateLimitError extends GitHubAPIError {
  constructor(
    message: string,
    public readonly resetTime: Date
  ) {
    super(message, 403, "RATE_LIMITED");
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubAuthError extends GitHubAPIError {
  constructor(message: string) {
    super(message, 401, "AUTH_ERROR");
    this.name = "GitHubAuthError";
  }
}

/**
 * GitHub Issue representation
 */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{
    name: string;
    color: string;
  }>;
  user: {
    login: string;
  };
  assignees: Array<{
    login: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Query options for listing issues
 */
export interface IssueQueryOptions {
  state?: "open" | "closed" | "all";
  labels?: string[];
  assignee?: string;
  creator?: string;
  mentioned?: string;
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  per_page?: number;
  page?: number;
}
