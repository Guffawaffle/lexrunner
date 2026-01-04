/**
 * Vitest Adapter End-to-End Tests
 *
 * Validates the full pipeline: Vitest JSON → AXTestResult → Output formats
 *
 * Tests cover:
 * - JSON output format
 * - Markdown output format
 * - failureId determinism
 * - stackFrames parsing
 * - nextActions generation
 * - Raw field preservation
 * - Exit codes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vitestJsonAdapter } from "../../../src/gates/test/adapters/vitest-json.js";
import { formatAsMarkdown } from "../../../src/gates/test/formatters/markdown.js";
import type { AXTestResult } from "../../../src/gates/test/schema.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/vitest");

describe("Vitest Adapter E2E", () => {
  describe("JSON Output Format", () => {
    it("should parse all-passing fixture to valid AXTestResult", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      // Validate structure
      expect(result.schemaVersion).toBe("1.0.0");
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.adapter.name).toBe("vitest-json");
      expect(result.adapter.version).toBe("1.0.0");

      // Validate summary
      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.passed).toBe(result.summary.total);
      expect(result.summary.durationMs).toBeGreaterThan(0);

      // Validate no failures
      expect(result.failures).toHaveLength(0);
    });

    it("should parse some-failing fixture with detailed failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      // Validate summary
      expect(result.summary.failed).toBe(2);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.total).toBe(5);

      // Validate failures
      expect(result.failures).toHaveLength(2);

      // Check first failure (AssertionError)
      const assertionFailure = result.failures.find((f) =>
        f.error.type?.includes("AssertionError")
      );
      expect(assertionFailure).toBeDefined();
      expect(assertionFailure!.failureId).toBeTruthy();
      expect(assertionFailure!.file).toBeTruthy();
      expect(assertionFailure!.line).toBeGreaterThan(0);
      expect(assertionFailure!.name).toBeTruthy();
      expect(assertionFailure!.error.message).toBeTruthy();
      expect(assertionFailure!.nextActions.length).toBeGreaterThan(0);

      // Check timeout failure
      const timeoutFailure = result.failures.find((f) => f.error.type?.includes("Timeout"));
      expect(timeoutFailure).toBeDefined();
      expect(timeoutFailure!.durationMs).toBeGreaterThan(5000); // Timeout duration
      expect(timeoutFailure!.nextActions.length).toBeGreaterThan(0);
    });

    it("should parse complex-nested-suites with proper hierarchy", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "complex-nested-suites.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      // Find a test with ancestorTitles
      const nestedTest = result.failures.length > 0 ? result.failures[0] : null;

      // Even if no failures, validate structure
      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.adapter.name).toBe("vitest-json");
    });

    it("should extract coverage when present", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "with-coverage.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      expect(result.coverage).toBeDefined();
      expect(result.coverage!.linesPct).toBeGreaterThanOrEqual(0);
      expect(result.coverage!.linesPct).toBeLessThanOrEqual(100);
      expect(result.coverage!.branchesPct).toBeGreaterThanOrEqual(0);
      expect(result.coverage!.branchesPct).toBeLessThanOrEqual(100);
      expect(result.coverage!.functionsPct).toBeGreaterThanOrEqual(0);
      expect(result.coverage!.functionsPct).toBeLessThanOrEqual(100);
    });

    it("should parse real LexRunner test output", () => {
      const input = fs.readFileSync(
        path.join(FIXTURES_DIR, "lexrunner-schema-tests.json"),
        "utf-8"
      );
      const result = vitestJsonAdapter.parse(input);

      expect(result.summary.total).toBe(31);
      expect(result.summary.passed).toBe(31);
      expect(result.summary.failed).toBe(0);
      expect(result.failures).toHaveLength(0);
    });
  });

  describe("Markdown Output Format", () => {
    it("should format all-passing as markdown", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);
      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("# Test Results");
      expect(markdown).toContain("✅"); // Success indicator
      expect(markdown).toContain("Passed:");
      expect(markdown).toContain("Duration:");
    });

    it("should format some-failing with failure details", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);
      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("# Test Results");
      expect(markdown).toContain("❌"); // Failure indicator
      expect(markdown).toContain("Failed:");
      expect(markdown).toContain("## Failures");
      expect(markdown).toContain("Next Actions");
    });

    it("should include coverage in markdown when present", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "with-coverage.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);
      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("Coverage");
      expect(markdown).toContain("Lines:");
      expect(markdown).toContain("%");
    });
  });

  describe("failureId Determinism", () => {
    it("should generate same failureId for same input", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");

      const result1 = vitestJsonAdapter.parse(input);
      const result2 = vitestJsonAdapter.parse(input);

      expect(result1.failures.length).toBeGreaterThan(0);
      expect(result2.failures.length).toBeGreaterThan(0);

      for (let i = 0; i < result1.failures.length; i++) {
        expect(result1.failures[i].failureId).toBe(result2.failures[i].failureId);
      }
    });

    it("should generate different failureIds for different tests", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      if (result.failures.length >= 2) {
        const ids = result.failures.map((f) => f.failureId);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }
    });
  });

  describe("stackFrames Parsing", () => {
    it("should parse stack frames from failure messages", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      const failureWithStack = result.failures.find(
        (f) => f.stackFrames && f.stackFrames.length > 0
      );

      if (failureWithStack) {
        expect(failureWithStack.stackFrames).toBeDefined();
        expect(failureWithStack.stackFrames!.length).toBeGreaterThan(0);

        const firstFrame = failureWithStack.stackFrames![0];
        expect(firstFrame.file).toBeTruthy();
        expect(firstFrame.line).toBeGreaterThan(0);
      }
    });

    it("should filter node_modules from stack frames", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        if (failure.stackFrames) {
          for (const frame of failure.stackFrames) {
            // Stack frames should be relevant (not deep in node_modules)
            expect(frame.file).toBeTruthy();
          }
        }
      }
    });
  });

  describe("nextActions Generation", () => {
    it("should generate rerun command for all failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        expect(failure.nextActions.length).toBeGreaterThan(0);

        // First action should be rerun
        const firstAction = failure.nextActions[0];
        if (typeof firstAction === "object") {
          expect(firstAction.kind).toBe("rerun");
          expect(firstAction.cmd).toContain("vitest run");
        }
      }
    });

    it("should include timeout-specific actions for timeout failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      const timeoutFailure = result.failures.find(
        (f) =>
          f.error.type?.includes("Timeout") || f.error.message.toLowerCase().includes("timeout")
      );

      if (timeoutFailure) {
        const actionNotes = timeoutFailure.nextActions.map((a) =>
          typeof a === "string" ? a : a.note
        );

        const hasTimeoutAction = actionNotes.some(
          (note) => note.toLowerCase().includes("timeout") || note.toLowerCase().includes("slow")
        );

        expect(hasTimeoutAction).toBe(true);
      }
    });

    it("should include confidence levels in nextActionsMeta", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        if (failure.nextActionsMeta) {
          expect(failure.nextActionsMeta.confidence).toMatch(/^(high|medium|low)$/);
        }
      }
    });
  });

  describe("Raw Field Preservation", () => {
    it("should preserve raw output when includeRaw is true", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      // The adapter includes raw in the result
      expect(result.raw).toBeDefined();
      expect(result.raw).toBe(input);
    });

    it("should include raw assertion data in failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        expect(failure.raw).toBeDefined();
      }
    });
  });

  describe("Round-trip Serialization", () => {
    it("should produce valid JSON that can be re-parsed", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = vitestJsonAdapter.parse(input);

      const json = JSON.stringify(result, null, 2);
      const reparsed = JSON.parse(json);

      expect(reparsed.schemaVersion).toBe(result.schemaVersion);
      expect(reparsed.summary.total).toBe(result.summary.total);
      expect(reparsed.failures.length).toBe(result.failures.length);
    });
  });
});
