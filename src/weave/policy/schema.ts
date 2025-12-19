/**
 * Merge-Weave Policy Schema
 *
 * Zod schema for validating merge-weave-policy.yml
 * This defines the contract for deterministic merge-weave execution.
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// DETERMINISM LEVELS
// =============================================================================

export const DeterminismLevel = z.enum(["D1", "D2", "D3"]);
export type DeterminismLevel = z.infer<typeof DeterminismLevel>;

// =============================================================================
// DISCOVERY PHASE
// =============================================================================

export const RepoConfig = z.object({
	owner: z.string().min(1),
	name: z.string().min(1),
	priority: z.number().int().min(1).default(1),
});
export type RepoConfig = z.infer<typeof RepoConfig>;

export const PRFilters = z.object({
	include_drafts: z.boolean().default(false),
	include_dependabot: z.boolean().default(true),
	include_copilot: z.boolean().default(true),
});
export type PRFilters = z.infer<typeof PRFilters>;

export const DraftPolicy = z.object({
	undraft_copilot_prs: z.boolean().default(true),
	undraft_with_prefix: z.array(z.string()).default([]),
	require_manual_for: z.array(z.string()).default([]),
});
export type DraftPolicy = z.infer<typeof DraftPolicy>;

export const DiscoveryConfig = z.object({
	repos: z.array(RepoConfig).min(1),
	filters: PRFilters.optional(),
	draft_policy: DraftPolicy.optional(),
});
export type DiscoveryConfig = z.infer<typeof DiscoveryConfig>;

// =============================================================================
// DEPENDENCY RESOLUTION
// =============================================================================

export const DependencyResolution = z.object({
	depends_on_footer: z.boolean().default(true),
	footer_pattern: z.string().optional(),
	cross_repo_chain: z.boolean().default(true),
	heuristic_detection: z.boolean().default(false),
});
export type DependencyResolution = z.infer<typeof DependencyResolution>;

export const DependencyConfig = z.object({
	resolution: DependencyResolution.optional(),
	on_cycle: z.enum(["fail", "warn", "ignore"]).default("fail"),
	on_missing_dep: z.enum(["fail", "warn", "ignore"]).default("warn"),
});
export type DependencyConfig = z.infer<typeof DependencyConfig>;

// =============================================================================
// QUALITY GATES
// =============================================================================

export const GateDefinition = z.object({
	name: z.string().min(1),
	command: z.string().min(1),
	determinism: DeterminismLevel.optional(),
	timeout_seconds: z.number().int().min(1).optional(),
	when: z.enum(["always", "available"]).optional(),
});
export type GateDefinition = z.infer<typeof GateDefinition>;

export const BaseBranchGates = z.object({
	required: z.array(GateDefinition).optional(),
	optional: z.array(GateDefinition).optional(),
});
export type BaseBranchGates = z.infer<typeof BaseBranchGates>;

// Review checklist: array of { key: boolean } objects
export const ReviewChecklistItem = z.record(z.string(), z.boolean());
export type ReviewChecklistItem = z.infer<typeof ReviewChecklistItem>;

export const QualityAssessment = z.object({
	enabled: z.boolean().default(true),
	criteria: z.array(z.string()).optional(),
	action_on_concern: z.enum(["warn", "block", "auto-fix"]).optional(),
});
export type QualityAssessment = z.infer<typeof QualityAssessment>;

export const PerPRGates = z.object({
	require_ci_green: z.boolean().default(true),
	review_checklist: z.array(ReviewChecklistItem).optional(),
	quality_assessment: QualityAssessment.optional(),
});
export type PerPRGates = z.infer<typeof PerPRGates>;

export const GatesConfig = z.object({
	base_branch: BaseBranchGates.optional(),
	per_pr: PerPRGates.optional(),
});
export type GatesConfig = z.infer<typeof GatesConfig>;

// =============================================================================
// MERGE EXECUTION
// =============================================================================

export const CommitTitleConfig = z.object({
	use_pr_title: z.boolean().default(true),
	validate_conventional: z.boolean().default(true),
});
export type CommitTitleConfig = z.infer<typeof CommitTitleConfig>;

export const AdminAuthorityCondition = z.object({
	local_ci_passes: z.boolean().optional(),
	no_open_review_requests: z.boolean().optional(),
	no_merge_conflicts: z.boolean().optional(),
});
export type AdminAuthorityCondition = z.infer<typeof AdminAuthorityCondition>;

export const AdminAuthorityConfig = z.object({
	enabled: z.boolean().default(true),
	conditions: z.array(AdminAuthorityCondition).optional(),
});
export type AdminAuthorityConfig = z.infer<typeof AdminAuthorityConfig>;

export const UmbrellaConfig = z.object({
	enabled: z.boolean().default(false),
	branch_pattern: z.string().optional(),
	auto_create: z.boolean().default(true),
});
export type UmbrellaConfig = z.infer<typeof UmbrellaConfig>;

export const MergeConfig = z.object({
	method: z.enum(["squash", "merge", "rebase"]).default("squash"),
	commit_title: CommitTitleConfig.optional(),
	admin_authority: AdminAuthorityConfig.optional(),
	umbrella: UmbrellaConfig.optional(),
});
export type MergeConfig = z.infer<typeof MergeConfig>;

// =============================================================================
// POST-MERGE VERIFICATION
// =============================================================================

export const PullAndVerifyConfig = z.object({
	enabled: z.boolean().default(true),
	gates: z.array(z.string()).optional(),
});
export type PullAndVerifyConfig = z.infer<typeof PullAndVerifyConfig>;

export const AutoFixPattern = z.object({
	pattern: z.string().min(1),
	action: z.string().min(1),
	determinism: DeterminismLevel.optional(),
});
export type AutoFixPattern = z.infer<typeof AutoFixPattern>;

export const AutoFixConfig = z.object({
	enabled: z.boolean().default(true),
	patterns: z.array(AutoFixPattern).optional(),
	escalate_on: z.array(z.string()).optional(),
});
export type AutoFixConfig = z.infer<typeof AutoFixConfig>;

export const CommitFixesConfig = z.object({
	enabled: z.boolean().default(true),
	message_template: z.string().optional(),
	require_green_before_push: z.boolean().default(true),
});
export type CommitFixesConfig = z.infer<typeof CommitFixesConfig>;

export const PostMergeConfig = z.object({
	pull_and_verify: PullAndVerifyConfig.optional(),
	auto_fix: AutoFixConfig.optional(),
	commit_fixes: CommitFixesConfig.optional(),
});
export type PostMergeConfig = z.infer<typeof PostMergeConfig>;

// =============================================================================
// FANOUT PLANNING
// =============================================================================

export const FanoutTrigger = z.object({
	type: z.string().min(1),
	pattern: z.string().min(1),
	suggest: z.string().min(1),
});
export type FanoutTrigger = z.infer<typeof FanoutTrigger>;

export const FanoutSuggestions = z.object({
	enabled: z.boolean().default(true),
	triggers: z.array(FanoutTrigger).optional(),
});
export type FanoutSuggestions = z.infer<typeof FanoutSuggestions>;

export const FanoutConfig = z.object({
	suggestions: FanoutSuggestions.optional(),
	escalate_to_pm: z.array(z.string()).optional(),
});
export type FanoutConfig = z.infer<typeof FanoutConfig>;

// =============================================================================
// MODEL TIER HANDOFF
// =============================================================================

export const ModelTier = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	handles: z.array(z.string()).optional(),
	current: z.boolean().optional(),
	ready_when: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type ModelTier = z.infer<typeof ModelTier>;

export const AuditConfig = z.object({
	enabled: z.boolean().default(true),
	log_path: z.string().optional(),
	fields: z.array(z.string()).optional(),
});
export type AuditConfig = z.infer<typeof AuditConfig>;

export const ModelHandoffConfig = z.object({
	tiers: z.array(ModelTier).optional(),
	audit: AuditConfig.optional(),
});
export type ModelHandoffConfig = z.infer<typeof ModelHandoffConfig>;

// =============================================================================
// ROOT POLICY SCHEMA
// =============================================================================

export const MergeWeavePolicy = z.object({
	version: z.number().int().min(1).default(1),
	schemaVersion: z
		.string()
		.regex(/^\d+\.\d+\.\d+$/)
		.default("1.0.0"),
	discovery: DiscoveryConfig,
	dependencies: DependencyConfig.optional(),
	gates: GatesConfig.optional(),
	merge: MergeConfig.optional(),
	post_merge: PostMergeConfig.optional(),
	fanout: FanoutConfig.optional(),
	model_handoff: ModelHandoffConfig.optional(),
});
export type MergeWeavePolicy = z.infer<typeof MergeWeavePolicy>;

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse and validate a merge-weave policy
 * @throws ZodError if validation fails
 */
export function parseMergeWeavePolicy(data: unknown): MergeWeavePolicy {
	return MergeWeavePolicy.parse(data);
}

/**
 * Safely parse a merge-weave policy
 * @returns Success result with data or error result with issues
 */
export function safeParseMergeWeavePolicy(data: unknown) {
	return MergeWeavePolicy.safeParse(data);
}

/**
 * Validate schema version compatibility
 */
export function validatePolicyVersion(policy: MergeWeavePolicy): void {
	const [major] = policy.schemaVersion.split(".").map(Number);
	if (major !== 1) {
		throw new Error(
			`Incompatible policy schema version: ${policy.schemaVersion}. ` +
				`This runner only supports major version 1.`
		);
	}
}
