/**
 * Admin Authority Condition Schema
 *
 * Zod schemas for machine-verifiable admin authority conditions.
 * Enables D1-deterministic merge authority decisions.
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// CONDITION TYPES
// =============================================================================

/**
 * Command-based condition: run a shell command and check exit code
 */
export const CommandCondition = z.object({
	type: z.literal("command"),
	/** Command to execute */
	command: z.string().min(1),
	/** Expected exit code for success (default: 0) */
	success_exit_code: z.number().int().default(0),
	/** Timeout in seconds */
	timeout_seconds: z.number().int().min(1).default(300),
	/** Working directory (optional) */
	cwd: z.string().optional(),
});
export type CommandCondition = z.infer<typeof CommandCondition>;

/**
 * API-based condition: call GitHub API and evaluate response
 */
export const ApiCondition = z.object({
	type: z.literal("api"),
	/** API endpoint path (supports {owner}, {repo}, {pr} placeholders) */
	endpoint: z.string().min(1),
	/** JavaScript expression to evaluate against response */
	condition: z.string().min(1),
	/** HTTP method (default: GET) */
	method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
});
export type ApiCondition = z.infer<typeof ApiCondition>;

/**
 * Label-based condition: check PR labels
 */
export const LabelCondition = z.object({
	type: z.literal("label"),
	/** Labels that must be absent for condition to pass */
	labels_absent: z.array(z.string()).optional(),
	/** Labels that must be present for condition to pass */
	labels_present: z.array(z.string()).optional(),
});
export type LabelCondition = z.infer<typeof LabelCondition>;

/**
 * Author-based condition: check PR author
 */
export const AuthorCondition = z.object({
	type: z.literal("author"),
	/** Authors for which this condition applies */
	allowed_authors: z.array(z.string()).optional(),
	/** Author types: 'bot', 'user' */
	allowed_types: z.array(z.enum(["bot", "user"])).optional(),
});
export type AuthorCondition = z.infer<typeof AuthorCondition>;

/**
 * Files-based condition: check touched files
 */
export const FilesCondition = z.object({
	type: z.literal("files"),
	/** Glob patterns that, if matched, require escalation */
	escalate_patterns: z.array(z.string()).optional(),
	/** Glob patterns that are always safe */
	safe_patterns: z.array(z.string()).optional(),
});
export type FilesCondition = z.infer<typeof FilesCondition>;

/**
 * CI Status condition: check GitHub CI status
 */
export const CIStatusCondition = z.object({
	type: z.literal("ci_status"),
	/** Required check names that must pass */
	required_checks: z.array(z.string()).optional(),
	/** If true, all checks must pass */
	all_checks_pass: z.boolean().default(false),
	/** Allow pending checks */
	allow_pending: z.boolean().default(false),
});
export type CIStatusCondition = z.infer<typeof CIStatusCondition>;

/**
 * Mergeable condition: check GitHub mergeable state
 */
export const MergeableCondition = z.object({
	type: z.literal("mergeable"),
	/** Required mergeable state */
	require_mergeable: z.boolean().default(true),
	/** Blocked mergeable_state values */
	blocked_states: z.array(z.string()).default(["dirty", "blocked"]),
	/** Retry if state is unknown */
	retry_on_unknown: z.boolean().default(true),
	/** Max retries for unknown state */
	max_retries: z.number().int().default(3),
	/** Retry delay in seconds */
	retry_delay_seconds: z.number().int().default(5),
});
export type MergeableCondition = z.infer<typeof MergeableCondition>;

/**
 * Review condition: check review status
 */
export const ReviewCondition = z.object({
	type: z.literal("review"),
	/** Require no pending review requests */
	no_pending_requests: z.boolean().default(true),
	/** Require at least N approvals (0 = disabled) */
	min_approvals: z.number().int().min(0).default(0),
	/** Block if any reviews request changes */
	block_on_changes_requested: z.boolean().default(false),
});
export type ReviewCondition = z.infer<typeof ReviewCondition>;

/**
 * Union of all condition types
 */
export const AuthorityCondition = z.discriminatedUnion("type", [
	CommandCondition,
	ApiCondition,
	LabelCondition,
	AuthorCondition,
	FilesCondition,
	CIStatusCondition,
	MergeableCondition,
	ReviewCondition,
]);
export type AuthorityCondition = z.infer<typeof AuthorityCondition>;

