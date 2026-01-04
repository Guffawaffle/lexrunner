/**
 * JUnit XML Test Adapter (ADR-009)
 *
 * Parses JUnit XML format (the CI lingua franca) into AXTestResult.
 * Supports single <testsuite> and multiple <testsuites> root elements.
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 * @see https://github.com/windyroad/JUnit-Schema
 */

import type { TestAdapter } from "./interface.js";
import type { AXTestResult, AXTestFailure } from "../schema.js";
import { createAXTestResult, createAXTestFailure } from "../schema.js";
import { generateFailureId, parseStackFrames } from "../enrichment/index.js";
import { AdapterParseError } from "./errors.js";

const ADAPTER_NAME = "junit-xml";
const ADAPTER_VERSION = "1.0.0";

/**
 * JUnit XML test adapter
 *
 * Parses JUnit XML format with support for:
 * - Single <testsuite> or multiple <testsuites>
 * - <testcase> with <failure>, <error>, <skipped>
 * - CDATA sections in failure messages
 * - Missing @file attribute (common in non-JS runners)
 * - Multiple <failure> elements per testcase
 */
export const junitXmlAdapter: TestAdapter = {
  name: ADAPTER_NAME,
  version: ADAPTER_VERSION,
  extensions: [".xml"],

  detect(content: string): boolean {
    if (!content || typeof content !== "string") {
      return false;
    }

    // Quick string check before parsing
    const trimmed = content.trim();
    if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<testsuite")) {
      return false;
    }

    // Check for testsuite or testsuites root element
    return /<testsuite[\s>]/.test(content) || /<testsuites[\s>]/.test(content);
  },

  parse(input: string | Buffer): AXTestResult {
    const content = typeof input === "string" ? input : input.toString("utf-8");

    try {
      // Extract all testsuite elements
      const testsuites = extractTestSuites(content);

      if (testsuites.length === 0) {
        throw new Error("No <testsuite> elements found in XML");
      }

      // Aggregate summary across all test suites
      let totalTests = 0;
      let totalFailures = 0;
      let totalErrors = 0;
      let totalSkipped = 0;
      let totalTime = 0;
      const failures: AXTestFailure[] = [];

      for (const testsuite of testsuites) {
        const suiteTests = parseInt(getAttribute(testsuite, "tests") || "0", 10);
        const suiteFailures = parseInt(getAttribute(testsuite, "failures") || "0", 10);
        const suiteErrors = parseInt(getAttribute(testsuite, "errors") || "0", 10);
        const suiteSkipped = parseInt(getAttribute(testsuite, "skipped") || "0", 10);
        const suiteTime = parseFloat(getAttribute(testsuite, "time") || "0");

        totalTests += suiteTests;
        totalFailures += suiteFailures;
        totalErrors += suiteErrors;
        totalSkipped += suiteSkipped;
        totalTime += suiteTime;

        // Process test cases
        const testcases = extractTestCases(testsuite);
        for (const testcase of testcases) {
          // Process failures
          const failureElements = extractElements(testcase, "failure");
          for (const failureElement of failureElements) {
            failures.push(parseTestFailure(testcase, failureElement, "failure"));
          }

          // Process errors (treat as failures)
          const errorElements = extractElements(testcase, "error");
          for (const errorElement of errorElements) {
            failures.push(parseTestFailure(testcase, errorElement, "error"));
          }
        }
      }

      // Calculate passed tests
      const totalPassed = totalTests - totalFailures - totalErrors - totalSkipped;

      return createAXTestResult({
        summary: {
          total: totalTests,
          passed: totalPassed,
          failed: totalFailures + totalErrors,
          skipped: totalSkipped,
          durationMs: totalTime * 1000, // Convert seconds to milliseconds
        },
        failures,
        adapter: {
          name: ADAPTER_NAME,
          version: ADAPTER_VERSION,
          source: "junit-xml",
        },
        raw: content,
      });
    } catch (error) {
      throw new AdapterParseError(
        `Failed to parse JUnit XML: ${error instanceof Error ? error.message : String(error)}`,
        content
      );
    }
  },
};

/**
 * Parse a test failure or error from a testcase element
 */
function parseTestFailure(
  testcase: string,
  failureElement: string,
  type: "failure" | "error"
): AXTestFailure {
  // Extract testcase attributes
  const className = getAttribute(testcase, "classname") || "";
  const name = getAttribute(testcase, "name") || "Unknown test";
  const file = getAttribute(testcase, "file") || "unknown";
  const lineStr = getAttribute(testcase, "line");
  const line = lineStr ? parseInt(lineStr, 10) : 1; // Default to line 1 if not specified
  const timeStr = getAttribute(testcase, "time");
  const durationMs = timeStr ? parseFloat(timeStr) * 1000 : undefined;

  // Extract failure/error attributes
  const message = getAttribute(failureElement, "message") || "";
  const errorType =
    getAttribute(failureElement, "type") || (type === "error" ? "Error" : "AssertionError");

  // Extract failure text (may contain CDATA)
  let stackTrace = getElementText(failureElement);
  stackTrace = stackTrace.trim();

  // Generate failure ID
  const failureId = generateFailureId(file, name, errorType, message);

  // Parse stack frames
  const stackFrames = parseStackFrames(stackTrace, {
    maxFrames: 5,
    filterNodeModules: true,
  });

  // Generate next actions using generic patterns
  const nextActions = generateNextActionsForFailure(message, errorType, stackTrace);

  // Prepare raw failure data
  const raw = {
    testcase: {
      classname: className,
      name,
      file,
      line,
      time: timeStr,
    },
    [type]: {
      message,
      type: errorType,
      text: stackTrace,
    },
  };

  return createAXTestFailure({
    failureId,
    file,
    line,
    name,
    suite: className || undefined,
    error: {
      message,
      type: errorType,
      stack: stackTrace || undefined,
    },
    stackFrames: stackFrames.length > 0 ? stackFrames : undefined,
    nextActions,
    durationMs,
    raw,
  });
}

