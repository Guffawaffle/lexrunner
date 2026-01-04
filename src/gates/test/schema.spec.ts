/**
 * Tests for AXTestResult schema
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import { describe, it, expect } from "vitest";
import {
  SCHEMA_VERSION,
  AXTestResultSchema,
  AXTestFailureSchema,
  AXNextActionSchema,
  parseAXTestResult,
  safeParseAXTestResult,
  isValidAXTestResult,
  parseAXTestFailure,
  isValidAXTestFailure,
  createAXTestResult,
  createAXTestFailure,
  type AXTestResult,
  type AXTestFailure,
  type AXNextAction,
} from "./schema.js";

describe("AXTestResult Schema", () => {
  describe("SCHEMA_VERSION", () => {
    it("is 1.0.0", () => {
      expect(SCHEMA_VERSION).toBe("1.0.0");
    });
  });

  describe("AXNextActionSchema", () => {
    it("accepts valid structured action", () => {
      const action: AXNextAction = {
        kind: "rerun",
        cmd: 'vitest run -t "my test"',
        note: "Re-run the failing test",
      };
      expect(AXNextActionSchema.parse(action)).toEqual(action);
    });

    it("accepts action without cmd", () => {
      const action: AXNextAction = {
        kind: "inspect",
        note: "Check null handling",
      };
      expect(AXNextActionSchema.parse(action)).toEqual(action);
    });

    it("rejects invalid kind", () => {
      expect(() => AXNextActionSchema.parse({ kind: "invalid", note: "test" })).toThrow();
    });

    it("rejects missing note", () => {
      expect(() => AXNextActionSchema.parse({ kind: "fix" })).toThrow();
    });
  });

  describe("AXTestFailureSchema", () => {
    const validFailure: AXTestFailure = {
      failureId: "abc123",
      file: "tests/unit/handler.spec.ts",
      line: 42,
      name: "handleActivate throws when persona not found",
      error: {
        message: "Expected LexSonaError but got TypeError",
        type: "AssertionError",
      },
      nextActions: ["Check persona loader for null handling"],
    };

    it("accepts valid failure with minimal fields", () => {
      expect(AXTestFailureSchema.parse(validFailure)).toEqual(validFailure);
    });

    it("accepts failure with all optional fields", () => {
      const fullFailure: AXTestFailure = {
        ...validFailure,
        signature: "assertion_persona_null",
        column: 10,
        suite: "handleActivate",
        error: {
          message: "Expected LexSonaError but got TypeError",
          type: "AssertionError",
          stack: "at Object.<anonymous> (tests/unit/handler.spec.ts:42:10)",
        },
        stackFrames: [
          {
            file: "tests/unit/handler.spec.ts",
            line: 42,
            column: 10,
            function: "Object.<anonymous>",
          },
          { file: "src/handlers.ts", line: 15, function: "handleActivate" },
        ],
        assertion: {
          operator: "toThrow",
          expectedType: "LexSonaError",
          actualType: "TypeError",
        },
        diff: {
          expected: "LexSonaError",
          actual: "TypeError: Cannot read property 'id' of undefined",
          unified: "- LexSonaError\n+ TypeError",
          contextLines: 3,
        },
        nextActions: [
          "Check persona loader for null handling",
          {
            kind: "rerun",
            cmd: 'vitest run -t "handleActivate throws"',
            note: "Re-run failing test",
          },
        ],
        nextActionsMeta: { confidence: "high" },
        durationMs: 123.45,
        raw: { originalVitestData: true },
      };
      expect(AXTestFailureSchema.parse(fullFailure)).toEqual(fullFailure);
    });

    it("accepts mixed string and structured nextActions", () => {
      const failure: AXTestFailure = {
        ...validFailure,
        nextActions: [
          "Simple string action",
          { kind: "fix", note: "Structured action" },
          { kind: "rerun", cmd: "npm test", note: "With command" },
        ],
      };
      expect(AXTestFailureSchema.parse(failure)).toEqual(failure);
    });

    it("rejects missing failureId", () => {
      const { failureId, ...noId } = validFailure;
      expect(() => AXTestFailureSchema.parse(noId)).toThrow();
    });

    it("rejects negative line number", () => {
      expect(() => AXTestFailureSchema.parse({ ...validFailure, line: -1 })).toThrow();
    });

    it("rejects non-integer line number", () => {
      expect(() => AXTestFailureSchema.parse({ ...validFailure, line: 42.5 })).toThrow();
    });
  });

  describe("AXTestResultSchema", () => {
    const validResult: AXTestResult = {
      schemaVersion: "1.0.0",
      timestamp: "2026-01-04T12:00:00.000Z",
      summary: {
        total: 100,
        passed: 95,
        failed: 3,
        skipped: 2,
        durationMs: 4500,
      },
      failures: [
        {
          failureId: "abc123",
          file: "tests/unit/handler.spec.ts",
          line: 42,
          name: "handleActivate throws",
          error: { message: "Test failed" },
          nextActions: [],
        },
      ],
      adapter: {
        name: "vitest-json",
        version: "1.0.0",
        source: "test-results.json",
      },
    };

    it("accepts valid result with minimal fields", () => {
      expect(AXTestResultSchema.parse(validResult)).toEqual(validResult);
    });

    it("accepts result with all optional fields", () => {
      const fullResult: AXTestResult = {
        ...validResult,
        coverage: {
          linesPct: 87.3,
          branchesPct: 72.1,
          functionsPct: 91.2,
          statementsPct: 85.0,
        },
        run: {
          cwd: "/srv/project",
          command: "vitest run --reporter=json",
          ci: true,
          os: "linux",
          nodeVersion: "20.10.0",
        },
        raw: '{"original": "json"}',
      };
      expect(AXTestResultSchema.parse(fullResult)).toEqual(fullResult);
    });

    it("rejects wrong schemaVersion", () => {
      expect(() => AXTestResultSchema.parse({ ...validResult, schemaVersion: "2.0.0" })).toThrow();
    });

    it("rejects invalid timestamp", () => {
      expect(() => AXTestResultSchema.parse({ ...validResult, timestamp: "not-a-date" })).toThrow();
    });

    it("rejects coverage outside 0-100 range", () => {
      expect(() =>
        AXTestResultSchema.parse({
          ...validResult,
          coverage: { linesPct: 150, branchesPct: 50, functionsPct: 50 },
        })
      ).toThrow();
    });

    it("accepts empty failures array", () => {
      const allPassing = { ...validResult, failures: [] };
      expect(AXTestResultSchema.parse(allPassing).failures).toEqual([]);
    });
  });

  describe("parseAXTestResult", () => {
    it("returns validated result for valid input", () => {
      const input = {
        schemaVersion: "1.0.0",
        timestamp: "2026-01-04T12:00:00.000Z",
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, durationMs: 100 },
        failures: [],
        adapter: { name: "test", version: "1.0.0", source: "test.json" },
      };
      const result = parseAXTestResult(input);
      expect(result.schemaVersion).toBe("1.0.0");
    });

    it("throws for invalid input", () => {
      expect(() => parseAXTestResult({ invalid: true })).toThrow();
    });
  });

  describe("safeParseAXTestResult", () => {
    it("returns success for valid input", () => {
      const input = {
        schemaVersion: "1.0.0",
        timestamp: "2026-01-04T12:00:00.000Z",
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, durationMs: 100 },
        failures: [],
        adapter: { name: "test", version: "1.0.0", source: "test.json" },
      };
      const result = safeParseAXTestResult(input);
      expect(result.success).toBe(true);
    });

    it("returns error for invalid input", () => {
      const result = safeParseAXTestResult({ invalid: true });
      expect(result.success).toBe(false);
    });
  });

  describe("isValidAXTestResult", () => {
    it("returns true for valid input", () => {
      const input = {
        schemaVersion: "1.0.0",
        timestamp: "2026-01-04T12:00:00.000Z",
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, durationMs: 100 },
        failures: [],
        adapter: { name: "test", version: "1.0.0", source: "test.json" },
      };
      expect(isValidAXTestResult(input)).toBe(true);
    });

    it("returns false for invalid input", () => {
      expect(isValidAXTestResult({ invalid: true })).toBe(false);
    });

    it("narrows type correctly", () => {
      const input: unknown = {
        schemaVersion: "1.0.0",
        timestamp: "2026-01-04T12:00:00.000Z",
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, durationMs: 100 },
        failures: [],
        adapter: { name: "test", version: "1.0.0", source: "test.json" },
      };
      if (isValidAXTestResult(input)) {
        // TypeScript should allow this without error
        expect(input.schemaVersion).toBe("1.0.0");
      }
    });
  });

  describe("parseAXTestFailure", () => {
    it("returns validated failure", () => {
      const input = {
        failureId: "test123",
        file: "test.ts",
        line: 1,
        name: "test",
        error: { message: "failed" },
        nextActions: [],
      };
      const result = parseAXTestFailure(input);
      expect(result.failureId).toBe("test123");
    });
  });

  describe("isValidAXTestFailure", () => {
    it("returns true for valid failure", () => {
      const input = {
        failureId: "test123",
        file: "test.ts",
        line: 1,
        name: "test",
        error: { message: "failed" },
        nextActions: [],
      };
      expect(isValidAXTestFailure(input)).toBe(true);
    });

    it("returns false for invalid failure", () => {
      expect(isValidAXTestFailure({ invalid: true })).toBe(false);
    });
  });

  describe("createAXTestResult", () => {
    it("creates result with schemaVersion and timestamp", () => {
      const result = createAXTestResult({
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, durationMs: 100 },
        failures: [],
        adapter: { name: "test", version: "1.0.0", source: "test.json" },
      });
      expect(result.schemaVersion).toBe("1.0.0");
      expect(result.timestamp).toBeDefined();
    });

    it("allows overriding timestamp", () => {
      const timestamp = "2026-01-01T00:00:00.000Z";
      const result = createAXTestResult({
        timestamp,
        summary: { total: 10, passed: 10, failed: 0, skipped: 0, durationMs: 100 },
        failures: [],
        adapter: { name: "test", version: "1.0.0", source: "test.json" },
      });
      expect(result.timestamp).toBe(timestamp);
    });
  });

  describe("createAXTestFailure", () => {
    it("creates failure with default empty nextActions", () => {
      const failure = createAXTestFailure({
        failureId: "test123",
        file: "test.ts",
        line: 1,
        name: "test",
        error: { message: "failed" },
      });
      expect(failure.nextActions).toEqual([]);
    });

    it("allows providing nextActions", () => {
      const failure = createAXTestFailure({
        failureId: "test123",
        file: "test.ts",
        line: 1,
        name: "test",
        error: { message: "failed" },
        nextActions: ["do something"],
      });
      expect(failure.nextActions).toEqual(["do something"]);
    });
  });
});
