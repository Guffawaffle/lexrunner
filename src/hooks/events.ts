/**
 * Event Types for Fanout and Merge-Weave Hooks
 *
 * TypeScript interfaces and Zod schemas for LexRunner events.
 * These events are designed to integrate with Lex Frame API v2.
 *
 * Related:
 * - docs/EVENT_SCHEMA.md: Full documentation and examples
 * - Lex#88: Frame schema v2 extension (runId, planHash, spend)
 * - LexRunner#330: Frames & metrics implementation
 * - LexRunner#344: Frame schema v2 alignment validation
 */

import { z } from "zod";

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Plan context shared across all events
 */
export const PlanContextSchema = z.object({
  /** Path to the plan.json file */
  planPath: z.string(),
  /** Schema version of the plan (e.g., "1.0.0") */
  planVersion: z.string(),
  /** Number of items in the plan */
  planSize: z.number().int().positive(),
});

export type PlanContext = z.infer<typeof PlanContextSchema>;

/**
 * Conflict types that can occur during merge-weave
 */
export const ConflictTypeSchema = z.enum([
  "content", // Standard merge conflict in file content
  "delete-modify", // File deleted in one branch, modified in another
  "modify-delete", // File modified in one branch, deleted in another
  "rename-rename", // File renamed differently in both branches
  "add-add", // Same file added in both branches with different content
]);

export type ConflictType = z.infer<typeof ConflictTypeSchema>;

/**
 * Gate execution status
 */
export const GateStatusSchema = z.enum(["pass", "fail", "skip"]);

export type GateStatus = z.infer<typeof GateStatusSchema>;

/**
 * Event outcome
 */
export const OutcomeSchema = z.enum(["success", "failure", "partial"]);

export type Outcome = z.infer<typeof OutcomeSchema>;

// ============================================================================
// FanoutEvent
// ============================================================================

/**
 * Optional metadata for fanout events
 */
export const FanoutMetadataSchema = z.object({
  /** Mode of execution (e.g., "parallel", "sequential") */
  executionMode: z.string().optional(),
  /** Target branch for PRs */
  targetBranch: z.string().optional(),
  /** Repository identifier (e.g., "owner/repo") */
  repository: z.string().optional(),
  /** Index of this batch (0-based) if multiple batches */
  batchIndex: z.number().int().nonnegative().optional(),
  /** Estimated duration in milliseconds */
  estimatedDuration: z.number().int().positive().optional(),
});

export type FanoutMetadata = z.infer<typeof FanoutMetadataSchema>;

/**
 * FanoutEvent: Emitted when PRs are batched and fanned out for parallel execution
 */
export const FanoutEventSchema = z.object({
  /** Event discriminator */
  eventType: z.literal("fanout"),
  /** Unique run identifier (UUID v4) */
  runId: z.string().uuid(),
  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),
  /** SHA-256 hash of the execution plan */
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** List of PR numbers or identifiers (e.g., ["#123", "#124"]) */
  prList: z.array(z.string()).min(1),
  /** Canonical module identifiers affected by this fanout */
  modulesTouched: z.array(z.string()).min(1),
  /** Number of items in this batch */
  batchSize: z.number().int().positive(),
  /** Total number of PRs in the workflow */
  totalPRs: z.number().int().positive(),
  /** Reference to the source plan */
  planContext: PlanContextSchema,
  /** Additional operational metadata */
  metadata: FanoutMetadataSchema.optional(),
});

export type FanoutEvent = z.infer<typeof FanoutEventSchema>;

// ============================================================================
// MergeWeaveEvent
// ============================================================================

/**
 * Conflict information
 */
export const ConflictInfoSchema = z.object({
  /** Total number of conflicts detected */
  totalConflicts: z.number().int().nonnegative(),
  /** Number of conflicts successfully resolved */
  conflictsResolved: z.number().int().nonnegative(),
  /** Paths of files with conflicts */
  conflictFiles: z.array(z.string()),
  /** Types of conflicts encountered */
  conflictTypes: z.array(ConflictTypeSchema).optional(),
});

export type ConflictInfo = z.infer<typeof ConflictInfoSchema>;

/**
 * Resolution information
 */
export const ResolutionInfoSchema = z.object({
  /** Resolution strategy used (e.g., "manual", "auto-theirs", "semantic-merge") */
  strategy: z.string(),
  /** Files that were successfully resolved */
  resolvedFiles: z.array(z.string()),
  /** Files still in conflict (for partial outcomes) */
  unresolvedFiles: z.array(z.string()),
  /** Human-readable notes about resolution approach */
  resolutionNotes: z.string().optional(),
});

export type ResolutionInfo = z.infer<typeof ResolutionInfoSchema>;

/**
 * Detailed result for a single gate
 */
export const GateDetailSchema = z.object({
  /** Gate name */
  name: z.string(),
  /** Gate execution status */
  status: GateStatusSchema,
  /** Duration in milliseconds */
  duration: z.number().int().nonnegative(),
  /** Exit code from gate command */
  exitCode: z.number().int(),
  /** Paths to artifacts produced (e.g., test reports) */
  artifacts: z.array(z.string()).optional(),
});

export type GateDetail = z.infer<typeof GateDetailSchema>;

/**
 * Gate execution results
 */
export const GateResultsSchema = z.object({
  /** Total number of gates executed */
  totalGates: z.number().int().nonnegative(),
  /** Names of gates that passed */
  gatesPassed: z.array(z.string()),
  /** Names of gates that failed */
  gatesFailed: z.array(z.string()),
  /** Detailed results for each gate */
  gateDetails: z.array(GateDetailSchema).optional(),
});

