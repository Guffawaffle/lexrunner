/**
 * Model Tier Handoff Metrics - Schema
 *
 * Audit logging and handoff readiness tracking for merge-weave interventions.
 * Enables progressive handoff from frontier models to smaller models.
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// DETERMINISM LEVELS
// =============================================================================

/**
 * Determinism level for interventions
 */
export const DeterminismLevel = z.enum(["D1", "D2", "D3"]);
export type DeterminismLevel = z.infer<typeof DeterminismLevel>;

/**
 * Model tier classification
 */
export const ModelTier = z.enum(["frontier", "mid", "junior", "script"]);
export type ModelTier = z.infer<typeof ModelTier>;

// =============================================================================
// TOKEN USAGE TRACKING
// =============================================================================

/**
 * Token Usage Data Flow (ADR-007):
 * 
 * 1. Snapshot builder calculates `snapshot_tokens` from hint budget
 * 2. Agent reports `search_activity` in receipt → `agent_search_tokens`
 * 3. Receipt includes `output_tokens` from generation
 * 4. Engine verification logs complete TokenUsage to audit entry
 * 
 * This enables future analysis:
 * - "When we provided X tokens of hints, agent used Y fewer search tokens"
 * - Token efficiency trends over time
 * - Persona impact on token usage
 */
