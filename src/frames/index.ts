/**
 * Frames Module - Public API
 *
 * Re-exports all public types and functions from the frames module.
 * Implements AX-005: Frame emission for core workflows.
 * Implements LPR-007 Sub B.4: Controlled frame emission with --emit-frames flag.
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

// Controlled emission functions (use these for flag-aware emission)
export {
  emitMergeWeaveFrame,
  emitExecutorFrame,
  emitGateFrame,
  emitProcedureFrame,
  setFrameEmissionEnabled,
  isFrameEmissionEnabled,
} from "./controller.js";

// Internal emitter functions (use controller instead for flag support)
export {
  emitMergeWeaveFrame as emitMergeWeaveFrameInternal,
  emitExecutorFrame as emitExecutorFrameInternal,
  emitGateFrame as emitGateFrameInternal,
  emitProcedureFrame as emitProcedureFrameInternal,
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
} from "./storage.js";
