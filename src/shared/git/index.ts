/**
 * Git utilities module
 *
 * Provides centralized git operations with safe defaults for automation.
 *
 * @module shared/git
 */

export {
	runGit,
	getCurrentBranch,
	getCurrentCommit,
	getRemoteUrl,
	isGitRepository,
	getRepositoryRoot,
	isGitDryRun,
	type GitResult,
	type RunGitOptions,
} from "./runGit.js";
