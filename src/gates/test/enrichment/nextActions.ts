/**
 * Generate next action suggestions based on failure patterns
 */

import type { AXTestResult, AXNextAction, AdapterContext } from "./types.js";

/**
 * Failure pattern detector and action generator
 */
export interface FailurePattern {
  /** Pattern name/ID */
  name: string;
  /** Detect if this pattern matches the failure */
  detect: (failure: AXTestResult, context?: AdapterContext) => boolean;
  /** Generate actions for this pattern */
  actions: (failure: AXTestResult, context?: AdapterContext) => AXNextAction[];
}

/**
 * Pattern library with common failure patterns from ADR-009
 */
export const FAILURE_PATTERNS: FailurePattern[] = [
  // Pattern 1: Snapshot mismatch
  {
    name: "snapshot-mismatch",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      return (
        msg.includes("snapshot") &&
        (msg.includes("mismatch") ||
          msg.includes("does not match") ||
          msg.includes("differ") ||
          msg.includes("tomatchsnapshot"))
      );
    },
    actions: () => [
      {
        action: "Review snapshot diff and updateSnapshot if intentional",
        confidence: 0.9,
        reason: "Snapshot tests fail when output changes",
      },
      {
        action: "Run with updateSnapshot flag to accept changes",
        confidence: 0.85,
        reason: "Common fix for intentional snapshot changes",
      },
    ],
  },

  // Pattern 2: Module not found
  {
    name: "module-not-found",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      return (
        msg.includes("cannot find module") ||
        msg.includes("module not found") ||
        msg.includes("enoent") ||
        (failure.errorType || "").includes("MODULE_NOT_FOUND")
      );
    },
    actions: (failure) => {
      const actions: AXNextAction[] = [
        {
          action: "Install missing dependencies with npm/yarn install",
          confidence: 0.85,
          reason: "Module may not be installed",
        },
        {
          action: "Check import path for typos",
          confidence: 0.8,
          reason: "Import path may be incorrect",
        },
      ];

      // Check for specific file reference
      if (failure.error?.match(/['"]([^'"]+)['"]/)) {
        actions.push({
          action: "Verify file exists at the specified path",
          confidence: 0.75,
          reason: "Referenced file may be missing",
        });
      }

      return actions;
    },
  },

  // Pattern 3: Timeout
  {
    name: "timeout",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      return (
        msg.includes("timeout") ||
        msg.includes("exceeded") ||
        msg.includes("timed out") ||
        (failure.errorType || "").toLowerCase().includes("timeout")
      );
    },
    actions: (failure) => {
      const actions: AXNextAction[] = [
        {
          action: "Increase test timeout threshold",
          confidence: 0.7,
          reason: "Test may need more time to complete",
        },
        {
          action: "Optimize slow operations or mock external dependencies",
          confidence: 0.75,
          reason: "Test execution may be genuinely too slow",
        },
      ];

      // Check for specific timeout value
      const timeoutMatch = failure.error?.match(/(\d+)\s*ms/);
      if (timeoutMatch) {
        actions.push({
          action: `Consider timeout value (currently ${timeoutMatch[1]}ms)`,
          confidence: 0.65,
          reason: "Specific timeout threshold detected",
        });
      }

      return actions;
    },
  },

  // Pattern 4: Unhandled promise rejection
  {
    name: "unhandled-promise",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      return (
        msg.includes("unhandled") ||
        msg.includes("unhandledpromiserejection") ||
        (msg.includes("promise") && msg.includes("reject"))
      );
    },
    actions: () => [
      {
        action: "Add await or .catch() to handle promise rejection",
        confidence: 0.9,
        reason: "Promise rejection is not being caught",
      },
      {
        action: "Use try-catch block around async operations",
        confidence: 0.85,
        reason: "Async function needs error handling",
      },
    ],
  },

  // Pattern 5: Port already in use
  {
    name: "port-in-use",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      return (
        (msg.includes("port") && msg.includes("in use")) ||
        msg.includes("eaddrinuse") ||
        msg.includes("address already in use")
      );
    },
    actions: (failure) => {
      const actions: AXNextAction[] = [
        {
          action: "Stop other processes using the port or use a different port",
          confidence: 0.85,
          reason: "Port conflict detected",
        },
        {
          action: "Use dynamic port allocation in tests",
          confidence: 0.8,
          reason: "Prevent port conflicts in parallel execution",
        },
      ];

      // Extract port number if present
      const portMatch = failure.error?.match(/(?::|\bport\s+)(\d{4,5})\b/i);
      if (portMatch) {
        actions.push({
          action: `Check processes using port ${portMatch[1]}`,
          confidence: 0.75,
          reason: `Port ${portMatch[1]} is already in use`,
        });
      }

      return actions;
    },
  },

  // Pattern 6: Date/time flakiness
  {
    name: "date-flake",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      return (
        (msg.includes("date") || msg.includes("time")) &&
        (msg.includes("expected") || msg.includes("received") || msg.includes("mismatch"))
      );
    },
    actions: () => [
      {
        action: "Mock Date.now() or use a fixed timestamp in tests",
        confidence: 0.85,
        reason: "Time-dependent test may have race conditions",
      },
      {
        action: "Use relative time comparisons instead of exact values",
        confidence: 0.8,
        reason: "Timing precision issues detected",
      },
    ],
  },

  // Pattern 7: Order-dependent test
  {
    name: "order-dependent",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      // This is harder to detect automatically, but we look for clues
      return (
        msg.includes("beforeeach") ||
        msg.includes("aftereach") ||
        msg.includes("setup") ||
        (msg.includes("state") && msg.includes("expect"))
      );
    },
    actions: () => [
      {
        action: "Check test isolation - ensure each test cleans up properly",
        confidence: 0.7,
        reason: "Test may depend on execution order or shared state",
      },
      {
        action: "Reset mocks and state in beforeEach/afterEach hooks",
        confidence: 0.75,
        reason: "Shared state between tests detected",
      },
    ],
  },

  // Pattern 8: Type error with null/undefined
  {
    name: "type-error-null",
    detect: (failure) => {
      const msg = (failure.error || "").toLowerCase();
      const errType = (failure.errorType || "").toLowerCase();
      return (
        errType.includes("typeerror") &&
        (msg.includes("null") ||
          msg.includes("undefined") ||
          msg.includes("cannot read prop") ||
          msg.includes("cannot access"))
      );
    },
    actions: () => [
      {
        action: "Add null/undefined checks before accessing properties",
        confidence: 0.9,
        reason: "Accessing property on null or undefined value",
      },
      {
        action: "Use optional chaining (?.) or nullish coalescing (??)",
        confidence: 0.85,
        reason: "Safe navigation operators can prevent this error",
      },
      {
        action: "Verify async operations complete before assertions",
        confidence: 0.7,
        reason: "Value may not be initialized yet",
      },
    ],
  },
];

/**
 * Generate next actions for a test failure
 *
 * @param failure - Test failure to analyze
 * @param context - Optional adapter context
 * @returns Array of suggested next actions
 */
export function generateNextActions(
  failure: AXTestResult,
  context?: AdapterContext
): AXNextAction[] {
  const actions: AXNextAction[] = [];

  // Try each pattern
  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.detect(failure, context)) {
      actions.push(...pattern.actions(failure, context));
    }
  }

  // If no patterns matched, provide generic actions
  if (actions.length === 0) {
    actions.push({
      action: "Review error message and stack trace",
      confidence: 0.5,
      reason: "No specific pattern detected",
    });
    actions.push({
      action: "Run test in isolation to reproduce",
      confidence: 0.6,
      reason: "Isolate the failure",
    });
  }

  return actions;
}

/**
 * Register a custom failure pattern
 *
 * @param pattern - Custom pattern to register
 */
export function registerFailurePattern(pattern: FailurePattern): void {
  FAILURE_PATTERNS.push(pattern);
}
