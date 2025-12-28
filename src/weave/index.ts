/**
 * Weave module exports - cluster execution, gates, and PR utilities
 */

export {
  executeClusterWithGates,
  type ClusterContext,
  type ClusterExecutionResult,
  type ClusterFailureBundle,
} from "./clusterGates.js";

export {
  createDraftPRForFailure,
  createFailureBranch,
  pushFailureBranch,
  type DraftPROptions,
  type DraftPRResult,
} from "./draftPR.js";

export {
  WeaveState,
  WeaveEvent,
  type StateTransition,
  type WeaveContext,
  type BatchState,
  type WeaveLockFile,
  type PreflightResults,
  type DryRunOutput,
} from "./types.js";

// Policy-based merge-weave infrastructure
export * from "./policy/index.js";
export * from "./planner/index.js";
export * from "./executor/index.js";
export * from "./fanout/index.js";
export * from "./authority/index.js";

// Audit module - explicit exports to avoid conflicts with metrics module
export {
  createAuditEmitter,
  type MergeWeaveAuditEntry,
  type PlanEvent,
  type SummaryEvent,
} from "./audit/index.js";

// Metrics module - explicit exports to avoid conflicts with policy module
// DeterminismLevel and ModelTier are already exported from policy
export {
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
  AuditLogger,
  InterventionTracker,
  createAuditLogger,
  calculateInterventionStats,
  calculateAllStats,
  calculateLevelStats,
  assessTierReadiness,
  generateHandoffReport,
  formatHandoffReport,
} from "./metrics/index.js";
export type { AuditLoggerOptions, LogInterventionOptions } from "./metrics/index.js";

export { WeaveStateMachine } from "./stateMachine.js";

// ADR-007: Task snapshot contract integration
export {
  GateFailureHandler,
  type GateFailureContext,
  type GateFailureHandlingResult,
  type ReceiptProcessingResult,
} from "./gateFailureHandler.js";
