/**
 * Policy Module
 *
 * Public API for merge-weave policy management.
 *
 * @module
 */

// Schema exports
export {
	// Determinism
	DeterminismLevel,
	// Discovery
	RepoConfig,
	PRFilters,
	DraftPolicy,
	DiscoveryConfig,
	// Dependencies
	DependencyResolution,
	DependencyConfig,
	// Gates
	GateDefinition,
	BaseBranchGates,
	ReviewChecklistItem,
	QualityAssessment,
	PerPRGates,
	GatesConfig,
	// Merge
	CommitTitleConfig,
	AdminAuthorityCondition,
	AdminAuthorityConfig,
	UmbrellaConfig,
	MergeConfig,
	// Post-merge
	PullAndVerifyConfig,
	AutoFixPattern,
	AutoFixConfig,
	CommitFixesConfig,
	PostMergeConfig,
	// Fanout
	FanoutTrigger,
	FanoutSuggestions,
	FanoutConfig,
	// Model handoff
	ModelTier,
	AuditConfig,
	ModelHandoffConfig,
	// Root
	MergeWeavePolicy,
	// Helpers
	parseMergeWeavePolicy,
	safeParseMergeWeavePolicy,
	validatePolicyVersion,
} from "./schema.js";

// Loader exports
export {
	loadPolicy,
	loadPolicyOrNull,
	PolicyLoadError,
	type LoadPolicyOptions,
	type LoadPolicyResult,
} from "./loader.js";
