/**
 * Weave Receipt Helper
 *
 * Utility for emitting ActionReceipts from weave execution.
 * Implements the Disciplined Failure pattern for merge-weave workflows.
 *
 * @module weave/receiptHelper
 * @see docs/DISCIPLINED_FAILURE.md
 */

import {
  emitActionReceipt,
  emitFailureReceipt,
  emitUncertaintyMarker,
  type ActionReceipt,
  type UncertaintyMarker,
  type EmitOptions,
} from "../receipts/index.js";
import type { WeaveContext, BatchState } from "./types.js";
import { WeaveState } from "./types.js";

// =============================================================================
// Weave-Specific Receipt Emission
// =============================================================================

/**
 * Emit a receipt for a merge operation
 *
 * @param context - Weave execution context
 * @param batch - The batch being merged
 * @param previousHead - Git SHA before merge (for rollback)
 * @param options - Emission options
 * @returns The emitted ActionReceipt
 *
 * @example
 * ```typescript
 * const previousHead = await git.revparse(['HEAD']);
 * const receipt = emitMergeReceipt(context, batch, previousHead);
 * // ... perform merge
 * ```
 */
export function emitMergeReceipt(
  context: WeaveContext,
  batch: BatchState,
  previousHead: string,
  options: EmitOptions = {}
): ActionReceipt {
  return emitActionReceipt(
    {
      action: `merge batch ${batch.batchNumber + 1}: ${batch.items.join(", ")}`,
      rationale: "Batch dependencies satisfied, ready for merge",
      confidence: "high",
      reversibility: "reversible",
      rollbackPath: `git reset --hard ${previousHead}`,
      rollbackCommand: `git reset --hard ${previousHead}`,
      phase: "apply",
      runId: context.runId,
      planHash: context.metadata.planHash,
    },
    options
  );
}

/**
 * Emit a receipt for a failed merge operation
 *
 * @param context - Weave execution context
 * @param batch - The batch that failed
 * @param error - Error message
 * @param previousHead - Git SHA for rollback
 * @param options - Emission options
 * @returns The emitted ActionReceipt
 */
export function emitMergeFailureReceipt(
  context: WeaveContext,
  batch: BatchState,
  error: string,
  previousHead: string,
  options: EmitOptions = {}
): ActionReceipt {
  return emitFailureReceipt(
    {
      action: `merge batch ${batch.batchNumber + 1}: ${batch.items.join(", ")}`,
      rationale: `Merge failed: ${error}`,
      confidence: "high",
      reversibility: "reversible",
      rollbackPath: `git reset --hard ${previousHead}`,
      rollbackCommand: `git reset --hard ${previousHead}`,
      nextActions: [
        "Review merge conflict details",
        "Resolve conflicts and retry",
        `Rollback: git reset --hard ${previousHead}`,
      ],
      escalationRequired: true,
      escalationReason: "Merge conflict requires manual resolution",
      phase: "apply",
      runId: context.runId,
      planHash: context.metadata.planHash,
    },
    options
  );
}

/**
 * Emit a receipt for weave completion
 *
 * @param context - Weave execution context
 * @param options - Emission options
 * @returns The emitted ActionReceipt
 */
export function emitWeaveCompletionReceipt(
  context: WeaveContext,
  options: EmitOptions = {}
): ActionReceipt {
  const outcome =
    context.state === WeaveState.COMPLETED
      ? "success"
      : context.failedMerges > 0 && context.successfulMerges > 0
        ? "partial"
        : "failure";

  const receipt = emitActionReceipt(
    {
      action: `complete weave execution: ${context.successfulMerges} merged, ${context.failedMerges} failed`,
      rationale:
        outcome === "success"
          ? "All batches completed successfully"
          : outcome === "partial"
            ? "Some batches completed, some failed"
            : "Weave execution failed",
      confidence: "high",
      reversibility: context.successfulMerges > 0 ? "partially-reversible" : "reversible",
      rollbackPath:
        context.successfulMerges > 0
          ? "Manual review required to revert merged changes"
          : "No changes made, no rollback needed",
      outcome,
      phase: "complete",
      runId: context.runId,
      planHash: context.metadata.planHash,
      nextActions:
        outcome === "failure"
          ? ["Review failure details", "Resolve issues and retry"]
          : outcome === "partial"
            ? ["Review partial results", "Retry failed batches"]
            : ["Weave complete - ready for verification"],
      escalationRequired: outcome !== "success",
      escalationReason: outcome !== "success" ? "Weave execution did not fully succeed" : undefined,
    },
    options
  );

  return receipt;
}

