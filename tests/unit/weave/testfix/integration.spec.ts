/**
 * Test Fix Pattern Integration Tests
 *
 * End-to-end tests for the test fix pattern library
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import {
	loadTestFixPatterns,
	safeLoadTestFixPatterns,
} from "../../../../src/weave/testfix/loader.js";
import { getEnabledPatterns } from "../../../../src/weave/testfix/schema.js";

describe("Test Fix Patterns Integration", () => {
	const workspaceRoot = join(__dirname, "../../../..");

	it("loads test-fix-patterns.yml successfully", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.patterns.version).toBe(1);
			expect(result.patterns.patterns.length).toBeGreaterThan(0);
		}
	});

	it("validates pattern IDs are unique", () => {
		expect(() => {
			loadTestFixPatterns(workspaceRoot);
		}).not.toThrow();
	});

	it("contains tool-count-assertion pattern", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			const pattern = result.patterns.patterns.find(
				(p) => p.id === "tool-count-assertion"
			);
			expect(pattern).toBeDefined();
			expect(pattern?.determinism).toBe("D1");
			expect(pattern?.enabled).toBe(true);
		}
	});

	it("contains lexsona-connect-explicit-path pattern", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			const pattern = result.patterns.patterns.find(
				(p) => p.id === "lexsona-connect-explicit-path"
			);
			expect(pattern).toBeDefined();
			expect(pattern?.determinism).toBe("D1");
			expect(pattern?.enabled).toBe(true);
		}
	});

	it("contains env-dependent-homedir pattern", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			const pattern = result.patterns.patterns.find(
				(p) => p.id === "env-dependent-homedir"
			);
			expect(pattern).toBeDefined();
			expect(pattern?.determinism).toBe("D2");
			expect(pattern?.enabled).toBe(true);
		}
	});

	it("returns enabled patterns sorted by priority", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			const enabled = getEnabledPatterns(result.patterns);
			expect(enabled.length).toBeGreaterThan(0);

			// Verify sorting by priority (descending)
			for (let i = 1; i < enabled.length; i++) {
				expect(enabled[i - 1].priority).toBeGreaterThanOrEqual(
					enabled[i].priority
				);
			}
		}
	});

	it("all patterns have valid fix actions", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			const validActions = [
				"update_number",
				"update_string",
				"replace",
				"make_environment_aware",
			];

			for (const pattern of result.patterns.patterns) {
				expect(validActions).toContain(pattern.fix.action);
			}
		}
	});

	it("all patterns have either test_output or error_message trigger", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			for (const pattern of result.patterns.patterns) {
				const hasTrigger =
					pattern.trigger.test_output || pattern.trigger.error_message;
				expect(hasTrigger).toBeTruthy();
			}
		}
	});

	it("all patterns have file_pattern and line_pattern", () => {
		const result = safeLoadTestFixPatterns(workspaceRoot);

		expect(result.success).toBe(true);
		if (result.success) {
			for (const pattern of result.patterns.patterns) {
				expect(pattern.detection.file_pattern).toBeTruthy();
				expect(pattern.detection.line_pattern).toBeTruthy();
			}
		}
	});
});
