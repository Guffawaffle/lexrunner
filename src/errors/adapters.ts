/**
 * AXError Adapters for LexRunner Errors
 *
 * Converts existing LexRunner error types to AX-compliant format
 * with appropriate nextActions for agent recovery.
 *
 * @module errors/adapters
 */

import { createAXError, type AXError } from "@smartergpt/lex/errors";
import { ErrorCodes } from "./index.js";

// =============================================================================
// Gate Error Adapters
// =============================================================================

export interface GateFailureContext {
	gate: string;
	item?: string;
	pr?: number;
	exitCode?: number;
	artifactPath?: string;
}

/**
 * Create an AXError for a gate failure
 */
export function gateFailedError(ctx: GateFailureContext): AXError {
	const nextActions: string[] = [];

	if (ctx.artifactPath) {
		nextActions.push(`Check gate output in ${ctx.artifactPath}`);
	}

	// Gate-specific suggestions
	switch (ctx.gate) {
		case "lint":
			nextActions.push("Run 'npm run lint' locally to reproduce");
			nextActions.push("Fix lint errors and push again");
			break;
		case "typecheck":
			nextActions.push("Run 'npm run typecheck' locally to reproduce");
			nextActions.push("Fix TypeScript errors and push again");
			break;
		case "test":
			nextActions.push("Run 'npm test' locally to reproduce");
			nextActions.push("Check for flaky tests or missing test fixtures");
			break;
		default:
			nextActions.push(`Run the '${ctx.gate}' gate locally to reproduce`);
	}

	if (nextActions.length === 0) {
		nextActions.push("Review the gate failure output for details");
	}

	return createAXError(
		ErrorCodes.GATE_FAILED,
		`Gate '${ctx.gate}'${ctx.item ? ` failed for ${ctx.item}` : " failed"}`,
		nextActions,
		{ ...ctx }
	);
}

// =============================================================================
// Merge Error Adapters
// =============================================================================

export interface MergeConflictContext {
	item?: string;
	pr?: number;
	files?: string[];
	targetBranch?: string;
}

/**
 * Create an AXError for a merge conflict
 */
export function mergeConflictError(ctx: MergeConflictContext): AXError {
	const nextActions: string[] = [
		"Resolve conflicts manually in the affected files",
	];

	if (ctx.targetBranch) {
		nextActions.push(
			`Rebase ${ctx.item || "the PR"} on ${ctx.targetBranch}`
		);
	} else {
		nextActions.push("Rebase on the latest target branch");
	}

	if (ctx.files && ctx.files.length > 0) {
		nextActions.push(`Affected files: ${ctx.files.join(", ")}`);
	}

	return createAXError(
		ErrorCodes.MERGE_CONFLICT,
		`Merge conflict${ctx.item ? ` for ${ctx.item}` : ""}`,
		nextActions,
		{ ...ctx }
	);
}

export interface CycleDetectedContext {
	cycle: string[];
}

/**
 * Create an AXError for a cycle in the dependency graph
 */
export function cycleDetectedError(ctx: CycleDetectedContext): AXError {
	return createAXError(
		ErrorCodes.PLAN_CYCLE_DETECTED,
		`Dependency cycle detected: ${ctx.cycle.join(" → ")}`,
		[
			"Review the dependency declarations in the affected PRs",
			"Remove or restructure dependencies to break the cycle",
			`Cycle path: ${ctx.cycle.join(" → ")}`,
		],
		{ ...ctx }
	);
}

export interface UnknownDependencyContext {
	item: string;
	dependency: string;
	availableItems?: string[];
}

/**
 * Create an AXError for an unknown dependency
 */