export const TokenUsage = z.object({
	/** Tokens from snapshot hint budget (what we provided) */
	snapshot_tokens: z.number().int().nonnegative(),

	/** Additional tokens from agent-initiated search (what agent discovered) */
	agent_search_tokens: z.number().int().nonnegative(),

	/** Output tokens generated */
	output_tokens: z.number().int().nonnegative(),

	/** Total tokens used */
	total: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

// =============================================================================
// INTERVENTION AUDIT ENTRY
// =============================================================================

/**
 * Single audit log entry for an intervention
 */
export const InterventionAuditEntry = z.object({
	/** Intervention ID (e.g., INT-007) */
	intervention_id: z.string().regex(/^INT-\d{3}$/),

	/** Human-readable intervention name */
	intervention_name: z.string(),

	/** Determinism level */
	determinism_level: DeterminismLevel,

	/** Model tier that executed this intervention */
	model_tier_used: ModelTier,

	/** Whether the intervention succeeded */
	success: z.boolean(),

	/** Whether human override was required */
	required_human_override: z.boolean().default(false),

	/** Time to complete in milliseconds */
	time_to_complete_ms: z.number().int().nonnegative(),

	/** ISO timestamp */
	timestamp: z.string().datetime(),

	/** Run ID for correlation */
	run_id: z.string().optional(),

	/** Repository context */
	repo: z.string().optional(),

	/** Error message if failed */
	error_message: z.string().optional(),

	/** Additional context */
	context: z.record(z.string(), z.any()).optional(),

	/** Token usage tracking (optional, backward compatible) */
	token_usage: TokenUsage.optional(),

	/** Task ID if linked to task snapshot contract */
	task_id: z.string().optional(),

	/** Snapshot hash if linked to task snapshot */
	snapshot_hash: z.string().optional(),
});
export type InterventionAuditEntry = z.infer<typeof InterventionAuditEntry>;

// =============================================================================
// HANDOFF READINESS
// =============================================================================

/**
 * Intervention success statistics
 */
export const InterventionStats = z.object({
	intervention_id: z.string(),
	intervention_name: z.string(),
	determinism_level: DeterminismLevel,
	total_executions: z.number().int().nonnegative(),
	successful_executions: z.number().int().nonnegative(),
	success_rate: z.number().min(0).max(1),
	human_overrides: z.number().int().nonnegative(),
	avg_time_ms: z.number().nonnegative(),
});
export type InterventionStats = z.infer<typeof InterventionStats>;

/**
 * Tier readiness assessment
 */
export const TierReadiness = z.object({
	tier: ModelTier,
	determinism_level: DeterminismLevel,
	ready: z.boolean(),
	success_rate: z.number().min(0).max(1),
	target_rate: z.number().min(0).max(1),
	successful_runs: z.number().int().nonnegative(),
	required_runs: z.number().int().nonnegative(),
	blocking_interventions: z.array(z.string()),
});
export type TierReadiness = z.infer<typeof TierReadiness>;

/**
 * Handoff readiness report
 */
export const HandoffReadinessReport = z.object({
	/** Report generation timestamp */
	generated_at: z.string().datetime(),

	/** Total interventions analyzed */
	total_interventions: z.number().int().nonnegative(),

	/** Interventions by level */
	by_level: z.object({
		D1: z.object({
			count: z.number().int().nonnegative(),
			success_rate: z.number().min(0).max(1),
			ready_for_handoff: z.boolean(),
		}),
		D2: z.object({
			count: z.number().int().nonnegative(),
			success_rate: z.number().min(0).max(1),
			ready_for_handoff: z.boolean(),
		}),
		D3: z.object({
			count: z.number().int().nonnegative(),
			success_rate: z.number().min(0).max(1),
			ready_for_handoff: z.literal(false), // D3 is frontier-only by design
		}),
	}),

	/** Per-intervention statistics */
	intervention_stats: z.array(InterventionStats),

	/** Tier readiness assessments */
	tier_readiness: z.array(TierReadiness),

	/** Recommendations */
	recommendations: z.array(z.string()),
});
export type HandoffReadinessReport = z.infer<typeof HandoffReadinessReport>;

// =============================================================================
// HANDOFF THRESHOLDS
// =============================================================================

/**
 * Default handoff thresholds
 */
export const HandoffThresholds = z.object({
	/** Minimum success rate for D1 handoff to junior/script tier */
	d1_min_success_rate: z.number().min(0).max(1).default(0.99),

	/** Minimum success rate for D2 handoff to mid tier */
	d2_min_success_rate: z.number().min(0).max(1).default(0.95),

	/** Minimum successful runs before handoff */
	min_successful_runs: z.number().int().positive().default(10),

	/** Maximum human override rate */
	max_human_override_rate: z.number().min(0).max(1).default(0.05),
});
export type HandoffThresholds = z.infer<typeof HandoffThresholds>;

/**
 * Default thresholds
 */
export const DEFAULT_HANDOFF_THRESHOLDS: HandoffThresholds = {
	d1_min_success_rate: 0.99,
	d2_min_success_rate: 0.95,
	min_successful_runs: 10,
	max_human_override_rate: 0.05,
};

// =============================================================================
// INTERVENTION CATALOG
// =============================================================================

/**
 * Intervention definition
 */
export const InterventionDefinition = z.object({
	id: z.string().regex(/^INT-\d{3}$/),
	name: z.string(),
	description: z.string(),
	determinism_level: DeterminismLevel,
	target_tier: ModelTier,
	handoff_ready: z.boolean(),
	policy_path: z.string().optional(),
	blocking_factors: z.array(z.string()).optional(),
});
export type InterventionDefinition = z.infer<typeof InterventionDefinition>;

/**
 * Built-in intervention catalog from merge-weave-interventions.md
 */
export const INTERVENTION_CATALOG: InterventionDefinition[] = [
	// Discovery Phase
	{
		id: "INT-001",
		name: "PR Discovery",
		description: "List open PRs across configured repos",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "discovery.repos",
	},
	{
		id: "INT-002",
		name: "Draft PR Handling",
		description: "Decide whether to undraft PRs before merge",
		determinism_level: "D1",
		target_tier: "junior",
		handoff_ready: true,
		policy_path: "discovery.draft_policy",
	},
	{
		id: "INT-003",
		name: "PR Filtering",
		description: "Include/exclude Dependabot, Copilot, human PRs",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "discovery.filters",
	},

	// Dependency Resolution
	{
		id: "INT-004",
		name: "Explicit Dependency Parsing",
		description: "Parse Depends-on footer from PR body",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "dependencies.resolution.depends_on_footer",
	},
	{
		id: "INT-005",
		name: "Cross-Repo Ordering",
		description: "Apply implicit order (lex → lexsona → lexrunner)",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "discovery.repos.priority",
	},
	{
		id: "INT-006",
		name: "Heuristic Dependency Detection",
		description: "Infer dependencies from file overlap, imports",
		determinism_level: "D3",
		target_tier: "frontier",
		handoff_ready: false,
		policy_path: "dependencies.resolution.heuristic_detection",
		blocking_factors: ["Requires semantic understanding"],
	},

	// Quality Gates
	{
		id: "INT-007",
		name: "Base Branch Verification",
		description: "Run install/build/test on main before merging",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "gates.base_branch.required",
	},
	{
		id: "INT-008",
		name: "CI Status Check",
		description: "Verify PR CI is green before merge",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "gates.per_pr.require_ci_green",
	},
	{
		id: "INT-009",
		name: "Conventional Commit Validation",
		description: "Verify PR title follows conventional commits",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "gates.per_pr.review_checklist.conventional_commit_title",
	},
	{
		id: "INT-010",
		name: "Code Quality Assessment",
		description: "Review diff for bugs, patterns, security issues",
		determinism_level: "D3",
		target_tier: "frontier",
		handoff_ready: false,
		policy_path: "gates.per_pr.quality_assessment",
		blocking_factors: ["Requires code understanding"],
	},

	// Merge Execution
	{
		id: "INT-011",
		name: "Squash Merge",
		description: "Execute squash merge with PR title as commit",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "merge.method",
	},
	{
		id: "INT-012",
		name: "Admin Authority Decision",
		description: "Decide whether to use admin merge",
		determinism_level: "D2",
		target_tier: "mid",
		handoff_ready: true,
		policy_path: "merge.admin_authority.conditions",
	},
	{
		id: "INT-013",
		name: "Conflict Resolution",
		description: "Resolve merge conflicts per merge-policy.yml",
		determinism_level: "D1",
		target_tier: "junior",
		handoff_ready: true,
		policy_path: "merge-policy.yml",
	},

	// Post-Merge
	{
		id: "INT-014",
		name: "Pull and Verify",
		description: "Git pull, rebuild, run tests",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "post_merge.pull_and_verify",
	},
	{
		id: "INT-015",
		name: "Tool Count Assertion Fix",
		description: "Update test assertions when MCP tools added",
		determinism_level: "D2",
		target_tier: "mid",
		handoff_ready: true,
		policy_path: "post_merge.auto_fix.patterns",
	},
	{
		id: "INT-016",
		name: "Environment-Dependent Test Fix",
		description: "Add explicit paths to avoid env-specific behavior",
		determinism_level: "D2",
		target_tier: "mid",
		handoff_ready: false,
		policy_path: "post_merge.auto_fix.patterns",
		blocking_factors: ["Pattern match is D1, correct fix is D2"],
	},
	{
		id: "INT-017",
		name: "Fix Commit and Push",
		description: "Commit post-merge fixes and push to main",
		determinism_level: "D1",
		target_tier: "script",
		handoff_ready: true,
		policy_path: "post_merge.commit_fixes",
	},

	// Fanout
	{
		id: "INT-018",
		name: "Follow-up Work Suggestion",
		description:
			"Identify what new work is needed based on merged features",
		determinism_level: "D1",
		target_tier: "junior",
		handoff_ready: true,
		policy_path: "fanout.suggestions.triggers",
	},
	{
		id: "INT-019",
		name: "Issue Creation",
		description: "Create well-formed GitHub issues for follow-up work",
		determinism_level: "D1",
		target_tier: "junior",
		handoff_ready: true,
		policy_path: ".smartergpt/fanout-templates.yml",
	},
];

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse an audit entry
 */
export function parseAuditEntry(data: unknown): InterventionAuditEntry {
	return InterventionAuditEntry.parse(data);
}

/**
 * Safe parse an audit entry
 */
export function safeParseAuditEntry(data: unknown) {
	return InterventionAuditEntry.safeParse(data);
}

/**
 * Parse a handoff readiness report
 */
export function parseHandoffReport(data: unknown): HandoffReadinessReport {
	return HandoffReadinessReport.parse(data);
}

/**
 * Get intervention by ID
 */
export function getInterventionById(
	id: string
): InterventionDefinition | undefined {
	return INTERVENTION_CATALOG.find((i) => i.id === id);
}

/**
 * Get interventions by level
 */
export function getInterventionsByLevel(
	level: DeterminismLevel
): InterventionDefinition[] {
	return INTERVENTION_CATALOG.filter((i) => i.determinism_level === level);
}

// =============================================================================
// TOKEN USAGE HELPERS
// =============================================================================

/**
 * Compute token usage from snapshot and receipt
 */
export function computeTokenUsage(
	snapshotTokens: number,
	searchTokens: number,
	outputTokens: number
): TokenUsage {
	return {
		snapshot_tokens: snapshotTokens,
		agent_search_tokens: searchTokens,
		output_tokens: outputTokens,
		total: snapshotTokens + searchTokens + outputTokens,
	};
}

/**
 * Create audit entry with token tracking
 */
export function createAuditEntryWithTokens(
	base: Omit<
		z.infer<typeof InterventionAuditEntry>,
		"token_usage" | "task_id" | "snapshot_hash"
	>,
	tokenUsage: TokenUsage,
	taskId?: string,
	snapshotHash?: string
): z.infer<typeof InterventionAuditEntry> {
	return {
		...base,
		token_usage: tokenUsage,
		task_id: taskId,
		snapshot_hash: snapshotHash,
	};
}
