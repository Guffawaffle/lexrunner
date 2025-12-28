/**
 * Merge-Weave Audit Module
 *
 * Public API for merge-weave audit logging.
 *
 * @module
 */

export {
  createAuditLogger,
  createAuditEmitter,
  type AuditLogger,
  type AuditLoggerOptions,
  type MergeWeaveAuditEntry,
  type PlanEvent,
  type SummaryEvent,
} from "./logger.js";
