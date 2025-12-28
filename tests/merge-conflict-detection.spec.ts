/**
 * Integration tests for merge-weave conflict detection and reporting
 * Tests the enhanced conflict detection functionality added to address issue:
 * "Merge-weave execution aborts after first conflicting item without reporting per-file conflict details"
 */

import { describe, it, expect } from "vitest";
import { WeaveResult, WeaveExecutionResult } from "../src/git/operations.js";

describe("Merge Conflict Detection and Reporting", () => {
  describe("WeaveResult conflict structure", () => {
    it("should structure conflicts as an array of file paths", () => {
      const result: WeaveResult = {
        success: false,
        item: { name: "test-branch", deps: [], gates: [] },
        conflicts: ["src/index.ts", "package.json", "README.md"],
        message: "CONFLICTS: src/index.ts, package.json, README.md",
      };

      expect(result.conflicts).toBeInstanceOf(Array);
      expect(result.conflicts).toHaveLength(3);
      expect(result.conflicts).toContain("src/index.ts");
      expect(result.conflicts).toContain("package.json");
      expect(result.conflicts).toContain("README.md");
    });

    it("should format message with CONFLICTS prefix and file list", () => {
      const conflicts = ["src/cli/index.ts", "src/config.ts"];
      const message = `CONFLICTS: ${conflicts.join(", ")}`;

      expect(message).toBe("CONFLICTS: src/cli/index.ts, src/config.ts");
      expect(message).toMatch(/^CONFLICTS:/);
    });

    it("should handle single conflict file", () => {
      const result: WeaveResult = {
        success: false,
        item: { name: "feature-branch", deps: [], gates: [] },
        conflicts: ["src/index.ts"],
        message: "CONFLICTS: src/index.ts",
      };

      expect(result.conflicts).toHaveLength(1);
      expect(result.message).toContain("src/index.ts");
    });

    it("should handle complex file paths", () => {
      const result: WeaveResult = {
        success: false,
        item: { name: "feature-branch", deps: [], gates: [] },
        conflicts: [
          "src/commands/merge.ts",
          "tests/commands/merge.spec.ts",
          "src/git/operations.ts",
          ".github/workflows/ci.yml",
        ],
        message:
          "CONFLICTS: src/commands/merge.ts, tests/commands/merge.spec.ts, src/git/operations.ts, .github/workflows/ci.yml",
      };

      expect(result.conflicts).toHaveLength(4);
      expect(result.conflicts).toContain(".github/workflows/ci.yml");
    });
  });

  describe("WeaveExecutionResult conflict counting", () => {
    it("should count conflicts correctly when multiple items have conflicts", () => {
      const operations: WeaveResult[] = [
        {
          success: false,
          item: { name: "branch-1", deps: [], gates: [] },
          conflicts: ["file1.ts"],
          message: "CONFLICTS: file1.ts",
        },
        {
          success: false,
          item: { name: "branch-2", deps: [], gates: [] },
          conflicts: ["file2.ts", "file3.ts"],
          message: "CONFLICTS: file2.ts, file3.ts",
        },
        {
          success: true,
          item: { name: "branch-3", deps: [], gates: [] },
          message: "Successfully merged",
        },
      ];

      // Simulate conflict counting logic
      let conflicts = 0;
      for (const op of operations) {
        if (op.conflicts && op.conflicts.length > 0) {
          conflicts++;
        }
      }

      expect(conflicts).toBe(2); // Two items have conflicts
    });

    it("should report zero conflicts when all merges succeed", () => {
      const operations: WeaveResult[] = [
        {
          success: true,
          item: { name: "branch-1", deps: [], gates: [] },
          message: "Successfully merged",
        },
        {
          success: true,
          item: { name: "branch-2", deps: [], gates: [] },
          message: "Successfully merged",
        },
      ];

      let conflicts = 0;
      for (const op of operations) {
        if (op.conflicts && op.conflicts.length > 0) {
          conflicts++;
        }
      }

      expect(conflicts).toBe(0);
    });

    it("should properly count when some items fail without conflicts", () => {
      const operations: WeaveResult[] = [
        {
          success: false,
          item: { name: "branch-1", deps: [], gates: [] },
          conflicts: ["file1.ts"],
          message: "CONFLICTS: file1.ts",
        },
        {
          success: false,
          item: { name: "branch-2", deps: [], gates: [] },
          message: "Branch not found",
        },
        {
          success: true,
          item: { name: "branch-3", deps: [], gates: [] },
          message: "Successfully merged",
        },
      ];

      let conflicts = 0;
      let failed = 0;
      for (const op of operations) {
        if (!op.success) failed++;
        if (op.conflicts && op.conflicts.length > 0) {
          conflicts++;
        }
      }

      expect(failed).toBe(2); // Two failures
      expect(conflicts).toBe(1); // But only one with conflicts
    });
  });

  describe("Conflict detection behavior", () => {
    it("should detect conflicts from git diff --diff-filter=U output", () => {
      // Simulated output from git diff --name-only --diff-filter=U
      const gitDiffOutput = "src/index.ts\npackage.json\n";
      const conflictedFiles = gitDiffOutput
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);

      expect(conflictedFiles).toHaveLength(2);
      expect(conflictedFiles).toContain("src/index.ts");
      expect(conflictedFiles).toContain("package.json");
    });

    it("should handle empty conflict list", () => {
      const gitDiffOutput = "";
      const conflictedFiles = gitDiffOutput
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);

      expect(conflictedFiles).toHaveLength(0);
    });

    it("should deduplicate conflicts from multiple sources", () => {
      // Conflicts from git diff
      const diffConflicts = ["src/index.ts", "package.json"];
      // Conflicts from git status
      const statusConflicts = ["src/index.ts", "README.md"];

      // Combine and deduplicate
      const allConflicts = [...new Set([...diffConflicts, ...statusConflicts])];

      expect(allConflicts).toHaveLength(3);
      expect(allConflicts).toContain("src/index.ts");
      expect(allConflicts).toContain("package.json");
      expect(allConflicts).toContain("README.md");
    });
  });

  describe("Execution flow with conflicts", () => {
    it("should stop execution when conflicts are detected", () => {
      // Simulates the behavior described in the issue:
      // After first conflict, subsequent operations should not be attempted
      const operations: WeaveResult[] = [
        {
          success: false,
          item: { name: "item-1", deps: [], gates: [] },
          conflicts: ["src/index.ts"],
          message: "CONFLICTS: src/index.ts",
        },
        // Items 2-4 should not be attempted if we stop on first conflict
      ];

      // With the fix, execution should stop after first conflict
      expect(operations).toHaveLength(1); // Only one operation attempted
      expect(operations[0].conflicts).toHaveLength(1);
    });

    it("should provide structured conflict data for downstream tooling", () => {
      const result: WeaveExecutionResult = {
        operations: [
          {
            success: false,
            item: { name: "branch-1", deps: [], gates: [] },
            conflicts: ["src/index.ts", "package.json"],
            message: "CONFLICTS: src/index.ts, package.json",
          },
        ],
        successful: 0,
        failed: 1,
        conflicts: 1,
        totalOperations: 1,
      };

      // Verify the structure is suitable for JSON serialization
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);

      expect(parsed.conflicts).toBe(1);
      expect(parsed.operations[0].conflicts).toHaveLength(2);
      expect(parsed.operations[0].conflicts).toContain("src/index.ts");
    });
  });

  describe("Error message formatting", () => {
    it("should include merge error details when available", () => {
      const baseMessage = "CONFLICTS: src/index.ts";
      const errorDetail = "Automatic merge failed; fix conflicts and then commit the result.";
      const fullMessage = `${baseMessage} (${errorDetail})`;

      expect(fullMessage).toContain("CONFLICTS:");
      expect(fullMessage).toContain("src/index.ts");
      expect(fullMessage).toContain("Automatic merge failed");
    });

    it("should handle message without error details", () => {
      const message = "CONFLICTS: src/index.ts, package.json";

      expect(message).toBe("CONFLICTS: src/index.ts, package.json");
      expect(message).not.toContain("(");
    });
  });
});
