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
	// MCP-specific adapters
	mcpToolError,
	planNotFoundError,
	profileNotFoundError,
	configInvalidError,
	writeProtectionError,
	type GateFailureContext,
	type MergeConflictContext,
	type CycleDetectedContext,
	type UnknownDependencyContext,
	type GitHubErrorContext,
	type GitOperationContext,
	type PlanValidationContext,
	type MCPErrorContext,
} from "./adapters.js";

// =============================================================================
// LexRunner-Specific Error Codes
// =============================================================================

/**
 * LexRunner error codes for AX compliance.
 *
 * These are stable identifiers that agents can rely on for error handling.
 * 
 * Format: UPPER_SNAKE_CASE
 * 
 * @example
 * ```typescript
 * // Check for specific error type
 * if (error.code === ErrorCodes.GATE_FAILED) {
 *   console.log("Gate failure:", error.message);
 *   console.log("Recovery actions:", error.nextActions);
 * }
 * ```
 * 
 * @see AX-CONTRACT.md v0.1 for full error handling contract
 */
export const ErrorCodes = {
	// ─────────────────────────────────────────────────────────────────────────
	// Gate-related errors
	// ─────────────────────────────────────────────────────────────────────────
	/** A gate failed during execution (lint, test, build, etc.) */
	GATE_FAILED: "GATE_FAILED",
	/** Requested gate was not found in plan */
	GATE_NOT_FOUND: "GATE_NOT_FOUND",
	/** Gate execution timed out */
	GATE_TIMEOUT: "GATE_TIMEOUT",

	// ─────────────────────────────────────────────────────────────────────────
	// Merge-related errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Git merge conflict detected */
	MERGE_CONFLICT: "MERGE_CONFLICT",
	/** Merge is blocked by policy or dependencies */
	MERGE_BLOCKED: "MERGE_BLOCKED",
	/** Cycle detected in merge dependency graph */
	MERGE_CYCLE_DETECTED: "MERGE_CYCLE_DETECTED",

	// ─────────────────────────────────────────────────────────────────────────
	// Plan-related errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Plan failed schema validation */
	PLAN_VALIDATION_FAILED: "PLAN_VALIDATION_FAILED",
	/** Plan file not found */
	PLAN_NOT_FOUND: "PLAN_NOT_FOUND",
	/** Cycle detected in plan item dependencies */
	PLAN_CYCLE_DETECTED: "PLAN_CYCLE_DETECTED",
	/** Referenced dependency not found in plan */
	UNKNOWN_DEPENDENCY: "UNKNOWN_DEPENDENCY",

	// ─────────────────────────────────────────────────────────────────────────
	// GitHub-related errors
	// ─────────────────────────────────────────────────────────────────────────
	/** GitHub API request failed */
	GITHUB_API_ERROR: "GITHUB_API_ERROR",
	/** GitHub API rate limit exceeded */
	GITHUB_RATE_LIMIT: "GITHUB_RATE_LIMIT",
	/** GitHub authentication failed (invalid/expired token) */
	GITHUB_AUTH_ERROR: "GITHUB_AUTH_ERROR",

	// ─────────────────────────────────────────────────────────────────────────
	// Git-related errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Git operation (checkout, merge, etc.) failed */
	GIT_OPERATION_FAILED: "GIT_OPERATION_FAILED",
	/** Git conflict during operation */
	GIT_CONFLICT: "GIT_CONFLICT",

	// ─────────────────────────────────────────────────────────────────────────
	// Configuration errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Configuration file is invalid */
	CONFIG_INVALID: "CONFIG_INVALID",
	/** Profile directory not found */
	PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
	/** Write operation blocked by profile protection */
	WRITE_PROTECTION_ERROR: "WRITE_PROTECTION_ERROR",

	// ─────────────────────────────────────────────────────────────────────────
	// Resource errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Budget limit exceeded */
	BUDGET_EXCEEDED: "BUDGET_EXCEEDED",

	// ─────────────────────────────────────────────────────────────────────────
	// Security errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Operation violated security policy */
	SECURITY_POLICY_VIOLATION: "SECURITY_POLICY_VIOLATION",
	/** Command failed security validation */
	COMMAND_VALIDATION_FAILED: "COMMAND_VALIDATION_FAILED",

	// ─────────────────────────────────────────────────────────────────────────
	// Generic errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Internal error - unexpected condition */
	INTERNAL_ERROR: "INTERNAL_ERROR",
	/** Invalid input parameters */
	INVALID_INPUT: "INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
