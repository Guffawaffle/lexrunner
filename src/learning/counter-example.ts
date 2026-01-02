/**
 * Counter-Example Capture - LR-TSF-003
 *
 * Captures execution failures as counter-examples for learning loop closure.
 * When a gate fails, this module provides structured data capture and
 * classification to feed back into constraint refinement.
 */

import { ulid } from "ulid";
import type { GateResult } from "../schema.js";

/**
 * Classification types for counter-examples
 */
export type CounterExampleClassificationType = "transient" | "gap" | "false-positive" | "unknown";

/**
 * Failure types that can be recorded
 */
export type FailureType = "gate" | "merge" | "validation";

/**
 * Counter-example classification from user
 */
export interface CounterExampleClassification {
  type: CounterExampleClassificationType;
  description: string;
  suggestedAction?: string;
}

/**
 * Failure information
 */
export interface FailureInfo {
  type: FailureType;
  target: string; // PR number, gate name, etc.
  error: string;
  exitCode?: number;
}

/**
 * Execution context for counter-example
 */
export interface ExecutionContext {
  planPath: string;
  runId: string;
  activeConstraints: string[];
  scope: string[];
}

/**
 * Counter-example record
 */
export interface CounterExample {
  id: string;
  timestamp: string;

  // What failed
  failure: {
    type: FailureType;
    target: string;
    error: string;
    exitCode?: number;
  };

  // Context
  context: {
    plan: string;
    runId: string;
    activeConstraints: string[];
    scope: string[];
  };

  // User classification
  classification: {
    type: CounterExampleClassificationType;
    description: string;
    suggestedAction?: string;
  };

  // For learning
  relatedConstraints: string[];
  shouldLearn: boolean;
}

/**
 * Build a counter-example from failure info and user classification
 */
export function buildCounterExample(
  failure: FailureInfo,
  context: ExecutionContext,
  classification: CounterExampleClassification
): CounterExample {
  const counterExample: CounterExample = {
    id: ulid(),
    timestamp: new Date().toISOString(),
    failure: {
      type: failure.type,
      target: failure.target,
      error: failure.error,
      exitCode: failure.exitCode,
    },
    context: {
      plan: context.planPath,
      runId: context.runId,
      activeConstraints: context.activeConstraints,
      scope: context.scope,
    },
    classification: {
      type: classification.type,
      description: classification.description,
      suggestedAction: classification.suggestedAction,
    },
    relatedConstraints: inferRelatedConstraints(failure, context),
    shouldLearn: classification.type !== "transient",
  };

  return counterExample;
}

/**
 * Infer which constraints might be affected by this failure
 */
function inferRelatedConstraints(failure: FailureInfo, context: ExecutionContext): string[] {
  const related: string[] = [];

  // For gate failures, the constraint is likely related to the gate name
  if (failure.type === "gate") {
    // Add constraints that match the gate name pattern
    for (const constraint of context.activeConstraints) {
      if (
        constraint.toLowerCase().includes(failure.target.toLowerCase()) ||
        failure.target.toLowerCase().includes(constraint.toLowerCase())
      ) {
        related.push(constraint);
      }
    }
  }

  // If no specific constraints found, return all active constraints
  if (related.length === 0) {
    return context.activeConstraints;
  }

  return related;
}

/**
 * Create a counter-example from a gate failure result
 */
export function createCounterExampleFromGate(
  gateResult: GateResult,
  planPath: string,
  runId: string,
  classification: CounterExampleClassification,
  activeConstraints: string[] = [],
  scope: string[] = []
): CounterExample {
  const failure: FailureInfo = {
    type: "gate",
    target: gateResult.gate,
    error: gateResult.stderr || "Gate execution failed",
    exitCode: gateResult.exitCode,
  };

  const context: ExecutionContext = {
    planPath,
    runId,
    activeConstraints,
    scope,
  };

  return buildCounterExample(failure, context, classification);
}
