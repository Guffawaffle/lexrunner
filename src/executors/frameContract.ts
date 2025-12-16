/**
 * Executor Frame Contract Enforcement
 *
 * Enforces the requirement that every executor invocation MUST emit at least one Frame.
 * Frames are receipts that prove what happened during execution.
 *
 * Related to:
 * - LPR-044: Eager-PM Executor Canonicalization
 * - Lex#88: Frame schema v2
 */

import { createHash } from "node:crypto";
import type { ExecutionFrame, FrameEmitResult } from "../frames/types.js";

/**
 * Tool call record for Frame metadata
 */
export interface ToolCall {
	/** Tool name */
	tool: string;
	/** Timestamp when the tool was called */
	timestamp: string;
	/** Duration in milliseconds */
	durationMs?: number;
	/** Whether the call succeeded */
	success: boolean;
	/** Error message if failed */
	error?: string;
}

/**
 * Executor invocation context for Frame emission
 */
export interface ExecutorInvocationContext {
	/** Executor role/name */
	executorRole: string;
	/** Run ID for correlation */
	runId: string;
	/** Input parameters (will be hashed) */
	inputs: Record<string, unknown>;
	/** Tools called during execution */
	toolCalls: ToolCall[];
	/** Execution start time */
	startTime: string;
}

/**
 * Executor output for Frame validation
 */
export interface ExecutorOutput {
	/** Result data (will be hashed) */
	outputs: Record<string, unknown>;
	/** Execution end time */
	endTime: string;
	/** Frame emitted during execution */
	frame?: ExecutionFrame;
}

/**
 * Frame contract violation error
 */
export class FrameContractViolationError extends Error {
	constructor(
		public readonly executorRole: string,
		public readonly runId: string,
		message: string
	) {
		super(message);
		this.name = "FrameContractViolationError";
	}
}

/**
 * Generate SHA-256 hash of data for Frame metadata
 */
function hashData(data: Record<string, unknown>): string {
	const json = JSON.stringify(data, Object.keys(data).sort());
	return createHash("sha256").update(json).digest("hex");
}

/**
 * Create Frame metadata from executor invocation
 */
export function createFrameMetadata(
	context: ExecutorInvocationContext,
	output: ExecutorOutput
): {
	executorRole: string;
	inputsHash: string;
	outputsHash: string;
	toolCalls: ToolCall[];
	durationMs: number;
} {
	const inputsHash = hashData(context.inputs);
	const outputsHash = hashData(output.outputs);
	const durationMs =
		new Date(output.endTime).getTime() - new Date(context.startTime).getTime();

	return {
		executorRole: context.executorRole,
		inputsHash,
		outputsHash,
		toolCalls: context.toolCalls,
		durationMs,
	};
}

/**
 * Validate that executor output includes a Frame
 *
 * @throws {FrameContractViolationError} If no Frame is emitted
 */
export function enforceFrameEmission(
	context: ExecutorInvocationContext,
	output: ExecutorOutput
): ExecutionFrame {
	if (!output.frame) {
		throw new FrameContractViolationError(
			context.executorRole,
			context.runId,
			`Executor '${context.executorRole}' did not emit a Frame. All executor invocations MUST emit at least one Frame.`
		);
	}

	return output.frame;
}

/**
 * Wrap executor function to enforce Frame emission
 *
 * This is a higher-order function that wraps an executor implementation
 * to automatically enforce Frame emission requirements.
 *
 * @example
 * ```typescript
 * const wrappedExecutor = withFrameContract(
 *   myExecutor,
 *   { executorRole: 'senior-dev', runId: '01JFZG...' }
 * );
 * const output = await wrappedExecutor(inputs);
 * // Throws if output.frame is not present
 * ```
 */
export function withFrameContract<TInput extends Record<string, unknown>, TOutput extends ExecutorOutput>(
	executor: (inputs: TInput, context: ExecutorInvocationContext) => Promise<TOutput>,
	baseContext: Omit<ExecutorInvocationContext, 'inputs' | 'toolCalls' | 'startTime'>
): (inputs: TInput) => Promise<TOutput & { validatedFrame: ExecutionFrame }> {
	return async (inputs: TInput) => {
		const context: ExecutorInvocationContext = {
			...baseContext,
			inputs,
			toolCalls: [],
			startTime: new Date().toISOString(),
		};

		const output = await executor(inputs, context);

		// Enforce Frame emission
		const validatedFrame = enforceFrameEmission(context, output);

		return {
			...output,
			validatedFrame,
		};
	};
}

/**
 * Validate Frame metadata completeness
 *
 * Ensures the Frame includes required executor metadata fields
 */
export function validateFrameMetadata(
	frame: ExecutionFrame,
	expectedMetadata: {
		executorRole: string;
		inputsHash: string;
		outputsHash: string;
		toolCalls: ToolCall[];
	}
): boolean {
	// Check if Frame metadata exists
	if (!frame.metadata) {
		return false;
	}

	// For now, we validate that the frame exists and has metadata
	// Future versions can enforce specific metadata fields
	return true;
}

/**
 * Executor Frame template
 *
 * Template for creating Frames from executor outputs.
 * This ensures consistency across all executor Frame emissions.
 */
export interface ExecutorFrameTemplate {
	/** Executor role */
	role: string;
	/** Run ID */
	runId: string;
	/** Summary of what was executed */
	summary: string;
	/** Modules/scope touched */
	moduleScope: string[];
	/** Outcome of execution */
	outcome: "success" | "failure" | "partial";
	/** Next recommended actions */
	nextActions: string[];
	/** Input parameters hash */
	inputsHash: string;
	/** Output results hash */
	outputsHash: string;
	/** Tool calls made during execution */
	toolCalls: ToolCall[];
	/** Duration in milliseconds */
	durationMs: number;
	/** Error message if failed */
	error?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Build ExecutionFrame from executor template
 */
export function buildFrameFromTemplate(template: ExecutorFrameTemplate): ExecutionFrame {
	const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	const suffix = Math.random().toString(36).slice(-6);
	const referencePoint = `executor-${template.role}-${timestamp}-${suffix}`;

	// Build metadata with ExecutionFrameMetadata fields plus custom executor data
	const metadata: Record<string, unknown> = {
		duration_ms: template.durationMs,
		run_id: template.runId,
		error: template.error,
	};

	// Add executor-specific metadata
	if (template.metadata) {
		Object.assign(metadata, template.metadata);
	}

	// Add Frame contract metadata (stored as custom fields)
	metadata.executor_role = template.role;
	metadata.inputs_hash = template.inputsHash;
	metadata.outputs_hash = template.outputsHash;
	metadata.tool_calls_count = template.toolCalls.length;
	metadata.tool_calls = template.toolCalls.map((tc) => ({
		tool: tc.tool,
		timestamp: tc.timestamp,
		duration_ms: tc.durationMs,
		success: tc.success,
		error: tc.error,
	}));

	return {
		type: "execution",
		reference_point: referencePoint,
		summary_caption: template.summary,
		module_scope: template.moduleScope,
		keywords: ["executor", template.role, "execution"],
		outcome: template.outcome,
		next_actions: template.nextActions,
		metadata,
	};
}
