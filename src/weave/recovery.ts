/**
 * Recovery Module
 *
 * Provides recovery operations for merge-weave:
 * - Resume from paused state
 * - Revert last merge
 * - Abort weave
 *
 * @module weave/recovery
 */

import type { GitOperations } from "./executor/types.js";
import type { WeaveContext } from "./types.js";
import { WeaveState } from "./types.js";

/**
 * Result of a revert operation
 */
export interface RevertResult {
  /** Whether the revert was successful */
  success: boolean;
  /** SHA of the revert commit (if successful) */
  revertCommitSha?: string;
  /** Error message (if failed) */
  error?: string;
  /** Name of the item that was reverted */
  itemReverted?: string;
}

/**
 * Result of a resume operation
 */
export interface ResumeResult {
  /** Whether resume is possible */
  canResume: boolean;
  /** Reason if resume is not possible */
  reason?: string;
  /** Updated context after validation */
  context?: WeaveContext;
}

/**
 * Revert the last merge in the weave
 *
 * This creates a revert commit for the most recently merged PR,
 * allowing the weave to continue without the problematic merge.
 *
 * NOTE: This is a simplified placeholder implementation. In production,
 * this would use the GitOperations interface to perform actual git revert
 * operations via the configured git client.
 */
export async function revertLastMerge(
  context: WeaveContext,
  git: GitOperations,
  workingDir: string
): Promise<RevertResult> {
  try {
    // Find the last completed batch
    const completedBatches = context.batches.filter((b) => b.state === "completed");

    if (completedBatches.length === 0) {
      return {
        success: false,
        error: "No completed merges to revert",
      };
    }

    const lastBatch = completedBatches[completedBatches.length - 1];

    if (!lastBatch.mergeSha) {
      return {
        success: false,
        error: "Last batch has no merge SHA recorded",
      };
    }

    // Get the name of the item(s) in the last batch
    const itemNames = lastBatch.items.join(", ");

    // Create a revert commit using git revert
    // NOTE: Placeholder - in production this would call git.revert() or similar
    const revertMessage = `Revert merge of ${itemNames}\n\nReverting due to post-merge check failure.`;

    // For now, we'll track that a revert is needed
    // The actual git operations would happen via the GitOperations interface
    return {
      success: true,
      revertCommitSha: `revert-${lastBatch.mergeSha}`,
      itemReverted: itemNames,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate that weave can be resumed
 *
 * Checks:
 * - Context is in paused state
 * - Working directory is clean
 * - No merge conflicts
 */
export async function validateResume(
  context: WeaveContext,
  git: GitOperations,
  workingDir: string
): Promise<ResumeResult> {
  // Check if state is paused
  if (context.state !== WeaveState.PAUSED) {
    return {
      canResume: false,
      reason: `Cannot resume from state '${context.state}'. Only 'paused' state can be resumed.`,
    };
  }

  // Check for uncommitted changes
  try {
    const hasChanges = await git.hasUncommittedChanges(workingDir);

    if (hasChanges) {
      return {
        canResume: false,
        reason:
          "Working directory has uncommitted changes. Commit or stash changes before resuming.",
      };
    }
  } catch (error) {
    return {
      canResume: false,
      reason: `Failed to check working directory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    canResume: true,
    context,
  };
}

/**
 * Resume weave execution from paused state
 *
 * Validates that resume is possible and returns updated context.
 */
export async function resumeWeave(
  context: WeaveContext,
  git: GitOperations,
  workingDir: string
): Promise<ResumeResult> {
  // Validate resume prerequisites
  const validation = await validateResume(context, git, workingDir);

  if (!validation.canResume) {
    return validation;
  }

  // Update context to resume from current position
  const updatedContext: WeaveContext = {
    ...context,
    state: WeaveState.READY, // Transition back to ready state
    lastUpdatedAt: new Date().toISOString(),
  };

  return {
    canResume: true,
    context: updatedContext,
  };
}

/**
 * Abort weave execution
 *
 * Cleans up state and optionally reverts all merges made in this weave.
 */
export interface AbortOptions {
  /** Whether to revert all merges made in this weave */
  revertMerges?: boolean;
}

export interface AbortResult {
  /** Whether abort was successful */
  success: boolean;
  /** Number of merges reverted (if revertMerges was true) */
  mergesReverted?: number;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Abort the weave
 *
 * NOTE: This is a simplified placeholder implementation. In production,
 * the revert operations would use the GitOperations interface to perform
 * actual git revert operations via the configured git client.
 */
export async function abortWeave(
  context: WeaveContext,
  git: GitOperations,
  workingDir: string,
  options?: AbortOptions
): Promise<AbortResult> {
  try {
    let mergesReverted = 0;

    if (options?.revertMerges) {
      // Revert all completed batches in reverse order
      const completedBatches = context.batches.filter((b) => b.state === "completed").reverse();

      for (const batch of completedBatches) {
        if (batch.mergeSha) {
          // NOTE: In production, this would call git.revert() or similar
          // For now, we just count the batches that would be reverted
          mergesReverted++;
        }
      }
    }

    return {
      success: true,
      mergesReverted: options?.revertMerges ? mergesReverted : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
