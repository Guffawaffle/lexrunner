/**
 * Weave Frame Helper
 *
 * Utility for emitting Frames from weave state machine events.
 * Implements AX-005: Frame emission for merge-weave workflows.
 */

import { emitMergeWeaveFrame } from "../frames/index.js";
import type { MergeWeaveFrameInput, FrameEmitResult, FrameOutcome } from "../frames/types.js";
import type { WeaveContext } from "./types.js";
import { WeaveState } from "./types.js";

/**
 * Emit a Frame for weave completion
 *
 * Called when weave execution reaches a terminal state (COMPLETED or FAILED).
 */
export function emitWeaveCompletionFrame(context: WeaveContext): FrameEmitResult {
	// Determine outcome based on state
	let outcome: FrameOutcome;
	if (context.state === WeaveState.COMPLETED) {
		outcome = "success";
	} else if (context.failedMerges > 0 && context.successfulMerges > 0) {
		outcome = "partial";
	} else {
		outcome = "failure";
	}

	// Collect merged PRs from batches
	const mergedPRs: string[] = [];
	for (const batch of context.batches) {
		if (batch.state === "completed") {
			mergedPRs.push(...batch.items);
		}
	}

	// If no completed batches, use all items from plan
	if (mergedPRs.length === 0 && context.plan.items) {
		for (const item of context.plan.items) {
			mergedPRs.push(item.name);
		}
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

	// Build frame input
	const input: MergeWeaveFrameInput = {
		runId: context.runId,
		mergedPRs,
		conflictsResolved: 0, // Could be tracked in context.metadata if needed
		gatesPassed,
		gatesFailed: gatesFailed.length > 0 ? gatesFailed : undefined,
		durationMs,
		outcome,
		targetBranch: context.metadata.targetBranch,
		planHash: context.metadata.planHash,
	};

	return emitMergeWeaveFrame(input);
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
