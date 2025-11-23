/**
 * Git test utilities for creating test repositories without GPG signing issues
 */
import { execSync } from "child_process";

/**
 * Initialize a git repository in the given directory with GPG signing disabled.
 * This prevents "Inappropriate ioctl for device" errors in test environments.
 *
 * @param cwd - Directory to initialize as a git repo
 * @param branch - Initial branch name (default: "main")
 */
export function initTestGitRepo(cwd: string, branch = "main"): void {
	try {
		// Try git init with -b flag (Git 2.28+)
		execSync(`git init -b ${branch}`, { cwd, stdio: "pipe" });
	} catch {
		// Fallback for older git versions
		execSync("git init", { cwd, stdio: "pipe" });
		execSync(`git checkout -b ${branch}`, { cwd, stdio: "pipe" });
	}

	// Disable GPG signing for this test repository
	execSync("git config commit.gpgsign false", { cwd, stdio: "pipe" });
	execSync("git config tag.gpgsign false", { cwd, stdio: "pipe" });
	execSync("git config user.email test@example.com", { cwd, stdio: "pipe" });
	execSync("git config user.name 'Test User'", { cwd, stdio: "pipe" });
}

/**
 * Execute a git commit in the given directory.
 * GPG signing should already be disabled via initTestGitRepo().
 *
 * @param cwd - Directory containing the git repo
 * @param message - Commit message
 * @param allowEmpty - Whether to allow empty commits (default: false)
 */
export function gitCommit(
	cwd: string,
	message: string,
	allowEmpty = false
): void {
	const flags = allowEmpty ? "--allow-empty " : "";
	execSync(`git commit ${flags}-m "${message}"`, { cwd, stdio: "pipe" });
}

/**
 * Add all files to the git staging area.
 *
 * @param cwd - Directory containing the git repo
 */
export function gitAdd(cwd: string): void {
	execSync("git add .", { cwd, stdio: "pipe" });
}

/**
 * Create a test git repository with an initial commit.
 *
 * @param cwd - Directory to initialize
 * @param branch - Initial branch name (default: "main")
 * @param initialCommitMessage - Message for initial commit (default: "Initial commit")
 */
export function initTestGitRepoWithCommit(
	cwd: string,
	branch = "main",
	initialCommitMessage = "Initial commit"
): void {
	initTestGitRepo(cwd, branch);
	gitCommit(cwd, initialCommitMessage, true);
}
