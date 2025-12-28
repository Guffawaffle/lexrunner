/**
 * Test Fix Pattern Applier Tests
 *
 * Tests fix application to files
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildFixInstruction,
  applyFix,
  applyFixes,
} from "../../../../src/weave/testfix/applier.js";
import type {
  TestFixPattern,
  TriggerMatch,
  FixLocation,
} from "../../../../src/weave/testfix/schema.js";

describe("buildFixInstruction", () => {
  it("builds update_number instruction", () => {
    const pattern: TestFixPattern = {
      id: "tool-count",
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
    };

    const trigger: TriggerMatch = {
      patternId: "tool-count",
      matchedOutput: "expected 6 to equal received 7",
      triggerCaptures: { "1": "6", "2": "7" },
      determinism: "D1",
    };

    const location: FixLocation = {
      filePath: "/test/file.spec.ts",
      lineNumber: 10,
      matchedLine: "  expect(tools.length).toBe(6);",
      detectionCaptures: { "1": "6" },
    };

    const instruction = buildFixInstruction(pattern, trigger, location);

    expect(instruction).not.toBeNull();
    expect(instruction!.patternId).toBe("tool-count");
    expect(instruction!.replacement).toContain("7");
    expect(instruction!.requiresConfirmation).toBe(false);
  });

  it("builds replace instruction", () => {
    const pattern: TestFixPattern = {
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
    };

    const trigger: TriggerMatch = {
      patternId: "lexsona",
      matchedOutput: "LexSona.connect error",
      triggerCaptures: {},
      determinism: "D1",
    };

    const location: FixLocation = {
      filePath: "/test/file.spec.ts",
      lineNumber: 5,
      matchedLine: "  await LexSona.connect();",
      detectionCaptures: {},
    };

    const instruction = buildFixInstruction(pattern, trigger, location);

    expect(instruction).not.toBeNull();
    expect(instruction!.replacement).toContain('lexDb: "/nonexistent"');
  });

  it("returns null when missing required capture groups", () => {
    const pattern: TestFixPattern = {
      id: "test",
      determinism: "D1",
      trigger: {
        test_output: "test",
      },
      detection: {
        file_pattern: "**/*.spec.ts",
        line_pattern: "test",
      },
      fix: {
        action: "update_number",
        from_group: 1,
        to_group: 2,
      },
      priority: 100,
      enabled: true,
    };

    const trigger: TriggerMatch = {
      patternId: "test",
      matchedOutput: "test",
      triggerCaptures: {}, // Missing captures
      determinism: "D1",
    };

    const location: FixLocation = {
      filePath: "/test/file.spec.ts",
      lineNumber: 1,
      matchedLine: "test",
      detectionCaptures: {},
    };

    const instruction = buildFixInstruction(pattern, trigger, location);

    expect(instruction).toBeNull();
  });

  it("sets requiresConfirmation for D2 patterns", () => {
    const pattern: TestFixPattern = {
      id: "test",
      determinism: "D2",
      trigger: {
        test_output: "test",
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
    };

    const trigger: TriggerMatch = {
      patternId: "test",
      matchedOutput: "test",
      triggerCaptures: { "1": "5", "2": "6" },
      determinism: "D2",
    };

    const location: FixLocation = {
      filePath: "/test/file.spec.ts",
      lineNumber: 1,
      matchedLine: "expect(x).toBe(5);",
      detectionCaptures: { "1": "5" },
    };

    const instruction = buildFixInstruction(pattern, trigger, location);

    expect(instruction).not.toBeNull();
    expect(instruction!.requiresConfirmation).toBe(true);
  });
});

describe("applyFix", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "testfix-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies fix successfully", () => {
    const testFile = join(tmpDir, "test.spec.ts");
    writeFileSync(
      testFile,
      `it('test', () => {
  expect(tools.length).toBe(6);
});`
    );

    const pattern: TestFixPattern = {
      id: "tool-count",
      determinism: "D1",
      trigger: {
        test_output: "test",
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
    };

    const trigger: TriggerMatch = {
      patternId: "tool-count",
      matchedOutput: "test",
      triggerCaptures: {},
      determinism: "D1",
    };

    const location: FixLocation = {
      filePath: testFile,
      lineNumber: 2,
      matchedLine: "  expect(tools.length).toBe(6);",
      detectionCaptures: {},
    };

    const instruction = {
      patternId: "tool-count",
      trigger,
      location,
      fix: pattern.fix,
      replacement: "  expect(tools.length).toBe(7);",
      requiresConfirmation: false,
    };

    const result = applyFix(instruction, false);

    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("  expect(tools.length).toBe(6);");
    expect(result.newContent).toBe("  expect(tools.length).toBe(7);");

    const updatedContent = readFileSync(testFile, "utf-8");
    expect(updatedContent).toContain("toBe(7)");
  });

  it("performs dry run without writing", () => {
    const testFile = join(tmpDir, "test.spec.ts");
    const originalContent = `it('test', () => {
  expect(count).toBe(5);
});`;
    writeFileSync(testFile, originalContent);

    const pattern: TestFixPattern = {
      id: "test",
      determinism: "D1",
      trigger: {
        test_output: "test",
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
    };

    const trigger: TriggerMatch = {
      patternId: "test",
      matchedOutput: "test",
      triggerCaptures: {},
      determinism: "D1",
    };

    const location: FixLocation = {
      filePath: testFile,
      lineNumber: 2,
      matchedLine: "  expect(count).toBe(5);",
      detectionCaptures: {},
    };

    const instruction = {
      patternId: "test",
      trigger,
      location,
      fix: pattern.fix,
      replacement: "  expect(count).toBe(10);",
      requiresConfirmation: false,
    };

    const result = applyFix(instruction, true);

    expect(result.success).toBe(true);

    // File should not be changed
    const content = readFileSync(testFile, "utf-8");
    expect(content).toBe(originalContent);
  });

  it("fails when line content changed", () => {
    const testFile = join(tmpDir, "test.spec.ts");
    writeFileSync(
      testFile,
      `it('test', () => {
  expect(count).toBe(10);
});`
    );

    const pattern: TestFixPattern = {
      id: "test",
      determinism: "D1",
      trigger: {
        test_output: "test",
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
    };

    const trigger: TriggerMatch = {
      patternId: "test",
      matchedOutput: "test",
      triggerCaptures: {},
      determinism: "D1",
    };

    const location: FixLocation = {
      filePath: testFile,
      lineNumber: 2,
      matchedLine: "  expect(count).toBe(5);", // Different from actual
      detectionCaptures: {},
    };

    const instruction = {
      patternId: "test",
      trigger,
      location,
      fix: pattern.fix,
      replacement: "  expect(count).toBe(6);",
      requiresConfirmation: false,
    };

    const result = applyFix(instruction, false);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Line content changed");
  });
});
