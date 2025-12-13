/**
 * Frame Emitter
 *
 * Utility for emitting Frames capturing workflow execution.
 * Implements AX-005: Frame emission for core workflows.
 *
 * AX Principle: Memory Is a Feature
 */

import { ulid } from "ulid";
import type {
	ExecutionFrame,
	FrameEmitResult,
	MergeWeaveFrameInput,
	ExecutorFrameInput,
	GateFrameInput,
	FrameOutcome,
} from "./types.js";
import { validateExecutionFrame } from "./types.js";

/**
 * Generate a timestamp string for reference points
 */
function getTimestampForRef(): string {
	const now = new Date();
	return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Generate a short unique suffix for reference points
 */
function getUniqueSuffix(): string {
	return ulid().slice(-6).toLowerCase();
}

/**
 * Emit a Frame for merge-weave completion
 */
export function emitMergeWeaveFrame(
	input: MergeWeaveFrameInput
): FrameEmitResult {
	try {
		const timestamp = getTimestampForRef();
		const suffix = getUniqueSuffix();
		const referencePoint = `merge-weave-${timestamp}-${suffix}`;

		const prList = input.mergedPRs.join(", ");
		const summaryCaption =
			input.outcome === "success"
				? `Merged ${input.mergedPRs.length} PRs (${prList}) into ${input.targetBranch}`
				: input.outcome === "partial"
					? `Partially merged PRs (${prList}) into ${input.targetBranch}`
					: `Failed to merge PRs (${prList}) into ${input.targetBranch}`;

		const nextActions: string[] = [];
		if (input.outcome === "success") {
			if (input.gatesPassed.length > 0) {
				nextActions.push("Run e2e tests");
			}
			nextActions.push("Deploy to staging");
			nextActions.push("Verify integration");
		} else if (input.outcome === "partial") {
			nextActions.push("Review partial merge results");
			nextActions.push("Resolve remaining conflicts");
			nextActions.push("Retry merge-weave");
		} else {
			nextActions.push("Review merge failure logs");
			nextActions.push("Resolve conflicts manually");
			nextActions.push("Retry after fixes");
		}

		const frame: ExecutionFrame = {
			type: "merge-weave",
			reference_point: referencePoint,
			summary_caption: summaryCaption,
			module_scope: input.mergedPRs,
			keywords: ["merge-weave", "integration", input.targetBranch],
			outcome: input.outcome,
			next_actions: nextActions,
			metadata: {
				duration_ms: input.durationMs,
				conflicts_resolved: input.conflictsResolved,
				gates_passed: input.gatesPassed,
				gates_failed: input.gatesFailed,
				run_id: input.runId,
				plan_hash: input.planHash,
				error: input.error,
				turn_cost: input.turnCost,
				tier_metrics: input.tierMetrics,
			},
		};

		// Validate the frame
		const validated = validateExecutionFrame(frame);

		return {
			success: true,
			frame: validated,
			frameId: referencePoint,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Emit a Frame for executor run completion
 */
export function emitExecutorFrame(input: ExecutorFrameInput): FrameEmitResult {
	try {
		const timestamp = getTimestampForRef();
		const suffix = getUniqueSuffix();
		const referencePoint = `executor-${input.procedure}-${timestamp}-${suffix}`;

		const scopeList = input.moduleScope.join(", ");
		const summaryCaption =
			input.outcome === "success"
				? `Executed procedure '${input.procedure}' on ${scopeList}`
				: input.outcome === "partial"
					? `Partially executed procedure '${input.procedure}' on ${scopeList}`
					: `Failed to execute procedure '${input.procedure}' on ${scopeList}`;

		// Build next actions: user-provided action + outcome-based suggestions
		const nextActions: string[] = [input.nextAction];
		if (input.outcome === "success") {
			nextActions.push(`Verify executor ${input.procedure} completion`);
			nextActions.push("Continue to next workflow step");
		} else if (input.outcome === "partial") {
			nextActions.push(`Review partial executor ${input.procedure} results`);
			nextActions.push("Address remaining items");
		} else {
			nextActions.push(`Review executor ${input.procedure} failure logs`);
			nextActions.push("Fix issues and retry");
		}

		const frame: ExecutionFrame = {
			type: "execution",
			reference_point: referencePoint,
			summary_caption: summaryCaption,
			module_scope: input.moduleScope,
			keywords: ["executor", input.procedure, "execution"],
			outcome: input.outcome,
			next_actions: nextActions,
			metadata: {
				duration_ms: input.durationMs,
				artifacts: input.artifacts,
				run_id: input.runId,
				error: input.error,
			},
		};

		// Validate the frame
		const validated = validateExecutionFrame(frame);

		return {
			success: true,
			frame: validated,
			frameId: referencePoint,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Emit a Frame for gate execution
 */
export function emitGateFrame(input: GateFrameInput): FrameEmitResult {
	try {
		const timestamp = getTimestampForRef();
		const suffix = getUniqueSuffix();
		const referencePoint = `gate-${input.gateName}-${input.itemName}-${timestamp}-${suffix}`;

		const summaryCaption =
			input.outcome === "success"
				? `Gate '${input.gateName}' passed for ${input.itemName}`
				: `Gate '${input.gateName}' failed for ${input.itemName}`;

		const nextActions: string[] = [];
		if (input.outcome === "success") {
			nextActions.push("Continue to next gate");
			nextActions.push("Verify gate artifacts");
		} else {
			nextActions.push(`Review ${input.gateName} failure`);
			nextActions.push("Fix issues and re-run gate");
		}

		const frame: ExecutionFrame = {
			type: "gate",
			reference_point: referencePoint,
			summary_caption: summaryCaption,
			module_scope: [input.itemName],
			keywords: ["gate", input.gateName, input.itemName],
			outcome: input.outcome,
			next_actions: nextActions,
			metadata: {
				duration_ms: input.durationMs,
				exit_code: input.exitCode,
				artifacts: input.artifacts,
				run_id: input.runId,
				error: input.error,
			},
		};

		// Validate the frame
		const validated = validateExecutionFrame(frame);

		return {
			success: true,
			frame: validated,
			frameId: referencePoint,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Emit a Frame for procedure execution
 */
export function emitProcedureFrame(input: {
	runId: string;
	procedure: string;
	moduleScope: string[];
	durationMs: number;
	outcome: FrameOutcome;
	nextActions: string[];
	artifacts?: string[];
	error?: string;
	planHash?: string;
}): FrameEmitResult {
	try {
		const timestamp = getTimestampForRef();
		const suffix = getUniqueSuffix();
		const referencePoint = `procedure-${input.procedure}-${timestamp}-${suffix}`;

		const scopeList = input.moduleScope.join(", ");
		const summaryCaption =
			input.outcome === "success"
				? `Completed procedure '${input.procedure}' for ${scopeList}`
				: input.outcome === "partial"
					? `Partially completed procedure '${input.procedure}' for ${scopeList}`
					: `Failed procedure '${input.procedure}' for ${scopeList}`;

		const frame: ExecutionFrame = {
			type: "procedure",
			reference_point: referencePoint,
			summary_caption: summaryCaption,
			module_scope: input.moduleScope,
			keywords: ["procedure", input.procedure],
			outcome: input.outcome,
			next_actions: input.nextActions,
			metadata: {
				duration_ms: input.durationMs,
				artifacts: input.artifacts,
				run_id: input.runId,
				plan_hash: input.planHash,
				error: input.error,
			},
		};

		// Validate the frame
		const validated = validateExecutionFrame(frame);

		return {
			success: true,
			frame: validated,
			frameId: referencePoint,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
