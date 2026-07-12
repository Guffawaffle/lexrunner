/**
 * Runs Module - Public API
 *
 * Re-exports all public types and classes from the runs module.
 */

// Types
export type {
  RunState,
  CreateRunParams,
  RunFilter,
  RunIndexEntry,
  RunIndex,
  StartRunInput,
  GetStatusInput,
  RunStateFile,
} from "./types.js";

export {
  RunStateSchema,
  parseRunState,
  safeParseRunState,
  StartRunInputSchema,
  GetStatusInputSchema,
  RunNotFoundError,
} from "./types.js";

// Status builder
export { buildStatusResponse, getDefaultNextOptions } from "./statusBuilder.js";

// Storage utilities
export {
  getRunsDir,
  ensureRunsDir,
  getRunStatePath,
  getRunDir,
  getIndexPath,
  writeRunState,
  readRunState,
  deleteRunState,
  readIndex,
  writeIndex,
  upsertIndexEntry,
  removeIndexEntry,
  ensureRunDir,
  appendToRunLog,
  readRunLog,
  writeAttributions,
} from "./storage.js";

// Manager
export { RunManager, createRunManager } from "./manager.js";
export type { RunManagerOptions } from "./manager.js";

// Lease-fenced coordinated run application service
export {
  CoordinatedRunManager,
  FileRunProjection,
  InvalidProcedureTransitionError,
  ProcedureUnavailableError,
} from "./coordinated-manager.js";

export { AgentWorkLifecycleService } from "./agent-work-lifecycle-service.js";
export type {
  AgentWorkLifecycleFailure,
  AgentWorkLifecycleResult,
  AgentWorkLifecycleSuccess,
  AgentWorkStatus,
  BoundedAttemptStatus,
  BoundedRunStatus,
  BoundedWorkspaceStatus,
  LifecycleFailureReason,
  LifecyclePhase,
  StartAttemptInput,
} from "./agent-work-lifecycle-service.js";
export type {
  RunProjection,
  ProcedureResolver,
  CoordinatedRunManagerOptions,
  AcquireCoordinatedRunInput,
  RenewCoordinatedRunInput,
  AdvanceCoordinatedRunInput,
  ProjectionResult,
  AdvanceCoordinatedRunResult,
  RebuildProjectionResult,
} from "./coordinated-manager.js";

// Enforcement
export {
  ViolationType,
  ViolationSeverity,
  EnforcementMode,
  ViolationEntrySchema,
  DEFAULT_ENFORCEMENT_CONFIG,
  requiresEnforcement,
  detectGitViolation,
  detectGhViolation,
  detectCiConfigViolation,
  getViolationSeverity,
  logViolation,
  getViolations,
  countViolationsBySeverity,
  generateViolationRiskFlags,
  checkAndLogViolation,
} from "./enforcement.js";

export type { ViolationEntry, EnforcementConfig } from "./enforcement.js";

// Failures - LR-064
export {
  FailureErrorCode,
  isRetryableErrorCode,
  FailureErrorSchema,
  RecommendedActionSchema,
  FailureRecordSchema,
  FailureHandlingPayloadSchema,
  classifyGateError,
  buildRecommendedActions,
  wrapGateFailure,
  logGateFailure,
  getGateFailures,
  toNextOptions,
} from "./failures.js";

export type {
  FailureError,
  RecommendedAction,
  FailureRecord,
  FailureHandlingPayload,
} from "./failures.js";

// Artifacts
export {
  ARTIFACT_TYPES,
  ListArtifactsInputSchema,
  ArtifactDescriptorSchema,
  ListArtifactsOutputSchema,
  getArtifactType,
  matchesPattern,
  listArtifacts,
  getArtifact,
} from "./artifacts.js";

export type {
  ArtifactType,
  ListArtifactsInput,
  ArtifactDescriptor,
  ListArtifactsOutput,
} from "./artifacts.js";

// Decisions - LR-062
export {
  DecisionErrorCodes,
  SubmitDecisionInputSchema,
  SubmitDecisionOutputSchema,
  submitDecision,
  getDecisions,
} from "./decisions.js";

export type { SubmitDecisionInput, SubmitDecisionOutput, DecisionLogEntry } from "./decisions.js";

// Attribution - LR-TSF-001
export type {
  ConstraintSource,
  ConstraintAttribution,
  AttributionLogEntry,
  FrameAttribution,
} from "./attribution.js";

export { AttributionTracker, createAttributionTracker } from "./attribution.js";

// Context - LR-TSF-001
export type { ExecutionContext } from "./context.js";
export { createExecutionContext, logAttribution } from "./context.js";