export function unknownDependencyError(ctx: UnknownDependencyContext): AXError {
	const nextActions: string[] = [
		`Check that '${ctx.dependency}' is included in the plan`,
		`Verify the dependency reference in '${ctx.item}'`,
	];

	if (ctx.availableItems && ctx.availableItems.length > 0) {
		nextActions.push(`Available items: ${ctx.availableItems.join(", ")}`);
	}

	return createAXError(
		ErrorCodes.UNKNOWN_DEPENDENCY,
		`Item '${ctx.item}' depends on unknown item '${ctx.dependency}'`,
		nextActions,
		{ ...ctx }
	);
}

// =============================================================================
// GitHub Error Adapters
// =============================================================================

export interface GitHubErrorContext {
	status?: number;
	endpoint?: string;
	message?: string;
	retryAfter?: number;
}

/**
 * Create an AXError for GitHub API errors
 */
export function githubApiError(ctx: GitHubErrorContext): AXError {
	const nextActions: string[] = [];

	if (ctx.status === 401 || ctx.status === 403) {
		return createAXError(
			ErrorCodes.GITHUB_AUTH_ERROR,
			ctx.message || "GitHub authentication failed",
			[
				"Check that GITHUB_TOKEN is set and valid",
				"Verify the token has required permissions",
				"Try: gh auth status",
			],
			{ ...ctx }
		);
	}

	if (ctx.status === 429 || ctx.retryAfter) {
		const waitTime = ctx.retryAfter
			? `${ctx.retryAfter} seconds`
			: "a few minutes";
		return createAXError(
			ErrorCodes.GITHUB_RATE_LIMIT,
			"GitHub API rate limit exceeded",
			[
				`Wait ${waitTime} before retrying`,
				"Consider using a GitHub App token for higher limits",
				"Reduce API call frequency",
			],
			{ ...ctx }
		);
	}

	nextActions.push("Check the GitHub API status page");
	if (ctx.endpoint) {
		nextActions.push(`Failed endpoint: ${ctx.endpoint}`);
	}
	nextActions.push("Retry the operation after a brief wait");

	return createAXError(
		ErrorCodes.GITHUB_API_ERROR,
		ctx.message || "GitHub API request failed",
		nextActions,
		{ ...ctx }
	);
}

// =============================================================================
// Git Operation Error Adapters
// =============================================================================

export interface GitOperationContext {
	operation: string;
	message?: string;
	command?: string;
}

/**
 * Create an AXError for git operation failures
 */
export function gitOperationError(ctx: GitOperationContext): AXError {
	return createAXError(
		ErrorCodes.GIT_OPERATION_FAILED,
		ctx.message || `Git ${ctx.operation} failed`,
		[
			"Check git status for uncommitted changes",
			"Ensure you're on the correct branch",
			ctx.command
				? `Command that failed: ${ctx.command}`
				: "Review git output for details",
		],
		{ ...ctx }
	);
}

// =============================================================================
// Plan Error Adapters
// =============================================================================

export interface PlanValidationContext {
	errors: string[];
	planPath?: string;
}

/**
 * Create an AXError for plan validation failures
 */
export function planValidationError(ctx: PlanValidationContext): AXError {
	const nextActions: string[] = [
		"Review the plan file for schema violations",
	];

	if (ctx.planPath) {
		nextActions.push(`Plan file: ${ctx.planPath}`);
	}

	nextActions.push(`Errors: ${ctx.errors.join("; ")}`);

	return createAXError(
		ErrorCodes.PLAN_VALIDATION_FAILED,
		`Plan validation failed with ${ctx.errors.length} error(s)`,
		nextActions,
		{ ...ctx }
	);
}

// =============================================================================
// Generic Error Adapter
// =============================================================================

/**
 * Convert any Error to an AXError with generic recovery suggestions.
 * Use specific adapters when possible for better nextActions.
 */
export function toAXError(
	error: Error,
	code: string = ErrorCodes.INTERNAL_ERROR,
	nextActions?: string[]
): AXError {
	return createAXError(
		code,
		error.message,
		nextActions || [
			"Review the error details and retry",
			"Check logs for more context",
		],
		{
			originalError: error.name,
			stack: error.stack?.split("\n").slice(0, 3),
		}
	);
}

