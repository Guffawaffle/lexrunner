/**
 * GitHub API integration for PR discovery and metadata extraction
 * Maintains deterministic ordering and stable output
 * Includes error recovery with retry and circuit breaker patterns
 */

import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { stableSort } from "../util/canonicalJson.js";
import {
	retryWithBackoff,
	createGitHubCircuitBreaker,
	classifyError,
	formatErrorForUser,
	CircuitBreaker
} from "../core/errorRecovery.js";

/**
 * Normalize a label entry returned by octokit into a string name.
 * Labels can be returned as plain strings or objects with a `name` property.
 */
export function extractLabelName(label: any): string {
	if (!label) return '';
	if (typeof label === 'string') return label;
	if (typeof label.name === 'string') return label.name;
	return '';
}

export interface GitHubPullRequest {
	number: number;
	title: string;
	branch: string;
	sha: string;
	state: "open" | "closed" | "merged";
	labels: string[];
	author: string;
	baseBranch: string;
	createdAt: string;
	updatedAt: string;
	mergeable?: boolean;
}

export interface GitHubConfig {
	token?: string;
	owner: string;
	repo: string;
}

/**
 * GitHub API client for PR operations with error recovery
 */
export class GitHubAPI {
	private octokit: Octokit;
	public config: GitHubConfig;
	private circuitBreaker: CircuitBreaker;

	constructor(config: GitHubConfig) {
		this.config = config;
		this.octokit = new Octokit({
			auth: config.token || process.env.GITHUB_TOKEN,
		});
		this.circuitBreaker = createGitHubCircuitBreaker();
	}

	/**
	 * Discover open pull requests with stable ordering and error recovery
	 */
	async discoverPullRequests(state: "open" | "closed" | "all" = "open"): Promise<GitHubPullRequest[]> {
		return retryWithBackoff(
			async () => {
				return this.circuitBreaker.execute(async () => {
					try {
						const { data: pulls } = await this.octokit.rest.pulls.list({
							owner: this.config.owner,
							repo: this.config.repo,
							state,
							sort: "updated",
							direction: "desc",
							per_page: 100,
						});

						// Transform to our interface and sort for deterministic output
						const pullRequests: GitHubPullRequest[] = pulls.map(pull => ({
							number: pull.number,
							title: pull.title,
							branch: pull.head.ref,
							sha: pull.head.sha,
							state: pull.state as "open" | "closed" | "merged",
							labels: stableSort(pull.labels.map(extractLabelName)),
							author: pull.user?.login || 'unknown',
							baseBranch: pull.base.ref,
							createdAt: pull.created_at,
							updatedAt: pull.updated_at,
						}));

						// Sort by PR number for deterministic ordering
						pullRequests.sort((a, b) => a.number - b.number);
						return pullRequests;
					} catch (error) {
						const classified = classifyError(error, 'Fetching pull requests');
						console.error(formatErrorForUser(classified));
						throw new GitHubAPIError(`Failed to fetch pull requests: ${error instanceof Error ? error.message : String(error)}`);
					}
				});
			},
			{
				maxAttempts: 3,
				initialDelayMs: 1000,
				backoffMultiplier: 2
			},
			(attempt, error, delayMs) => {
				console.warn(`Retrying GitHub API call (attempt ${attempt}): ${error.error.message}. Waiting ${delayMs}ms...`);
			}
		);
	}

	/**
	 * Get repository information
	 */
	async getRepositoryInfo() {
		try {
			const { data: repo } = await this.octokit.rest.repos.get({
				owner: this.config.owner,
				repo: this.config.repo,
			});

			return {
				name: repo.name,
				fullName: repo.full_name,
				defaultBranch: repo.default_branch,
				private: repo.private,
			};
		} catch (error) {
			throw new GitHubAPIError(`Failed to fetch repository info: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Check if authentication is working
	 */
	async checkAuth(): Promise<{ authenticated: boolean; user?: string }> {
		try {
			const { data: user } = await this.octokit.rest.users.getAuthenticated();
			return {
				authenticated: true,
				user: user.login,
			};
		} catch (error) {
			return {
				authenticated: false,
			};
		}
	}

	/**
	 * Get a specific pull request by number
	 */
	async getPullRequest(prNumber: number): Promise<GitHubPullRequest | null> {
		try {
			const { data: pull } = await this.octokit.rest.pulls.get({
				owner: this.config.owner,
				repo: this.config.repo,
				pull_number: prNumber,
			});

			return {
				number: pull.number,
				title: pull.title,
				branch: pull.head.ref,
				sha: pull.head.sha,
				state: pull.state as "open" | "closed" | "merged",
				labels: stableSort(pull.labels.map(extractLabelName)),
				author: pull.user?.login || 'unknown',
				baseBranch: pull.base.ref,
				createdAt: pull.created_at,
				updatedAt: pull.updated_at,
				mergeable: pull.mergeable ?? undefined,
			};
		} catch (error) {
			return null;
		}
	}

	/**
	 * Add a label to a pull request
	 */
	async addLabel(prNumber: number, label: string): Promise<void> {
		try {
			await this.octokit.rest.issues.addLabels({
				owner: this.config.owner,
				repo: this.config.repo,
				issue_number: prNumber,
				labels: [label],
			});
		} catch (error) {
			throw new GitHubAPIError(`Failed to add label to PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Remove a label from a pull request
	 */
	async removeLabel(prNumber: number, label: string): Promise<void> {
		try {
			await this.octokit.rest.issues.removeLabel({
				owner: this.config.owner,
				repo: this.config.repo,
				issue_number: prNumber,
				name: label,
			});
		} catch (error) {
			throw new GitHubAPIError(`Failed to remove label from PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get labels for a pull request
	 */
	async getLabels(prNumber: number): Promise<string[]> {
		try {
			const { data: issue } = await this.octokit.rest.issues.get({
				owner: this.config.owner,
				repo: this.config.repo,
				issue_number: prNumber,
			});

			return stableSort(issue.labels.map(extractLabelName));
		} catch (error) {
			throw new GitHubAPIError(`Failed to get labels for PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

export class GitHubAPIError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GitHubAPIError";
	}
}

/**
 * Create GitHub API client from environment and config
 */
export async function createGitHubAPI(): Promise<GitHubAPI | null> {
	// Try to detect GitHub repository from current directory
	const repoInfo = await detectGitHubRepository();
	if (!repoInfo) {
		return null;
	}

	return new GitHubAPI({
		owner: repoInfo.owner,
		repo: repoInfo.repo,
		token: process.env.GITHUB_TOKEN,
	});
}

/**
 * Detect GitHub repository information from git remote
 */
async function detectGitHubRepository(): Promise<{ owner: string; repo: string } | null> {
	try {
		const git = simpleGit();
		const remotes = await git.getRemotes(true);

		// Look for origin remote first, then any GitHub remote
		const githubRemote = remotes.find(remote => remote.name === "origin" && remote.refs.fetch.includes("github.com"))
			|| remotes.find(remote => remote.refs.fetch.includes("github.com"));

		if (!githubRemote) {
			return null;
		}

		// Parse GitHub URL (supports both HTTPS and SSH formats)
		const url = githubRemote.refs.fetch;
		const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);

		if (!match) {
			return null;
		}

		return {
			owner: match[1],
			repo: match[2],
		};
	} catch {
		return null;
	}
}