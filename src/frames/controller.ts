/**
 * Frame Emission Controller
 *
 * Controls frame emission based on --emit-frames flag and tracks telemetry.
 * Implements LPR-007 Sub B.4: Frame emission control and metrics.
 */

import type {
  FrameEmitResult,
  MergeWeaveFrameInput,
  ExecutorFrameInput,
  GateFrameInput,
} from "./types.js";
import {
  emitMergeWeaveFrame as emitMergeWeaveFrameInternal,
  emitExecutorFrame as emitExecutorFrameInternal,
  emitGateFrame as emitGateFrameInternal,
  emitProcedureFrame as emitProcedureFrameInternal,
} from "./emitter.js";
import type { ResolveOptions } from "../aliases/index.js";
import {
  measureFrameEmission,
  trackFrameEmissionFailed,
  type FrameEventType,
} from "../telemetry/frames.js";
import { storeFrameResult } from "./storage.js";

/**
 * Global flag to control frame emission
 * Set via --emit-frames CLI flag or LEX_PR_EMIT_FRAMES env var
 */
let frameEmissionEnabled = true;

/**
 * Set whether frame emission is enabled
 */
export function setFrameEmissionEnabled(enabled: boolean): void {
  frameEmissionEnabled = enabled;
}

/**
 * Get whether frame emission is enabled
 */
export function isFrameEmissionEnabled(): boolean {
  return frameEmissionEnabled;
}

/**
 * Controlled frame emission wrapper
 * Checks if emission is enabled and tracks telemetry
 */
async function controlledEmit<T extends FrameEmitResult>(
  eventType: FrameEventType,
  emitFn: () => Promise<T>,
  baseDir?: string
): Promise<T> {
  if (!frameEmissionEnabled) {
    // Return a disabled result without emitting
    trackFrameEmissionFailed(eventType, "disabled");
    return {
      success: false,
      error: "Frame emission is disabled (--no-emit-frames)",
    } as T;
  }

  try {
    const result = await measureFrameEmission(eventType, emitFn);

    // Store the frame if emission was successful
    if (result.success && result.frame && result.frameId) {
      storeFrameResult(result, baseDir);
    }

    return result;
  } catch (error) {
    trackFrameEmissionFailed(eventType, "unknown");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } as T;
  }
}

/**
 * Emit a Frame for merge-weave completion (controlled)
 *
 * @param input - Frame input
 * @param resolveOptions - Optional alias resolution options
 * @returns Promise resolving to frame emit result
 */
export async function emitMergeWeaveFrame(
  input: MergeWeaveFrameInput,
  resolveOptions?: ResolveOptions
): Promise<FrameEmitResult> {
  return controlledEmit(
    "merge-weave",
    () => emitMergeWeaveFrameInternal(input, resolveOptions),
    resolveOptions?.baseDir
  );
}

/**
 * Emit a Frame for executor run completion (controlled)
 *
 * @param input - Frame input
 * @param resolveOptions - Optional alias resolution options
 * @returns Promise resolving to frame emit result
 */
export async function emitExecutorFrame(
  input: ExecutorFrameInput,
  resolveOptions?: ResolveOptions
): Promise<FrameEmitResult> {
  return controlledEmit(
    "executor",
    () => emitExecutorFrameInternal(input, resolveOptions),
    resolveOptions?.baseDir
  );
}

/**
 * Emit a Frame for gate execution (controlled)
 *
 * @param input - Frame input
 * @param baseDir - Optional base directory for storage
 * @returns Promise resolving to frame emit result
 */
export async function emitGateFrame(
  input: GateFrameInput,
  baseDir?: string
): Promise<FrameEmitResult> {
  return controlledEmit("gate", () => emitGateFrameInternal(input), baseDir);
}

/**
 * Emit a Frame for procedure execution (controlled)
 *
 * @param input - Frame input
 * @param resolveOptions - Optional alias resolution options
 * @returns Promise resolving to frame emit result
 */
export async function emitProcedureFrame(
  input: {
    runId: string;
    procedure: string;
    moduleScope: string[];
    durationMs: number;
    outcome: "success" | "failure" | "partial";
    nextActions: string[];
    artifacts?: string[];
    error?: string;
    planHash?: string;
  },
  resolveOptions?: ResolveOptions
): Promise<FrameEmitResult> {
  return controlledEmit(
    "procedure",
    () => emitProcedureFrameInternal(input, resolveOptions),
    resolveOptions?.baseDir
  );
}