// =============================================================================
// MCP-Specific Error Adapters
// =============================================================================

export interface MCPErrorContext {
	tool: string;
	operation?: string;
	details?: Record<string, unknown>;
}

/**
 * Create an AXError for MCP tool failures.
 * This provides structured errors for MCP clients including AI agents.
 *
 * @param code - Error code (should be from ErrorCodes for type safety, but string is accepted for extensibility)
 * @param message - Human-readable error message
 * @param ctx - MCP error context containing tool name and optional details
 * @param nextActions - Optional array of recovery actions; if not provided, tool-specific defaults are used
 */
export function mcpToolError(
	code: string,
	message: string,
	ctx: MCPErrorContext,
	nextActions?: string[]
): AXError {
	const actions: string[] = nextActions || [];

	// Add tool-specific recovery suggestions if none provided
	if (actions.length === 0) {
		switch (ctx.tool) {
			case "plan.create":
				actions.push(
					"Check if configuration files exist in the profile directory"
				);
				actions.push(
					"Run 'local.init' to create missing configuration"
				);
				break;
			case "gates.run":
				actions.push(
					"Ensure plan.json exists - run 'plan.create' first"
				);
				actions.push("Check gate commands are valid and available");
				break;
			case "merge.apply":
				actions.push(
					"Set ALLOW_MUTATIONS=true to enable merge operations"
				);
				actions.push("Use dryRun=true to preview without mutations");
				break;
			case "discover":
				actions.push("Check GITHUB_TOKEN is set and valid");
				actions.push("Provide owner and repo parameters explicitly");
				break;
			case "status":
				actions.push("Ensure plan.json exists");
				actions.push("Run 'plan.create' to generate a plan");
				break;
			case "merge-order":
				actions.push("Ensure plan.json exists and is valid");
				actions.push("Check for dependency cycles in the plan");
				break;
			default:
				actions.push("Review the error details and retry");
				actions.push("Check MCP server logs for more context");
		}
	}

	return createAXError(code, message, actions, {
		tool: ctx.tool,
		operation: ctx.operation,
		...ctx.details,
	});
}

/**
 * Create an AXError for plan not found errors
 */
export function planNotFoundError(planFile?: string): AXError {
	return createAXError(
		ErrorCodes.PLAN_NOT_FOUND,
		planFile
			? `Plan file not found: ${planFile}`
			: "No plan found. Run plan.create first.",
		[
			"Run 'plan.create' to generate a plan",
			planFile
				? `Check if ${planFile} exists and is accessible`
				: "Ensure plan.json exists in the profile runner directory",
		],
		{ planFile }
	);
}

/**
 * Create an AXError for profile not found errors
 */
export function profileNotFoundError(profileDir?: string): AXError {
	return createAXError(
		ErrorCodes.PROFILE_NOT_FOUND,
		profileDir
			? `Profile directory not found: ${profileDir}`
			: "No profile directory found",
		[
			"Run 'local.init' to create a local profile",
			"Set LEX_PR_PROFILE_DIR environment variable",
			"Ensure .smartergpt/ or .smartergpt.local/ exists",
		],
		{ profileDir }
	);
}

/**
 * Create an AXError for configuration errors
 */
export function configInvalidError(
	message: string,
	details?: Record<string, unknown>
): AXError {
	return createAXError(
		ErrorCodes.CONFIG_INVALID,
		message,
		[
			"Check configuration file syntax",
			"Ensure all required fields are present",
			"Validate against the schema with 'lex-pr schema validate'",
		],
		details
	);
}

/**
 * Create an AXError for write protection errors
 */
export function writeProtectionError(
	message: string,
	operation?: string
): AXError {
	return createAXError(
		ErrorCodes.WRITE_PROTECTION_ERROR,
		message,
		[
			"Use a local overlay profile (.smartergpt.local/) for write operations",
			"Set role to 'local' or 'ci' in manifest.yaml",
			"Run 'local.init' to create a writable profile",
		],
		{ operation }
	);
}

