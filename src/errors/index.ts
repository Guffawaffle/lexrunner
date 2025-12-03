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
	// Run lifecycle adapters
	runNotFoundError,
	// Helper for throwing AXErrors
	throwAXError,
	// Weave-specific adapters
	weaveLockConflictError,
	weaveStateInvalidError,
	weavePreflightFailedError,
	// Security-specific adapters
	securityAuthFailedError,
	securityUnauthorizedError,
	securityCommandBlockedError,
	securityComplianceViolationError,
	securitySecretDetectedError,
	securitySecretNotFoundError,
	securitySarifParseError,
	securityScanFailedError,
	type GateFailureContext,
	type MergeConflictContext,
	type CycleDetectedContext,
	type UnknownDependencyContext,
	type GitHubErrorContext,
	type GitOperationContext,
	type PlanValidationContext,
	type MCPErrorContext,
	type RunNotFoundContext,
	type WeaveLockConflictContext,
	type WeaveStateInvalidContext,
	type WeavePreflightFailedContext,
	type SecurityAuthContext,
	type SecurityUnauthorizedContext,
	type SecurityCommandBlockedContext,
	type SecurityComplianceViolationContext,
	type SecuritySecretDetectedContext,
	type SecuritySecretNotFoundContext,
	type SecuritySarifParseErrorContext,
	type SecurityScanFailedContext,
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
	// Weave-related errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Lock file conflict detected (stale or in use) */
	WEAVE_LOCK_CONFLICT: "WEAVE_LOCK_CONFLICT",
	/** Invalid state transition in weave state machine */
	WEAVE_STATE_INVALID: "WEAVE_STATE_INVALID",
	/** Preflight merge simulation failed */
	WEAVE_PREFLIGHT_FAILED: "WEAVE_PREFLIGHT_FAILED",
	/** Merge conflict during weave operation */
	WEAVE_MERGE_CONFLICT: "WEAVE_MERGE_CONFLICT",

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
	// Run lifecycle errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Run not found by runId */
	RUN_NOT_FOUND: "RUN_NOT_FOUND",
	/** Run is already complete and cannot be modified */
	RUN_ALREADY_COMPLETE: "RUN_ALREADY_COMPLETE",
	/** Run state is invalid for the requested operation */
	RUN_STATE_INVALID: "RUN_STATE_INVALID",

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
	/** Authentication failed */
	SECURITY_AUTH_FAILED: "SECURITY_AUTH_FAILED",
	/** User is not authorized for operation */
	SECURITY_UNAUTHORIZED: "SECURITY_UNAUTHORIZED",
	/** Command is blocked by security policy */
	SECURITY_COMMAND_BLOCKED: "SECURITY_COMMAND_BLOCKED",
	/** Operation violates compliance requirements */
	SECURITY_COMPLIANCE_VIOLATION: "SECURITY_COMPLIANCE_VIOLATION",
	/** Secret was detected in content */
	SECURITY_SECRET_DETECTED: "SECURITY_SECRET_DETECTED",
	/** Required secret not found */
	SECURITY_SECRET_NOT_FOUND: "SECURITY_SECRET_NOT_FOUND",
	/** SARIF parsing failed */
	SECURITY_SARIF_PARSE_ERROR: "SECURITY_SARIF_PARSE_ERROR",
	/** Security scan failed */
	SECURITY_SCAN_FAILED: "SECURITY_SCAN_FAILED",

	// ─────────────────────────────────────────────────────────────────────────
	// Generic errors
	// ─────────────────────────────────────────────────────────────────────────
	/** Internal error - unexpected condition */
	INTERNAL_ERROR: "INTERNAL_ERROR",
	/** Invalid input parameters */
	INVALID_INPUT: "INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
