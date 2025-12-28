/**
 * Receipts Module - Disciplined Failure Pattern
 *
 * Provides ActionReceipt schema and emission helpers for implementing
 * the "Permission to Fail with Discipline" governance pattern.
 *
 * Key concepts:
 * - ActionReceipt: Documents actions taken with rationale and reversibility
 * - UncertaintyMarker: Declares uncertainty BEFORE taking action
 * - GovernanceContext: Extended context for AXError with governance fields
 *
 * @module receipts
 * @see docs/DISCIPLINED_FAILURE.md
 */

// Schema exports
export {
  // Enumerated types
  ConfidenceLevel,
  ReversibilityLevel,
  Outcome,
  // Schemas
  ActionReceiptSchema,
  UncertaintyMarkerSchema,
  // Types
  type ActionReceipt,
  type UncertaintyMarker,
  type GovernanceContext,
  // Type guards
  hasGovernanceContext,
} from "./schema.js";

// Emission helper exports
export {
  // Main emission function
  emitActionReceipt,
  // Convenience wrappers
  emitFailureReceipt,
  emitDeferredReceipt,
  // Uncertainty marker
  emitUncertaintyMarker,
  // Governance context builder
  buildGovernanceContext,
  // Types
  type EmitReceiptParams,
  type EmitOptions,
  type EmitUncertaintyParams,
} from "./emit.js";