/**
 * Extract testsuite elements from XML content
 */
function extractTestSuites(content: string): string[] {
  const suites: string[] = [];

  // Match <testsuite>...</testsuite> elements
  const suiteRegex = /<testsuite\s+[^>]*>[\s\S]*?<\/testsuite>/g;
  let match;

  while ((match = suiteRegex.exec(content)) !== null) {
    suites.push(match[0]);
  }

  return suites;
}

/**
 * Extract testcase elements from a testsuite element
 */
function extractTestCases(testsuite: string): string[] {
  const testcases: string[] = [];

  // Match <testcase>...</testcase> elements (including self-closing)
  const testcaseRegex = /<testcase\s+[^>]*>[\s\S]*?<\/testcase>|<testcase\s+[^>]*\/>/g;
  let match;

  while ((match = testcaseRegex.exec(testsuite)) !== null) {
    testcases.push(match[0]);
  }

  return testcases;
}

/**
 * Extract child elements with a specific tag name
 */
function extractElements(parent: string, tagName: string): string[] {
  const elements: string[] = [];

  // Match <tagName>...</tagName> elements
  const regex = new RegExp(
    `<${tagName}\\s+[^>]*>[\\s\\S]*?<\\/${tagName}>|<${tagName}\\s+[^>]*\\/>`,
    "g"
  );
  let match;

  while ((match = regex.exec(parent)) !== null) {
    elements.push(match[0]);
  }

  return elements;
}

/**
 * Get attribute value from an XML element string
 */
function getAttribute(element: string, attrName: string): string | null {
  // Use word boundary to avoid matching partial attribute names
  // e.g., prevent "name" from matching in "classname"
  const regex = new RegExp(`\\b${attrName}="([^"]*)"`, "i");
  const match = element.match(regex);
  return match ? match[1] : null;
}

/**
 * Get text content from an XML element (handles CDATA)
 */
function getElementText(element: string): string {
  // First, extract CDATA content if present
  const cdataRegex = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let text = "";
  let match;

  // Collect all CDATA sections
  while ((match = cdataRegex.exec(element)) !== null) {
    text += match[1];
  }

  // If no CDATA found, extract text between opening and closing tags
  if (!text) {
    const textRegex = /^<[^>]+>([\s\S]*)<\/[^>]+>$/;
    const textMatch = element.match(textRegex);
    if (textMatch) {
      text = textMatch[1];
      // Decode HTML entities
      text = decodeHtmlEntities(text);
    }
  }

  return text;
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Generate next actions for a failure
 * Uses generic patterns since this is a universal format
 */
function generateNextActionsForFailure(
  message: string,
  errorType: string,
  stack: string
): Array<{ kind: "rerun" | "inspect" | "fix" | "doc"; note: string; cmd?: string }> {
  const actions: Array<{ kind: "rerun" | "inspect" | "fix" | "doc"; note: string; cmd?: string }> =
    [];

  const msg = message.toLowerCase();
  const type = errorType.toLowerCase();

  // Assertion failures
  if (type.includes("assertion") || msg.includes("expected") || msg.includes("assert")) {
    actions.push({
      kind: "inspect",
      note: "Review assertion - expected vs actual values may have changed",
    });
    actions.push({
      kind: "fix",
      note: "Update test expectations if behavior change is intentional",
    });
  }

  // Type errors with null/undefined
  if (
    type.includes("typeerror") &&
    (msg.includes("null") || msg.includes("undefined") || msg.includes("cannot read"))
  ) {
    actions.push({
      kind: "fix",
      note: "Add null/undefined checks before accessing properties",
    });
    actions.push({
      kind: "fix",
      note: "Verify async operations complete before assertions",
    });
  }

  // Timeout errors
  if (type.includes("timeout") || msg.includes("timeout") || msg.includes("timed out")) {
    actions.push({
      kind: "fix",
      note: "Increase test timeout threshold or optimize slow operations",
    });
    actions.push({
      kind: "inspect",
      note: "Check for hanging promises or infinite loops",
    });
  }

  // Connection/network errors
  if (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("connection") ||
    msg.includes("network")
  ) {
    actions.push({
      kind: "fix",
      note: "Mock external dependencies or ensure test services are running",
    });
    actions.push({
      kind: "inspect",
      note: "Verify network configuration and service availability",
    });
  }

  // Module/import errors
  if (msg.includes("cannot find module") || msg.includes("module not found")) {
    actions.push({
      kind: "fix",
      note: "Install missing dependencies or check import paths",
    });
  }

  // Generic actions if no specific pattern matched
  if (actions.length === 0) {
    actions.push({
      kind: "inspect",
      note: "Review error message and stack trace for root cause",
    });
    actions.push({
      kind: "rerun",
      note: "Run test in isolation to reproduce the failure",
    });
  }

  return actions;
}
