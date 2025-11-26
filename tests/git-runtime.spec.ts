/**
 * Tests for git runtime gate (LEX_GIT_MODE)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	getGitMode,
	isGitEnabled,
	getDefaultBranch,
	getDefaultCommit,
} from "../src/shared/git/runtime.js";

describe("Git Runtime Gate", () => {
	// Store original env values
	let originalGitMode: string | undefined;
	let originalDefaultBranch: string | undefined;
	let originalDefaultCommit: string | undefined;

	beforeEach(() => {
		// Save original values
		originalGitMode = process.env.LEX_GIT_MODE;
		originalDefaultBranch = process.env.LEX_DEFAULT_BRANCH;
		originalDefaultCommit = process.env.LEX_DEFAULT_COMMIT;
	});

	afterEach(() => {
		// Restore original values
		if (originalGitMode !== undefined) {
			process.env.LEX_GIT_MODE = originalGitMode;
		} else {
			delete process.env.LEX_GIT_MODE;
		}
		if (originalDefaultBranch !== undefined) {
			process.env.LEX_DEFAULT_BRANCH = originalDefaultBranch;
		} else {
			delete process.env.LEX_DEFAULT_BRANCH;
		}
		if (originalDefaultCommit !== undefined) {
			process.env.LEX_DEFAULT_COMMIT = originalDefaultCommit;
		} else {
			delete process.env.LEX_DEFAULT_COMMIT;
		}
	});

	describe("getGitMode", () => {
		it("should return 'off' by default when LEX_GIT_MODE is not set", () => {
			delete process.env.LEX_GIT_MODE;
			expect(getGitMode()).toBe("off");
		});

		it("should return 'live' when LEX_GIT_MODE is 'live'", () => {
			process.env.LEX_GIT_MODE = "live";
			expect(getGitMode()).toBe("live");
		});

		it("should return 'live' when LEX_GIT_MODE is 'LIVE' (case insensitive)", () => {
			process.env.LEX_GIT_MODE = "LIVE";
			expect(getGitMode()).toBe("live");
		});

		it("should return 'live' when LEX_GIT_MODE is 'Live' (mixed case)", () => {
			process.env.LEX_GIT_MODE = "Live";
			expect(getGitMode()).toBe("live");
		});

		it("should return 'off' when LEX_GIT_MODE is 'off'", () => {
			process.env.LEX_GIT_MODE = "off";
			expect(getGitMode()).toBe("off");
		});

		it("should return 'off' when LEX_GIT_MODE is 'OFF' (case insensitive)", () => {
			process.env.LEX_GIT_MODE = "OFF";
			expect(getGitMode()).toBe("off");
		});

		it("should return 'off' for any unrecognized value", () => {
			process.env.LEX_GIT_MODE = "invalid";
			expect(getGitMode()).toBe("off");
		});

		it("should return 'off' for empty string", () => {
			process.env.LEX_GIT_MODE = "";
			expect(getGitMode()).toBe("off");
		});
	});

	describe("isGitEnabled", () => {
		it("should return false by default when LEX_GIT_MODE is not set", () => {
			delete process.env.LEX_GIT_MODE;
			expect(isGitEnabled()).toBe(false);
		});

		it("should return true when LEX_GIT_MODE is 'live'", () => {
			process.env.LEX_GIT_MODE = "live";
			expect(isGitEnabled()).toBe(true);
		});

		it("should return false when LEX_GIT_MODE is 'off'", () => {
			process.env.LEX_GIT_MODE = "off";
			expect(isGitEnabled()).toBe(false);
		});

		it("should return false for invalid values", () => {
			process.env.LEX_GIT_MODE = "invalid";
			expect(isGitEnabled()).toBe(false);
		});
	});

	describe("getDefaultBranch", () => {
		it("should return 'main' by default when LEX_DEFAULT_BRANCH is not set", () => {
			delete process.env.LEX_DEFAULT_BRANCH;
			expect(getDefaultBranch()).toBe("main");
		});

		it("should return custom branch when LEX_DEFAULT_BRANCH is set", () => {
			process.env.LEX_DEFAULT_BRANCH = "develop";
			expect(getDefaultBranch()).toBe("develop");
		});

		it("should return custom branch with slashes", () => {
			process.env.LEX_DEFAULT_BRANCH = "feature/my-branch";
			expect(getDefaultBranch()).toBe("feature/my-branch");
		});

		it("should return empty string if LEX_DEFAULT_BRANCH is empty", () => {
			process.env.LEX_DEFAULT_BRANCH = "";
			expect(getDefaultBranch()).toBe("main");
		});
	});

	describe("getDefaultCommit", () => {
		it("should return 40 zeros by default when LEX_DEFAULT_COMMIT is not set", () => {
			delete process.env.LEX_DEFAULT_COMMIT;
			expect(getDefaultCommit()).toBe("0000000000000000000000000000000000000000");
		});

		it("should return custom commit when LEX_DEFAULT_COMMIT is set", () => {
			const customCommit = "abc123def456789012345678901234567890abcd";
			process.env.LEX_DEFAULT_COMMIT = customCommit;
			expect(getDefaultCommit()).toBe(customCommit);
		});

		it("should return custom commit even if it is not a valid SHA", () => {
			process.env.LEX_DEFAULT_COMMIT = "invalid-sha";
			expect(getDefaultCommit()).toBe("invalid-sha");
		});

		it("should return default if LEX_DEFAULT_COMMIT is empty", () => {
			process.env.LEX_DEFAULT_COMMIT = "";
			expect(getDefaultCommit()).toBe("0000000000000000000000000000000000000000");
		});
	});

	describe("Integration behavior", () => {
		it("should be safe for CI by defaulting to off", () => {
			// Clear all env vars to simulate fresh CI environment
			delete process.env.LEX_GIT_MODE;
			delete process.env.LEX_DEFAULT_BRANCH;
			delete process.env.LEX_DEFAULT_COMMIT;

			// Default behavior should be safe (git off)
			expect(isGitEnabled()).toBe(false);
			expect(getGitMode()).toBe("off");
			expect(getDefaultBranch()).toBe("main");
			expect(getDefaultCommit()).toBe("0000000000000000000000000000000000000000");
		});

		it("should enable git when explicitly set to live", () => {
			process.env.LEX_GIT_MODE = "live";

			expect(isGitEnabled()).toBe(true);
			expect(getGitMode()).toBe("live");
		});
	});
});
