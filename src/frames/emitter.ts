/**
 * Frame Emitter
 *
 * Utility for emitting Frames capturing workflow execution.
 * Implements AX-005: Frame emission for core workflows.
 * Implements LPR-019: Module aliasing integration.
 * Implements LPR-007 Sub B.4: Idempotent frame emission with content-based hashing.
 *
 * AX Principle: Memory Is a Feature
 */

import { ulid } from "ulid";
import type {
  ExecutionFrame,
  FrameEmitResult,
  MergeWeaveFrameInput,
  ExecutorFrameInput,
  GateFrameInput,
  FrameOutcome,
} from "./types.js";
import { validateExecutionFrame } from "./types.js";
import { resolveModulePaths, extractCanonicalIds, type ResolveOptions } from "../aliases/index.js";
import { sha256 } from "../util/hash.js";
import { readFrame } from "./storage.js";

/**
 * Generate a timestamp string for reference points
 * @internal
 */
function getTimestampForRef(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Generate a short unique suffix for reference points
 * @internal
 */
function getUniqueSuffix(): string {
  return ulid().slice(-6).toLowerCase();
}

/**
 * Compute content hash for frame idempotency
 * Hash inputs: event_type, pr_list/module_scope, timestamp_bucket (day), keywords, outcome
 *
 * @internal
 */
function computeFrameContentHash(
  eventType: string,
  moduleScope: string[],
  timestampBucket: string,
  keywords: string[],
  outcome?: string
): string {
  const content = JSON.stringify({
    event_type: eventType,
    module_scope: moduleScope.sort(), // Sort for consistency
    timestamp_bucket: timestampBucket,
    keywords: keywords.sort(), // Sort for consistency
    outcome: outcome || "unknown", // Include outcome to distinguish success/failure frames
  });
  return sha256(content).slice(0, 16); // Use first 16 chars for brevity
}

/**
 * Check if a frame with the same content hash already exists
 * Returns existing frame data if found, null otherwise
 *
 * @internal
 */
function checkForDuplicateFrame(
  eventType: string,
  contentHash: string,
  timestampBucket: string,
  baseDir?: string
): { frameId: string; frame: any } | null {
  // Construct the expected frame ID pattern
  const frameIdPrefix = `${eventType}-${timestampBucket}-${contentHash}`;

  // Try to read frame with this exact ID
  const existingFrame = readFrame(frameIdPrefix, baseDir);
  if (existingFrame) {
    return {
      frameId: frameIdPrefix,
      frame: existingFrame,
    };
  }
  return null;
}

/**
 * Emit a Frame for merge-weave completion
 *
 * Module paths in mergedPRs are resolved to canonical module IDs via Lex aliasing system.
 * PR numbers (e.g., "#123") are passed through as-is.
 *
 * @param input - Frame input with PR numbers or file paths
 * @param resolveOptions - Optional alias resolution options
 * @returns Promise resolving to frame emit result
 *
 * @example
 * ```typescript
 * const result = await emitMergeWeaveFrame({
 *   runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
 *   mergedPRs: ["#123", "#124"],
 *   conflictsResolved: 2,
 *   gatesPassed: ["lint", "typecheck"],
 *   durationMs: 45000,
 *   outcome: "success",
 *   targetBranch: "main"
 * });
 * ```
 */
export async function emitMergeWeaveFrame(
  input: MergeWeaveFrameInput,
  resolveOptions?: ResolveOptions
): Promise<FrameEmitResult> {
  try {
    const timestamp = getTimestampForRef();
    const suffix = getUniqueSuffix();

    // Resolve module paths to canonical IDs (LPR-019)
    const resolutions = await resolveModulePaths(input.mergedPRs, resolveOptions);
    const canonicalIds = extractCanonicalIds(resolutions);

    // Compute content hash for idempotency (includes outcome to distinguish success/failure)
    const contentHash = computeFrameContentHash(
      "merge-weave",
      canonicalIds,
      timestamp,
      ["merge-weave", "integration", input.targetBranch],
      input.outcome
    );

    // Check for duplicate frame
    const duplicate = checkForDuplicateFrame(
      "merge-weave",
      contentHash,
      timestamp,
      resolveOptions?.baseDir
    );
    if (duplicate) {
      // Return existing frame instead of creating duplicate
      return {
        success: true,
        frame: duplicate.frame,
        frameId: duplicate.frameId,
      };
    }

    const referencePoint = `merge-weave-${timestamp}-${contentHash}`;

    const prList = input.mergedPRs.join(", ");
    const summaryCaption =
      input.outcome === "success"
        ? `Merged ${input.mergedPRs.length} PRs (${prList}) into ${input.targetBranch}`
        : input.outcome === "partial"
          ? `Partially merged PRs (${prList}) into ${input.targetBranch}`
          : `Failed to merge PRs (${prList}) into ${input.targetBranch}`;

    const nextActions: string[] = [];
    if (input.outcome === "success") {
      if (input.gatesPassed.length > 0) {
        nextActions.push("Run e2e tests");
      }
      nextActions.push("Deploy to staging");
      nextActions.push("Verify integration");
    } else if (input.outcome === "partial") {
      nextActions.push("Review partial merge results");
      nextActions.push("Resolve remaining conflicts");
      nextActions.push("Retry merge-weave");
    } else {
      nextActions.push("Review merge failure logs");
      nextActions.push("Resolve conflicts manually");
      nextActions.push("Retry after fixes");
    }

    const frame: ExecutionFrame = {
      type: "merge-weave",
      reference_point: referencePoint,
      summary_caption: summaryCaption,
      module_scope: canonicalIds, // Use canonical IDs (LPR-019)
      keywords: ["merge-weave", "integration", input.targetBranch],
      outcome: input.outcome,
      next_actions: nextActions,
      metadata: {
        duration_ms: input.durationMs,
        conflicts_resolved: input.conflictsResolved,
        gates_passed: input.gatesPassed,
        gates_failed: input.gatesFailed,
        run_id: input.runId,
        plan_hash: input.planHash,
        error: input.error,
        turn_cost: input.turnCost,
        tier_metrics: input.tierMetrics,
      },
    };

    // Validate the frame
    const validated = validateExecutionFrame(frame);

    return {
      success: true,
      frame: validated,
      frameId: referencePoint,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Emit a Frame for executor run completion
 *
 * Module paths in moduleScope are resolved to canonical module IDs via Lex aliasing system.
 *
 * @param input - Frame input with module scope paths
 * @param resolveOptions - Optional alias resolution options
 * @returns Promise resolving to frame emit result
 *
 * @example
 * ```typescript
 * const result = await emitExecutorFrame({
 *   runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
 *   procedure: "deploy-staging",
 *   moduleScope: ["src/api", "src/web"],
 *   durationMs: 120000,
 *   outcome: "success",
 *   nextAction: "Verify deployment"
 * });
 * ```
 */
export async function emitExecutorFrame(
  input: ExecutorFrameInput,
  resolveOptions?: ResolveOptions
): Promise<FrameEmitResult> {
  try {
    const timestamp = getTimestampForRef();
    const suffix = getUniqueSuffix();
    const referencePoint = `executor-${input.procedure}-${timestamp}-${suffix}`;

    // Resolve module paths to canonical IDs (LPR-019)
    const resolutions = await resolveModulePaths(input.moduleScope, resolveOptions);
    const canonicalIds = extractCanonicalIds(resolutions);

    const scopeList = input.moduleScope.join(", ");
    const summaryCaption =
      input.outcome === "success"
        ? `Executed procedure '${input.procedure}' on ${scopeList}`
        : input.outcome === "partial"
          ? `Partially executed procedure '${input.procedure}' on ${scopeList}`
          : `Failed to execute procedure '${input.procedure}' on ${scopeList}`;

    // Build next actions: user-provided action + outcome-based suggestions
    const nextActions: string[] = [input.nextAction];
    if (input.outcome === "success") {
      nextActions.push(`Verify executor ${input.procedure} completion`);
      nextActions.push("Continue to next workflow step");
    } else if (input.outcome === "partial") {
      nextActions.push(`Review partial executor ${input.procedure} results`);
      nextActions.push("Address remaining items");
    } else {
      nextActions.push(`Review executor ${input.procedure} failure logs`);
      nextActions.push("Fix issues and retry");
    }

    const frame: ExecutionFrame = {
      type: "execution",
      reference_point: referencePoint,
      summary_caption: summaryCaption,
      module_scope: canonicalIds, // Use canonical IDs (LPR-019)
      keywords: ["executor", input.procedure, "execution"],
      outcome: input.outcome,
      next_actions: nextActions,
      metadata: {
        duration_ms: input.durationMs,
        artifacts: input.artifacts,
        run_id: input.runId,
        error: input.error,
      },
    };

    // Validate the frame
    const validated = validateExecutionFrame(frame);

    return {
      success: true,
      frame: validated,
      frameId: referencePoint,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Emit a Frame for gate execution
 *
 * @example
 * ```typescript
 * const result = await emitGateFrame({
 *   runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
 *   gateName: "lint",
 *   itemName: "PR-123",
 *   durationMs: 5000,
 *   outcome: "success",
 *   exitCode: 0
 * });
 * ```
 */
export async function emitGateFrame(input: GateFrameInput): Promise<FrameEmitResult> {
  try {
    const timestamp = getTimestampForRef();
    const suffix = getUniqueSuffix();
    const referencePoint = `gate-${input.gateName}-${input.itemName}-${timestamp}-${suffix}`;

    const summaryCaption =
      input.outcome === "success"
        ? `Gate '${input.gateName}' passed for ${input.itemName}`
        : `Gate '${input.gateName}' failed for ${input.itemName}`;

    const nextActions: string[] = [];
    if (input.outcome === "success") {
      nextActions.push("Continue to next gate");
      nextActions.push("Verify gate artifacts");
    } else {
      nextActions.push(`Review ${input.gateName} failure`);
      nextActions.push("Fix issues and re-run gate");
    }

    const frame: ExecutionFrame = {
      type: "gate",
      reference_point: referencePoint,
      summary_caption: summaryCaption,
      module_scope: [input.itemName],
      keywords: ["gate", input.gateName, input.itemName],
      outcome: input.outcome,
      next_actions: nextActions,
      metadata: {
        duration_ms: input.durationMs,
        exit_code: input.exitCode,
        artifacts: input.artifacts,
        run_id: input.runId,
        error: input.error,
      },
    };

    // Validate the frame
    const validated = validateExecutionFrame(frame);

    return {
      success: true,
      frame: validated,
      frameId: referencePoint,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Emit a Frame for procedure execution
 *
 * Module paths in moduleScope are resolved to canonical module IDs via Lex aliasing system.
 *
 * @param input - Frame input with module scope paths
 * @param resolveOptions - Optional alias resolution options
 * @returns Promise resolving to frame emit result
 *
 * @example
 * ```typescript
 * const result = await emitProcedureFrame({
 *   runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
 *   procedure: "release-prepare",
 *   moduleScope: ["v1.0.0"],
 *   durationMs: 30000,
 *   outcome: "success",
 *   nextActions: ["Tag release", "Push to registry"]
 * });
 * ```
 */
export async function emitProcedureFrame(
  input: {
    runId: string;
    procedure: string;
    moduleScope: string[];
    durationMs: number;
    outcome: FrameOutcome;
    nextActions: string[];
    artifacts?: string[];
    error?: string;
    planHash?: string;
  },
  resolveOptions?: ResolveOptions
): Promise<FrameEmitResult> {
  try {
    const timestamp = getTimestampForRef();
    const suffix = getUniqueSuffix();
    const referencePoint = `procedure-${input.procedure}-${timestamp}-${suffix}`;

    // Resolve module paths to canonical IDs (LPR-019)
    const resolutions = await resolveModulePaths(input.moduleScope, resolveOptions);
    const canonicalIds = extractCanonicalIds(resolutions);

    const scopeList = input.moduleScope.join(", ");
    const summaryCaption =
      input.outcome === "success"
        ? `Completed procedure '${input.procedure}' for ${scopeList}`
        : input.outcome === "partial"
          ? `Partially completed procedure '${input.procedure}' for ${scopeList}`
          : `Failed procedure '${input.procedure}' for ${scopeList}`;

    const frame: ExecutionFrame = {
      type: "procedure",
      reference_point: referencePoint,
      summary_caption: summaryCaption,
      module_scope: canonicalIds, // Use canonical IDs (LPR-019)
      keywords: ["procedure", input.procedure],
      outcome: input.outcome,
      next_actions: input.nextActions,
      metadata: {
        duration_ms: input.durationMs,
        artifacts: input.artifacts,
        run_id: input.runId,
        plan_hash: input.planHash,
        error: input.error,
      },
    };

    // Validate the frame
    const validated = validateExecutionFrame(frame);

    return {
      success: true,
      frame: validated,
      frameId: referencePoint,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
