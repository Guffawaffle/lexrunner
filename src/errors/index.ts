/**
 * LexRunner Error Module
 *
 * Re-exports AXError from @smartergpt/lex and provides
 * adapters to convert LexRunner errors to AX format.
 *
 * @module errors
 * @see AX-CONTRACT.md v0.1, Guarantee 2.3: Recoverable Errors
 */

// Re-export everything from lex/errors
export {
	AXErrorSchema,
	type AXError,
	createAXError,
	wrapAsAXError,
	isAXError,
	AXErrorException,
	isAXErrorException,
} from "@smartergpt/lex/errors";

// Export adapters for LexRunner-specific errors
export {
	gateFailedError,
	mergeConflictError,
	cycleDetectedError,
	unknownDependencyError,
	githubApiError,
	gitOperationError,
	planValidationError,
	toAXError,
	type GateFailureContext,
	type MergeConflictContext,
	type CycleDetectedContext,
	type UnknownDependencyContext,
	type GitHubErrorContext,
	type GitOperationContext,
	type PlanValidationContext,
} from "./adapters.js"; // =============================================================================
// LexRunner-Specific Error Codes
// =============================================================================

/**
 * LexRunner error codes for AX compliance.
 *
 * These are stable identifiers that agents can rely on.
 * Format: UPPER_SNAKE_CASE
 */
export const ErrorCodes = {
	// Gate-related errors
	GATE_FAILED: "GATE_FAILED",
	GATE_NOT_FOUND: "GATE_NOT_FOUND",
	GATE_TIMEOUT: "GATE_TIMEOUT",

	// Merge-related errors
	MERGE_CONFLICT: "MERGE_CONFLICT",
	MERGE_BLOCKED: "MERGE_BLOCKED",
	MERGE_CYCLE_DETECTED: "MERGE_CYCLE_DETECTED",

	// Plan-related errors
	PLAN_VALIDATION_FAILED: "PLAN_VALIDATION_FAILED",
	PLAN_NOT_FOUND: "PLAN_NOT_FOUND",
	PLAN_CYCLE_DETECTED: "PLAN_CYCLE_DETECTED",
	UNKNOWN_DEPENDENCY: "UNKNOWN_DEPENDENCY",

	// GitHub-related errors
	GITHUB_API_ERROR: "GITHUB_API_ERROR",
	GITHUB_RATE_LIMIT: "GITHUB_RATE_LIMIT",
	GITHUB_AUTH_ERROR: "GITHUB_AUTH_ERROR",

	// Git-related errors
	GIT_OPERATION_FAILED: "GIT_OPERATION_FAILED",
	GIT_CONFLICT: "GIT_CONFLICT",

	// Config errors
	CONFIG_INVALID: "CONFIG_INVALID",
	PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
	WRITE_PROTECTION_ERROR: "WRITE_PROTECTION_ERROR",

	// Budget errors
	BUDGET_EXCEEDED: "BUDGET_EXCEEDED",

	// Security errors
	SECURITY_POLICY_VIOLATION: "SECURITY_POLICY_VIOLATION",
	COMMAND_VALIDATION_FAILED: "COMMAND_VALIDATION_FAILED",

	// Generic errors
	INTERNAL_ERROR: "INTERNAL_ERROR",
	INVALID_INPUT: "INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
