/**
 * Run-Centric Schemas for Tool-Grounded Interactions
 *
 * This module defines the canonical Zod schemas for StatusResponse and NextOption,
 * which structure all tool-grounded interactions in the lex-pr-runner system.
 *
 * Key invariants:
 * - `nextOptions` is the ONLY canonical source of allowed next actions
 * - Models should never invent actions outside of `nextOptions`
 * - `summary` must be a single sentence that orients quickly
 */

import { z } from "zod";

/**
 * PersonaSnapshot Schema
 *
 * Captures the current persona mode and its constraints at a point in time.
 *
 * @example
 * ```typescript
 * const snapshot: PersonaSnapshot = {
 *   mode: "senior-dev",
 *   forbidden: ["force-push", "delete-branch"],
 *   completionGates: ["lint", "test", "build"],
 *   decisionStyle: {
 *     preferSmallDiffs: true,
 *     requireRationaleForSkips: true,
 *     escalateSecurityFindings: true
 *   }
 * };
 * ```
 */
export const PersonaSnapshotSchema = z.object({
	/** Persona mode identifier, e.g. "senior-dev", "reviewer", "security-auditor" */
	mode: z.string(),
	/** Actions that are forbidden under this persona */
	forbidden: z.array(z.string()),
	/** Gates that must pass before completion */
	completionGates: z.array(z.string()),
	/** Decision-making style preferences */
	decisionStyle: z.object({
		/** Prefer small, incremental diffs over large changes */
		preferSmallDiffs: z.boolean().optional(),
		/** Require explicit rationale when skipping steps */
		requireRationaleForSkips: z.boolean().optional(),
		/** Escalate security findings to higher attention */
		escalateSecurityFindings: z.boolean().optional()
	}).optional(),
	/** Output formatting preferences */
	outputFormat: z.object({
		/** Severity levels for findings, e.g. ["critical", "high", "medium", "low"] */
		severityLevels: z.array(z.string()).optional(),
		/** Whether findings must include a severity level */
		requireSeverityOnFindings: z.boolean().optional()
	}).optional()
});

export type PersonaSnapshot = z.infer<typeof PersonaSnapshotSchema>;

/**
 * NextOption Schema
 *
 * Represents a single action option available to the caller.
 * This is the canonical way to present allowed next actions.
 *
 * @example
 * ```typescript
 * const option: NextOption = {
 *   action: "merge_next",
 *   description: "Merge the next PR in the dependency chain.",
 *   requiresLLMDecision: false,
 *   riskLevel: "low"
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Decision point requiring LLM input
 * const decisionOption: NextOption = {
 *   action: "resolve_conflict",
 *   description: "Resolve merge conflict in src/cli.ts.",
 *   requiresLLMDecision: true,
 *   prompt: "Review the conflict markers and choose the correct resolution.",
 *   responseSchema: { type: "object", properties: { resolution: { type: "string" } } },
 *   objective: "Preserve functionality from both branches",
 *   constraints: ["Do not remove existing tests", "Maintain backwards compatibility"],
 *   style: "detailed",
 *   riskLevel: "medium"
 * };
 * ```
 */
export const NextOptionSchema = z.object({
	/** Action identifier, e.g. "merge_next", "abort_run", "resolve_conflict" */
	action: z.string(),
	/** Verb-first description, at most one sentence */
	description: z.string(),

	// Decision point fields
	/** Whether this action requires an LLM decision */
	requiresLLMDecision: z.boolean().optional(),
	/** Prompt to present to the LLM for decision-making */
	prompt: z.string().optional(),
	/** JSON Schema describing the expected response format */
	responseSchema: z.record(z.string(), z.unknown()).optional(),

	// Guidance
	/** The objective to achieve with this action */
	objective: z.string().optional(),
	/** Constraints that must be respected */
	constraints: z.array(z.string()).optional(),
	/** Output style preference */
	style: z.enum(["brief", "detailed"]).optional(),
	/** Risk level assessment for this action */
	riskLevel: z.enum(["low", "medium", "high"]).optional()
});

export type NextOption = z.infer<typeof NextOptionSchema>;

/**
 * StatusResponse Schema
 *
 * The canonical response format for run status queries.
 * Contains full context for orientation and available actions.
 *
 * @example
 * ```typescript
 * const status: StatusResponse = {
 *   runId: "01HXYZ123ABC",
 *   state: "gated",
 *   mode: "senior-dev",
 *   procedure: "merge-weave-main",
 *   summary: "Waiting for lint gate to pass on PR #42.",
 *   progress: {
 *     completed: ["fetch-prs", "analyze-deps"],
 *     current: "run-gates",
 *     remaining: ["merge-prs", "cleanup"]
 *   },
 *   nextOptions: [
 *     {
 *       action: "retry_gate",
 *       description: "Retry the failing lint gate.",
 *       riskLevel: "low"
 *     },
 *     {
 *       action: "skip_gate",
 *       description: "Skip the lint gate and continue.",
 *       requiresLLMDecision: true,
 *       prompt: "Provide rationale for skipping the lint gate.",
 *       riskLevel: "medium"
 *     }
 *   ],
 *   blockers: ["lint gate failing"],
 *   riskFlags: ["unstable-ci"]
 * };
 * ```
 */
