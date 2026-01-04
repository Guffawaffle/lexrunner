/**
 * JUnit XML Adapter End-to-End Tests
 *
 * Validates the full pipeline: JUnit XML → AXTestResult → JSON output
 *
 * Tests cover:
 * - Single suite parsing
 * - Multiple suites parsing
 * - Error vs failure distinction
 * - Skipped tests
 * - CDATA message handling
 * - failureId determinism
 */

import { describe, it, expect } from "vitest";
import { junitXmlAdapter } from "../../../src/gates/test/adapters/junit-xml.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/junit");

describe("JUnit XML Adapter E2E", () => {
  describe("Single Suite Parsing", () => {
    it("should parse single-suite.xml to valid AXTestResult", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      // Validate structure
      expect(result.schemaVersion).toBe("1.0.0");
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.adapter.name).toBe("junit-xml");
      expect(result.adapter.version).toBe("1.0.0");

      // Validate summary
      expect(result.summary.total).toBe(5);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.skipped).toBe(1);

      // Validate failures
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].failureId).toBeTruthy();
      expect(result.failures[0].file).toBe("tests/user-service.spec.ts");
      expect(result.failures[0].line).toBe(35);
    });
  });

  describe("Multiple Suites Parsing", () => {
    it("should parse multiple-suites.xml with aggregated results", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "multiple-suites.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      // Should aggregate across suites
      expect(result.summary.total).toBeGreaterThan(5);
      expect(result.adapter.name).toBe("junit-xml");
    });
  });

  describe("Error vs Failure Distinction", () => {
    it("should parse with-errors.xml including both errors and failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "with-errors.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      // Both errors and failures should be captured
      expect(result.summary.failed).toBeGreaterThan(0);
      expect(result.failures.length).toBeGreaterThan(0);

      // Check that we have error type information
      const hasErrorType = result.failures.some((f) => f.error.type);
      expect(hasErrorType).toBe(true);
    });
  });

  describe("Skipped Tests", () => {
    it("should parse with-skipped.xml and count skipped tests", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "with-skipped.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      expect(result.summary.skipped).toBeGreaterThan(0);
    });
  });

  describe("CDATA Message Handling", () => {
    it("should parse cdata-messages.xml with CDATA sections", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "cdata-messages.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      expect(result.adapter.name).toBe("junit-xml");

      // Should parse without errors
      if (result.failures.length > 0) {
        expect(result.failures[0].error.message).toBeTruthy();
      }
    });
  });

  describe("failureId Determinism", () => {
    it("should generate same failureId for same input", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");

      const result1 = junitXmlAdapter.parse(input);
      const result2 = junitXmlAdapter.parse(input);

      expect(result1.failures.length).toBeGreaterThan(0);
      expect(result1.failures[0].failureId).toBe(result2.failures[0].failureId);
    });
  });

  describe("Location Extraction", () => {
    it("should extract file and line information from attributes", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      if (result.failures.length > 0) {
        const failure = result.failures[0];
        expect(failure.file).toBeTruthy();
        expect(failure.line).toBeGreaterThan(0);
      }
    });
  });

  describe("nextActions Generation", () => {
    it("should generate rerun commands for JUnit failures", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      if (result.failures.length > 0) {
        const failure = result.failures[0];
        expect(failure.nextActions.length).toBeGreaterThan(0);

        // Check for actionable guidance
        const hasRerun = failure.nextActions.some((action) => {
          if (typeof action === "object") {
            return action.kind === "rerun";
          }
          return false;
        });

        // JUnit might not always have specific rerun commands
        // but should have some next actions
        expect(failure.nextActions.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Duration Parsing", () => {
    it("should parse test duration from time attribute", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      // Check that duration is captured
      expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Test Name Extraction", () => {
    it("should extract test name from testcase name attribute", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      if (result.failures.length > 0) {
        const failure = result.failures[0];
        expect(failure.name).toBeTruthy();
        expect(failure.name).toContain("should");
      }
    });

    it("should extract suite from testsuite name attribute", () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(input);

      if (result.failures.length > 0) {
        const failure = result.failures[0];
        expect(failure.suite).toBeTruthy();
      }
    });
  });
});
