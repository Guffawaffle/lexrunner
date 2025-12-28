/**
 * Audit subsystem - Public API
 */

export { AuditEmitter, initAuditEmitter, emitEvent, finalizeAudit } from "./emitter.js";
export type { AuditOptions, AuditSummary } from "./emitter.js";

export type { EventEnvelope, EventLevel, Tool, Actor, Repo, Context, EventType } from "./events.js";

export { EVENT_TYPES } from "./events.js";

export {
  AUDIT_PROFILES,
  getProfileConfig,
  mergeProfileConfig,
  DEFAULT_REDACT_REGEX,
  STRICT_REDACT_REGEX,
} from "./profiles.js";
export type { AuditProfile, AuditProfileConfig } from "./profiles.js";

export {
  redactSecrets,
  redactObject,
  redactArgv,
  hashPath,
  sanitizeEnv,
  sanitizeFileContent,
  buildContext,
} from "./redaction.js";

export { generateManifest, writeManifest } from "./manifest.js";
export type { AuditManifest, AuditManifestEntry } from "./manifest.js";

export {
  discoverSidecarFiles,
  readSidecarFile,
  markSidecarProcessed,
  enrichSidecarEvent,
  ingestSidecarFiles,
} from "./sidecar.js";
export type { SidecarEvent } from "./sidecar.js";

export { generateSARIF, writeSARIF } from "./sarif.js";
export type { SARIFReport, SARIFRun, SARIFRule, SARIFResult, SARIFLocation } from "./sarif.js";