/**
 * Emit uncertainty marker before weave execution
 *
 * @param context - Weave execution context
 * @param predictedConflicts - Number of predicted conflicts from preflight
 * @param options - Emission options
 * @returns The emitted UncertaintyMarker
 */
export function emitWeaveUncertaintyMarker(
  context: WeaveContext,
  predictedConflicts: number,
  options: EmitOptions = {}
): UncertaintyMarker {
  const uncertainties: string[] = [];

  if (predictedConflicts > 0) {
    uncertainties.push(`${predictedConflicts} potential conflict(s) detected in preflight`);
  }

  if (context.batches.length > 1) {
    uncertainties.push(`Multi-batch execution with ${context.batches.length} batches`);
  }

  // Even if no specific uncertainties, acknowledge the operation risk
  if (uncertainties.length === 0) {
    uncertainties.push("Standard merge operation risk");
  }

  return emitUncertaintyMarker(
    {
      operation: `weave execution for ${context.plan.items.length} items`,
      uncertainties,
      mitigations: [
        "Preflight conflict detection performed",
        "Lock file created for resume capability",
        "Rollback available via git reset",
      ],
      proceedingAnyway: true,
      reason: "All pre-flight checks passed",
    },
    options
  );
}

// =============================================================================
// Gate-Specific Receipt Emission
// =============================================================================

/**
 * Additional context for gate receipts
 */
export interface GateReceiptContext {
  /** Error message if gate failed */
  error?: string;
  /** Exit code of the gate command */
  exitCode?: number;
  /** Artifacts collected from gate execution */
  artifacts?: string[];
}

/**
 * Emit a receipt for gate execution
 *
 * Implements Wave 3 acceptance criteria: "Receipt Emission from Gates"
 * - Every gate should emit a receipt on completion
 * - Receipts should include: gate name, duration, outcome, context
 * - Failed gates should emit detailed failure receipts
 *
 * @param gateName - Name of the gate
 * @param itemName - Name of the item being gated
 * @param passed - Whether the gate passed
 * @param duration - Gate execution duration in ms
 * @param runId - Optional run ID for correlation
 * @param options - Emission options
 * @param context - Optional additional context for the receipt
 * @returns The emitted ActionReceipt
 */
export function emitGateReceipt(
  gateName: string,
  itemName: string,
  passed: boolean,
  duration: number,
  runId?: string,
  options: EmitOptions = {},
  context?: GateReceiptContext
): ActionReceipt {
  if (passed) {
    return emitActionReceipt(
      {
        action: `execute gate: ${gateName} for ${itemName}`,
        rationale: `Gate execution completed successfully in ${duration}ms`,
        confidence: "high",
        reversibility: "reversible", // Gates don't mutate state
        outcome: "success",
        phase: "verify",
        runId,
        nextActions: ["Continue to next gate or phase"],
      },
      options
    );
  } else {
    // Build detailed failure receipt with context
    const uncertaintyNotes: string[] = [];
    if (context?.error) {
      uncertaintyNotes.push(
        `Error: ${context.error.slice(0, 200)}${context.error.length > 200 ? "..." : ""}`
      );
    }
    if (context?.exitCode !== undefined && context.exitCode !== 0) {
      uncertaintyNotes.push(`Exit code: ${context.exitCode}`);
    }

    return emitFailureReceipt(
      {
        action: `execute gate: ${gateName} for ${itemName}`,
        rationale: `Gate ${gateName} failed after ${duration}ms`,
        confidence: "high",
        reversibility: "reversible", // Gates don't mutate state
        phase: "verify",
        runId,
        uncertaintyNotes: uncertaintyNotes.length > 0 ? uncertaintyNotes : undefined,
        nextActions: [
          `Fix ${gateName} failures`,
          `Re-run gate: lex-pr gates run --gate ${gateName}`,
        ],
        escalationRequired: true,
        escalationReason: `Gate ${gateName} failed, blocking merge`,
      },
      options
    );
  }
}
