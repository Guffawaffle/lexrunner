/**
 * ActionReceipt Schema for Disciplined Failure Pattern
 *
 * Implements Definition 3.4 (Disciplined Failure) from the
 * coordination cost compression thesis:
 *
 * 1. Uncertainty is stated explicitly before action
 * 2. Actions taken are reversible (or flagged as non-reversible)
 * 3. Receipts document the decision chain
 * 4. Recovery path is proposed or escalation triggered
 *
 * @module receipts/schema
 * @see docs/DISCIPLINED_FAILURE.md
 */

import { z } from "zod";

// =============================================================================
// Enumerated Types
// =============================================================================

/**
 * Confidence level for an action's expected outcome
 */
export const ConfidenceLevel = z.enum(["high", "medium", "low", "uncertain"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

/**
 * Reversibility classification for actions
 */
export const ReversibilityLevel = z.enum(["reversible", "partially-reversible", "irreversible"]);
export type ReversibilityLevel = z.infer<typeof ReversibilityLevel>;

/**
 * Outcome of an action
 */
export const Outcome = z.enum(["success", "failure", "partial", "deferred"]);
export type Outcome = z.infer<typeof Outcome>;

// =============================================================================
// ActionReceipt Schema
// =============================================================================

/**
 * ActionReceipt - Documents the decision chain for disciplined failure
 *
 * This receipt provides full traceability for agent actions, enabling:
 * - Post-hoc analysis of decision quality
 * - Automated rollback when needed
 * - Human oversight of uncertainty handling
 *
 * @example
 * ```json
 * {
 *   "schemaVersion": "1.0.0",
 *   "kind": "ActionReceipt",
 *   "action": "merge PR-123 to integration",
 *   "outcome": "success",
 *   "rationale": "PR dependencies satisfied, gates green",
 *   "confidence": "high",
 *   "reversibility": "reversible",
 *   "rollbackPath": "git reset --hard HEAD~1",
 *   "escalationRequired": false,
 *   "timestamp": "2024-01-15T10:30:00.000Z"
 * }
 * ```
 */
export const ActionReceiptSchema = z.object({
  /** Schema version for forward compatibility */
  schemaVersion: z.literal("1.0.0"),

  /** Kind identifier for this receipt type */
  kind: z.literal("ActionReceipt"),

  // ─────────────────────────────────────────────────────────────────────────
  // What (Action Description)
  // ─────────────────────────────────────────────────────────────────────────
  /** Human-readable description of the action taken */
  action: z.string(),

  /** Outcome of the action */
  outcome: Outcome,

  // ─────────────────────────────────────────────────────────────────────────
  // Why (Decision Rationale)
  // ─────────────────────────────────────────────────────────────────────────
  /** Explanation for why this action was taken */
  rationale: z.string(),

  /** Confidence level in the action's success */
  confidence: ConfidenceLevel,

  /** Notes about sources of uncertainty (when confidence < high) */
  uncertaintyNotes: z.array(z.string()).optional(),

  // ─────────────────────────────────────────────────────────────────────────
  // Reversibility (Rollback Support)
  // ─────────────────────────────────────────────────────────────────────────
  /** Classification of action reversibility */
  reversibility: ReversibilityLevel,

  /** Human-readable rollback instructions */
  rollbackPath: z.string().optional(),

  /** Actual command to execute for rollback */
  rollbackCommand: z.string().optional(),

  // ─────────────────────────────────────────────────────────────────────────
  // Recovery (Next Steps)
  // ─────────────────────────────────────────────────────────────────────────
  /** Suggested next actions (for success or failure) */
  nextActions: z.array(z.string()).optional(),

  /** Whether human escalation is required */
  escalationRequired: z.boolean().default(false),

  /** Reason for escalation (when escalationRequired is true) */
  escalationReason: z.string().optional(),

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────────────────
  /** ISO 8601 timestamp of when the action was taken */
  timestamp: z.string().datetime(),

  /** Execution phase (e.g., 'planning', 'apply', 'verify') */
  phase: z.string().optional(),

  /** Run ID for correlation */
  runId: z.string().optional(),

  /** Plan hash for verification */
  planHash: z.string().optional(),
});

export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;

// =============================================================================
// UncertaintyMarker Schema
// =============================================================================

/**
 * UncertaintyMarker - Pre-action uncertainty declaration
 *
 * Used to explicitly state uncertainty BEFORE taking an action,
 * satisfying requirement (1) of Disciplined Failure.
 *
 * @example
 * ```typescript
 * const marker: UncertaintyMarker = {
 *   operation: 'merge PR-456 with active dependencies',
 *   uncertainties: [
 *     'Dependency PR-123 may have untested changes',
 *     'Target branch received commits since last check'
 *   ],
 *   mitigations: [
 *     'Will run full test suite after merge',
 *     'Rollback path: git reset --hard HEAD~1'
 *   ],
 *   proceedingAnyway: true,
 *   reason: 'Time-sensitive release; risk accepted by policy'
 * };
 * ```
 */
export const UncertaintyMarkerSchema = z.object({
  /** Operation about to be performed */
  operation: z.string(),

  /** Explicit list of known uncertainties */
  uncertainties: z.array(z.string()),

  /** Mitigations in place for the uncertainties */
  mitigations: z.array(z.string()),

  /** Whether proceeding despite uncertainties */
  proceedingAnyway: z.boolean(),

  /** Reason for proceeding (if proceedingAnyway is true) */
  reason: z.string().optional(),

  /** Timestamp of uncertainty declaration */
  timestamp: z.string().datetime().optional(),
});

export type UncertaintyMarker = z.infer<typeof UncertaintyMarkerSchema>;

// =============================================================================
// Governance-Extended AXError Context
// =============================================================================

/**
 * Extended context for AXError with governance fields
 *
 * These fields are added to AXError.context to support disciplined failure:
 * - reversibility: How reversible is the failed action?
 * - rollbackPath: Instructions for rollback
 * - confidence: How confident was the agent before failure?
 *
 * Note: AXError type is from @smartergpt/lex and cannot be extended directly.
 * These fields are added to the context object.
 */
export interface GovernanceContext {
  /** How reversible is this action/error condition? */
  reversibility?: ReversibilityLevel;

  /** Rollback instructions (human-readable) */
  rollbackPath?: string;

  /** Actual command to execute for rollback */
  rollbackCommand?: string;

  /** Agent confidence before the action was taken */
  confidence?: ConfidenceLevel;

  /** Source uncertainties that may have contributed to failure */
  uncertaintyNotes?: string[];
}

/**
 * Type guard to check if context contains governance fields
 */
export function hasGovernanceContext(
  context: Record<string, unknown> | undefined
): context is GovernanceContext & Record<string, unknown> {
  if (!context) return false;
  return "reversibility" in context || "rollbackPath" in context || "confidence" in context;
}