export const StatusResponseSchema = z.object({
	/** Unique run identifier */
	runId: z.string(),

	// Core run identity
	/** Current state, e.g. "planning", "gated", "executing", "completed", "failed" */
	state: z.string(),
	/** Persona mode, e.g. "senior-dev" */
	mode: z.string(),
	/** Procedure identifier, e.g. "merge-weave-main" */
	procedure: z.string(),

	// Human-readable recap
	/** Single sentence orientation summary */
	summary: z.string(),

	// Progress tracking
	/** Progress information with completed, current, and remaining steps */
	progress: z.object({
		/** List of completed step identifiers */
		completed: z.array(z.string()),
		/** Current step identifier, or null if between steps */
		current: z.string().nullable(),
		/** List of remaining step identifiers */
		remaining: z.array(z.string())
	}).optional(),

	// Canonical action set
	/** Available next actions - the ONLY source of allowed actions */
	nextOptions: z.array(NextOptionSchema),

	// Additional context
	/** Additional context as key-value pairs */
	context: z.record(z.string(), z.unknown()).optional(),
	/** Risk flags for the current state */
	riskFlags: z.array(z.string()).optional(),
	/** Blocking issues that prevent progress */
	blockers: z.array(z.string()).optional(),

	// Persona snapshot
	/** Snapshot of the active persona configuration */
	persona: PersonaSnapshotSchema.optional()
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

/**
 * Validation error with helpful context
 */
export interface RunCentricValidationError {
	path: string;
	message: string;
	code: string;
	suggestion?: string;
}

/**
 * Format Zod issues into user-friendly validation errors
 */
function formatValidationErrors(error: z.ZodError): RunCentricValidationError[] {
	return error.issues.map(issue => {
		const path = issue.path.join('.');
		let suggestion: string | undefined;

		// Provide helpful suggestions based on error type and path
		if (issue.code === 'invalid_type') {
			if (path === 'runId') {
				suggestion = 'Must be a non-empty string identifier';
			} else if (path === 'state') {
				suggestion = 'Valid states: "planning", "gated", "executing", "completed", "failed"';
			} else if (path === 'summary') {
				suggestion = 'Must be a single sentence string';
			} else if (path.includes('nextOptions')) {
				suggestion = 'Must be an array of NextOption objects';
			}
		} else if (issue.code === 'invalid_value') {
			if (path.includes('riskLevel')) {
				suggestion = 'Valid values: "low", "medium", "high"';
			} else if (path.includes('style')) {
				suggestion = 'Valid values: "brief", "detailed"';
			}
		}

		return {
			path: path || 'root',
			message: issue.message,
			code: issue.code,
			suggestion
		};
	});
}

/**
 * Parse and validate a StatusResponse object.
 *
 * @param data - The data to validate
 * @returns The validated StatusResponse
 * @throws {z.ZodError} If validation fails
 *
 * @example
 * ```typescript
 * try {
 *   const status = parseStatusResponse(rawData);
 *   console.log(`Run ${status.runId} is ${status.state}`);
 * } catch (error) {
 *   console.error('Invalid status response:', error);
 * }
 * ```
 */
export function parseStatusResponse(data: unknown): StatusResponse {
	return StatusResponseSchema.parse(data);
}

/**
 * Safely parse a StatusResponse, returning a result object.
 *
 * @param data - The data to validate
 * @returns Success with data, or failure with error details
 *
 * @example
 * ```typescript
 * const result = safeParseStatusResponse(rawData);
 * if (result.success) {
 *   console.log(result.data.summary);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function safeParseStatusResponse(data: unknown): {
	success: true;
	data: StatusResponse;
} | {
	success: false;
	errors: RunCentricValidationError[];
} {
	const result = StatusResponseSchema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return {
		success: false,
		errors: formatValidationErrors(result.error)
	};
}

/**
 * Parse and validate a NextOption object.
 *
 * @param data - The data to validate
 * @returns The validated NextOption
 * @throws {z.ZodError} If validation fails
 *
 * @example
 * ```typescript
 * try {
 *   const option = parseNextOption(rawOption);
 *   console.log(`Action: ${option.action} - ${option.description}`);
 * } catch (error) {
 *   console.error('Invalid next option:', error);
 * }
 * ```
 */
export function parseNextOption(data: unknown): NextOption {
	return NextOptionSchema.parse(data);
}

/**
 * Safely parse a NextOption, returning a result object.
 *
 * @param data - The data to validate
 * @returns Success with data, or failure with error details
 *
 * @example
 * ```typescript
 * const result = safeParseNextOption(rawOption);
 * if (result.success) {
 *   console.log(`Available action: ${result.data.action}`);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function safeParseNextOption(data: unknown): {
	success: true;
	data: NextOption;
} | {
	success: false;
	errors: RunCentricValidationError[];
} {
	const result = NextOptionSchema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return {
		success: false,
		errors: formatValidationErrors(result.error)
	};
}

/**
 * Parse and validate a PersonaSnapshot object.
 *
 * @param data - The data to validate
 * @returns The validated PersonaSnapshot
 * @throws {z.ZodError} If validation fails
 */
export function parsePersonaSnapshot(data: unknown): PersonaSnapshot {
	return PersonaSnapshotSchema.parse(data);
}

/**
 * Safely parse a PersonaSnapshot, returning a result object.
 *
 * @param data - The data to validate
 * @returns Success with data, or failure with error details
 */
export function safeParsePersonaSnapshot(data: unknown): {
	success: true;
	data: PersonaSnapshot;
} | {
	success: false;
	errors: RunCentricValidationError[];
} {
	const result = PersonaSnapshotSchema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return {
		success: false,
		errors: formatValidationErrors(result.error)
	};
}
