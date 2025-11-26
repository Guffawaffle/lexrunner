/**
 * Runtime gate for git operations
 *
 * Controls git access via environment variables:
 * - LEX_GIT_MODE: "off" | "live" (default: "off")
 * - LEX_DEFAULT_BRANCH: fallback branch name when git is disabled (default: "main")
 * - LEX_DEFAULT_COMMIT: fallback commit SHA when git is disabled (default: "0000000000000000000000000000000000000000")
 *
 * @module src/shared/git/runtime
 */

/**
 * Git mode values
 */
export type GitMode = "off" | "live";

/**
 * Default commit SHA when git is disabled (40 zeros)
 */
const DEFAULT_COMMIT_SHA = "0000000000000000000000000000000000000000";

/**
 * Default branch name when git is disabled
 */
const DEFAULT_BRANCH_NAME = "main";

/**
 * Get the current git mode from environment
 *
 * @returns "off" or "live" based on LEX_GIT_MODE environment variable
 */
export function getGitMode(): GitMode {
	const mode = process.env.LEX_GIT_MODE?.toLowerCase();
	if (mode === "live") {
		return "live";
	}
	// Default to "off" for safety in CI/ephemeral environments
	return "off";
}

/**
 * Check if git operations are enabled
 *
 * @returns true if LEX_GIT_MODE is "live", false otherwise
 */
export function isGitEnabled(): boolean {
	return getGitMode() === "live";
}

/**
 * Get the default branch name to use when git is disabled
 *
 * @returns LEX_DEFAULT_BRANCH if set, otherwise "main"
 */
export function getDefaultBranch(): string {
	return process.env.LEX_DEFAULT_BRANCH || DEFAULT_BRANCH_NAME;
}

/**
 * Get the default commit SHA to use when git is disabled
 *
 * @returns LEX_DEFAULT_COMMIT if set, otherwise 40 zeros
 */
export function getDefaultCommit(): string {
	return process.env.LEX_DEFAULT_COMMIT || DEFAULT_COMMIT_SHA;
}
