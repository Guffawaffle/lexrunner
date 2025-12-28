/**
 * Audit SDK for third-party consumption (Phase 3A)
 *
 * @packageDocumentation
 * This SDK enables third-party tools to consume lexrunner audit outputs.
 *
 * ## Features
 * - Parse and validate audit events (NDJSON format)
 * - Query and filter events
 * - Validate audit manifests
 * - Type-safe TypeScript interfaces
 *
 * ## Quick Start
 * ```typescript
 * import { readAuditNDJSON, filterEvents } from '@lex-pr/audit';
 *
 * // Read all events
 * for await (const event of readAuditNDJSON('./audit.ndjson')) {
 *   if (event.event === 'gate_finished' && event.payload.status === 'fail') {
 *     console.log(`Failed gate: ${event.payload.gate}`);
 *   }
 * }
 *
 * // Or load into memory and filter
 * import { readAuditNDJSONSync } from '@lex-pr/audit';
 * const events = await readAuditNDJSONSync('./audit.ndjson');
 * const failed = filterEvents(events, {
 *   eventType: 'gate_finished',
 *   gateStatus: 'fail'
 * });
 * ```
 */

// Export types from schema
export type {
  AuditEvent,
  EventType,
  EventLevel,
  ActorType,
  GateStatus,
  MergeStatus,
  AuditProfile,
  Tool,
  Actor,
  Repo,
  Context,
  EventEnvelope,
  CommandInvocationPayload,
  PlanDiscoveredPayload,
  PlanValidatedPayload,
  MergeOrderComputedPayload,
  GateStartedPayload,
  GateFinishedPayload,
  MergeDryRunStartedPayload,
  MergeDryRunFinishedPayload,
  MergeExecuteStartedPayload,
  MergeConflictDetectedPayload,
  MergeFinishedPayload,
  ArtifactWrittenPayload,
  ErrorPayload,
  RunSummaryPayload,
  CommandInvocationEvent,
  PlanDiscoveredEvent,
  PlanValidatedEvent,
  MergeOrderComputedEvent,
  GateStartedEvent,
  GateFinishedEvent,
  MergeDryRunStartedEvent,
  MergeDryRunFinishedEvent,
  MergeExecuteStartedEvent,
  MergeConflictDetectedEvent,
  MergeFinishedEvent,
  ArtifactWrittenEvent,
  ErrorEvent,
  RunSummaryEvent,
} from "../audit/schema/events.js";

export type { AuditManifest, ManifestEntry } from "../audit/schema/manifest.js";

// Export schema constants
export { AUDIT_SCHEMA_VERSION } from "../audit/schema/events.js";

// Export parsing functions
export {
  parseAuditEvent,
  validateAuditEvent as validateAuditEventZod,
} from "../audit/schema/events.js";

export { parseAuditManifest } from "../audit/schema/manifest.js";

// Export parser functions
export {
  parseAuditEventLine,
  readAuditNDJSON,
  readAuditNDJSONSync,
  parseAuditNDJSONString,
} from "./parser.js";

// Export validator functions
export {
  validateAuditManifest,
  validateAuditManifestSafe,
  validateAuditEvent,
  validateAuditEventSafe,
  isSchemaCompatible,
  validateAuditEvents,
  validateAuditEventsSafe,
} from "./validator.js";

// Export query functions
export { filterEvents, computeStatistics, EventQuery } from "./query.js";

export type { EventFilter } from "./query.js";
