/**
 * Execution Frame Types
 *
 * Types for capturing workflow execution as Frames for memory integration.
 * Implements AX-005: Frame emission for core workflows.
 *
 * AX Principle: Memory Is a Feature
 */

import { z } from "zod";

/**
 * Frame outcome status
 */
export type FrameOutcome = "success" | "failure" | "partial";

/**
 * Frame type for workflow classification
 */
export type FrameType = "execution" | "merge-weave" | "gate" | "procedure";

/**
 * Execution Frame metadata schema
 */
export const ExecutionFrameMetadataSchema = z.object({
  /** Duration in milliseconds */
  duration_ms: z.number().optional(),
  /** Number of conflicts resolved during merge-weave */
  conflicts_resolved: z.number().optional(),
  /** List of gates that passed */
  gates_passed: z.array(z.string()).optional(),
  /** List of gates that failed */
  gates_failed: z.array(z.string()).optional(),
  /** Artifacts produced */
  artifacts: z.array(z.string()).optional(),
  /** Error message if applicable */
  error: z.string().optional(),
  /** Exit code if applicable */
  exit_code: z.number().optional(),
  /** Run ID for correlation */
  run_id: z.string().optional(),
  /** Plan hash for idempotency */
  plan_hash: z.string().optional(),
  /** Turn Cost tracking data */
  turn_cost: z
    .object({
      /** Turn Cost components */
      components: z.object({
        latencyMs: z.number(),
        contextResetTokens: z.number(),
        renegotiationCount: z.number(),
        tokenBloat: z.number(),
        attentionSwitchCount: z.number(),
      }),
      /** Weighted score */
      weightedScore: z.number(),
      /** Number of events recorded */
      eventCount: z.number(),
      /** Prior run score for comparison */
      priorRunScore: z.number().optional(),
      /** Improvement percentage */
      improvement: z.string().optional(),
    })
    .optional(),
  /** Tier metrics for governance (Claim 3.4) */
  tier_metrics: z
    .object({
      totalTasks: z.number(),
      byTier: z.object({
        senior: z.number(),
        mid: z.number(),
        junior: z.number(),
      }),
      escalations: z.number(),
      mismatches: z.number(),
      tierMatchRate: z.number(),
      escalationRate: z.number(),
    })
    .optional(),
  /** Constraint attributions (LR-TSF-001) */
  governed_by: z
    .array(
      z.object({
        /** Constraint identifier */
        constraintId: z.string(),
        /** Source of the constraint */
        source: z.enum(["baseline", "persona", "learned"]),
        /** Action that was governed */
        action: z.string(),
      })
    )
    .optional(),
});

export type ExecutionFrameMetadata = z.infer<typeof ExecutionFrameMetadataSchema>;

/**
 * Execution Frame schema
 *
 * Represents what was attempted, scope touched, outcome, and recommended next steps.
 */
export const ExecutionFrameSchema = z.object({
  /** Frame type for classification */
  type: z.enum(["execution", "merge-weave", "gate", "procedure"]),
  /** Unique reference point (e.g., "merge-weave-2025-12-01-abc123") */
  reference_point: z.string(),
  /** Summary of what was attempted */
  summary_caption: z.string(),
  /** PR numbers or scope touched */
  module_scope: z.array(z.string()),
  /** Keywords for searchability */
  keywords: z.array(z.string()),
  /** Outcome of the execution */
  outcome: z.enum(["success", "failure", "partial"]),
  /** Recommended next steps */
  next_actions: z.array(z.string()),
  /** Additional metadata */
  metadata: ExecutionFrameMetadataSchema.optional(),
});

export type ExecutionFrame = z.infer<typeof ExecutionFrameSchema>;

/**
 * Input for emitting a merge-weave completion Frame
 */
export interface MergeWeaveFrameInput {
  /** Run ID for correlation */
  runId: string;
  /** PRs that were merged */
  mergedPRs: string[];
  /** Number of conflicts resolved */
  conflictsResolved: number;
  /** Gates that passed */
  gatesPassed: string[];
  /** Gates that failed (if any) */
  gatesFailed?: string[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Outcome of the merge-weave */
  outcome: FrameOutcome;
  /** Target branch */
  targetBranch: string;
  /** Error message if failed */
  error?: string;
  /** Plan hash for idempotency */
  planHash?: string;
  /** Turn Cost tracking data */
  turnCost?: {
    components: {
      latencyMs: number;
      contextResetTokens: number;
      renegotiationCount: number;
      tokenBloat: number;
      attentionSwitchCount: number;
    };
    weightedScore: number;
    eventCount: number;
    priorRunScore?: number;
    improvement?: string;
  };
  /** Tier metrics for governance (Claim 3.4) */
  tierMetrics?: {
    totalTasks: number;
    byTier: {
      senior: number;
      mid: number;
      junior: number;
    };
    escalations: number;
    mismatches: number;
    tierMatchRate: number;
    escalationRate: number;
  };
  /** Constraint attributions (LR-TSF-001) */
  governedBy?: Array<{
    constraintId: string;
    source: "baseline" | "persona" | "learned";
    action: string;
  }>;
}

/**
 * Input for emitting an executor run Frame
 */
export interface ExecutorFrameInput {
  /** Run ID for correlation */
  runId: string;
  /** Procedure that was executed */
  procedure: string;
  /** Module scope touched */
  moduleScope: string[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Outcome of the execution */
  outcome: FrameOutcome;
  /** Next recommended action */
  nextAction: string;
  /** Artifacts produced */
  artifacts?: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Input for emitting a gate execution Frame
 */
export interface GateFrameInput {
  /** Run ID for correlation */
  runId: string;
  /** Gate name */
  gateName: string;
  /** Item/node that the gate ran for */
  itemName: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Outcome of the gate */
  outcome: FrameOutcome;
  /** Exit code */
  exitCode?: number;
  /** Artifacts collected */
  artifacts?: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Result of Frame emission
 */
export interface FrameEmitResult {
  /** Whether the Frame was emitted successfully */
  success: boolean;
  /** The emitted Frame (if successful) */
  frame?: ExecutionFrame;
  /** Frame ID (if stored via Lex) */
  frameId?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Validate an execution frame
 */
export function validateExecutionFrame(frame: unknown): ExecutionFrame {
  return ExecutionFrameSchema.parse(frame);
}

/**
 * Safely validate an execution frame
 */
export function safeValidateExecutionFrame(
  frame: unknown
): { success: true; data: ExecutionFrame } | { success: false; error: z.ZodError } {
  const result = ExecutionFrameSchema.safeParse(frame);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
