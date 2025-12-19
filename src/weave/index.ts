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
export * from "./audit/index.js";
export * from "./fanout/index.js";

export { WeaveStateMachine } from "./stateMachine.js";
