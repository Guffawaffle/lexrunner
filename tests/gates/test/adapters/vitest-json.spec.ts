/**
 * Tests for Vitest JSON Adapter
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { vitestJsonAdapter } from "../../../../src/gates/test/adapters/vitest-json.js";
import {
  registerAdapter,
  detectAdapter,
  clearAdapters,
} from "../../../../src/gates/test/adapters/registry.js";
import { isValidAXTestResult } from "../../../../src/gates/test/schema.js";

// Helper to load fixture
function loadFixture(name: string): string {
  const fixturePath = join(process.cwd(), "tests/fixtures/vitest", `${name}.json`);
  return readFileSync(fixturePath, "utf-8");
}

describe("Vitest JSON Adapter", () => {
  beforeEach(() => {
    clearAdapters();
  });

  describe("Adapter metadata", () => {
    it("should have correct name", () => {
      expect(vitestJsonAdapter.name).toBe("vitest-json");
    });

    it("should have version", () => {
      expect(vitestJsonAdapter.version).toBe("1.0.0");
    });

    it("should handle .json extension", () => {
      expect(vitestJsonAdapter.extensions).toEqual([".json"]);
    });
  });

  describe("detect()", () => {
    it("should detect valid Vitest JSON output", () => {
      const content = loadFixture("all-passing");
      expect(vitestJsonAdapter.detect(content)).toBe(true);
    });

    it("should detect Vitest JSON with failures", () => {
      const content = loadFixture("some-failing");
      expect(vitestJsonAdapter.detect(content)).toBe(true);
    });

    it("should detect Vitest JSON with coverage", () => {
      const content = loadFixture("with-coverage");
      expect(vitestJsonAdapter.detect(content)).toBe(true);
    });

    it("should reject invalid JSON", () => {
      const content = "not json at all";
      expect(vitestJsonAdapter.detect(content)).toBe(false);
    });

    it("should reject non-Vitest JSON", () => {
      const content = JSON.stringify({
        type: "jest",
        results: [],
      });
      expect(vitestJsonAdapter.detect(content)).toBe(false);
    });

    it("should reject empty object", () => {
      const content = JSON.stringify({});
      expect(vitestJsonAdapter.detect(content)).toBe(false);
    });

    it("should work with auto-detection in registry", () => {
      registerAdapter(vitestJsonAdapter);
      const content = loadFixture("all-passing");
      const detected = detectAdapter(content);
      expect(detected).toBe(vitestJsonAdapter);
    });
  });

  describe("parse() - all-passing fixture", () => {
    it("should parse successfully", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(isValidAXTestResult(result)).toBe(true);
    });

    it("should extract correct summary", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.skipped).toBe(0);
      expect(result.summary.durationMs).toBeGreaterThan(0);
    });

    it("should have no failures for passing tests", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.failures).toHaveLength(0);
    });

    it("should include adapter metadata", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.adapter.name).toBe("vitest-json");
      expect(result.adapter.version).toBe("1.0.0");
      expect(result.adapter.source).toBe("vitest-json-output");
    });

    it("should preserve raw output", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.raw).toBe(content);
    });

    it("should have valid timestamp", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.timestamp).toBeDefined();
      expect(() => new Date(result.timestamp)).not.toThrow();
    });

    it("should have correct schema version", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.schemaVersion).toBe("1.0.0");
    });
  });

  describe("parse() - some-failing fixture", () => {
    it("should parse successfully", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      expect(isValidAXTestResult(result)).toBe(true);
    });

    it("should extract correct summary", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.summary.total).toBe(5);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(2);
      expect(result.summary.skipped).toBe(0);
    });

    it("should extract failures", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.failures).toHaveLength(2);
    });

    it("should map failure fields correctly", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      const failure = result.failures[0];
      expect(failure.file).toBe("src/services/user.spec.ts");
      expect(failure.name).toBe("UserService validates email format");
      expect(failure.suite).toBe("UserService");
      expect(failure.error.message).toContain("expected");
      expect(failure.error.type).toBe("AssertionError");
    });

    it("should generate failureId for each failure", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      result.failures.forEach((failure) => {
        expect(failure.failureId).toBeDefined();
        expect(failure.failureId).toHaveLength(16);
        expect(failure.failureId).toMatch(/^[0-9a-f]{16}$/);
      });
    });

    it("should parse stack frames", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      const failure = result.failures[0];
      expect(failure.stackFrames).toBeDefined();
      expect(failure.stackFrames!.length).toBeGreaterThan(0);
    });

    it("should extract file location from stack trace", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      const failure = result.failures[0];
      expect(failure.line).toBe(15);
      expect(failure.column).toBe(25);
    });

    it("should include duration for failures", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      result.failures.forEach((failure) => {
        expect(failure.durationMs).toBeDefined();
        expect(failure.durationMs!).toBeGreaterThan(0);
      });
    });

    it("should preserve raw assertion data", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      result.failures.forEach((failure) => {
        expect(failure.raw).toBeDefined();
        expect(failure.raw).toHaveProperty("ancestorTitles");
        expect(failure.raw).toHaveProperty("status");
      });
    });
  });

  describe("parse() - with-coverage fixture", () => {
    it("should parse successfully", () => {
      const content = loadFixture("with-coverage");
      const result = vitestJsonAdapter.parse(content);

      expect(isValidAXTestResult(result)).toBe(true);
    });

    it("should extract coverage summary", () => {
      const content = loadFixture("with-coverage");
      const result = vitestJsonAdapter.parse(content);

      expect(result.coverage).toBeDefined();
      expect(result.coverage!.linesPct).toBe(85);
      expect(result.coverage!.branchesPct).toBe(75);
      expect(result.coverage!.functionsPct).toBe(90);
      expect(result.coverage!.statementsPct).toBe(85);
    });

    it("should handle missing coverage gracefully", () => {
      const content = loadFixture("all-passing");
      const result = vitestJsonAdapter.parse(content);

      expect(result.coverage).toBeUndefined();
    });
  });

  describe("parse() - complex-nested-suites fixture", () => {
    it("should parse successfully", () => {
      const content = loadFixture("complex-nested-suites");
      const result = vitestJsonAdapter.parse(content);

      expect(isValidAXTestResult(result)).toBe(true);
    });

    it("should handle deeply nested suites", () => {
      const content = loadFixture("complex-nested-suites");
      const result = vitestJsonAdapter.parse(content);

      const failure = result.failures[0];
      expect(failure.suite).toBeDefined();
      expect(failure.suite).toContain(">");
    });

    it("should extract correct test names from nested suites", () => {
      const content = loadFixture("complex-nested-suites");
      const result = vitestJsonAdapter.parse(content);

      expect(result.failures[0].name).toContain("API");
      expect(result.failures[0].name).toContain("validates required fields");
    });
  });

  describe("nextActions generation", () => {
    it("should generate rerun command for all failures", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      result.failures.forEach((failure) => {
        expect(failure.nextActions.length).toBeGreaterThan(0);
        const rerunAction = failure.nextActions.find(
          (action) => typeof action === "object" && action.kind === "rerun"
        );
        expect(rerunAction).toBeDefined();
      });
    });

    it("should include vitest-specific rerun template", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      const failure = result.failures[0];
      const rerunAction = failure.nextActions.find(
        (action) => typeof action === "object" && action.kind === "rerun"
      ) as { kind: string; cmd?: string };

      expect(rerunAction.cmd).toBeDefined();
      expect(rerunAction.cmd).toContain("vitest run -t");
    });

    it("should generate timeout-specific actions for timeout errors", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      const timeoutFailure = result.failures.find((f) => f.error.type?.includes("Timeout"));

      if (timeoutFailure) {
        const hasTimeoutAction = timeoutFailure.nextActions.some(
          (action) =>
            typeof action === "object" &&
            (action.note.toLowerCase().includes("timeout") ||
              action.note.toLowerCase().includes("slow"))
        );
        expect(hasTimeoutAction).toBe(true);
      }
    });

    it("should set confidence level for each failure", () => {
      const content = loadFixture("some-failing");
      const result = vitestJsonAdapter.parse(content);

      result.failures.forEach((failure) => {
        expect(failure.nextActionsMeta).toBeDefined();
        expect(failure.nextActionsMeta!.confidence).toMatch(/^(high|medium|low)$/);
      });
    });

    it("should generate type-specific actions for TypeError", () => {
      const content = loadFixture("complex-nested-suites");
      const result = vitestJsonAdapter.parse(content);

      const typeErrorFailure = result.failures.find((f) => f.error.type === "TypeError");

      if (typeErrorFailure) {
        const hasTypeErrorAction = typeErrorFailure.nextActions.some(
          (action) =>
            typeof action === "object" &&
            (action.note.toLowerCase().includes("null") ||
              action.note.toLowerCase().includes("undefined"))
        );
        expect(hasTypeErrorAction).toBe(true);
      }
    });
  });

  describe("Error handling", () => {
    it("should throw on invalid JSON", () => {
      const invalidJson = "{ invalid json }";
      expect(() => vitestJsonAdapter.parse(invalidJson)).toThrow(
        /Failed to parse Vitest JSON output/
      );
    });

    it("should handle Buffer input", () => {
      const content = loadFixture("all-passing");
      const buffer = Buffer.from(content, "utf-8");
      const result = vitestJsonAdapter.parse(buffer);

      expect(isValidAXTestResult(result)).toBe(true);
    });

    it("should handle empty test results array", () => {
      const content = JSON.stringify({
        numTotalTestSuites: 0,
        numPassedTestSuites: 0,
        numFailedTestSuites: 0,
        numPendingTestSuites: 0,
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        startTime: Date.now(),
        success: true,
        testResults: [],
      });

      const result = vitestJsonAdapter.parse(content);
      expect(result.summary.total).toBe(0);
      expect(result.failures).toHaveLength(0);
    });

    it("should handle failures without stack traces", () => {
      const content = JSON.stringify({
        numTotalTestSuites: 1,
        numPassedTestSuites: 0,
        numFailedTestSuites: 1,
        numPendingTestSuites: 0,
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 1,
        numPendingTests: 0,
        numTodoTests: 0,
        startTime: Date.now(),
        success: false,
        testResults: [
          {
            assertionResults: [
              {
                ancestorTitles: ["Suite"],
                fullName: "Suite test",
                status: "failed" as const,
                title: "test",
                duration: 1,
                failureMessages: ["Simple error"],
                meta: {},
              },
            ],
            startTime: Date.now(),
            endTime: Date.now() + 1,
            status: "failed",
            message: "",
            name: "test.spec.ts",
          },
        ],
      });

      const result = vitestJsonAdapter.parse(content);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].error.message).toBe("Simple error");
    });
  });

  describe("Integration with registry", () => {
    it("should be registrable", () => {
      expect(() => registerAdapter(vitestJsonAdapter)).not.toThrow();
    });

    it("should be auto-detectable after registration", () => {
      registerAdapter(vitestJsonAdapter);
      const content = loadFixture("all-passing");
      const detected = detectAdapter(content);

      expect(detected).toBe(vitestJsonAdapter);
    });

    it("should parse via detected adapter", () => {
      registerAdapter(vitestJsonAdapter);
      const content = loadFixture("some-failing");
      const detected = detectAdapter(content);

      expect(detected).toBe(vitestJsonAdapter);
      const result = detected!.parse(content);
      expect(isValidAXTestResult(result)).toBe(true);
    });
  });
});
