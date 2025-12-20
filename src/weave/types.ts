/**
 * Core types for merge-weave execution state machine
 */

import { Plan } from '../schema.js';
import type { TurnCostSummary } from '../metrics/turncost.js';

/**
 * Weave execution states
 */
export enum WeaveState {
	/** Initial state - no execution started */
	IDLE = 'idle',
	/** Planning phase - analyzing PRs and dependencies */
	PLANNING = 'planning',
	/** Computing merge order and batches */
	COMPUTING_ORDER = 'computing_order',
	/** Ready to execute merges */
	READY = 'ready',
	/** Executing merges for current batch */
	MERGING = 'merging',
	/** Running gates on merged result */
	VALIDATING = 'validating',
	/** Gate failed, awaiting automated fix attempt */
	AWAITING_FIX = 'awaiting_fix',
	/** Fix submitted, ready for verification */
	FIX_SUBMITTED = 'fix_submitted',
	/** Verifying submitted fix */
	VERIFYING = 'verifying',
	/** Fix verified successfully */
	VERIFIED = 'verified',
	/** Trust gap detected between agent claim and verification */
	TRUST_GAP = 'trust_gap',
	/** All batches completed successfully */
	COMPLETED = 'completed',
	/** Execution failed */
	FAILED = 'failed',
	/** Execution paused, can be resumed */
	PAUSED = 'paused'
}

/**
 * Events that trigger state transitions
 */
export enum WeaveEvent {
	/** Start execution */
	START = 'start',
	/** Planning completed */
	PLAN_READY = 'plan_ready',
	/** Order computed */
	ORDER_COMPUTED = 'order_computed',
	/** Begin merge execution */
	BEGIN_MERGE = 'begin_merge',
	/** Merge batch completed successfully */
	MERGE_SUCCESS = 'merge_success',
	/** Merge failed with conflicts */
	MERGE_FAILED = 'merge_failed',
	/** Validation gates passed */
	VALIDATION_PASSED = 'validation_passed',
	/** Validation gates failed */
	VALIDATION_FAILED = 'validation_failed',
	/** Gate failed, snapshot generated */
	GATE_FAILED = 'gate_failed',
	/** Fix receipt submitted */
	FIX_SUBMITTED = 'fix_submitted',
	/** Begin verification of fix */
	BEGIN_VERIFICATION = 'begin_verification',
	/** Fix verified successfully */
	FIX_VERIFIED = 'fix_verified',
	/** Trust gap detected */
	TRUST_GAP_DETECTED = 'trust_gap_detected',
	/** All batches completed */
	ALL_COMPLETE = 'all_complete',
	/** Request to pause execution */
	PAUSE = 'pause',
	/** Resume from paused state */
	RESUME = 'resume',
	/** Reset to initial state */
	RESET = 'reset'
}

/**
 * State transition definition
 */
export interface StateTransition {
	from: WeaveState;
	to: WeaveState;
	event: WeaveEvent;
	guard?: () => boolean;
}

/**
 * Batch execution state
 */
export interface BatchState {
	/** Batch number (0-indexed) */
	batchNumber: number;
	/** Item names in this batch */
	items: string[];
	/** Current state of the batch */
	state: 'pending' | 'in-progress' | 'completed' | 'failed';
	/** Start timestamp */
	startedAt?: string;
	/** Completion timestamp */
	completedAt?: string;
	/** Error message if failed */
	error?: string;
	/** Merge commit SHA if successful */
	mergeSha?: string;
}

/**
 * PR head information for tracking
 */
export interface PRHead {
	/** PR number or branch name */
	name: string;
	/** Git commit SHA */
	sha: string;
	/** Last updated timestamp */
	updatedAt: string;
}

/**
 * Weave execution context
 */
export interface WeaveContext {
	/** Unique run ID */
	runId: string;
	/** Current state */
	state: WeaveState;
	/** Plan being executed */
	plan: Plan;
	/** PR head information */
	prHeads: PRHead[];
	/** Computed merge batches */
	batches: BatchState[];
	/** Current batch being processed */
	currentBatchIndex: number;
	/** Execution start timestamp */
	startedAt: string;
	/** Last state update timestamp */
	lastUpdatedAt: string;
	/** Completion timestamp */
	completedAt?: string;
	/** Total successful merges */
	successfulMerges: number;
	/** Total failed merges */
	failedMerges: number;
	/** Execution metadata */
	metadata: {
		/** Hash of plan.json + PR heads */
		planHash: string;
		/** Target branch */
		targetBranch: string;
		/** Integration branch name */
		integrationBranch?: string;
		/** Dry run mode */
		dryRun: boolean;
	};
	/** Turn Cost tracking summary (when enabled) */
	turnCost?: TurnCostSummary;
}

/**
 * Lock file structure for resume capability
 */
export interface WeaveLockFile {
	/** Schema version for lock file format */
	schemaVersion: string;
	/** Run ID */
	runId: string;
	/** Hash of plan.json + PR heads for validation */
	planHash: string;
	/** Current execution state */
	state: WeaveState;
	/** Full execution context */
	context: WeaveContext;
	/** Lock file creation timestamp */
	createdAt: string;
	/** Last update timestamp */
	updatedAt: string;
}

/**
 * Preflight conflict detection result for a single item
 */
export interface PreflightItemConflict {
	/** Item name (branch name) */
	name: string;
	/** Whether conflicts were detected */
	hasConflicts: boolean;
	/** List of conflicted files */
	conflicts: Array<{
		/** Path to the conflicted file */
		path: string;
		/** Type of conflict */
		type: 'both-modified' | 'rename' | 'delete-modify' | 'add-add' | 'unknown';
		/** Whether our side changed this file */
		oursChanged: boolean;
		/** Whether their side changed this file */
		theirsChanged: boolean;
		/** Line range of conflict (if available) */
		lines?: string;
	}>;
	/** Merge base SHA used for simulation */
	mergeBase?: string;
	/** Error message if simulation failed */
	error?: string;
}

/**
 * Preflight conflict detection results
 */
export interface PreflightResults {
	/** Total number of conflicts detected across all items */
	conflictsDetected: number;
	/** Per-item conflict details */
	items: PreflightItemConflict[];
	/** Whether preflight detection was skipped */
	skipped?: boolean;
	/** Reason for skipping (if applicable) */
	skipReason?: string;
}

/**
 * Dry run output structure
 */
export interface DryRunOutput {
	/** Execution plan summary */
	summary: {
		totalBatches: number;
		totalItems: number;
		targetBranch: string;
		estimatedDuration?: string;
	};
	/** Planned batches in execution order */
	batches: Array<{
		batchNumber: number;
		items: string[];
		dependencies: string[];
		parallelizable: boolean;
	}>;
	/** PR information */
	prs: Array<{
		name: string;
		currentSha: string;
		status: string;
	}>;
	/** Validation checks */
	checks: {
		cleanWorkingDirectory: boolean;
		branchExists: boolean;
		conflictsPredicted: number;
	};
	/** Preflight conflict detection results (optional) */
	preflight?: PreflightResults;
}
