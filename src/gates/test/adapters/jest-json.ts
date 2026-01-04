/**
 * Jest JSON Adapter (ADR-009)
 *
 * Parses Jest JSON reporter output (`--json`) into AXTestResult format.
 * Jest has a huge footprint and its format is similar to Vitest but with
 * some key differences like `wasInterrupted`, `snapshot`, and richer error info.
 *
 * @see https://jestjs.io/docs/cli#--json
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import type { TestAdapter } from "./interface.js";
import type { AXTestResult, AXTestFailure } from "../schema.js";
import { createAXTestResult, createAXTestFailure } from "../schema.js";
import { AdapterParseError } from "./errors.js";
import {
  generateFailureId,
  parseStackFrames,
  generateNextActions,
  getRerunCommand,
} from "../enrichment/index.js";

/**
 * Jest JSON output structure
 */
interface JestJsonOutput {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests?: number;
  startTime: number;
  success: boolean;
  testResults: JestTestResult[];
  wasInterrupted?: boolean;
  snapshot?: JestSnapshotResult;
}

interface JestTestResult {
  name: string; // file path
  status: string;
  startTime?: number;
  endTime?: number;
  assertionResults: JestAssertionResult[];
  message?: string;
}

interface JestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  title: string;
  status: string;
  duration?: number;
  failureMessages: string[];
  failureDetails?: JestFailureDetail[];
  location?: {
    line: number;
    column: number;
  } | null;
}

interface JestFailureDetail {
  matcherResult?: {
    actual?: any;
    expected?: any;
    message?: string;
    name?: string;
    pass: boolean;
  };
  message?: string;
}

interface JestSnapshotResult {
  added: number;
  didUpdate: boolean;
  failure: boolean;
  filesAdded: number;
  filesRemoved: number;
  filesUnmatched: number;
  filesUpdated: number;
  matched: number;
  total: number;
  unchecked: number;
  unmatched: number;
  updated: number;
}

/**
 * Jest JSON adapter
 */
export const jestJsonAdapter: TestAdapter = {
  name: "jest-json",
  version: "1.0.0",
  extensions: [".json"],

  /**
   * Detect if content is Jest JSON output
   *
   * Jest has specific markers that differentiate it from Vitest:
   * - wasInterrupted field
   * - snapshot object with detailed snapshot info
   * - Different structure than Vitest
   */
  detect(content: string): boolean {
    try {
      const data = JSON.parse(content);

      // Must have Jest-specific structure
      if (!data || typeof data !== "object") {
        return false;
      }

      // Look for Jest-specific markers
      const hasWasInterrupted = "wasInterrupted" in data;
      const hasSnapshot = "snapshot" in data && typeof data.snapshot === "object";
      const hasTestResults = Array.isArray(data.testResults);
      const hasNumTotalTests = typeof data.numTotalTests === "number";

      // Jest has both wasInterrupted and snapshot fields
      // This differentiates it from Vitest which doesn't have these
      return hasWasInterrupted && hasSnapshot && hasTestResults && hasNumTotalTests;
    } catch {
      return false;
    }
  },

  /**
   * Parse Jest JSON output into AXTestResult
   */
  parse(input: string | Buffer): AXTestResult {
    const raw = typeof input === "string" ? input : input.toString("utf-8");

    let data: JestJsonOutput;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new AdapterParseError(
        `Failed to parse Jest JSON: ${err instanceof Error ? err.message : String(err)}`,
        "jest-json",
        raw
      );
    }

    // Validate basic structure
    if (!data.testResults || !Array.isArray(data.testResults)) {
      throw new AdapterParseError(
        "Invalid Jest JSON: missing or invalid testResults array",
        "jest-json",
        raw
      );
    }

    // Extract failures
    const failures: AXTestFailure[] = [];

    for (const testResult of data.testResults) {
      const file = testResult.name;

      for (const assertion of testResult.assertionResults) {
        if (assertion.status === "failed") {
          failures.push(parseFailure(assertion, file, raw));
        }
      }
    }

    // Calculate duration from start/end times
    let durationMs = 0;
    if (data.testResults.length > 0) {
      const allTimes = data.testResults
        .filter((r) => r.startTime && r.endTime)
        .map((r) => ({
          start: r.startTime!,
          end: r.endTime!,
        }));

      if (allTimes.length > 0) {
        const minStart = Math.min(...allTimes.map((t) => t.start));
        const maxEnd = Math.max(...allTimes.map((t) => t.end));
        durationMs = maxEnd - minStart;
      }
    }

    return createAXTestResult({
      summary: {
        total: data.numTotalTests,
        passed: data.numPassedTests,
        failed: data.numFailedTests,
        skipped: data.numPendingTests ?? 0,
        durationMs,
      },
      failures,
      adapter: {
        name: "jest-json",
        version: "1.0.0",
        source: "jest-json-output",
      },
      timestamp: new Date(data.startTime).toISOString(),
      raw,
    });
  },
};

