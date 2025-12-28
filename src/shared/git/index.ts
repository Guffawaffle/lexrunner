/**
 * Shared git utilities
 *
 * Provides centralized git operations with safe defaults for automation.
 * Exports runtime gate functions and git operation wrappers.
 *
 * @module shared/git
 */

// Runtime gate for git operations (LEX_GIT_MODE)
export {
  getGitMode,
  isGitEnabled,
  getDefaultBranch,
  getDefaultCommit,
  type GitMode,
} from "./runtime.js";

// Git operation wrappers with safe defaults
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
