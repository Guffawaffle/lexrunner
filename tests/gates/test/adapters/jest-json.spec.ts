/**
 * Tests for Jest JSON adapter
 */

import { describe, it, expect, beforeEach } from "vitest";
import { jestJsonAdapter } from "../../../../src/gates/test/adapters/jest-json.js";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Helper to load fixture files
 */
function loadFixture(name: string): string {
  const fixturePath = join(import.meta.dirname, "../../../fixtures/jest", name);
  return readFileSync(fixturePath, "utf-8");
}

describe("jestJsonAdapter", () => {
  describe("detect()", () => {
    it("detects valid Jest JSON output", () => {
      const content = loadFixture("all-passing.json");
      expect(jestJsonAdapter.detect(content)).toBe(true);
    });

    it("detects Jest JSON with failures", () => {
      const content = loadFixture("some-failing.json");
      expect(jestJsonAdapter.detect(content)).toBe(true);
    });

    it("detects Jest JSON with snapshots", () => {
      const content = loadFixture("snapshot-failures.json");
      expect(jestJsonAdapter.detect(content)).toBe(true);
    });

    it("detects Jest JSON with location info", () => {
      const content = loadFixture("with-location.json");
      expect(jestJsonAdapter.detect(content)).toBe(true);
    });

    it("rejects invalid JSON", () => {
      expect(jestJsonAdapter.detect("not json")).toBe(false);
    });

    it("rejects non-object JSON", () => {
      expect(jestJsonAdapter.detect("[]")).toBe(false);
      expect(jestJsonAdapter.detect('"string"')).toBe(false);
      expect(jestJsonAdapter.detect("123")).toBe(false);
    });

    it("rejects JSON without Jest markers", () => {
      const vitestLike = JSON.stringify({
        testResults: [],
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
      });
      expect(jestJsonAdapter.detect(vitestLike)).toBe(false);
    });

    it("rejects JSON with only wasInterrupted", () => {
      const incomplete = JSON.stringify({
        wasInterrupted: false,
        testResults: [],
      });
      expect(jestJsonAdapter.detect(incomplete)).toBe(false);
    });

    it("rejects JSON with only snapshot", () => {
      const incomplete = JSON.stringify({
        snapshot: {},
        testResults: [],
      });
      expect(jestJsonAdapter.detect(incomplete)).toBe(false);
    });
  });

  describe("parse()", () => {
    describe("all-passing.json", () => {
      it("parses passing tests correctly", () => {
        const content = loadFixture("all-passing.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.schemaVersion).toBe("1.0.0");
        expect(result.summary.total).toBe(3);
        expect(result.summary.passed).toBe(3);
        expect(result.summary.failed).toBe(0);
        expect(result.summary.skipped).toBe(0);
        expect(result.failures).toHaveLength(0);
      });

      it("sets adapter metadata", () => {
        const content = loadFixture("all-passing.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.adapter.name).toBe("jest-json");
        expect(result.adapter.version).toBe("1.0.0");
        expect(result.adapter.source).toBe("jest-json-output");
      });

      it("preserves raw output", () => {
        const content = loadFixture("all-passing.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.raw).toBe(content);
      });

      it("sets timestamp from startTime", () => {
        const content = loadFixture("all-passing.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.timestamp).toBe("2024-01-04T10:00:00.000Z");
      });
    });

    describe("some-failing.json", () => {
      it("parses mixed pass/fail tests correctly", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.summary.total).toBe(3);
        expect(result.summary.passed).toBe(1);
        expect(result.summary.failed).toBe(2);
        expect(result.failures).toHaveLength(2);
      });

      it("maps failure fields correctly", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.file).toBe("/home/user/project/src/math.test.js");
        expect(failure.name).toBe("Math operations addition works correctly");
        expect(failure.suite).toBe("Math operations");
        expect(failure.line).toBe(8);
        expect(failure.column).toBe(3);
        expect(failure.durationMs).toBe(12);
      });

      it("extracts error message from failureMessages", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.error.message).toContain("expect(received).toEqual(expected)");
        expect(failure.error.message).toContain("Expected: 4");
        expect(failure.error.message).toContain("Received: 5");
      });

      it("generates failure ID", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.failureId).toBeDefined();
        expect(failure.failureId).toMatch(/^[0-9a-f]{16}$/);
      });

      it("parses stack frames", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.stackFrames).toBeDefined();
        expect(failure.stackFrames!.length).toBeGreaterThan(0);
        expect(failure.stackFrames![0].file).toContain("math.test.js");
      });

      it("generates next actions with rerun command", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.nextActions).toBeDefined();
        expect(failure.nextActions.length).toBeGreaterThan(0);

        const rerunAction = failure.nextActions.find(
          (action) => typeof action === "object" && action.kind === "rerun"
        );
        expect(rerunAction).toBeDefined();
        if (typeof rerunAction === "object" && rerunAction.kind === "rerun") {
          expect(rerunAction.cmd).toContain("jest -t");
          expect(rerunAction.cmd).toContain("Math operations addition works correctly");
        }
      });

      it("detects timeout failures", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const timeoutFailure = result.failures.find((f) => f.name.includes("async operation"));
        expect(timeoutFailure).toBeDefined();
        expect(timeoutFailure!.error.message).toContain("Timeout");
        expect(timeoutFailure!.durationMs).toBeGreaterThan(15000);

        const timeoutAction = timeoutFailure!.nextActions.find(
          (action) => typeof action === "object" && action.note?.includes("timeout")
        );
        expect(timeoutAction).toBeDefined();
      });

      it("extracts diff information from failureDetails", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.diff).toBeDefined();
        expect(failure.diff!.expected).toBe("4");
        expect(failure.diff!.actual).toBe("5");
      });

      it("extracts assertion details from failureDetails", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.assertion).toBeDefined();
        expect(failure.assertion!.operator).toBe("toEqual");
      });

      it("preserves raw assertion data", () => {
        const content = loadFixture("some-failing.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.raw).toBeDefined();
        expect(failure.raw).toHaveProperty("ancestorTitles");
        expect(failure.raw).toHaveProperty("fullName");
      });
    });

    describe("snapshot-failures.json", () => {
      it("detects snapshot failures", () => {
        const content = loadFixture("snapshot-failures.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.failures).toHaveLength(1);
        const failure = result.failures[0];
        expect(failure.error.message).toContain("toMatchSnapshot");
        expect(failure.error.message).toContain("Snapshot");
      });

      it("provides snapshot-specific next actions", () => {
        const content = loadFixture("snapshot-failures.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        const snapshotActions = failure.nextActions.filter((action) => {
          if (typeof action === "string") return action.includes("snapshot");
          return action.note?.toLowerCase().includes("snapshot");
        });

        expect(snapshotActions.length).toBeGreaterThan(0);

        const updateAction = failure.nextActions.find(
          (action) => typeof action === "object" && action.cmd === "jest -u"
        );
        expect(updateAction).toBeDefined();
      });

      it("shows snapshot diff in error message", () => {
        const content = loadFixture("snapshot-failures.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.error.message).toContain("- Snapshot");
        expect(failure.error.message).toContain("+ Received");
        expect(failure.error.message).toContain("<h1>Welcome</h1>");
        expect(failure.error.message).toContain("<h1>Welcome User</h1>");
      });
    });

    describe("with-location.json", () => {
      it("uses location information when available", () => {
        const content = loadFixture("with-location.json");
        const result = jestJsonAdapter.parse(content);

        expect(result.failures).toHaveLength(1);
        const failure = result.failures[0];

        expect(failure.line).toBe(22);
        expect(failure.column).toBe(5);
      });

      it("handles nested ancestor titles", () => {
        const content = loadFixture("with-location.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.suite).toBe("User API > GET /users");
      });

      it("detects TypeError from error message", () => {
        const content = loadFixture("with-location.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        expect(failure.error.type).toBe("TypeError");
      });

      it("suggests null check for null errors", () => {
        const content = loadFixture("with-location.json");
        const result = jestJsonAdapter.parse(content);

        const failure = result.failures[0];
        const nullCheckAction = failure.nextActions.find(
          (action) =>
            typeof action === "object" &&
            (action.note?.includes("null") || action.note?.includes("optional chaining"))
        );

        expect(nullCheckAction).toBeDefined();
      });
    });

    describe("error handling", () => {
      it("throws AdapterParseError for invalid JSON", () => {
        expect(() => jestJsonAdapter.parse("not json")).toThrow("Failed to parse Jest JSON");
      });

      it("throws AdapterParseError for missing testResults", () => {
        const invalid = JSON.stringify({
          numTotalTests: 0,
          numPassedTests: 0,
          numFailedTests: 0,
          wasInterrupted: false,
          snapshot: {},
        });

        expect(() => jestJsonAdapter.parse(invalid)).toThrow("missing or invalid testResults");
      });

      it("preserves raw input in AdapterParseError", () => {
        const invalid = "not json";
        try {
          jestJsonAdapter.parse(invalid);
          expect.fail("Should have thrown");
        } catch (err: any) {
          expect(err.name).toBe("AdapterParseError");
          expect(err.raw).toBe(invalid);
          expect(err.adapterName).toBe("jest-json");
        }
      });
    });

    describe("Buffer input", () => {
      it("handles Buffer input", () => {
        const content = loadFixture("all-passing.json");
        const buffer = Buffer.from(content, "utf-8");

        const result = jestJsonAdapter.parse(buffer);
        expect(result.summary.total).toBe(3);
      });
    });
  });

  describe("adapter metadata", () => {
    it("has correct name", () => {
      expect(jestJsonAdapter.name).toBe("jest-json");
    });

    it("has version", () => {
      expect(jestJsonAdapter.version).toBe("1.0.0");
    });

    it("supports .json extension", () => {
      expect(jestJsonAdapter.extensions).toContain(".json");
    });
  });
});