// =============================================================================
// ESCALATION RULES
// =============================================================================

/**
 * Escalation trigger configuration
 */
export const EscalationTrigger = z.object({
	/** Label that triggers escalation if present */
	label_present: z.string().optional(),
	/** Author patterns that trigger escalation */
	author_not_in: z.array(z.string()).optional(),
	/** File patterns that trigger escalation */
	files_touched_pattern: z.array(z.string()).optional(),
	/** Escalation message */
	reason: z.string().optional(),
});
export type EscalationTrigger = z.infer<typeof EscalationTrigger>;

// =============================================================================
// ENHANCED ADMIN AUTHORITY CONFIG
// =============================================================================

/**
 * Enhanced admin authority configuration with verifiable conditions
 */
export const EnhancedAdminAuthorityConfig = z.object({
	/** Whether admin authority is enabled */
	enabled: z.boolean().default(true),
	/** Conditions that must all pass */
	conditions: z.array(AuthorityCondition).default([]),
	/** Triggers that force escalation to human */
	escalate_if: z.array(EscalationTrigger).optional(),
	/** Retry configuration for flaky conditions */
	retry: z
		.object({
			max_attempts: z.number().int().min(1).default(2),
			backoff_seconds: z.number().int().min(1).default(5),
		})
		.optional(),
});
export type EnhancedAdminAuthorityConfig = z.infer<
	typeof EnhancedAdminAuthorityConfig
>;

// =============================================================================
// EVALUATION RESULT TYPES
// =============================================================================

/**
 * Result of evaluating a single condition
 */
export interface ConditionResult {
	/** Condition type */
	type: AuthorityCondition["type"];
	/** Whether the condition passed */
	passed: boolean;
	/** Human-readable message */
	message: string;
	/** Additional details for debugging */
	details?: Record<string, unknown>;
	/** Time taken to evaluate (ms) */
	duration_ms: number;
}

/**
 * Result of evaluating all conditions for admin authority
 */
export interface AuthorityEvaluationResult {
	/** Whether authority is granted */
	authority_granted: boolean;
	/** Conditions that passed */
	conditions_met: string[];
	/** Conditions that failed */
	conditions_failed: string[];
	/** Whether escalation to human is required */
	escalation_required: boolean;
	/** Reason for escalation if required */
	escalation_reason?: string;
	/** Individual condition results */
	condition_results: ConditionResult[];
	/** Total evaluation time (ms) */
	total_duration_ms: number;
	/** Timestamp of evaluation */
	evaluated_at: string;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse enhanced admin authority config
 */
export function parseEnhancedAdminAuthority(
	data: unknown
): EnhancedAdminAuthorityConfig {
	return EnhancedAdminAuthorityConfig.parse(data);
}

/**
 * Safely parse enhanced admin authority config
 */
export function safeParseEnhancedAdminAuthority(data: unknown) {
	return EnhancedAdminAuthorityConfig.safeParse(data);
}

/**
 * Create a default D1 admin authority configuration
 */
export function createDefaultAdminAuthorityConfig(): EnhancedAdminAuthorityConfig {
	return {
		enabled: true,
		conditions: [
			{
				type: "mergeable",
				require_mergeable: true,
				blocked_states: ["dirty", "blocked"],
				retry_on_unknown: true,
				max_retries: 3,
				retry_delay_seconds: 5,
			},
			{
				type: "review",
				no_pending_requests: true,
				min_approvals: 0,
				block_on_changes_requested: false,
			},
			{
				type: "label",
				labels_absent: [
					"do-not-merge",
					"wip",
					"blocked",
					"needs-discussion",
				],
			},
			{
				type: "ci_status",
				all_checks_pass: false, // We run local CI
				allow_pending: true,
			},
		],
		escalate_if: [
			{
				label_present: "needs-human-review",
				reason: "PR has needs-human-review label",
			},
			{
				files_touched_pattern: ["**/security/**", "**/auth/**"],
				reason: "PR touches security-sensitive files",
			},
		],
		retry: {
			max_attempts: 2,
			backoff_seconds: 5,
		},
	};
}
