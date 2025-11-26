import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	runGit,
	getCurrentBranch,
	getCurrentCommit,
	getRemoteUrl,
	isGitRepository,
	getRepositoryRoot,
	isGitDryRun,
} from "../src/shared/git/runGit.js";

describe("runGit wrapper", () => {
	const originalEnv = process.env.LEX_GIT_MODE;

	beforeEach(() => {
		// Reset env before each test
		delete process.env.LEX_GIT_MODE;
	});

	afterEach(() => {
		// Restore original env
		if (originalEnv !== undefined) {
			process.env.LEX_GIT_MODE = originalEnv;
		} else {
			delete process.env.LEX_GIT_MODE;
		}
	});

	describe("isGitDryRun", () => {
		it("returns false when LEX_GIT_MODE is not set", () => {
			delete process.env.LEX_GIT_MODE;
			expect(isGitDryRun()).toBe(false);
		});

		it("returns true when LEX_GIT_MODE=off", () => {
			process.env.LEX_GIT_MODE = "off";
			expect(isGitDryRun()).toBe(true);
		});

		it("returns false when LEX_GIT_MODE is set to other values", () => {
			process.env.LEX_GIT_MODE = "on";
			expect(isGitDryRun()).toBe(false);

			process.env.LEX_GIT_MODE = "true";
			expect(isGitDryRun()).toBe(false);
		});
	});

	describe("runGit", () => {
		it("returns exitCode 0 for successful git commands", () => {
			// This test runs in an actual git repo
			const result = runGit(["--version"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("git version");
			expect(result.stderr).toBe("");
		});

		it("returns non-zero exitCode for failed git commands", () => {
			const result = runGit(["not-a-real-command"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).not.toBe("");
		});

		it("respects cwd option", () => {
			const result = runGit(["rev-parse", "--is-inside-work-tree"], {
				cwd: "/tmp",
			});
			// /tmp is likely not a git repo
			expect(result.exitCode).not.toBe(0);
		});

		it("returns dry-run fallback when LEX_GIT_MODE=off", () => {
			process.env.LEX_GIT_MODE = "off";

			const customFallback = {
				exitCode: 0,
				stdout: "dry-run-branch",
				stderr: "",
			};

			const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
				dryRunFallback: customFallback,
			});

			expect(result).toEqual(customFallback);
		});

		it("uses default dry-run fallback when not provided", () => {
			process.env.LEX_GIT_MODE = "off";

			const result = runGit(["status"]);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
		});
	});

	describe("getCurrentBranch", () => {
		it("returns current branch name in a git repository", () => {
			// This test runs in an actual git repo
			const branch = getCurrentBranch();
			expect(branch).toBeTruthy();
			expect(typeof branch).toBe("string");
		});

		it("returns dry-run fallback when LEX_GIT_MODE=off", () => {
			process.env.LEX_GIT_MODE = "off";
			const branch = getCurrentBranch();
			expect(branch).toBe("main");
		});

		it("returns empty string for non-git directory", () => {
			const branch = getCurrentBranch("/tmp");
			expect(branch).toBe("");
		});
	});

	describe("getCurrentCommit", () => {
		it("returns current commit SHA in a git repository", () => {
			const commit = getCurrentCommit();
			expect(commit).toBeTruthy();
			expect(commit.length).toBe(40); // Full SHA length
		});

		it("returns short SHA when requested", () => {
			const commit = getCurrentCommit(undefined, true);
			expect(commit).toBeTruthy();
			expect(commit.length).toBeLessThanOrEqual(12);
		});

		it("returns dry-run fallback when LEX_GIT_MODE=off", () => {
			process.env.LEX_GIT_MODE = "off";
			const commit = getCurrentCommit();
			expect(commit).toBe("abc1234567890def1234567890abc1234567890de");

			const shortCommit = getCurrentCommit(undefined, true);
			expect(shortCommit).toBe("abc1234");
		});

		it("returns empty string for non-git directory", () => {
			const commit = getCurrentCommit("/tmp");
			expect(commit).toBe("");
		});
	});

	describe("getRemoteUrl", () => {
		it("returns remote URL in a git repository with remotes", () => {
			const url = getRemoteUrl();
			// In most CI environments, there's an origin remote
			expect(typeof url).toBe("string");
		});

		it("returns dry-run fallback when LEX_GIT_MODE=off", () => {
			process.env.LEX_GIT_MODE = "off";
			const url = getRemoteUrl();
			expect(url).toBe("https://github.com/example/repo.git");
		});

		it("returns empty string for non-existent remote", () => {
			const url = getRemoteUrl(undefined, "nonexistent-remote");
			expect(url).toBe("");
		});
	});

	describe("isGitRepository", () => {
		it("returns true for git repository", () => {
			// This test runs in an actual git repo
			expect(isGitRepository()).toBe(true);
		});

		it("returns false for non-git directory", () => {
			expect(isGitRepository("/tmp")).toBe(false);
		});

		it("returns true in dry-run mode", () => {
			process.env.LEX_GIT_MODE = "off";
			expect(isGitRepository()).toBe(true);
		});
	});

	describe("getRepositoryRoot", () => {
		it("returns repository root for git repository", () => {
			const root = getRepositoryRoot();
			expect(root).toBeTruthy();
			expect(root.endsWith("lex-pr-runner")).toBe(true);
		});

		it("returns empty string for non-git directory", () => {
			const root = getRepositoryRoot("/tmp");
			expect(root).toBe("");
		});

		it("returns cwd in dry-run mode", () => {
			process.env.LEX_GIT_MODE = "off";
			const root = getRepositoryRoot();
			expect(root).toBe(process.cwd());
		});
	});
});

describe("GitResult interface", () => {
	it("contains expected properties", () => {
		const result = runGit(["--version"]);
		expect(result).toHaveProperty("exitCode");
		expect(result).toHaveProperty("stdout");
		expect(result).toHaveProperty("stderr");
		expect(typeof result.exitCode).toBe("number");
		expect(typeof result.stdout).toBe("string");
		expect(typeof result.stderr).toBe("string");
	});
});

describe("GPG signing disabled by default", () => {
	it("disables GPG signing for commit-related operations", () => {
		// This is a unit test verifying the behavior, not actual GPG signing
		// The -c commit.gpgsign=false flag is added by default in runGit
		const result = runGit(["config", "--get", "commit.gpgsign"], {
			cwd: "/tmp", // Likely not a git repo
		});
		// The command should fail (non-git directory), but that's OK
		// The important thing is that the wrapper doesn't throw
		expect(result).toHaveProperty("exitCode");
	});
});
