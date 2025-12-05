/**
 * Weave Frame Helper
 *
 * Utility for emitting Frames from weave state machine events.
 * Implements AX-005: Frame emission for merge-weave workflows.
 */

import { emitMergeWeaveFrame, storeFrameResult } from "../frames/index.js";
import type { MergeWeaveFrameInput, FrameEmitResult, FrameOutcome } from "../frames/types.js";
import type { WeaveContext } from "./types.js";
import { WeaveState } from "./types.js";

/**
 * Options for emitting weave completion Frame
 */
export interface EmitWeaveFrameOptions {
	/** Base directory for Frame storage (defaults to cwd) */
	baseDir?: string;
	/** Whether to persist the Frame to disk (defaults to true) */
	persist?: boolean;
}

/**
 * Emit a Frame for weave completion
 *
 * Called when weave execution reaches a terminal state (COMPLETED or FAILED).
 * Optionally persists the Frame to .lexrunner/frames/.
 */
export function emitWeaveCompletionFrame(
	context: WeaveContext,
	options?: EmitWeaveFrameOptions
): FrameEmitResult {
	// Determine outcome based on state
	let outcome: FrameOutcome;
	if (context.state === WeaveState.COMPLETED) {
		outcome = "success";
	} else if (context.failedMerges > 0 && context.successfulMerges > 0) {
		outcome = "partial";
	} else {
		outcome = "failure";
	}

	// Collect merged PRs from completed batches
	const mergedPRs: string[] = [];
	for (const batch of context.batches) {
		if (batch.state === "completed") {
			mergedPRs.push(...batch.items);
		}
	}

	// For failed/partial outcomes, include all attempted items in module_scope
	// so the Frame captures the full scope of what was attempted
	let moduleScope: string[];
	if (mergedPRs.length > 0) {
		moduleScope = mergedPRs;
	} else if (context.plan.items && context.plan.items.length > 0) {
		// Use plan items as the attempted scope (even if none merged)
		moduleScope = context.plan.items.map(item => item.name);
	} else {
		// Fallback: empty scope
		moduleScope = [];
	}

	// Calculate duration
	const startTime = new Date(context.startedAt).getTime();
	const endTime = context.completedAt
		? new Date(context.completedAt).getTime()
		: Date.now();
	const durationMs = endTime - startTime;

	// Collect gates passed/failed from batches (if tracked)
	const gatesPassed: string[] = [];
	const gatesFailed: string[] = [];

	// Build frame input - use moduleScope for full scope, mergedPRs for actual merged items
	const input: MergeWeaveFrameInput = {
		runId: context.runId,
		mergedPRs: moduleScope,
		conflictsResolved: 0, // Could be tracked in context.metadata if needed
		gatesPassed,
		gatesFailed: gatesFailed.length > 0 ? gatesFailed : undefined,
		durationMs,
		outcome,
		targetBranch: context.metadata.targetBranch,
		planHash: context.metadata.planHash,
		turnCost: context.turnCost,
	};

	const result = emitMergeWeaveFrame(input);

	// Persist Frame to disk if successful and persistence is enabled (default: true)
	const shouldPersist = options?.persist !== false;
	if (shouldPersist && result.success && result.frame && result.frameId) {
		try {
			storeFrameResult(result, options?.baseDir);
		} catch (error) {
			// Best-effort persistence - don't fail the emit if storage fails
			// Log for debugging but continue
			if (process.env.DEBUG) {
				console.error("[weave-frame] Failed to persist Frame:", error);
			}
		}
	}

	return result;
}

/**
 * Extract PR names from weave context
 */
export function extractMergedPRs(context: WeaveContext): string[] {
	const mergedPRs: string[] = [];
	for (const batch of context.batches) {
		if (batch.state === "completed") {
			mergedPRs.push(...batch.items);
		}
	}
	return mergedPRs;
}

/**
 * Calculate weave duration from context
 */
export function calculateWeaveDuration(context: WeaveContext): number {
	const startTime = new Date(context.startedAt).getTime();
	const endTime = context.completedAt
		? new Date(context.completedAt).getTime()
		: Date.now();
	return endTime - startTime;
}
