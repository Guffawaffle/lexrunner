/**
 * GitHub API client for PR discovery and metadata extraction
 * Implements the GitHubClient interface with authentication and rate limiting
 */

import { Octokit } from "@octokit/rest";
import { createTokenAuth } from "@octokit/auth-token";
import type {
	PullRequest,
	PullRequestDetails,
	PRQueryOptions,
	RepositoryInfo,
	GitHubIssue,
	IssueQueryOptions
} from "./types.js";
import {
	GitHubAPIError,
	GitHubRateLimitError,
	GitHubAuthError
} from "./types.js";
import { parsePRDescription, normalizeDependencyRef } from "../planner/index.js";
import { parseRemoteUrl } from "../git/parseRemote.js";

export type { PullRequest, PullRequestDetails, PRQueryOptions, RepositoryInfo, GitHubIssue, IssueQueryOptions };
export { GitHubAPIError, GitHubRateLimitError, GitHubAuthError };

export interface GitHubClient {
	listOpenPRs(options?: PRQueryOptions): Promise<PullRequest[]>;
	getPRDetails(number: number): Promise<PullRequestDetails>;
	getPRDependencies(pr: PullRequest): Promise<string[]>;
	validateRepository(): Promise<RepositoryInfo>;
	// Issue operations
	listIssues(options?: IssueQueryOptions): Promise<GitHubIssue[]>;
	// File analysis support
	getOctokit(): any; // Returns Octokit instance for advanced operations
	getOwner(): string;
	getRepo(): string;
}

export class GitHubClientImpl implements GitHubClient {
	private octokit: Octokit;
	private owner: string;
	private repo: string;

	constructor(options: {
		token?: string;
		owner: string;
		repo: string;
		octokit?: Octokit;
	}) {
		this.owner = options.owner;
		this.repo = options.repo;

		// Use injected Octokit if provided (for testing)
		if (options.octokit) {
			this.octokit = options.octokit;
		} else if (options.token) {
			// Initialize Octokit with authentication if token provided
			this.octokit = new Octokit({
				auth: options.token
			});
		} else {
			// Try to get token from environment
			const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
			if (token) {
				this.octokit = new Octokit({
					auth: token
				});
			} else {
				// Unauthenticated client (rate limited)
				this.octokit = new Octokit();
			}
		}
	}

