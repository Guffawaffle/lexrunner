/**
 * Admin Authority Module
 *
 * Machine-verifiable conditions for D1-deterministic merge authority.
 *
 * @module
 */

// Schema and types
export {
	ApiCondition,
	AuthorCondition,
	AuthorityCondition,
	CIStatusCondition,
	CommandCondition,
	createDefaultAdminAuthorityConfig,
	EnhancedAdminAuthorityConfig,
	EscalationTrigger,
	FilesCondition,
	LabelCondition,
	MergeableCondition,
	parseEnhancedAdminAuthority,
	ReviewCondition,
	safeParseEnhancedAdminAuthority,
} from "./schema.js";
export type { AuthorityEvaluationResult, ConditionResult } from "./schema.js";

// Evaluator
export {
	evaluateAdminAuthority,
	checkEscalationTriggers,
} from "./evaluator.js";
export type {
	CommandExecutor,
	GitHubAPIClient,
	PRContext,
} from "./evaluator.js";