export type GateResults = z.infer<typeof GateResultsSchema>;

/**
 * Turn Cost metrics (from existing Frame types)
 */
export const TurnCostSchema = z.object({
  components: z.object({
    latencyMs: z.number().nonnegative(),
    contextResetTokens: z.number().nonnegative(),
    renegotiationCount: z.number().int().nonnegative(),
    tokenBloat: z.number().nonnegative(),
    attentionSwitchCount: z.number().int().nonnegative(),
  }),
  weightedScore: z.number(),
  eventCount: z.number().int().nonnegative(),
  priorRunScore: z.number().optional(),
  improvement: z.string().optional(),
});

export type TurnCost = z.infer<typeof TurnCostSchema>;

/**
 * Token usage metrics
 */
export const TokenUsageSchema = z.object({
  /** Input tokens consumed */
  input: z.number().int().nonnegative(),
  /** Output tokens generated */
  output: z.number().int().nonnegative(),
  /** Total tokens (input + output) */
  total: z.number().int().nonnegative(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Tier metrics for governance (Claim 3.4)
 */
export const TierMetricsSchema = z.object({
  totalTasks: z.number().int().nonnegative(),
  byTier: z.object({
    senior: z.number().int().nonnegative(),
    mid: z.number().int().nonnegative(),
    junior: z.number().int().nonnegative(),
  }),
  escalations: z.number().int().nonnegative(),
  mismatches: z.number().int().nonnegative(),
  tierMatchRate: z.number().min(0).max(1),
  escalationRate: z.number().min(0).max(1),
});

export type TierMetrics = z.infer<typeof TierMetricsSchema>;

/**
 * Spend metrics (Lex v2 schema)
 */
export const SpendMetricsSchema = z.object({
  /** Total duration in milliseconds */
  duration: z.number().int().positive(),
  /** Turn Cost metrics (if available) */
  turnCost: TurnCostSchema.optional(),
  /** Token consumption metrics */
  tokenUsage: TokenUsageSchema.optional(),
  /** Governance tier metrics */
  tierMetrics: TierMetricsSchema.optional(),
});

export type SpendMetrics = z.infer<typeof SpendMetricsSchema>;

/**
 * Optional metadata for merge-weave events
 */
export const MergeWeaveMetadataSchema = z.object({
  /** Target branch for merge */
  targetBranch: z.string().optional(),
  /** Integration branch used (if umbrella pattern) */
  integrationBranch: z.string().optional(),
  /** PRs successfully merged */
  mergedPRs: z.array(z.string()).optional(),
  /** PRs that failed to merge */
  failedPRs: z.array(z.string()).optional(),
  /** Repository identifier */
  repository: z.string().optional(),
  /** Error message if outcome is failure */
  error: z.string().optional(),
});

export type MergeWeaveMetadata = z.infer<typeof MergeWeaveMetadataSchema>;

/**
 * MergeWeaveEvent: Emitted during merge-weave operations
 */
export const MergeWeaveEventSchema = z.object({
  /** Event discriminator */
  eventType: z.literal("merge-weave"),
  /** Unique run identifier (UUID v4) */
  runId: z.string().uuid(),
  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),
  /** SHA-256 hash of the execution plan */
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Overall outcome of the merge-weave */
  outcome: OutcomeSchema,
  /** Details about conflicts encountered */
  conflictInfo: ConflictInfoSchema,
  /** How conflicts were resolved */
  resolution: ResolutionInfoSchema,
  /** Results from all gate executions */
  gateResults: GateResultsSchema,
  /** Cost tracking metrics */
  spend: SpendMetricsSchema,
  /** Reference to the source plan */
  planContext: PlanContextSchema,
  /** Additional operational metadata */
  metadata: MergeWeaveMetadataSchema.optional(),
});

export type MergeWeaveEvent = z.infer<typeof MergeWeaveEventSchema>;

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all hook events
 */
export const HookEventSchema = z.discriminatedUnion("eventType", [
  FanoutEventSchema,
  MergeWeaveEventSchema,
]);

export type HookEvent = z.infer<typeof HookEventSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a FanoutEvent
 */
export function validateFanoutEvent(event: unknown): FanoutEvent {
  return FanoutEventSchema.parse(event);
}

/**
 * Safely validate a FanoutEvent
 */
export function safeValidateFanoutEvent(
  event: unknown
): { success: true; data: FanoutEvent } | { success: false; error: z.ZodError } {
  const result = FanoutEventSchema.safeParse(event);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate a MergeWeaveEvent
 */
export function validateMergeWeaveEvent(event: unknown): MergeWeaveEvent {
  return MergeWeaveEventSchema.parse(event);
}

/**
 * Safely validate a MergeWeaveEvent
 */
export function safeValidateMergeWeaveEvent(
  event: unknown
): { success: true; data: MergeWeaveEvent } | { success: false; error: z.ZodError } {
  const result = MergeWeaveEventSchema.safeParse(event);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate any hook event (discriminated union)
 */
export function validateHookEvent(event: unknown): HookEvent {
  return HookEventSchema.parse(event);
}

/**
 * Safely validate any hook event
 */
export function safeValidateHookEvent(
  event: unknown
): { success: true; data: HookEvent } | { success: false; error: z.ZodError } {
  const result = HookEventSchema.safeParse(event);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