// =============================================================================
// Run Lifecycle Error Adapters
// =============================================================================

export interface RunNotFoundContext {
	runId: string;
}

/**
 * Create an AXError for run not found errors
 */
export function runNotFoundError(ctx: RunNotFoundContext): AXError {
	return createAXError(
		ErrorCodes.RUN_NOT_FOUND,
		`Run not found: ${ctx.runId}`,
		[
			"List available runs with: lex-pr runs list",
			"Check .lexrunner/runs/ directory for artifacts",
		],
		{ runId: ctx.runId }
	);
}

// =============================================================================
// Helper for throwing AXErrors
// =============================================================================

import { AXErrorException } from "@smartergpt/lex/errors";

/**
 * Throw an AXError as an exception
 *
 * @param axError - The AXError to throw
 * @throws AXErrorException with the AXError data
 */
export function throwAXError(axError: AXError): never {
	throw new AXErrorException(
		axError.code,
		axError.message,
		axError.nextActions,
		axError.context
	);
}

// =============================================================================
// Weave Error Adapters
// =============================================================================

export interface WeaveLockConflictContext {
	lockFile?: string;
	expectedVersion?: string;
	actualVersion?: string;
	originalError?: string;
}

/**
 * Create an AXError for weave lock file conflicts
 */
export function weaveLockConflictError(ctx: WeaveLockConflictContext): AXError {
	const nextActions: string[] = [];

	if (ctx.lockFile) {
		nextActions.push(`Remove stale lock with: rm ${ctx.lockFile}`);
	} else {
		nextActions.push("Remove stale lock file: rm weave-lock.json");
	}

	nextActions.push("Wait for other weave operation to complete");
	nextActions.push("Verify no concurrent weave processes are running");

	return createAXError(
		ErrorCodes.WEAVE_LOCK_CONFLICT,
		ctx.originalError || "Lock file conflict detected",
		nextActions,
		{ ...ctx }
	);
}

export interface WeaveStateInvalidContext {
	currentState: string;
	event: string;
	availableEvents?: string[];
}

/**
 * Create an AXError for invalid weave state transitions
 */
export function weaveStateInvalidError(ctx: WeaveStateInvalidContext): AXError {
	const nextActions: string[] = [
		`Check current weave state: '${ctx.currentState}'`,
		"Review available transitions for current state",
	];

	if (ctx.availableEvents && ctx.availableEvents.length > 0) {
		nextActions.push(
			`Valid events for current state: ${ctx.availableEvents.join(", ")}`
		);
	}

	nextActions.push("Use 'reset' event to return to idle state if stuck");

	return createAXError(
		ErrorCodes.WEAVE_STATE_INVALID,
		`Invalid transition: cannot apply event '${ctx.event}' in state '${ctx.currentState}'`,
		nextActions,
		{ ...ctx }
	);
}

export interface WeavePreflightFailedContext {
	itemBranch: string;
	targetBranch?: string;
	originalError?: string;
}

/**
 * Create an AXError for preflight merge simulation failures
 */
export function weavePreflightFailedError(
	ctx: WeavePreflightFailedContext
): AXError {
	const nextActions: string[] = [
		`Verify branch '${ctx.itemBranch}' exists locally or on remote`,
	];

	if (ctx.targetBranch) {
		nextActions.push(`Verify target branch '${ctx.targetBranch}' exists`);
	}

	nextActions.push("Run 'git fetch' to update remote references");
	nextActions.push("Check git repository status with 'git status'");

	return createAXError(
		ErrorCodes.WEAVE_PREFLIGHT_FAILED,
		`Failed to simulate merge for ${ctx.itemBranch}${
			ctx.originalError ? `: ${ctx.originalError}` : ""
		}`,
		nextActions,
		{ ...ctx }
	);
}
