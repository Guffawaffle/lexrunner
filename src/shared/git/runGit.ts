/**
 * Centralized Git Wrapper
 *
 * Provides safe git invocations with:
 * - GPG signing disabled for automation (`-c commit.gpgsign=false`)
 * - Support for dry-run mode via `LEX_GIT_MODE=off` environment variable
 * - Consistent return type: { exitCode, stdout, stderr }
 */

import { spawnSync } from "node:child_process";

/**
 * Result from a git command execution
 */
export interface GitResult {
	/** Exit code from the git command (0 = success) */
	exitCode: number;
	/** Standard output from the command */
	stdout: string;
	/** Standard error output from the command */
	stderr: string;
}

/**
 * Options for runGit
 */
export interface RunGitOptions {
	/** Working directory for the git command */
	cwd?: string;
	/** Timeout in milliseconds (default: 30000) */
	timeout?: number;
	/** Whether to disable GPG signing (default: true) */
	disableGpgSign?: boolean;
	/** Fallback values for dry-run mode */
	dryRunFallback?: GitResult;
}

/**
 * Default fallback values for dry-run mode
 */
const DEFAULT_DRY_RUN_FALLBACK: GitResult = {
	exitCode: 0,
	stdout: "",
	stderr: "",
};

/**
 * Check if git dry-run mode is enabled
 *
 * When LEX_GIT_MODE=off, git commands return configured fallback values
 * instead of executing actual git commands.
 */
export function isGitDryRun(): boolean {
	return process.env.LEX_GIT_MODE === "off";
}

/**
 * Execute a git command with safe defaults
 *
 * Features:
 * - Disables GPG signing by default to avoid prompts in automation
 * - Returns structured result with exitCode, stdout, stderr
 * - Supports dry-run mode via LEX_GIT_MODE=off
 *
 * @param args - Git command arguments (e.g., ["status", "--short"])
 * @param options - Execution options
 * @returns Git command result
 *
 * @example
 * ```ts
 * const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
 * if (result.exitCode === 0) {
 *   console.log("Current branch:", result.stdout.trim());
 * }
 * ```
 */
export function runGit(args: string[], options: RunGitOptions = {}): GitResult {
	const {
		cwd = process.cwd(),
		timeout = 30000,
		disableGpgSign = true,
		dryRunFallback = DEFAULT_DRY_RUN_FALLBACK,
	} = options;

	// Check for dry-run mode
	if (isGitDryRun()) {
		return dryRunFallback;
	}

	// Build git command with safe defaults
	const gitArgs: string[] = [];

	// Add GPG signing disable flag for commit operations
	if (disableGpgSign) {
		gitArgs.push("-c", "commit.gpgsign=false");
	}

	// Add user-provided arguments
	gitArgs.push(...args);

	try {
		const result = spawnSync("git", gitArgs, {
			cwd,
			timeout,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (result.error) {
			// Process error (e.g., timeout, spawn failure)
			return {
				exitCode: 1,
				stdout: "",
				stderr: result.error.message,
			};
		}

		return {
			exitCode: result.status ?? 0,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
		};
	} catch (error) {
		// Unexpected error (shouldn't happen with spawnSync)
		const err = error as Error;
		return {
			exitCode: 1,
			stdout: "",
			stderr: err.message ?? "Unknown error",
		};
	}
}

/**
 * Get the current git branch name
 *
 * @param cwd - Working directory (default: process.cwd())
 * @returns Branch name or empty string if not in a git repository
 *
 * @example
 * ```ts
 * const branch = getCurrentBranch();
 * console.log(`Current branch: ${branch}`);
 * ```
 */
export function getCurrentBranch(cwd?: string): string {
	const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd,
		disableGpgSign: false, // No GPG config needed for read operations
		dryRunFallback: {
			exitCode: 0,
			stdout: "main",
			stderr: "",
		},
	});

	if (result.exitCode === 0) {
		return result.stdout.trim();
	}

	return "";
}

/**
 * Get the current git commit SHA
 *
 * @param cwd - Working directory (default: process.cwd())
 * @param short - Return short SHA (7 characters) instead of full SHA
 * @returns Commit SHA or empty string if not in a git repository
 *
 * @example
 * ```ts
 * const commit = getCurrentCommit();
 * const shortCommit = getCurrentCommit(undefined, true);
 * ```
 */
export function getCurrentCommit(cwd?: string, short?: boolean): string {
	const args = short
		? ["rev-parse", "--short", "HEAD"]
		: ["rev-parse", "HEAD"];

	const result = runGit(args, {
		cwd,
		disableGpgSign: false, // No GPG config needed for read operations
		dryRunFallback: {
			exitCode: 0,
			stdout: short ? "abc1234" : "abc1234567890def1234567890abc1234567890de",
			stderr: "",
		},
	});

	if (result.exitCode === 0) {
		return result.stdout.trim();
	}

	return "";
}

/**
 * Get the remote URL for a repository
 *
 * @param cwd - Working directory (default: process.cwd())
 * @param remote - Remote name (default: "origin")
 * @returns Remote URL or empty string if not found
 *
 * @example
 * ```ts
 * const url = getRemoteUrl();
 * console.log(`Remote URL: ${url}`);
 * ```
 */
export function getRemoteUrl(cwd?: string, remote: string = "origin"): string {
	const result = runGit(["remote", "get-url", remote], {
		cwd,
		disableGpgSign: false, // No GPG config needed for read operations
		dryRunFallback: {
			exitCode: 0,
			stdout: "https://github.com/example/repo.git",
			stderr: "",
		},
	});

	if (result.exitCode === 0) {
		return result.stdout.trim();
	}

	return "";
}

/**
 * Check if the current directory is inside a git repository
 *
 * @param cwd - Working directory (default: process.cwd())
 * @returns true if inside a git repository
 */
export function isGitRepository(cwd?: string): boolean {
	const result = runGit(["rev-parse", "--is-inside-work-tree"], {
		cwd,
		disableGpgSign: false,
		dryRunFallback: {
			exitCode: 0,
			stdout: "true",
			stderr: "",
		},
	});

	return result.exitCode === 0 && result.stdout.trim() === "true";
}

/**
 * Get the root directory of the git repository
 *
 * @param cwd - Working directory (default: process.cwd())
 * @returns Repository root path or empty string if not in a repository
 */
export function getRepositoryRoot(cwd?: string): string {
	const result = runGit(["rev-parse", "--show-toplevel"], {
		cwd,
		disableGpgSign: false,
		dryRunFallback: {
			exitCode: 0,
			stdout: process.cwd(),
			stderr: "",
		},
	});

	if (result.exitCode === 0) {
		return result.stdout.trim();
	}

	return "";
}