	async validateRepository(): Promise<RepositoryInfo> {
		try {
			const response = await this.octokit.rest.repos.get({
				owner: this.owner,
				repo: this.repo
			});

			return {
				owner: this.owner,
				repo: this.repo,
				defaultBranch: response.data.default_branch,
				url: response.data.html_url
			};
		} catch (error: any) {
			if (error.status === 401) {
				throw new GitHubAuthError("GitHub authentication failed. Please provide a valid token.");
			}
			if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
				const resetTime = new Date(parseInt(error.response.headers['x-ratelimit-reset']) * 1000);
				throw new GitHubRateLimitError("GitHub API rate limit exceeded", resetTime);
			}
			if (error.status === 404) {
				throw new GitHubAPIError(`Repository ${this.owner}/${this.repo} not found or not accessible`);
			}
			throw new GitHubAPIError(`Failed to validate repository: ${error.message}`, error.status);
		}
	}

	async listOpenPRs(options: PRQueryOptions = {}): Promise<PullRequest[]> {
		try {
			const params: any = {
				owner: this.owner,
				repo: this.repo,
				state: options.state || "open",
				sort: options.sort || "created",
				direction: options.direction || "desc",
				per_page: options.per_page || 30,
				page: options.page ?? 1
			};

			if (options.base) params.base = options.base;
			if (options.head) params.head = options.head;

			// Use octokit.paginate to follow pagination automatically if available
			let allPRs: any[];
			if (typeof (this.octokit as any).paginate === 'function') {
				allPRs = await (this.octokit as any).paginate((this.octokit as any).rest.pulls.list, params);

				// Some test fakes return minimal objects (e.g., [{ number: 1 }]). If items are incomplete
				// (missing expected fields like 'title'), fallback to a single REST list call which
				// most mocks provide with full PR objects.
				if (allPRs.length > 0 && allPRs.some(item => typeof item.title === 'undefined')) {
					const response = await this.octokit.rest.pulls.list(params as any);
					allPRs = response.data || [];
				}
			} else {
				// Fallback: single page request
				const response = await this.octokit.rest.pulls.list(params as any);
				allPRs = response.data || [];
			}

			// Filter by labels if specified
			let prs = allPRs;
			if (options.labels && options.labels.length > 0) {
				prs = prs.filter((pr: any) =>
					options.labels!.some((label: string) =>
						pr.labels.some((prLabel: any) => prLabel.name === label)
					)
				);
			}

			return prs.map(this.transformPR);
		} catch (error: any) {
			return this.handleAPIError(error);
		}
	}

	async getPRDetails(number: number): Promise<PullRequestDetails> {
		try {
			const response = await this.octokit.rest.pulls.get({
				owner: this.owner,
				repo: this.repo,
				pull_number: number
			});

			const pr = this.transformPR(response.data);
			const dependencies = await this.getPRDependencies(pr);
			const tags = this.extractTags(pr);
			const requiredGates = this.extractRequiredGates(pr);

			// Parse PR description for additional metadata and gate overrides
			const parsed = parsePRDescription(pr.number, pr.body, {
				repository: `${this.owner}/${this.repo}`,
				partialExtraction: true
			});

			return {
				...pr,
				dependencies,
				tags,
				requiredGates,
				...(parsed.metadata && Object.keys(parsed.metadata).length > 0 ? { metadata: parsed.metadata } : {}),
				...(parsed.gates ? { gateOverrides: parsed.gates } : {})
			};
		} catch (error: any) {
			return this.handleAPIError(error);
		}
	}

	async getPRDependencies(pr: PullRequest): Promise<string[]> {
		if (!pr.body) {
			return [];
		}

		// Use the new dependency parser for comprehensive parsing
		const parsed = parsePRDescription(pr.number, pr.body, {
			repository: `${this.owner}/${this.repo}`,
			partialExtraction: true
		});

		// Normalize all dependencies to full format (owner/repo#123)
		const normalizedDeps = parsed.dependencies.map(dep =>
			normalizeDependencyRef(dep, `${this.owner}/${this.repo}`)
		);

		// Remove duplicates and sort for deterministic output
		return [...new Set(normalizedDeps)].sort();
	}

	async listIssues(options: IssueQueryOptions = {}): Promise<GitHubIssue[]> {
		try {
			const params: any = {
				owner: this.owner,
				repo: this.repo,
				state: options.state || "open",
				per_page: options.per_page || 100,
				page: options.page || 1,
				sort: options.sort || "created",
				direction: options.direction || "desc"
			};

			if (options.labels && options.labels.length > 0) {
				params.labels = options.labels.join(",");
			}

			if (options.assignee) {
				params.assignee = options.assignee;
			}

			if (options.creator) {
				params.creator = options.creator;
			}

			if (options.mentioned) {
				params.mentioned = options.mentioned;
			}

			const response = await this.octokit.rest.issues.listForRepo(params);

			// Filter out pull requests (GitHub API includes PRs in issues endpoint)
			const issues = response.data.filter((item: any) => !item.pull_request);

			return issues.map((issue: any) => ({
				number: issue.number,
				title: issue.title,
				body: issue.body,
				state: issue.state,
				labels: issue.labels.map((label: any) => ({
					name: label.name,
					color: label.color
				})),
				user: {
					login: issue.user.login
				},
				assignees: issue.assignees.map((assignee: any) => ({
					login: assignee.login
				})),
				createdAt: issue.created_at,
				updatedAt: issue.updated_at
			}));
		} catch (error: any) {
			return this.handleAPIError(error);
		}
	}

	private transformPR(prData: any): PullRequest {
		return {
			number: prData.number,
			title: prData.title,
			body: prData.body,
			head: {
				ref: prData.head.ref,
				sha: prData.head.sha
			},
			base: {
				ref: prData.base.ref,
				sha: prData.base.sha
			},
			state: prData.state,
			labels: prData.labels.map((label: any) => ({
				name: label.name,
				color: label.color
			})),
			draft: prData.draft || false,
			mergeable: prData.mergeable,
			user: {
				login: prData.user.login
			},
			createdAt: prData.created_at,
			updatedAt: prData.updated_at
		};
	}

	private extractTags(pr: PullRequest): string[] {
		// Extract tags from labels, filtering for stack-related labels
		const tags = pr.labels
			.map(label => label.name)
			.filter(name => name.startsWith('stack:') || name.startsWith('tag:'))
			.map(name => name.replace(/^(stack:|tag:)/, ''));

		return [...new Set(tags)].sort();
	}

	private extractRequiredGates(pr: PullRequest): string[] {
		const gates: string[] = [];

		// Extract from labels like "gate:lint", "gate:test"
		const gateLabels = pr.labels
			.map(label => label.name)
			.filter(name => name.startsWith('gate:'))
			.map(name => name.replace(/^gate:/, ''));

		gates.push(...gateLabels);

		// Use the dependency parser to extract gate overrides from PR body
		if (pr.body) {
			const parsed = parsePRDescription(pr.number, pr.body, { partialExtraction: true });
			if (parsed.gates?.required) {
				gates.push(...parsed.gates.required);
			}
		}

		return [...new Set(gates)].sort();
	}

	private handleAPIError(error: any): never {
		if (error.status === 401) {
			throw new GitHubAuthError("GitHub authentication failed. Please provide a valid token.");
		}
		if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
			const resetTime = new Date(parseInt(error.response.headers['x-ratelimit-reset']) * 1000);
			throw new GitHubRateLimitError("GitHub API rate limit exceeded", resetTime);
		}
		throw new GitHubAPIError(`GitHub API error: ${error.message}`, error.status);
	}

	// File analysis support methods
	getOctokit(): any {
		return this.octokit;
	}

	getOwner(): string {
		return this.owner;
	}

	getRepo(): string {
		return this.repo;
	}
}

