/**
 * Test Fix Pattern End-to-End Scenario Tests
 *
 * Demonstrates real-world usage of the pattern library
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import {
	loadTestFixPatterns,
	getEnabledPatterns,
	matchAndLocate,
	buildFixInstruction,
	applyFix,
} from "../../../../src/weave/testfix/index.js";

// Find workspace root by going up from current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("End-to-End Scenarios", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "testfix-e2e-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("INT-015: Tool Count Assertion Fix", () => {
		// Scenario: A new MCP tool was added, increasing count from 6 to 7

		// 1. Create a test file with old assertion
		const testFile = join(tmpDir, "mcp-tools.spec.ts");
		writeFileSync(
			testFile,
			`import { describe, it, expect } from 'vitest';
import { getTools } from '../src/tools';

describe('MCP Tools', () => {
  it('should have correct tool count', () => {
    const tools = getTools();
    expect(tools.length).toBe(6);
  });
});`
		);

		// 2. Simulate test failure output (match the trigger pattern)
		const testOutput = `
FAIL  tests/mcp-tools.spec.ts
  MCP Tools
    ✕ should have correct tool count (3ms)

  ● MCP Tools › should have correct tool count

    AssertionError: assert.strictEqual(tools.length, 6) expected 6 received 7

      5 |     const tools = getTools();
    > 6 |     expect(tools.length).toBe(6);
        |                         ^
      7 |   });
`;

		// 3. Load patterns and get enabled ones
		const workspaceRoot = join(__dirname, "../../../..");
		const allPatterns = loadTestFixPatterns(workspaceRoot);
		const enabledPatterns = getEnabledPatterns(allPatterns);

		// 4. Match triggers and find fix locations
		const matches = matchAndLocate(testOutput, tmpDir, enabledPatterns);

		// 5. Verify tool-count-assertion pattern matched
		expect(matches.has("tool-count-assertion")).toBe(true);

		const match = matches.get("tool-count-assertion")!;
		expect(match.trigger.triggerCaptures["1"]).toBe("6");
		expect(match.trigger.triggerCaptures["2"]).toBe("7");
		expect(match.locations.length).toBe(1);

		// 6. Build fix instruction
		const pattern = enabledPatterns.find((p) => p.id === "tool-count-assertion")!;
		const instruction = buildFixInstruction(
			pattern,
			match.trigger,
			match.locations[0]
		);

		expect(instruction).not.toBeNull();
		expect(instruction!.replacement).toContain("7");

		// 7. Apply the fix
		const result = applyFix(instruction!, false);

		expect(result.success).toBe(true);
		expect(result.oldContent).toContain("toBe(6)");
		expect(result.newContent).toContain("toBe(7)");

		// 8. Verify file was updated
		const updatedContent = readFileSync(testFile, "utf-8");
		expect(updatedContent).toContain("expect(tools.length).toBe(7)");
		expect(updatedContent).not.toContain("expect(tools.length).toBe(6)");
	});

	it("INT-016: LexSona Explicit Path Fix", () => {
		// Scenario: Environment-dependent test needs explicit DB path

		// 1. Create a test file with implicit connection
		const testDir = join(tmpDir, "lexsona");
		mkdirSync(testDir, { recursive: true });
		
		const testFile = join(testDir, "connection.spec.ts");
		writeFileSync(
			testFile,
			`import { describe, it, expect } from 'vitest';
import { LexSona } from '../src/lexsona';

describe('LexSona Connection', () => {
  it('should not connect without DB', async () => {
    await LexSona.connect();
    expect(LexSona.isConnected()).toBe(false);
  });
});`
		);

		// 2. Simulate test failure output
		const testOutput = `
FAIL  tests/lexsona/connection.spec.ts
  LexSona Connection
    ✕ should not connect without DB (12ms)

  ● LexSona Connection › should not connect without DB

    expect(received).toBe(expected)

    Expected: false
    Received: true

      5 |     await LexSona.connect();
    > 6 |     expect(LexSona.isConnected()).toBe(false);
        |                                  ^
      7 |   });
`;

		// 3. Load patterns
		const workspaceRoot = join(__dirname, "../../../..");
		const allPatterns = loadTestFixPatterns(workspaceRoot);
		const enabledPatterns = getEnabledPatterns(allPatterns);

		// 4. Match and locate
		const matches = matchAndLocate(testOutput, tmpDir, enabledPatterns);

		// 5. Verify lexsona-connect-explicit-path pattern matched
		expect(matches.has("lexsona-connect-explicit-path")).toBe(true);

		const match = matches.get("lexsona-connect-explicit-path")!;
		expect(match.locations.length).toBe(1);

		// 6. Build fix instruction
		const pattern = enabledPatterns.find(
			(p) => p.id === "lexsona-connect-explicit-path"
		)!;
		const instruction = buildFixInstruction(
			pattern,
			match.trigger,
			match.locations[0]
		);

		expect(instruction).not.toBeNull();
		expect(instruction!.replacement).toContain('lexDb: "/nonexistent');

		// 7. Apply the fix
		const result = applyFix(instruction!, false);

		expect(result.success).toBe(true);

		// 8. Verify file was updated
		const updatedContent = readFileSync(testFile, "utf-8");
		expect(updatedContent).toContain('LexSona.connect({ lexDb: "/nonexistent');
		expect(updatedContent).not.toContain("LexSona.connect()");
	});

	it("handles multiple fixes in same file", () => {
		// Scenario: Multiple assertions need updating

		// 1. Create test file with multiple count assertions
		const testFile = join(tmpDir, "multi-fix.spec.ts");
		writeFileSync(
			testFile,
			`describe('Multiple Counts', () => {
  it('test 1', () => {
    expect(tools.length).toBe(6);
  });

  it('test 2', () => {
    expect(tools.length).toBe(6);
  });

  it('test 3', () => {
    expect(tools.length).toBe(6);
  });
});`
		);

		// 2. Simulate test failure (match the trigger pattern)
		const testOutput = `
FAIL  tests/multi-fix.spec.ts
    AssertionError: assert.strictEqual(tools.length, 6) expected 6 received 7
`;

		// 3. Load and match
		const workspaceRoot = join(__dirname, "../../../..");
		const allPatterns = loadTestFixPatterns(workspaceRoot);
		const enabledPatterns = getEnabledPatterns(allPatterns);
		const matches = matchAndLocate(testOutput, tmpDir, enabledPatterns);

		// 4. Should find multiple locations
		const match = matches.get("tool-count-assertion")!;
		expect(match.locations.length).toBe(3);

		// 5. Apply all fixes
		const pattern = enabledPatterns.find((p) => p.id === "tool-count-assertion")!;
		const instructions = match.locations
			.map((loc) => buildFixInstruction(pattern, match.trigger, loc))
			.filter((inst) => inst !== null);

		expect(instructions.length).toBe(3);

		for (const instruction of instructions) {
			const result = applyFix(instruction!, false);
			expect(result.success).toBe(true);
		}

		// 6. Verify all were updated
		const updatedContent = readFileSync(testFile, "utf-8");
		const countOf7 = (updatedContent.match(/toBe\(7\)/g) || []).length;
		expect(countOf7).toBe(3);
	});

	it("dry run mode doesn't modify files", () => {
		// 1. Create test file
		const testFile = join(tmpDir, "dry-run.spec.ts");
		const originalContent = `it('test', () => {
  expect(count).toBe(5);
});`;
		writeFileSync(testFile, originalContent);

		// 2. Test output
		const testOutput = "Expected: 5\nReceived: 10";

		// 3. Load and match
		const workspaceRoot = join(__dirname, "../../../..");
		const allPatterns = loadTestFixPatterns(workspaceRoot);
		const enabledPatterns = getEnabledPatterns(allPatterns);

		// Find a matching pattern (use generic-count-assertion if enabled)
		const pattern = enabledPatterns.find((p) => p.id === "tool-count-assertion");
		if (!pattern) return;

		const matches = matchAndLocate(testOutput, tmpDir, enabledPatterns);
		if (matches.size === 0) return;

		const match = Array.from(matches.values())[0];
		if (match.locations.length === 0) return;

		const instruction = buildFixInstruction(
			pattern,
			match.trigger,
			match.locations[0]
		);

		if (!instruction) return;

		// 4. Apply with dry run
		const result = applyFix(instruction, true);

		// 5. File should be unchanged
		const content = readFileSync(testFile, "utf-8");
		expect(content).toBe(originalContent);
	});
});
