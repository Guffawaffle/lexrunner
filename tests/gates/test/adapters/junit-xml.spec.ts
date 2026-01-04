/**
 * Tests for JUnit XML Adapter
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { junitXmlAdapter } from "../../../../src/gates/test/adapters/junit-xml.js";
import { registerAdapter, clearAdapters } from "../../../../src/gates/test/adapters/registry.js";

describe("JUnit XML Adapter", () => {
  const fixturesDir = join(process.cwd(), "tests/fixtures/junit");

  beforeEach(() => {
    clearAdapters();
  });

  describe("Adapter metadata", () => {
    it("should have correct name and version", () => {
      expect(junitXmlAdapter.name).toBe("junit-xml");
      expect(junitXmlAdapter.version).toBe("1.0.0");
    });

    it("should handle .xml extensions", () => {
      expect(junitXmlAdapter.extensions).toEqual([".xml"]);
    });
  });

  describe("detect()", () => {
    it("should detect JUnit XML with testsuite root", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      expect(junitXmlAdapter.detect(content)).toBe(true);
    });

    it("should detect JUnit XML with testsuites root", () => {
      const content = readFileSync(join(fixturesDir, "multiple-suites.xml"), "utf-8");
      expect(junitXmlAdapter.detect(content)).toBe(true);
    });

    it("should reject non-XML content", () => {
      expect(junitXmlAdapter.detect("not xml content")).toBe(false);
      expect(junitXmlAdapter.detect('{"json": true}')).toBe(false);
    });

    it("should reject XML without testsuite elements", () => {
      const content = '<?xml version="1.0"?><root><item>test</item></root>';
      expect(junitXmlAdapter.detect(content)).toBe(false);
    });

    it("should handle empty or invalid input", () => {
      expect(junitXmlAdapter.detect("")).toBe(false);
      expect(junitXmlAdapter.detect(null as any)).toBe(false);
      expect(junitXmlAdapter.detect(undefined as any)).toBe(false);
    });

    it("should detect XML without declaration", () => {
      const content = '<testsuite name="Test" tests="1" failures="0"></testsuite>';
      expect(junitXmlAdapter.detect(content)).toBe(true);
    });
  });

  describe("parse() - single suite", () => {
    it("should parse single testsuite with summary", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.schemaVersion).toBe("1.0.0");
      expect(result.summary.total).toBe(5);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.durationMs).toBe(523); // 0.523s * 1000
    });

    it("should extract failures with correct fields", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(1);

      const failure = result.failures[0];
      expect(failure.name).toBe("should delete user");
      expect(failure.suite).toBe("UserService");
      expect(failure.file).toBe("tests/user-service.spec.ts");
      expect(failure.line).toBe(30);
      expect(failure.error.message).toBe("Expected user to be deleted");
      expect(failure.error.type).toBe("AssertionError");
      expect(failure.error.stack).toContain("at Context.<anonymous>");
      expect(failure.durationMs).toBe(56); // 0.056s * 1000
    });

    it("should generate failure ID for each failure", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.failures[0].failureId).toBeTruthy();
      expect(result.failures[0].failureId).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should parse stack frames from failure", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const failure = result.failures[0];
      expect(failure.stackFrames).toBeDefined();
      expect(failure.stackFrames!.length).toBeGreaterThan(0);

      const firstFrame = failure.stackFrames![0];
      expect(firstFrame.file).toBeTruthy();
      expect(firstFrame.line).toBeGreaterThan(0);
    });

    it("should generate next actions for failure", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.failures[0].nextActions).toBeDefined();
      expect(result.failures[0].nextActions.length).toBeGreaterThan(0);

      const action = result.failures[0].nextActions[0];
      expect(action).toHaveProperty("kind");
      expect(action).toHaveProperty("note");
      expect(["rerun", "inspect", "fix", "doc"]).toContain(action.kind);
    });

    it("should preserve raw data", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.raw).toBe(content);
      expect(result.failures[0].raw).toBeDefined();
      expect(result.failures[0].raw).toHaveProperty("testcase");
      expect(result.failures[0].raw).toHaveProperty("failure");
    });

    it("should include adapter metadata", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.adapter.name).toBe("junit-xml");
      expect(result.adapter.version).toBe("1.0.0");
      expect(result.adapter.source).toBe("junit-xml");
    });
  });

  describe("parse() - multiple suites", () => {
    it("should aggregate summary across multiple suites", () => {
      const content = readFileSync(join(fixturesDir, "multiple-suites.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.summary.total).toBe(8);
      expect(result.summary.passed).toBe(5);
      expect(result.summary.failed).toBe(2);
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.durationMs).toBe(1234); // 1.234s * 1000
    });

    it("should extract failures from all suites", () => {
      const content = readFileSync(join(fixturesDir, "multiple-suites.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(2);

      // Check failures are from different suites
      const suites = result.failures.map((f) => f.suite);
      expect(suites).toContain("AuthService");
      expect(suites).toContain("PaymentService");
    });

    it("should handle different failure types across suites", () => {
      const content = readFileSync(join(fixturesDir, "multiple-suites.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const authFailure = result.failures.find((f) => f.suite === "AuthService");
      const paymentFailure = result.failures.find((f) => f.suite === "PaymentService");

      expect(authFailure?.error.type).toBe("AssertionError");
      expect(paymentFailure?.error.type).toBe("TypeError");
    });
  });

  describe("parse() - with errors", () => {
    it("should treat errors as failures", () => {
      const content = readFileSync(join(fixturesDir, "with-errors.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.summary.total).toBe(4);
      expect(result.summary.failed).toBe(3); // 1 failure + 2 errors
      expect(result.failures).toHaveLength(3);
    });

    it("should distinguish error type from failure type", () => {
      const content = readFileSync(join(fixturesDir, "with-errors.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const errorTypes = result.failures.map((f) => f.error.type);
      expect(errorTypes).toContain("TimeoutError");
      expect(errorTypes).toContain("Error");
      expect(errorTypes).toContain("AssertionError");
    });

    it("should handle both <error> and <failure> in same suite", () => {
      const content = readFileSync(join(fixturesDir, "with-errors.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const timeoutError = result.failures.find((f) => f.error.type === "TimeoutError");
      const assertionFailure = result.failures.find((f) => f.error.type === "AssertionError");
      const connectionError = result.failures.find((f) => f.error.message.includes("ECONNRESET"));

      expect(timeoutError).toBeDefined();
      expect(assertionFailure).toBeDefined();
      expect(connectionError).toBeDefined();
    });
  });

  describe("parse() - with skipped tests", () => {
    it("should count skipped tests correctly", () => {
      const content = readFileSync(join(fixturesDir, "with-skipped.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.summary.total).toBe(6);
      expect(result.summary.skipped).toBe(3);
      expect(result.summary.passed).toBe(3);
    });

    it("should not include skipped tests in failures", () => {
      const content = readFileSync(join(fixturesDir, "with-skipped.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(0);
    });
  });

  describe("parse() - CDATA handling", () => {
    it("should extract text from CDATA sections", () => {
      const content = readFileSync(join(fixturesDir, "cdata-messages.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(2);

      // Check that CDATA content is properly extracted
      const failure1 = result.failures[0];
      expect(failure1.error.stack).toContain("Expected: user@example.com");
      expect(failure1.error.stack).toContain("Received: user@invalid");

      const failure2 = result.failures[1];
      expect(failure2.error.stack).toContain("Schema validation failed");
      expect(failure2.error.stack).toContain("/name: must be string");
    });

    it("should preserve formatting in CDATA sections", () => {
      const content = readFileSync(join(fixturesDir, "cdata-messages.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const failure = result.failures[1];
      expect(failure.error.stack).toContain("Errors:");
      expect(failure.error.stack).toContain("Input:");
      // Check multi-line structure is preserved
      expect(failure.error.stack?.split("\n").length).toBeGreaterThan(5);
    });
  });

  describe("Edge cases", () => {
    it("should handle missing file attribute", () => {
      const content = `<?xml version="1.0"?>
<testsuite name="Test" tests="1" failures="1" errors="0" skipped="0" time="0.1">
  <testcase classname="TestClass" name="test case" time="0.1">
    <failure message="Test failed" type="Error">Stack trace here</failure>
  </testcase>
</testsuite>`;

      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].file).toBe("unknown");
      expect(result.failures[0].line).toBe(1);
    });

    it("should handle missing line attribute", () => {
      const content = `<?xml version="1.0"?>
<testsuite name="Test" tests="1" failures="1" errors="0" skipped="0" time="0.1">
  <testcase classname="TestClass" name="test case" file="test.spec.ts" time="0.1">
    <failure message="Test failed" type="Error">Stack trace here</failure>
  </testcase>
</testsuite>`;

      const result = junitXmlAdapter.parse(content);

      expect(result.failures[0].line).toBe(1);
    });

    it("should handle multiple failures in same testcase", () => {
      const content = `<?xml version="1.0"?>
<testsuite name="Test" tests="1" failures="2" errors="0" skipped="0" time="0.1">
  <testcase classname="TestClass" name="test case" file="test.spec.ts" line="10" time="0.1">
    <failure message="First failure" type="Error">Stack 1</failure>
    <failure message="Second failure" type="Error">Stack 2</failure>
  </testcase>
</testsuite>`;

      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(2);
      expect(result.failures[0].error.message).toBe("First failure");
      expect(result.failures[1].error.message).toBe("Second failure");
    });

    it("should handle empty message attribute", () => {
      const content = `<?xml version="1.0"?>
<testsuite name="Test" tests="1" failures="1" errors="0" skipped="0" time="0.1">
  <testcase classname="TestClass" name="test case" file="test.spec.ts" line="10" time="0.1">
    <failure message="" type="Error">Stack trace only</failure>
  </testcase>
</testsuite>`;

      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].error.message).toBe("");
      expect(result.failures[0].error.stack).toBe("Stack trace only");
    });

    it("should handle missing classname attribute", () => {
      const content = `<?xml version="1.0"?>
<testsuite name="Test" tests="1" failures="1" errors="0" skipped="0" time="0.1">
  <testcase name="test case" file="test.spec.ts" line="10" time="0.1">
    <failure message="Test failed" type="Error">Stack trace</failure>
  </testcase>
</testsuite>`;

      const result = junitXmlAdapter.parse(content);

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].suite).toBeUndefined();
    });

    it("should throw AdapterParseError on invalid XML", () => {
      const invalidXml = "not valid xml at all";

      expect(() => junitXmlAdapter.parse(invalidXml)).toThrow();
    });

    it("should handle Buffer input", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"));
      const result = junitXmlAdapter.parse(content);

      expect(result.summary.total).toBe(5);
    });
  });

  describe("Next actions generation", () => {
    it("should generate assertion-specific actions for AssertionError", () => {
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const assertionFailure = result.failures.find((f) => f.error.type === "AssertionError");
      expect(assertionFailure).toBeDefined();

      const actionNotes = assertionFailure!.nextActions.map((a) => a.note);
      expect(actionNotes.some((note) => note.toLowerCase().includes("assertion"))).toBe(true);
    });

    it("should generate type-error-specific actions for TypeError", () => {
      const content = readFileSync(join(fixturesDir, "multiple-suites.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const typeError = result.failures.find((f) => f.error.type === "TypeError");
      expect(typeError).toBeDefined();

      const actionNotes = typeError!.nextActions.map((a) => a.note);
      expect(
        actionNotes.some(
          (note) => note.toLowerCase().includes("null") || note.toLowerCase().includes("undefined")
        )
      ).toBe(true);
    });

    it("should generate timeout-specific actions for TimeoutError", () => {
      const content = readFileSync(join(fixturesDir, "with-errors.xml"), "utf-8");
      const result = junitXmlAdapter.parse(content);

      const timeoutError = result.failures.find((f) => f.error.type === "TimeoutError");
      expect(timeoutError).toBeDefined();

      const actionNotes = timeoutError!.nextActions.map((a) => a.note);
      expect(actionNotes.some((note) => note.toLowerCase().includes("timeout"))).toBe(true);
    });

    it("should generate generic actions when no pattern matches", () => {
      const content = `<?xml version="1.0"?>
<testsuite name="Test" tests="1" failures="1" errors="0" skipped="0" time="0.1">
  <testcase classname="TestClass" name="test case" file="test.spec.ts" line="10" time="0.1">
    <failure message="Some unusual error" type="CustomError">Custom stack trace</failure>
  </testcase>
</testsuite>`;

      const result = junitXmlAdapter.parse(content);

      expect(result.failures[0].nextActions.length).toBeGreaterThan(0);
      const actionNotes = result.failures[0].nextActions.map((a) => a.note);
      expect(
        actionNotes.some(
          (note) => note.toLowerCase().includes("review") || note.toLowerCase().includes("inspect")
        )
      ).toBe(true);
    });
  });

  describe("Registry integration", () => {
    it("should be registerable in the adapter registry", () => {
      expect(() => registerAdapter(junitXmlAdapter)).not.toThrow();
    });

    it("should be detectable via registry", () => {
      registerAdapter(junitXmlAdapter);
      const content = readFileSync(join(fixturesDir, "single-suite.xml"), "utf-8");

      expect(junitXmlAdapter.detect(content)).toBe(true);
    });
  });
});
