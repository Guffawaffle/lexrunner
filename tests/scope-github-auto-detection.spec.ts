/**
 * Test auto-detection of GitHub mode from scope.yml
 * Validates that plan_create automatically enables GitHub discovery when scope.yml has filters
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectGitHubMode } from "../src/core/inputs.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Scope.yml GitHub Auto-Detection", () => {
	let tempDir: string;

	beforeEach(() => {
		// Create a temporary directory for each test
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
		fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
	});

	afterEach(() => {
		// Clean up temporary directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("detectGitHubMode", () => {
		it("should detect GitHub mode when scope.yml has include_labels", () => {
			const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: ["ready-merge", "stack:*"]
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);

			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(true);
			expect(result.scopeConfig?.labels).toEqual(["ready-merge", "stack:*"]);
			expect(result.scopeConfig?.target).toBe("main");
		});

		it("should detect GitHub mode when scope.yml has query", () => {
			const scopeContent = `version: 1
target: main
sources:
  - query: "is:open label:stack:*"
selectors:
  include_labels: []
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);

			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(true);
			expect(result.scopeConfig?.query).toBe("is:open label:stack:*");
			expect(result.scopeConfig?.target).toBe("main");
		});

		it("should detect GitHub mode when scope.yml has both query and labels", () => {
			const scopeContent = `version: 1
target: staging
sources:
  - query: "is:open label:feature"
selectors:
  include_labels: ["ready-merge"]
  exclude_labels: ["WIP"]
defaults:
  strategy: merge-weave
  base: staging
pin_commits: false
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);

			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(true);
			expect(result.scopeConfig?.query).toBe("is:open label:feature");
			expect(result.scopeConfig?.labels).toEqual(["ready-merge"]);
			expect(result.scopeConfig?.target).toBe("staging");
		});

		it("should NOT detect GitHub mode when scope.yml has no filters", () => {
			const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: []
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);

			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(false);
			expect(result.scopeConfig).toBeUndefined();
		});

		it("should NOT detect GitHub mode when stack.yml exists (takes precedence)", () => {
			const scopeContent = `version: 1
target: main
sources:
  - query: "is:open label:stack:*"
selectors:
  include_labels: ["ready-merge"]
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
			const stackContent = `version: 1
target: main
items:
  - branch: feature-a
    deps: []
    strategy: merge-weave
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "stack.yml"),
				stackContent
			);

			const result = detectGitHubMode(tempDir);

			// stack.yml takes precedence, so GitHub mode should NOT be auto-detected
			expect(result.shouldUseGitHub).toBe(false);
		});

		it("should NOT detect GitHub mode when scope.yml does not exist", () => {
			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(false);
			expect(result.scopeConfig).toBeUndefined();
		});

		it("should handle invalid scope.yml gracefully", () => {
			const invalidContent = `this is not valid YAML: {[}]`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				invalidContent
			);

			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(false);
		});

		it("should extract labels correctly when using wildcard patterns", () => {
			const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: ["stack:*", "priority:high", "team:backend"]
  exclude_labels: ["WIP"]
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);

			const result = detectGitHubMode(tempDir);

			expect(result.shouldUseGitHub).toBe(true);
			expect(result.scopeConfig?.labels).toEqual([
				"stack:*",
				"priority:high",
				"team:backend",
			]);
		});

		it("should handle scope.yml with only exclude_labels (no auto-detection)", () => {
			const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: []
  exclude_labels: ["WIP", "do-not-merge"]
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				scopeContent
			);

			const result = detectGitHubMode(tempDir);

			// Only exclude_labels, no include_labels or query
			expect(result.shouldUseGitHub).toBe(false);
		});
	});
});
