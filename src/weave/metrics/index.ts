/**
 * Model Tier Handoff Metrics Module
 *
 * Provides audit logging and handoff readiness tracking for merge-weave interventions.
 * Enables progressive handoff from frontier models to smaller models.
 *
 * @module
 */

// Schema and types
export {
	DeterminismLevel,
	ModelTier,
	TokenUsage,
	InterventionAuditEntry,
	InterventionStats,
	TierReadiness,
	HandoffReadinessReport,
	HandoffThresholds,
	InterventionDefinition,
	DEFAULT_HANDOFF_THRESHOLDS,
	INTERVENTION_CATALOG,
	parseAuditEntry,
	safeParseAuditEntry,
	parseHandoffReport,
	getInterventionById,
	getInterventionsByLevel,
	computeTokenUsage,
	createAuditEntryWithTokens,
} from "./schema.js";

// Logger
export {
	AuditLogger,
	InterventionTracker,
	createAuditLogger,
} from "./logger.js";
export type { AuditLoggerOptions, LogInterventionOptions } from "./logger.js";

// Calculator
export {
	calculateInterventionStats,
	calculateAllStats,
	calculateLevelStats,
	assessTierReadiness,
	generateHandoffReport,
	formatHandoffReport,
} from "./calculator.js";
