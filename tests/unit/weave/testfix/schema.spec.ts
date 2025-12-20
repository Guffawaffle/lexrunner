/**
 * Test Fix Pattern Schema Tests
 *
 * Validates the schema for test-fix-patterns.yml
 */

import { describe, it, expect } from "vitest";
import {
	parseTestFixPatterns,
	safeParseTestFixPatterns,
	validatePatternIds,
	getEnabledPatterns,
	type TestFixPatterns,
	type TestFixPattern,
} from "../../../../src/weave/testfix/schema.js";

describe("TestFixPatterns Schema", () => {
	it("validates a valid pattern configuration", () => {
		const validConfig = {
			version: 1,
			patterns: [
				{
					id: "test-pattern",
					description: "Test pattern",
					determinism: "D1",
					trigger: {
						test_output: "expected (\\d+).*received (\\d+)",
					},
					detection: {
						file_pattern: "**/*.spec.ts",
						line_pattern: "expect\\(.*\\)\\.toBe\\((\\d+)\\)",
					},
					fix: {
						action: "update_number",
						from_group: 1,
						to_group: 2,
					},
					priority: 100,
					enabled: true,
				},
			],
		};

		const result = parseTestFixPatterns(validConfig);
		expect(result.version).toBe(1);
		expect(result.patterns).toHaveLength(1);
		expect(result.patterns[0].id).toBe("test-pattern");
	});

	it("requires at least file_pattern and line_pattern in detection", () => {
		const invalid = {
			version: 1,
			patterns: [
				{
					id: "invalid",
					trigger: { test_output: "test" },
					detection: {
						file_pattern: "**/*.ts",
						// missing line_pattern
					},
					fix: { action: "update_number" },
				},
			],
		};

		const result = safeParseTestFixPatterns(invalid);
		expect(result.success).toBe(false);
	});

	it("requires valid action type", () => {
		const invalid = {
			version: 1,
			patterns: [
				{
					id: "invalid",
					trigger: { test_output: "test" },
					detection: {
						file_pattern: "**/*.ts",
						line_pattern: "test",
					},
					fix: { action: "invalid_action" },
				},
			],
		};

		const result = safeParseTestFixPatterns(invalid);
		expect(result.success).toBe(false);
	});

	it("requires valid determinism level", () => {
		const invalid = {
			version: 1,
			patterns: [
				{
					id: "invalid",
					determinism: "D4",
					trigger: { test_output: "test" },
					detection: {
						file_pattern: "**/*.ts",
						line_pattern: "test",
					},
					fix: { action: "update_number" },
				},
			],
		};

		const result = safeParseTestFixPatterns(invalid);
		expect(result.success).toBe(false);
	});

	it("defaults determinism to D2", () => {
		const config = {
			version: 1,
			patterns: [
				{
					id: "test",
					trigger: { test_output: "test" },
					detection: {
						file_pattern: "**/*.ts",
						line_pattern: "test",
					},
					fix: { action: "update_number" },
				},
			],
		};

		const result = parseTestFixPatterns(config);
		expect(result.patterns[0].determinism).toBe("D2");
	});

	it("defaults priority to 100", () => {
		const config = {
			version: 1,
			patterns: [
				{
					id: "test",
					trigger: { test_output: "test" },
					detection: {
						file_pattern: "**/*.ts",
						line_pattern: "test",
					},
					fix: { action: "update_number" },
				},
			],
		};

		const result = parseTestFixPatterns(config);
		expect(result.patterns[0].priority).toBe(100);
	});

	it("defaults enabled to true", () => {
		const config = {
			version: 1,
			patterns: [
				{
					id: "test",
					trigger: { test_output: "test" },
					detection: {
						file_pattern: "**/*.ts",
						line_pattern: "test",
					},
					fix: { action: "update_number" },
				},
			],
		};

		const result = parseTestFixPatterns(config);
		expect(result.patterns[0].enabled).toBe(true);
	});
});

describe("validatePatternIds", () => {
	it("passes with unique IDs", () => {
		const patterns: TestFixPatterns = {
			version: 1,
			patterns: [
				{
					id: "pattern-1",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: true,
				},
				{
					id: "pattern-2",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: true,
				},
			],
		};

		expect(() => validatePatternIds(patterns)).not.toThrow();
	});

	it("throws on duplicate IDs", () => {
		const patterns: TestFixPatterns = {
			version: 1,
			patterns: [
				{
					id: "duplicate",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: true,
				},
				{
					id: "duplicate",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: true,
				},
			],
		};

		expect(() => validatePatternIds(patterns)).toThrow(
			"Duplicate pattern ID: duplicate"
		);
	});
});

describe("getEnabledPatterns", () => {
	it("filters out disabled patterns", () => {
		const patterns: TestFixPatterns = {
			version: 1,
			patterns: [
				{
					id: "enabled",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: true,
				},
				{
					id: "disabled",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: false,
				},
			],
		};

		const enabled = getEnabledPatterns(patterns);
		expect(enabled).toHaveLength(1);
		expect(enabled[0].id).toBe("enabled");
	});

	it("sorts by priority descending", () => {
		const patterns: TestFixPatterns = {
			version: 1,
			patterns: [
				{
					id: "low",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 50,
					enabled: true,
				},
				{
					id: "high",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 100,
					enabled: true,
				},
				{
					id: "medium",
					determinism: "D1",
					trigger: { test_output: "test" },
					detection: { file_pattern: "**/*.ts", line_pattern: "test" },
					fix: { action: "update_number" },
					priority: 75,
					enabled: true,
				},
			],
		};

		const enabled = getEnabledPatterns(patterns);
		expect(enabled.map((p) => p.id)).toEqual(["high", "medium", "low"]);
	});
});