/**
 * Parse a single Jest test failure into AXTestFailure
 */
function parseFailure(
  assertion: JestAssertionResult,
  file: string,
  rawOutput: string
): AXTestFailure {
  // Extract error message from failureMessages
  const errorMessage =
    assertion.failureMessages && assertion.failureMessages.length > 0
      ? assertion.failureMessages[0]
      : "Test failed";

  // Determine error type from the message
  let errorType = "AssertionError";
  const typeMatch = errorMessage.match(/^(\w+Error):/);
  if (typeMatch) {
    errorType = typeMatch[1];
  }

  // Parse stack frames from error message and filter to only include frames with line numbers
  const allStackFrames = parseStackFrames(errorMessage, {
    maxFrames: 5,
    filterNodeModules: true,
  });
  // Filter to only include frames that have a line number (required by schema)
  const stackFrames = allStackFrames.filter(
    (frame): frame is typeof frame & { line: number } => frame.line !== undefined
  );

  // Get location from assertion or stack frames
  let line = 1;
  let column: number | undefined;

  if (assertion.location) {
    line = assertion.location.line;
    column = assertion.location.column;
  } else if (stackFrames.length > 0 && stackFrames[0].line) {
    line = stackFrames[0].line;
    column = stackFrames[0].column;
  }

  // Generate failure ID
  const failureId = generateFailureId(file, assertion.fullName, errorType, errorMessage);

  // Build suite name from ancestor titles
  const suite =
    assertion.ancestorTitles.length > 0 ? assertion.ancestorTitles.join(" > ") : undefined;

  // Generate next actions using the enrichment utility
  const nextActions = generateNextActionsForJest(assertion, errorMessage);

  // Extract diff information if available from failureDetails
  let diff;
  if (assertion.failureDetails && assertion.failureDetails.length > 0) {
    const detail = assertion.failureDetails[0];
    if (detail.matcherResult) {
      const { actual, expected } = detail.matcherResult;
      if (actual !== undefined && expected !== undefined) {
        diff = {
          expected: String(expected),
          actual: String(actual),
        };
      }
    }
  }

  // Extract assertion details from failureDetails
  let assertionInfo;
  if (assertion.failureDetails && assertion.failureDetails.length > 0) {
    const detail = assertion.failureDetails[0];
    if (detail.matcherResult) {
      assertionInfo = {
        operator: detail.matcherResult.name,
        expectedType: detail.matcherResult.expected
          ? typeof detail.matcherResult.expected
          : undefined,
        actualType: detail.matcherResult.actual ? typeof detail.matcherResult.actual : undefined,
      };
    }
  }

  return createAXTestFailure({
    failureId,
    file,
    line,
    column,
    name: assertion.fullName,
    suite,
    error: {
      message: errorMessage,
      type: errorType,
      stack: errorMessage, // Stack is included in message for Jest
    },
    stackFrames,
    assertion: assertionInfo,
    diff,
    nextActions,
    durationMs: assertion.duration,
    raw: assertion,
  });
}

/**
 * Generate next actions specifically for Jest failures
 */
function generateNextActionsForJest(
  assertion: JestAssertionResult,
  errorMessage: string
): Array<string | { kind: "rerun" | "inspect" | "fix" | "doc"; cmd?: string; note: string }> {
  const actions: Array<
    string | { kind: "rerun" | "inspect" | "fix" | "doc"; cmd?: string; note: string }
  > = [];

  // Add rerun command for Jest
  const rerunCmd = getRerunCommand(assertion.fullName, "jest");
  actions.push({
    kind: "rerun",
    cmd: rerunCmd,
    note: "Rerun this specific test in isolation",
  });

  // Check for snapshot failures
  if (
    errorMessage.toLowerCase().includes("snapshot") ||
    errorMessage.toLowerCase().includes("tomatchsnapshot")
  ) {
    actions.push({
      kind: "fix",
      cmd: "jest -u",
      note: "Update snapshots if changes are intentional",
    });
    actions.push({
      kind: "inspect",
      note: "Review snapshot diff to verify changes are expected",
    });
  }

  // Check for timeout
  if (errorMessage.toLowerCase().includes("timeout")) {
    actions.push({
      kind: "fix",
      note: "Increase test timeout with jest.setTimeout() or optimize async operations",
    });
  }

  // Check for null/undefined errors
  if (
    errorMessage.toLowerCase().includes("cannot read property") ||
    errorMessage.toLowerCase().includes("null")
  ) {
    actions.push({
      kind: "fix",
      note: "Add null/undefined checks or use optional chaining (?.)",
    });
  }

  // If no specific actions, add generic ones
  if (actions.length === 1) {
    // Only rerun command
    actions.push({
      kind: "inspect",
      note: "Review error message and stack trace for root cause",
    });
  }

  return actions;
}
