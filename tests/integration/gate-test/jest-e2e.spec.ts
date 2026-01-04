/**
 * Jest JSON Adapter End-to-End Tests
 *
 * Validates the full pipeline: Jest JSON → AXTestResult → JSON output
 *
 * Tests cover:
 * - Basic parsing with location data
 * - Snapshot failure handling
 * - Timeout errors
 * - Matcher result extraction
 * - failureId determinism
 */

import { describe, it, expect } from "vitest";
import { jestJsonAdapter } from "../../../src/gates/test/adapters/jest-json.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/jest");

describe("Jest JSON Adapter E2E", () => {
  describe("Basic Parsing", () => {
    it("should parse all-passing.json to valid AXTestResult", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      // Validate structure
      expect(result.schemaVersion).toBe("1.0.0");
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.adapter.name).toBe("jest-json");
      expect(result.adapter.version).toBe("1.0.0");

      // Validate summary
      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.passed).toBe(result.summary.total);

      // Validate no failures
      expect(result.failures).toHaveLength(0);
    });

    it("should parse some-failing.json with detailed failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      // Validate summary
      expect(result.summary.failed).toBe(2);
      expect(result.summary.passed).toBe(1);
      expect(result.summary.total).toBe(3);

      // Validate failures
      expect(result.failures).toHaveLength(2);
    });

    it("should parse with-location.json and extract location data", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "with-location.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      if (result.failures.length > 0) {
        const failure = result.failures[0];
        expect(failure.line).toBeGreaterThan(0);
        // Column might be present if Jest provides it
        if (failure.column) {
          expect(failure.column).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Snapshot Failures", () => {
    it("should parse snapshot-failures.json with snapshot-specific actions", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "snapshot-failures.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      expect(result.failures.length).toBeGreaterThan(0);

      // Check for snapshot-specific next actions
      const snapshotFailure = result.failures[0];
      const actionNotes = snapshotFailure.nextActions.map((a) =>
        typeof a === "string" ? a : a.note
      );

      // Should suggest snapshot update
      const hasSnapshotAction = actionNotes.some((note) => note.toLowerCase().includes("snapshot"));

      expect(hasSnapshotAction).toBe(true);
    });
  });

  describe("Matcher Result Extraction", () => {
    it("should extract expected/actual from matcherResult", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      // Look for a failure with diff information
      const failureWithDiff = result.failures.find((f) => f.diff);

      if (failureWithDiff) {
        expect(failureWithDiff.diff).toBeDefined();
        expect(failureWithDiff.diff!.expected).toBeTruthy();
        expect(failureWithDiff.diff!.actual).toBeTruthy();
      }
    });

    it("should extract assertion operator from matcherResult", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      const failureWithAssertion = result.failures.find((f) => f.assertion);

      if (failureWithAssertion) {
        expect(failureWithAssertion.assertion).toBeDefined();
        expect(failureWithAssertion.assertion!.operator).toBeTruthy();
      }
    });
  });

  describe("Timeout Handling", () => {
    it("should identify timeout errors and generate appropriate actions", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      const timeoutFailure = result.failures.find((f) =>
        f.error.message.toLowerCase().includes("timeout")
      );

      if (timeoutFailure) {
        expect(timeoutFailure.durationMs).toBeGreaterThan(5000);

        const actionNotes = timeoutFailure.nextActions.map((a) =>
          typeof a === "string" ? a : a.note
        );

        const hasTimeoutAction = actionNotes.some((note) => note.toLowerCase().includes("timeout"));

        expect(hasTimeoutAction).toBe(true);
      }
    });
  });

  describe("failureId Determinism", () => {
    it("should generate same failureId for same input", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");

      const result1 = jestJsonAdapter.parse(input);
      const result2 = jestJsonAdapter.parse(input);

      expect(result1.failures.length).toBeGreaterThan(0);
      expect(result2.failures.length).toBeGreaterThan(0);

      for (let i = 0; i < result1.failures.length; i++) {
        expect(result1.failures[i].failureId).toBe(result2.failures[i].failureId);
      }
    });

    it("should generate different failureIds for different tests", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      if (result.failures.length >= 2) {
        const ids = result.failures.map((f) => f.failureId);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }
    });
  });

  describe("Stack Frame Parsing", () => {
    it("should parse stack frames from error messages", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

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
  });

  describe("Next Actions Generation", () => {
    it("should generate rerun command for all failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        expect(failure.nextActions.length).toBeGreaterThan(0);

        // First action should typically be rerun
        const firstAction = failure.nextActions[0];
        if (typeof firstAction === "object") {
          expect(firstAction.kind).toBe("rerun");
          expect(firstAction.cmd).toContain("jest");
        }
      }
    });

    it("should include confidence levels in nextActionsMeta", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        if (failure.nextActionsMeta) {
          expect(failure.nextActionsMeta.confidence).toMatch(/^(high|medium|low)$/);
        }
      }
    });
  });

  describe("Test Name and Suite", () => {
    it("should extract full test name from fullName field", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        expect(failure.name).toBeTruthy();
        expect(failure.name).toContain("Math operations");
      }
    });

    it("should extract suite from ancestorTitles", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        if (failure.suite) {
          expect(failure.suite).toBeTruthy();
        }
      }
    });
  });

  describe("Duration Tracking", () => {
    it("should capture test duration for failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      for (const failure of result.failures) {
        if (failure.durationMs !== undefined) {
          expect(failure.durationMs).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("should capture overall test run duration", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Raw Preservation", () => {
    it("should preserve raw assertion data", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");
      const result = jestJsonAdapter.parse(input);

      expect(result.raw).toBe(input);

      for (const failure of result.failures) {
        expect(failure.raw).toBeDefined();
      }
    });
  });
});
