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
