/**
 * Test Fix Pattern Matcher Tests
 *
 * Tests trigger matching and fix location detection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	matchTriggers,
	findFixLocations,
	matchAndLocate,
} from "../../../../src/weave/testfix/matcher.js";
import type { TestFixPattern } from "../../../../src/weave/testfix/schema.js";

describe("matchTriggers", () => {
	it("matches test_output pattern", () => {
		const patterns: TestFixPattern[] = [
			{
				id: "tool-count",
				determinism: "D1",
				trigger: {
					test_output: "expected (\\d+).*received (\\d+)",
				},
				detection: {
					file_pattern: "**/*.spec.ts",
					line_pattern: "expect.*toBe\\((\\d+)\\)",
				},
				fix: {
					action: "update_number",
					from_group: 1,
					to_group: 2,
				},
				priority: 100,
				enabled: true,
			},
		];

		const testOutput = "AssertionError: expected 6 to equal received 7";

		const matches = matchTriggers(testOutput, patterns);

		expect(matches).toHaveLength(1);
		expect(matches[0].patternId).toBe("tool-count");
		expect(matches[0].triggerCaptures["1"]).toBe("6");
		expect(matches[0].triggerCaptures["2"]).toBe("7");
	});

	it("matches error_message pattern", () => {
		const patterns: TestFixPattern[] = [
			{
				id: "lexsona",
				determinism: "D1",
				trigger: {
					error_message: "LexSona\\.connect",
				},
				detection: {
					file_pattern: "**/*.spec.ts",
					line_pattern: "LexSona\\.connect\\(\\)",
				},
				fix: {
					action: "replace",
					with: 'LexSona.connect({ lexDb: "/nonexistent" })',
				},
				priority: 90,
				enabled: true,
			},
		];

		const testOutput = "Error in LexSona.connect: isConnected expected false received true";

		const matches = matchTriggers(testOutput, patterns);

		expect(matches).toHaveLength(1);
		expect(matches[0].patternId).toBe("lexsona");
	});

	it("returns empty array when no match", () => {
		const patterns: TestFixPattern[] = [
			{
				id: "no-match",
				determinism: "D1",
				trigger: {
					test_output: "will-not-match",
				},
				detection: {
					file_pattern: "**/*.spec.ts",
					line_pattern: "test",
				},
				fix: {
					action: "update_number",
				},
				priority: 100,
				enabled: true,
			},
		];

		const testOutput = "Some other error";

		const matches = matchTriggers(testOutput, patterns);

		expect(matches).toHaveLength(0);
	});

	it("matches multiple patterns", () => {
		const patterns: TestFixPattern[] = [
			{
				id: "pattern-1",
				determinism: "D1",
				trigger: {
					test_output: "error",
				},
				detection: {
					file_pattern: "**/*.spec.ts",
					line_pattern: "test",
				},
				fix: {
					action: "update_number",
				},
				priority: 100,
				enabled: true,
			},
			{
				id: "pattern-2",
				determinism: "D1",
				trigger: {
					test_output: "failure",
				},
				detection: {
					file_pattern: "**/*.spec.ts",
					line_pattern: "test",
				},
				fix: {
					action: "update_number",
				},
				priority: 90,
				enabled: true,
			},
		];

		const testOutput = "Test failure: error in assertion";

		const matches = matchTriggers(testOutput, patterns);

		expect(matches).toHaveLength(2);
	});
});

describe("findFixLocations", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "testfix-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds matching lines in files", () => {
		// Create a test file
		const testFile = join(tmpDir, "test.spec.ts");
		writeFileSync(
			testFile,
			`describe('test', () => {
  it('should count tools', () => {
    expect(tools.length).toBe(6);
  });
});`
		);

		const pattern: TestFixPattern = {
			id: "tool-count",
			determinism: "D1",
			trigger: {
				test_output: "expected (\\d+).*received (\\d+)",
			},
			detection: {
				file_pattern: "**/*.spec.ts",
				line_pattern: "expect\\(.*tools\\.length.*\\)\\.toBe\\((\\d+)\\)",
			},
			fix: {
				action: "update_number",
				from_group: 1,
				to_group: 2,
			},
			priority: 100,
			enabled: true,
		};

		const locations = findFixLocations(tmpDir, pattern);

		expect(locations).toHaveLength(1);
		expect(locations[0].filePath).toBe(testFile);
		expect(locations[0].lineNumber).toBe(3);
		expect(locations[0].matchedLine).toContain("expect(tools.length).toBe(6)");
		expect(locations[0].detectionCaptures["1"]).toBe("6");
	});

	it("finds multiple matches in same file", () => {
		const testFile = join(tmpDir, "test.spec.ts");
		writeFileSync(
			testFile,
			`it('test 1', () => {
  expect(count).toBe(5);
});

it('test 2', () => {
  expect(count).toBe(10);
});`
		);

		const pattern: TestFixPattern = {
			id: "count-pattern",
			determinism: "D1",
			trigger: {
				test_output: "test",
			},
			detection: {
				file_pattern: "**/*.spec.ts",
				line_pattern: "expect\\(count\\)\\.toBe\\((\\d+)\\)",
			},
			fix: {
				action: "update_number",
			},
			priority: 100,
			enabled: true,
		};

		const locations = findFixLocations(tmpDir, pattern);

		expect(locations).toHaveLength(2);
		expect(locations[0].detectionCaptures["1"]).toBe("5");
		expect(locations[1].detectionCaptures["1"]).toBe("10");
	});

	it("returns empty array when no matches", () => {
		const testFile = join(tmpDir, "test.spec.ts");
		writeFileSync(testFile, `it('test', () => { expect(true).toBe(true); });`);

		const pattern: TestFixPattern = {
			id: "no-match",
			determinism: "D1",
			trigger: {
				test_output: "test",
			},
			detection: {
				file_pattern: "**/*.spec.ts",
				line_pattern: "will-not-match",
			},
			fix: {
				action: "update_number",
			},
			priority: 100,
			enabled: true,
		};

		const locations = findFixLocations(tmpDir, pattern);

		expect(locations).toHaveLength(0);
	});
});

describe("matchAndLocate", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "testfix-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("matches triggers and finds locations", () => {
		const testFile = join(tmpDir, "test.spec.ts");
		writeFileSync(
			testFile,
			`it('test', () => {
  expect(tools.length).toBe(6);
});`
		);

		const patterns: TestFixPattern[] = [
			{
				id: "tool-count",
				determinism: "D1",
				trigger: {
					test_output: "expected (\\d+).*received (\\d+)",
				},
				detection: {
					file_pattern: "**/*.spec.ts",
					line_pattern: "expect\\(.*tools\\.length.*\\)\\.toBe\\((\\d+)\\)",
				},
				fix: {
					action: "update_number",
					from_group: 1,
					to_group: 2,
				},
				priority: 100,
				enabled: true,
			},
		];

		const testOutput = "AssertionError: expected 6 to equal received 7";

		const results = matchAndLocate(testOutput, tmpDir, patterns);

		expect(results.size).toBe(1);
		expect(results.has("tool-count")).toBe(true);

		const result = results.get("tool-count")!;
		expect(result.trigger.patternId).toBe("tool-count");
		expect(result.trigger.triggerCaptures["1"]).toBe("6");
		expect(result.trigger.triggerCaptures["2"]).toBe("7");
		expect(result.locations).toHaveLength(1);
		expect(result.locations[0].detectionCaptures["1"]).toBe("6");
	});
});
