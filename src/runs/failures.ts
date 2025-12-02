/**
 * Failure Handling Payload - LR-064
 *
 * Wraps gate and tool failures in a structured FailureHandlingPayload that
 * presents failure recovery as a decision point with nextOptions.
 *
 * Key concepts:
 * - Error classification (retryable vs non-retryable)
 * - Recommended actions populated based on error type
 * - All failures logged to failures.ndjson
 * - AX Level 3 compliance: toAXError() adapter for structured errors
 */

import { z } from "zod";
import type { GateResult } from "../schema.js";
import type { NextOption } from "../schemas/runCentric.js";
import { appendToRunLog, readRunLog } from "./storage.js";
import { type AXError, createAXError } from "../errors/index.js";

/**
 * Error codes for failure classification
 */
export const FailureErrorCode = {
	// Retryable errors
	GATE_TIMEOUT: "GATE_TIMEOUT",
	GATE_FLAKY: "GATE_FLAKY",
	NETWORK_ERROR: "NETWORK_ERROR",
	RATE_LIMITED: "RATE_LIMITED",

	// Non-retryable errors
	GATE_FAILED: "GATE_FAILED",
	AUTH_FAILED: "AUTH_FAILED",
	CONFIG_ERROR: "CONFIG_ERROR",
	CONFLICT_DETECTED: "CONFLICT_DETECTED",
	VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

export type FailureErrorCode =
	(typeof FailureErrorCode)[keyof typeof FailureErrorCode];

/**
 * Retryable error codes
 */
const RETRYABLE_ERROR_CODES: Set<FailureErrorCode> = new Set([
	FailureErrorCode.GATE_TIMEOUT,
	FailureErrorCode.GATE_FLAKY,
	FailureErrorCode.NETWORK_ERROR,
	FailureErrorCode.RATE_LIMITED,
]);

/**
 * Check if an error code is retryable
 */
export function isRetryableErrorCode(code: FailureErrorCode): boolean {
	return RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Structured error information
 */
export const FailureErrorSchema = z.object({
	/** Error code for classification */
	code: z.string(),
	/** Human-readable error message */
	message: z.string(),
	/** Whether the error is retryable */
	retryable: z.boolean(),
	/** Optional hint for recovery */
	hint: z.string().optional(),
});

export type FailureError = z.infer<typeof FailureErrorSchema>;

/**
 * Recommended action for failure recovery
 * Extends NextOption with failure-specific fields
 */
export const RecommendedActionSchema = z.object({
	/** Action identifier */
	action: z.string(),
	/** Action description */
	description: z.string(),
	/** Whether this action requires LLM decision */
	requiresLLMDecision: z.boolean().optional(),
	/** Prompt for LLM decision */
	prompt: z.string().optional(),
	/** JSON schema for response */
	responseSchema: z.record(z.string(), z.unknown()).optional(),
	/** Risk level assessment */
	riskLevel: z.enum(["low", "medium", "high"]).optional(),
});

export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

/**
 * Failure record for logging to failures.ndjson
 */
export const FailureRecordSchema = z.object({
	/** ISO 8601 timestamp */
	timestamp: z.string(),
	/** Run identifier */
	runId: z.string(),
	/** Gate name that failed */
	gate: z.string(),
	/** Structured error information */
	error: FailureErrorSchema,
	/** Whether the error was retryable */
	retryable: z.boolean(),
	/** Action taken to handle the failure */
	actionTaken: z.string().optional(),
	/** Rationale for the action taken */
	rationale: z.string().optional(),
	/** Exit code from gate execution */
	exitCode: z.number().optional(),
	/** Duration in milliseconds */
	duration_ms: z.number().optional(),
});

export type FailureRecord = z.infer<typeof FailureRecordSchema>;

/**
 * FailureHandlingPayload - The main structured failure response
 *
 * Wraps gate failures with error classification and recommended actions
 * to present failure recovery as a decision point.
 */
export const FailureHandlingPayloadSchema = z.object({
	/** Structured error information */
	error: FailureErrorSchema,
	/** Recommended actions for recovery */
	recommendedActions: z.array(RecommendedActionSchema),
	/** Schema for failure record logging */
	failureRecordSchema: z.record(z.string(), z.unknown()).optional(),
});

export type FailureHandlingPayload = z.infer<
	typeof FailureHandlingPayloadSchema
>;

/**
 * Classify a gate failure based on error message and exit code
 */
export function classifyGateError(
	gateName: string,
	stderr: string,
	exitCode?: number,
	isFlaky?: boolean
): { code: FailureErrorCode; retryable: boolean } {
	const errorMessage = stderr.toLowerCase();

	// Check for timeout
	if (
		errorMessage.includes("timeout") ||
		errorMessage.includes("timed out") ||
		errorMessage.includes("etimedout") ||
		errorMessage.includes("time limit")
	) {
		return { code: FailureErrorCode.GATE_TIMEOUT, retryable: true };
	}

	// Check for flaky gate (marked in policy)
	if (isFlaky) {
		return { code: FailureErrorCode.GATE_FLAKY, retryable: true };
	}

	// Check for network errors
	if (
		errorMessage.includes("network") ||
		errorMessage.includes("econnrefused") ||
		errorMessage.includes("enotfound") ||
		errorMessage.includes("fetch failed")
	) {
		return { code: FailureErrorCode.NETWORK_ERROR, retryable: true };
	}

	// Check for rate limiting
	if (
		errorMessage.includes("rate limit") ||
		errorMessage.includes("429") ||
		errorMessage.includes("too many requests")
	) {
		return { code: FailureErrorCode.RATE_LIMITED, retryable: true };
	}

	// Check for authentication errors
	if (
		errorMessage.includes("unauthorized") ||
		errorMessage.includes("authentication") ||
		errorMessage.includes("401") ||
		errorMessage.includes("403")
	) {
		return { code: FailureErrorCode.AUTH_FAILED, retryable: false };
	}

	// Check for configuration errors
	if (
		errorMessage.includes("config") ||
		errorMessage.includes("configuration") ||
		errorMessage.includes("invalid option")
	) {
		return { code: FailureErrorCode.CONFIG_ERROR, retryable: false };
	}

	// Check for merge conflicts
	if (
		errorMessage.includes("conflict") ||
		errorMessage.includes("merge conflict")
	) {
		return { code: FailureErrorCode.CONFLICT_DETECTED, retryable: false };
	}

	// Check for validation errors
	if (
		errorMessage.includes("validation") ||
		errorMessage.includes("schema")
	) {
		return { code: FailureErrorCode.VALIDATION_ERROR, retryable: false };
	}

	// Default: general gate failure (non-retryable)
	return { code: FailureErrorCode.GATE_FAILED, retryable: false };
}

/**
 * Build recommended actions based on error code
 */
export function buildRecommendedActions(
	code: FailureErrorCode,
	gateName: string,
	retryable: boolean
): RecommendedAction[] {
	const actions: RecommendedAction[] = [];

	// Always include retry action for retryable errors
	if (retryable) {
		actions.push({
			action: "retry_gate",
			description: `Retry the failed gate "${gateName}".`,
			requiresLLMDecision: false,
			riskLevel: "low",
		});

		actions.push({
			action: "retry_with_options",
			description: "Retry with modified configuration.",
			requiresLLMDecision: true,
			prompt: "Specify retry options (e.g., --maxWorkers=1, increased timeout)",
			responseSchema: {
				type: "object",
				properties: {
					options: { type: "string" },
					timeout: { type: "number" },
				},
			},
			riskLevel: "low",
		});
	}

	// Skip gate action (always available, but requires decision)
	actions.push({
		action: "skip_gate",
		description: `Skip gate "${gateName}" and continue.`,
		requiresLLMDecision: true,
		prompt: "Provide rationale for skipping (will be logged).",
		riskLevel: "medium",
	});

	// Abort run action (always available)
	actions.push({
		action: "abort_run",
		description: "Stop the run and report failure.",
		requiresLLMDecision: false,
		riskLevel: "low",
	});

	// Add error-specific actions
	switch (code) {
		case FailureErrorCode.AUTH_FAILED:
			actions.unshift({
				action: "check_credentials",
				description: "Verify authentication credentials.",
				requiresLLMDecision: false,
				riskLevel: "low",
			});
			break;
		case FailureErrorCode.CONFIG_ERROR:
			actions.unshift({
				action: "fix_config",
				description: "Review and fix configuration.",
				requiresLLMDecision: true,
				prompt: "Identify the configuration issue and suggest a fix.",
				riskLevel: "low",
			});
			break;
		case FailureErrorCode.CONFLICT_DETECTED:
			actions.unshift({
				action: "resolve_conflict",
				description: "Resolve the merge conflict.",
				requiresLLMDecision: true,
				prompt: "Review the conflict and provide resolution strategy.",
				riskLevel: "medium",
			});
			break;
	}

	return actions;
}

/**
 * Build hint message based on error code and context
 */
function buildHint(
	code: FailureErrorCode,
	gateName: string,
	runId?: string
): string {
	const artifactPath = runId
		? `.lexrunner/runs/${runId}/artifacts/${gateName}/`
		: `artifacts/${gateName}/`;

	switch (code) {
		case FailureErrorCode.GATE_TIMEOUT:
			return `Consider increasing timeout or checking for long-running operations in ${gateName}.`;
		case FailureErrorCode.GATE_FLAKY:
			return `Gate "${gateName}" is marked as flaky. Retry may succeed.`;
		case FailureErrorCode.NETWORK_ERROR:
			return "Check network connectivity and retry.";
		case FailureErrorCode.RATE_LIMITED:
			return "Wait for rate limit to reset or use authenticated requests.";
		case FailureErrorCode.GATE_FAILED:
			return `Check output in ${artifactPath}stderr.txt`;
		case FailureErrorCode.AUTH_FAILED:
			return "Verify credentials are valid and have required permissions.";
		case FailureErrorCode.CONFIG_ERROR:
			return "Review configuration files for syntax or schema errors.";
		case FailureErrorCode.CONFLICT_DETECTED:
			return "Resolve merge conflicts before continuing.";
		case FailureErrorCode.VALIDATION_ERROR:
			return "Check input data against expected schema.";
		default:
			return `Check logs in ${artifactPath}`;
	}
}

/**
 * Wrap a gate failure in a FailureHandlingPayload
 *
 * This is the main entry point for converting raw gate failures
 * into structured decision points with recommended actions.
 */
export function wrapGateFailure(
	gateResult: GateResult,
	options?: {
		runId?: string;
		isFlaky?: boolean;
		artifactDir?: string;
	}
): FailureHandlingPayload {
	const gateName = gateResult.gate;
	const stderr = gateResult.stderr || "";
	const exitCode = gateResult.exitCode;

	// Classify the error
	const { code, retryable } = classifyGateError(
		gateName,
		stderr,
		exitCode,
		options?.isFlaky
	);

	// Build error message
	const message =
		exitCode !== undefined
			? `Gate "${gateName}" failed with exit code ${exitCode}`
			: `Gate "${gateName}" failed`;

	// Build structured error
	const error: FailureError = {
		code,
		message,
		retryable,
		hint: buildHint(code, gateName, options?.runId),
	};

	// Build recommended actions
	const recommendedActions = buildRecommendedActions(
		code,
		gateName,
		retryable
	);

	// Build failure record schema for documentation
	const failureRecordSchema = {
		type: "object",
		properties: {
			timestamp: { type: "string", format: "date-time" },
			runId: { type: "string" },
			gate: { type: "string" },
			error: {
				type: "object",
				properties: {
					code: { type: "string" },
					message: { type: "string" },
				},
			},
			retryable: { type: "boolean" },
			actionTaken: { type: "string" },
			rationale: { type: "string" },
		},
		required: ["timestamp", "gate", "error", "retryable"],
	};

	return {
		error,
		recommendedActions,
		failureRecordSchema,
	};
}

/**
 * Log a failure to the run's failures.ndjson
 */
export function logGateFailure(
	runId: string,
	gateResult: GateResult,
	options?: {
		actionTaken?: string;
		rationale?: string;
		isFlaky?: boolean;
	},
	baseDir: string = process.cwd()
): FailureRecord {
	const payload = wrapGateFailure(gateResult, {
		runId,
		isFlaky: options?.isFlaky,
	});

	const record: FailureRecord = {
		timestamp: new Date().toISOString(),
		runId,
		gate: gateResult.gate,
		error: payload.error,
		retryable: payload.error.retryable,
		actionTaken: options?.actionTaken,
		rationale: options?.rationale,
		exitCode: gateResult.exitCode,
		duration_ms: gateResult.duration,
	};

	// Validate record
	FailureRecordSchema.parse(record);

	// Log to failures.ndjson
	appendToRunLog(runId, "failures", record, baseDir);

	return record;
}

/**
 * Get all failure records for a run
 */
export function getGateFailures(
	runId: string,
	baseDir: string = process.cwd()
): FailureRecord[] {
	const failures = readRunLog(runId, "failures", baseDir);

	// Filter and validate failure records (exclude violation entries)
	const records: FailureRecord[] = [];
	for (const entry of failures) {
		// Skip violation entries (they have 'violation' field instead of 'gate')
		if ("violation" in entry) {
			continue;
		}
		const result = FailureRecordSchema.safeParse(entry);
		if (result.success) {
			records.push(result.data);
		}
	}

	return records;
}

/**
 * Convert FailureHandlingPayload's recommendedActions to NextOptions
 * for StatusResponse integration
 */
export function toNextOptions(payload: FailureHandlingPayload): NextOption[] {
	return payload.recommendedActions.map((action) => ({
		action: action.action,
		description: action.description,
		requiresLLMDecision: action.requiresLLMDecision,
		prompt: action.prompt,
		responseSchema: action.responseSchema,
		riskLevel: action.riskLevel,
	}));
}

/**
 * Convert FailureHandlingPayload to AXError for AX Level 3 compliance.
 *
 * Per AX-CONTRACT.md v0.1, Guarantee 2.3: Recoverable Errors
 * - Structured errors MUST include code, message, and at least one nextAction
 *
 * @example
 * ```typescript
 * const gateResult = await executeGate(gate, policy, artifactDir);
 * if (gateResult.status === "fail") {
 *   const payload = wrapGateFailure(gateResult);
 *   const axError = failurePayloadToAXError(payload, "PR-123");
 *   return { error: axError };  // AX-compliant response
 * }
 * ```
 */
export function failurePayloadToAXError(
	payload: FailureHandlingPayload,
	itemName?: string
): AXError {
	// Extract nextActions from recommended actions
	const nextActions = payload.recommendedActions.map(
		(action) => action.description
	);

	// Ensure at least one nextAction (AX requirement)
	if (nextActions.length === 0) {
		nextActions.push("Review the error details and retry");
	}

	// Build context from error details
	const context: Record<string, unknown> = {
		errorCode: payload.error.code,
		retryable: payload.error.retryable,
	};

	if (payload.error.hint) {
		context.hint = payload.error.hint;
	}

	if (itemName) {
		context.item = itemName;
	}

	return createAXError(
		payload.error.code,
		payload.error.message,
		nextActions,
		context
	);
}
