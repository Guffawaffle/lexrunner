/**
 * Checkpoint types for merge-weave resume support
 */

import { WeaveState } from "../types.js";
import type { Plan } from "../../schema.js";

/**
 * Execution phase for checkpoint categorization
 */
export type CheckpointPhase = "discovery" | "gates" | "merge" | "post_checks" | "complete";

export type ResumeOperationStatus = "pending" | "in_progress" | "completed" | "failed";

/** One durable, independently reconcilable operation in a resumable weave. */
export interface ResumeOperation {
  id: string;
  phase: "gate" | "merge" | "post_check";
  item: string;
  status: ResumeOperationStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  result?: {
    outcome: "executed" | "observed";
    externalId?: string;
  };
  error?: string;
}

/** Versioned execution journal shared by every resume entry point. */
export interface WeaveResumeJournal_v1 {
  schemaVersion: "1.0.0";
  revision: number;
  operations: ResumeOperation[];
  repository: {
    target: string;
    targetHeadSha: string;
    integrationBranch: string;
    sourceHeads: Record<string, string>;
  };
}

/**
 * Checkpoint for merge-weave execution state
 * Enables resume after interruption (network issues, rate limits, crashes)
 */
export interface WeaveCheckpoint {
  /** Unique run identifier */
  runId: string;
  /** Checkpoint creation timestamp (ISO 8601) */
  timestamp: string;
  /** Current execution phase */
  phase: CheckpointPhase;
  /** Current state machine state */
  state: WeaveState;
  /** Plan hash for validation on resume */
  planHash: string;
  /** Original plan being executed */
  plan: Plan;
  /** Items that have been successfully completed */
  completedItems: string[];
  /** Items currently pending */
  pendingItems: string[];
  /** Items that have failed */
  failedItems: string[];
  /** Last successful merge commit SHA */
  lastSuccessfulSha?: string;
  /** Current batch index being processed */
  currentBatchIndex: number;
  /** Total number of batches */
  totalBatches: number;
  /** Number of successful merges so far */
  successfulMerges: number;
  /** Number of failed merges so far */
  failedMerges: number;
  /** Execution start timestamp */
  startedAt: string;
  /** Last update timestamp */
  lastUpdatedAt: string;
  /** Additional metadata for debugging/auditing */
  metadata?: {
    /** Version of lexrunner that created this checkpoint */
    version?: string;
    /** Target branch */
    target?: string;
    /** Any warnings or notices */
    warnings?: string[];
    /** Canonical operation journal used by both resume CLI entry points. */
    resume?: WeaveResumeJournal_v1;
  };
}

/**
 * Checkpoint listing entry (lightweight version for list operations)
 */
export interface CheckpointListEntry {
  runId: string;
  timestamp: string;
  phase: CheckpointPhase;
  state: WeaveState;
  completedItems: number;
  pendingItems: number;
  failedItems: number;
  startedAt: string;
}

/**
 * Options for saving a checkpoint
 */
export interface SaveCheckpointOptions {
  /** Optional custom checkpoint directory */
  checkpointDir?: string;
  /** Skip cleanup operation (for performance) */
  skipCleanup?: boolean;
}

/**
 * Options for loading a checkpoint
 */
export interface LoadCheckpointOptions {
  /** Optional custom checkpoint directory */
  checkpointDir?: string;
  /** Validate plan hash matches (default: true) */
  validatePlanHash?: boolean;
  /** Expected plan hash for validation */
  expectedPlanHash?: string;
}

/**
 * Options for listing checkpoints
 */
export interface ListCheckpointsOptions {
  /** Optional custom checkpoint directory */
  checkpointDir?: string;
  /** Filter by phase */
  phase?: CheckpointPhase;
  /** Filter by state */
  state?: WeaveState;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Checkpoint cleanup result
 */
export interface CleanupResult {
  /** Number of checkpoints removed */
  removed: number;
  /** Number of checkpoints retained */
  retained: number;
  /** Run IDs that were removed */
  removedRunIds: string[];
}
