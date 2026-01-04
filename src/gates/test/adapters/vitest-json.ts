/**
 * Vitest JSON Adapter (ADR-009)
 *
 * Parses Vitest JSON reporter output into AXTestResult format.
 * Vitest JSON format: https://vitest.dev/guide/reporters.html#json-reporter
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import type { TestAdapter } from "./interface.js";
import type { AXTestResult, AXTestFailure } from "../schema.js";
import { createAXTestResult, createAXTestFailure } from "../schema.js";
import { generateFailureId } from "../enrichment/failureId.js";
import { parseStackFrames } from "../enrichment/stackParser.js";
import { getRerunCommand } from "../enrichment/rerunTemplates.js";

/**
 * Vitest JSON output structure
 */
interface VitestJsonOutput {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numPendingTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  startTime: number;
  success: boolean;
  testResults: VitestTestResult[];
  coverage?: VitestCoverage;
}

interface VitestTestResult {
  assertionResults: VitestAssertionResult[];
  startTime: number;
  endTime: number;
  status: string;
  message: string;
  name: string;
}

interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  title: string;
  duration: number;
  failureMessages: string[];
  meta?: Record<string, unknown>;
}

interface VitestCoverage {
  total?: {
    lines?: { pct: number };
    statements?: { pct: number };
    functions?: { pct: number };
    branches?: { pct: number };
  };
}

/**
 * Vitest JSON adapter
 */
