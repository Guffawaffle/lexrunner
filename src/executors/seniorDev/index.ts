/**
 * Senior Dev Executor — Module Index
 *
 * Re-exports all public types and functions for the Senior Dev executor.
 */

// Types
export type {
	PrepareContextInput,
	PrepareContextResult,
	RecallContextInput,
	RecallContextResult,
	CaptureFrameInput,
	CaptureFrameResult,
	CommandResult,
	FramePayload,
	Frame,
	StatusSnapshot,
	RecallQueryType,
	Severity,
	ExecutorMode,
	ModeConfig,
	ArtifactPaths,
} from "./types.js";

// Constants
export { EXECUTOR_MODES } from "./types.js";

// Core functions
export {
	prepareReviewContext,
	recallSeniorDevContext,
	captureSeniorDevFrame,
} from "./core.js";
