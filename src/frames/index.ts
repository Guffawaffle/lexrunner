/**
 * Frames Module - Public API
 *
 * Re-exports all public types and functions from the frames module.
 * Implements AX-005: Frame emission for core workflows.
 *
 * AX Principle: Memory Is a Feature
 */

// Types
export type {
	ExecutionFrame,
	ExecutionFrameMetadata,
	FrameEmitResult,
	FrameOutcome,
	FrameType,
	MergeWeaveFrameInput,
	ExecutorFrameInput,
	GateFrameInput,
} from "./types.js";

export {
	ExecutionFrameSchema,
	ExecutionFrameMetadataSchema,
	validateExecutionFrame,
	safeValidateExecutionFrame,
} from "./types.js";

// Emitter functions
export {
	emitMergeWeaveFrame,
	emitExecutorFrame,
	emitGateFrame,
	emitProcedureFrame,
} from "./emitter.js";

// Storage functions
export {
	storeFrame,
	storeFrameResult,
	readFrame,
	listFrameIds,
	listFrames,
	deleteFrame,
	getFramesDir,
	ensureFramesDir,
	getFramePath,
} from "./storage.js";
