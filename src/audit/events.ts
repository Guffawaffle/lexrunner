/**
 * Audit event types and schemas
 */

import { z } from "zod";

/**
 * Event severity level
 */
export type EventLevel = "info" | "warn" | "error";

/**
 * Tool information
 */
export const ToolSchema = z.object({
  name: z.string(),
  version: z.string(),
});

export type Tool = z.infer<typeof ToolSchema>;

/**
 * Actor information
 */
export const ActorSchema = z.object({
  type: z.enum(["cli", "mcp", "ci"]),
});

export type Actor = z.infer<typeof ActorSchema>;

/**
 * Repository context
 */
export const RepoSchema = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
  commit: z.string().optional(),
});

export type Repo = z.infer<typeof RepoSchema>;

/**
 * Context blocks
 */
export const ContextSchema = z.object({
  git: z.record(z.string(), z.any()).optional(),
  ci: z.record(z.string(), z.any()).optional(),
  os: z.record(z.string(), z.any()).optional(),
});

export type Context = z.infer<typeof ContextSchema>;

/**
 * Event envelope schema
 */
export const EventEnvelopeSchema = z.object({
  schema_version: z.string(),
  event: z.string(),
  ts: z.string(),
  level: z.enum(["info", "warn", "error"]),
  session_id: z.string(),
  run_id: z.string(),
  tool: ToolSchema,
  actor: ActorSchema,
  repo: RepoSchema,
  context: ContextSchema.optional(),
  lock_hash: z.string().optional(), // Lock hash for merge-weave idempotency
  payload: z.any(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Command invocation payload
 */
export const CommandInvocationPayloadSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
});

/**
 * Plan discovered payload
 */
export const PlanDiscoveredPayloadSchema = z.object({
  pr_ids: z.array(z.union([z.string(), z.number()])),
  base: z.string(),
  head: z.string(),
  plan_hash: z.string(),
});

/**
 * Plan validated payload
 */
export const PlanValidatedPayloadSchema = z.object({
  schema_version: z.string(),
  warnings: z.array(z.string()).optional(),
});

/**
 * Merge order computed payload
 */
export const MergeOrderComputedPayloadSchema = z.object({
  levels: z.number(),
  items_per_level: z.array(z.number()),
});

/**
 * Gate started/finished payload
 */
export const GateStartedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  gate: z.string(),
});

export const GateFinishedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  gate: z.string(),
  duration_ms: z.number(),
  status: z.string(),
  artifact_refs: z.array(z.string()).optional(),
});

/**
 * Merge dry run started/finished payload
 */
export const MergeDryRunStartedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  base: z.string(),
  head: z.string(),
});

export const MergeDryRunFinishedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  status: z.string(),
  conflicts: z.array(z.string()).optional(),
});

/**
 * Merge execute payload
 */
export const MergeExecuteStartedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  base: z.string(),
  head: z.string(),
});

export const MergeConflictDetectedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  files: z.array(z.string()),
});

export const MergeFinishedPayloadSchema = z.object({
  item: z.union([z.string(), z.number()]),
  status: z.string(),
  commit: z.string().optional(),
});

/**
 * Artifact written payload
 */
export const ArtifactWrittenPayloadSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  bytes: z.number(),
});

/**
 * Error payload
 */
export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  where: z.string().optional(),
});

/**
 * Run summary payload
 */
export const RunSummaryPayloadSchema = z.object({
  totals: z.object({
    items: z.number(),
    gates: z.number(),
    passed: z.number(),
    failed: z.number(),
  }),
  pass_fail_matrix: z.record(z.string(), z.record(z.string(), z.string())),
  final_status: z.string(),
});

/**
 * Event type definitions
 */
export const EVENT_TYPES = {
  COMMAND_INVOCATION: "command_invocation",
  PLAN_DISCOVERED: "plan_discovered",
  PLAN_VALIDATED: "plan_validated",
  MERGE_ORDER_COMPUTED: "merge_order_computed",
  GATE_STARTED: "gate_started",
  GATE_FINISHED: "gate_finished",
  MERGE_DRY_RUN_STARTED: "merge_dry_run_started",
  MERGE_DRY_RUN_FINISHED: "merge_dry_run_finished",
  MERGE_EXECUTE_STARTED: "merge_execute_started",
  MERGE_CONFLICT_DETECTED: "merge_conflict_detected",
  MERGE_FINISHED: "merge_finished",
  ARTIFACT_WRITTEN: "artifact_written",
  ERROR: "error",
  RUN_SUMMARY: "run_summary",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
