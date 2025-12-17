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

export { WeaveStateMachine } from "./stateMachine.js";
