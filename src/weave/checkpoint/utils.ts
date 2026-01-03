/**
 * Checkpoint utility functions
 */

import { WeaveContext, WeaveState } from "../types.js";
import { sha256 } from "../../util/hash.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import type { WeaveCheckpoint, CheckpointPhase } from "./types.js";

/**
 * Map WeaveState to CheckpointPhase for categorization
 */
export function stateToPhase(state: WeaveState): CheckpointPhase {
  switch (state) {
    case WeaveState.IDLE:
    case WeaveState.PLANNING:
    case WeaveState.COMPUTING_ORDER:
      return "discovery";

    case WeaveState.READY:
    case WeaveState.VALIDATING:
    case WeaveState.AWAITING_FIX:
    case WeaveState.FIX_SUBMITTED:
    case WeaveState.VERIFYING:
    case WeaveState.VERIFIED:
    case WeaveState.TRUST_GAP:
      return "gates";

    case WeaveState.MERGING:
      return "merge";

    case WeaveState.COMPLETED:
      return "complete";

    case WeaveState.FAILED:
    case WeaveState.PAUSED:
      // Use gates as default for terminal/paused states
      return "gates";

    default:
      return "discovery";
  }
}

/**
 * Create a checkpoint from weave execution context
 */
export function createCheckpointFromContext(
  context: WeaveContext,
  completedItems: string[],
  pendingItems: string[],
  failedItems: string[]
): WeaveCheckpoint {
  const planJson = canonicalJSONStringify(context.plan);
  const planHash = sha256(Buffer.from(planJson));
  const phase = stateToPhase(context.state);

  return {
    runId: context.runId,
    timestamp: new Date().toISOString(),
    phase,
    state: context.state,
    planHash,
    plan: context.plan,
    completedItems,
    pendingItems,
    failedItems,
    lastSuccessfulSha: context.batches[context.currentBatchIndex]?.mergeSha,
    currentBatchIndex: context.currentBatchIndex,
    totalBatches: context.batches.length,
    successfulMerges: context.successfulMerges,
    failedMerges: context.failedMerges,
    startedAt: context.startedAt,
    lastUpdatedAt: context.lastUpdatedAt,
    metadata: {
      target: context.plan.target,
      warnings: [],
    },
  };
}

/**
 * Validate that a checkpoint is resumable
 */
export function validateCheckpointForResume(checkpoint: WeaveCheckpoint): {
  valid: boolean;
  reason?: string;
} {
  // Can't resume from completed or failed states
  if (checkpoint.state === WeaveState.COMPLETED) {
    return {
      valid: false,
      reason: "Cannot resume from completed state",
    };
  }

  if (checkpoint.state === WeaveState.FAILED) {
    return {
      valid: false,
      reason: "Cannot resume from failed state - please retry from start",
    };
  }

  // Must have a valid plan
  if (!checkpoint.plan || !checkpoint.plan.items || checkpoint.plan.items.length === 0) {
    return {
      valid: false,
      reason: "Checkpoint has invalid or empty plan",
    };
  }

  // Batch index must be within bounds
  if (checkpoint.currentBatchIndex < 0 || checkpoint.currentBatchIndex >= checkpoint.totalBatches) {
    return {
      valid: false,
      reason: "Invalid batch index in checkpoint",
    };
  }

  return { valid: true };
}

/**
 * Format a checkpoint for human-readable display
 */
export function formatCheckpoint(checkpoint: WeaveCheckpoint): string {
  const lines: string[] = [];

  lines.push(`Run ID: ${checkpoint.runId}`);
  lines.push(`Phase: ${checkpoint.phase}`);
  lines.push(`State: ${checkpoint.state}`);
  lines.push(`Started: ${checkpoint.startedAt}`);
  lines.push(`Last Updated: ${checkpoint.lastUpdatedAt}`);
  lines.push(`Progress: ${checkpoint.currentBatchIndex + 1}/${checkpoint.totalBatches} batches`);
  lines.push(`Completed: ${checkpoint.completedItems.length} items`);
  lines.push(`Pending: ${checkpoint.pendingItems.length} items`);
  lines.push(`Failed: ${checkpoint.failedItems.length} items`);
  lines.push(`Successful Merges: ${checkpoint.successfulMerges}`);
  lines.push(`Failed Merges: ${checkpoint.failedMerges}`);

  if (checkpoint.lastSuccessfulSha) {
    lines.push(`Last Successful SHA: ${checkpoint.lastSuccessfulSha.slice(0, 8)}`);
  }

  if (checkpoint.metadata?.target) {
    lines.push(`Target Branch: ${checkpoint.metadata.target}`);
  }

  return lines.join("\n");
}

/**
 * Format a list of checkpoint entries for display
 */
export function formatCheckpointList(
  entries: Array<{
    runId: string;
    timestamp: string;
    phase: CheckpointPhase;
    state: WeaveState;
    completedItems: number;
    pendingItems: number;
    failedItems: number;
    startedAt: string;
  }>
): string {
  if (entries.length === 0) {
    return "No checkpoints found";
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("Available Checkpoints:");
  lines.push("");

  for (const entry of entries) {
    const age = getCheckpointAge(entry.timestamp);
    lines.push(`• ${entry.runId}`);
    lines.push(`  Phase: ${entry.phase} | State: ${entry.state} | Age: ${age}`);
    lines.push(
      `  Progress: ${entry.completedItems} completed, ${entry.pendingItems} pending, ${entry.failedItems} failed`
    );
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get human-readable age of a checkpoint
 */
function getCheckpointAge(timestamp: string): string {
  const now = new Date();
  const checkpointDate = new Date(timestamp);
  const diffMs = now.getTime() - checkpointDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  }
}