/**
 * Factory function to create GitHub client with auto-detection of repository info
 */
export async function createGitHubClient(options: {
	token?: string;
	owner?: string;
	repo?: string;
	octokit?: Octokit;
} = {}): Promise<GitHubClient> {
	let owner = options.owner;
	let repo = options.repo;

	// Auto-detect repository info from git remote if not provided
	if (!owner || !repo) {
		try {
			const { execa } = await import("execa");

			// Prefer origin; fall back to first push remote from `git remote -v`
			let remoteUrl: string | undefined;
			try {
				const r = await execa("git", ["remote", "get-url", "origin"]);
				remoteUrl = r.stdout.trim();
			} catch (e) {
				// fallback: parse git remote -v for a push url
				const r = await execa("git", ["remote", "-v"]);
				const lines = r.stdout.trim().split(/\r?\n/);
				for (const line of lines) {
					// format: <name> <url> (fetch|push)
					const m = line.match(/^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/);
					if (m && m[3] === 'push') {
						remoteUrl = m[2];
						break;
					}
				}
				// if still not found, try first remote entry
				if (!remoteUrl && lines.length > 0) {
					const m = lines[0].match(/^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/);
					if (m) remoteUrl = m[2];
				}
			}

			if (remoteUrl) {
				const parsed = parseRemoteUrl(remoteUrl);
				owner = owner || parsed.owner;
				repo = repo || parsed.repo;
			}
		} catch (error) {
			// Ignore git command errors - user will need to provide explicit values
		}
	}

	if (!owner || !repo) {
		throw new GitHubAPIError("Repository owner and name must be provided or detectable from git remote");
	}

	// Support test injection via global fake Octokit (for CLI subprocess testing)
	let octokitToInject = options.octokit;
	if (!octokitToInject && process.env.LEX_PR_FAKE_OCTOKIT === '1') {
		const globalFake = (global as any).__FAKE_OCTOKIT;
		if (globalFake && typeof globalFake === 'object') {
			octokitToInject = globalFake;
		}
	}

	return new GitHubClientImpl({
		token: options.token,
		owner,
		repo,
		octokit: octokitToInject
	});
}
