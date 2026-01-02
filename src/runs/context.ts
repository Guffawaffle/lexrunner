/**
 * Execution Context with Attribution
 *
 * Extends execution context to support constraint attribution tracking.
 * Implements LR-TSF-001: Execution Trace → Constraint Attribution
 */

import type { AttributionTracker, ConstraintSource } from "./attribution.js";
import { createAttributionTracker } from "./attribution.js";

/**
 * Execution context with attribution tracking
 */
export interface ExecutionContext {
  /** Unique run identifier */
  runId: string;
  /** Attribution tracker for the run */
  attributionTracker: AttributionTracker;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Create a new execution context
 */
export function createExecutionContext(
  runId: string,
  metadata?: Record<string, unknown>
): ExecutionContext {
  return {
    runId,
    attributionTracker: createAttributionTracker(),
    metadata,
  };
}

/**
 * Log a constraint attribution in the execution context
 *
 * @example
 * ```typescript
 * logAttribution(context, "merge-gates-required", "All PRs must pass lint gate", "baseline", "ran lint gate on PR-123", "PR-123");
 * ```
 */
export function logAttribution(
  context: ExecutionContext,
  constraintId: string,
  statement: string,
  source: ConstraintSource,
  action: string,
  target?: string
): void {
  context.attributionTracker.logAttribution(constraintId, statement, source, action, target);
}