export const vitestJsonAdapter: TestAdapter = {
  name: "vitest-json",
  version: "1.0.0",
  extensions: [".json"],

  detect(content: string): boolean {
    try {
      const parsed = JSON.parse(content);

      // Check for Vitest-specific structure markers
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        "numTotalTestSuites" in parsed &&
        "numPassedTestSuites" in parsed &&
        "numFailedTestSuites" in parsed &&
        "testResults" in parsed &&
        Array.isArray(parsed.testResults)
      );
    } catch {
      return false;
    }
  },

  parse(input: string | Buffer): AXTestResult {
    const content = typeof input === "string" ? input : input.toString("utf-8");

    let vitestOutput: VitestJsonOutput;
    try {
      vitestOutput = JSON.parse(content);
    } catch (err) {
      throw new Error(
        `Failed to parse Vitest JSON output: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Calculate duration
    const durationMs = vitestOutput.testResults.reduce((total, result) => {
      return total + (result.endTime - result.startTime);
    }, 0);

    // Extract failures from all test results
    const failures: AXTestFailure[] = [];

    for (const testResult of vitestOutput.testResults) {
      for (const assertion of testResult.assertionResults) {
        if (assertion.status === "failed" && assertion.failureMessages.length > 0) {
          const failure = parseVitestFailure(testResult.name, assertion);
          failures.push(failure);
        }
      }
    }

    // Extract coverage if present
    const coverage = vitestOutput.coverage?.total
      ? {
          linesPct: vitestOutput.coverage.total.lines?.pct ?? 0,
          branchesPct: vitestOutput.coverage.total.branches?.pct ?? 0,
          functionsPct: vitestOutput.coverage.total.functions?.pct ?? 0,
          // statementsPct is optional in schema - undefined is valid when not present
          statementsPct: vitestOutput.coverage.total.statements?.pct,
        }
      : undefined;

    return createAXTestResult({
      summary: {
        total: vitestOutput.numTotalTests,
        passed: vitestOutput.numPassedTests,
        failed: vitestOutput.numFailedTests,
        skipped: vitestOutput.numPendingTests + vitestOutput.numTodoTests,
        durationMs,
      },
      failures,
      coverage,
      adapter: {
        name: "vitest-json",
        version: "1.0.0",
        source: "vitest-json-output",
      },
      raw: content,
    });
  },
};

/**
 * Parse a single Vitest failure into AXTestFailure
 */
function parseVitestFailure(filePath: string, assertion: VitestAssertionResult): AXTestFailure {
  // Get the first failure message (Vitest can have multiple)
  const failureMessage = assertion.failureMessages[0] || "Unknown error";

  // Extract error type from message (e.g., "AssertionError:", "TypeError:")
  const errorTypeMatch = failureMessage.match(/^(\w+Error):/);
  const errorType = errorTypeMatch ? errorTypeMatch[1] : "Error";

  // Extract just the error message without the stack trace
  const messageParts = failureMessage.split("\n");
  const errorMessage = messageParts[0] || failureMessage;

  // Parse stack frames from the failure message
  const stackFrames = parseStackFrames(failureMessage, {
    maxFrames: 5,
    filterNodeModules: true,
  });

  // Extract file location from first stack frame or use file path
  let line = 1;
  let column: number | undefined;

  if (stackFrames.length > 0 && stackFrames[0].line) {
    line = stackFrames[0].line;
    column = stackFrames[0].column;
  } else {
    // Try to extract from stack trace directly
    const lineMatch = failureMessage.match(/at\s+.*?:(\d+):(\d+)/);
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
      column = parseInt(lineMatch[2], 10);
    }
  }

  // Generate failure ID
  const failureId = generateFailureId(filePath, assertion.fullName, errorType, errorMessage);

  // Build suite path from ancestor titles
  const suite =
    assertion.ancestorTitles.length > 0 ? assertion.ancestorTitles.join(" > ") : undefined;

  // Generate next actions based on error type and message
  const nextActions = generateNextActionsForVitest(errorType, errorMessage, assertion.fullName);

  return createAXTestFailure({
    failureId,
    file: filePath,
    line,
    column,
    name: assertion.fullName,
    suite,
    error: {
      message: errorMessage,
      type: errorType,
      stack: failureMessage,
    },
    stackFrames,
    nextActions,
    nextActionsMeta: {
      confidence: determineConfidence(errorType, errorMessage),
    },
    durationMs: assertion.duration,
    raw: assertion,
  });
}

/**
 * Generate context-aware next actions for Vitest failures
 */
function generateNextActionsForVitest(
  errorType: string,
  errorMessage: string,
  testName: string
): Array<string | { kind: "rerun" | "inspect" | "fix" | "doc"; cmd?: string; note: string }> {
  const actions: Array<
    string | { kind: "rerun" | "inspect" | "fix" | "doc"; cmd?: string; note: string }
  > = [];

  // Always include rerun command first
  const rerunCmd = getRerunCommand(testName, "vitest");
  actions.push({
    kind: "rerun",
    cmd: rerunCmd,
    note: "Rerun this specific test",
  });

  const lowerMsg = errorMessage.toLowerCase();

  // Timeout errors
  if (
    errorType.includes("Timeout") ||
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("timed out")
  ) {
    actions.push({
      kind: "inspect",
      note: "Check for slow async operations or infinite loops",
    });
    actions.push({
      kind: "fix",
      note: "Increase test timeout or optimize the test",
    });
  }
  // Assertion errors
  else if (errorType === "AssertionError") {
    if (lowerMsg.includes("snapshot")) {
      actions.push({
        kind: "inspect",
        note: "Review snapshot diff",
      });
      actions.push({
        kind: "fix",
        cmd: "npx vitest run -u",
        note: "Update snapshots if changes are intentional",
      });
    } else {
      actions.push({
        kind: "inspect",
        note: "Review assertion logic and expected values",
      });
    }
  }
  // Type errors (null/undefined)
  else if (errorType === "TypeError") {
    if (
      lowerMsg.includes("undefined") ||
      lowerMsg.includes("null") ||
      lowerMsg.includes("cannot read")
    ) {
      actions.push({
        kind: "fix",
        note: "Add null/undefined checks or use optional chaining (?.)",
      });
      actions.push({
        kind: "inspect",
        note: "Verify async operations complete before assertions",
      });
    }
  }
  // Connection errors
  else if (lowerMsg.includes("econnrefused") || lowerMsg.includes("connection refused")) {
    actions.push({
      kind: "inspect",
      note: "Verify test server is running or mock the connection",
    });
    actions.push({
      kind: "fix",
      note: "Add proper setup/teardown for test server",
    });
  }

  // Generic fallback
  if (actions.length === 1) {
    actions.push({
      kind: "inspect",
      note: "Review error message and stack trace",
    });
  }

  return actions;
}

/**
 * Determine confidence level for next actions based on error pattern
 */
function determineConfidence(errorType: string, errorMessage: string): "high" | "medium" | "low" {
  const lowerMsg = errorMessage.toLowerCase();

  // High confidence patterns
  if (
    errorType.includes("Timeout") ||
    lowerMsg.includes("snapshot") ||
    lowerMsg.includes("econnrefused") ||
    (errorType === "TypeError" && (lowerMsg.includes("undefined") || lowerMsg.includes("null")))
  ) {
    return "high";
  }

  // Medium confidence patterns
  if (errorType === "AssertionError" || errorType === "TypeError") {
    return "medium";
  }

  // Low confidence for unknown patterns
  return "low";
}
