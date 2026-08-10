import { z } from "zod";

import { SHA256Hash } from "../schemas/task-contract.js";

export const PROTECTED_EVIDENCE_CONTRACT_VERSION = "1.0.0" as const;
export const STAGE1_SYNTHETIC_EVIDENCE_PROFILE_ID =
  "lexrunner.local-protected-evidence@1.0.0" as const;

export const STAGE1_SYNTHETIC_EVIDENCE_PROFILE = Object.freeze({
  maxDurationMs: 15 * 60 * 1_000,
  maxFrameBytes: 64 * 1_024,
  maxStdoutBytes: 8 * 1_024 * 1_024,
  maxStderrBytes: 2 * 1_024 * 1_024,
  maxProviderControlBytes: 4 * 1_024 * 1_024,
  maxContainerBytes: 16 * 1_024 * 1_024,
  maxJsonlEvents: 10_000,
  maxJsonlLineBytes: 1 * 1_024 * 1_024,
  maxFrames: 65_536,
  maxLiveCaptures: 32,
  maxReservedStoreBytes: 512 * 1_024 * 1_024,
  completeRetentionMs: 72 * 60 * 60 * 1_000,
  incompleteRetentionMs: 24 * 60 * 60 * 1_000,
  prohibitedQuarantineMs: 60 * 60 * 1_000,
  derivedPresentationRetentionMs: 24 * 60 * 60 * 1_000,
});

const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const storeKey = z.string().regex(/^pe:[0-9a-f]{32}$/u, "Must be an opaque protected-store key");
const instant = z.string().datetime({ offset: true });

export const ProtectedEvidenceFrameClass = z.enum([
  "executor_stdout",
  "executor_stderr",
  "executor_event",
  "executor_claim",
  "provider_receipt",
  "control_evidence",
  "verifier_evidence",
  "capture_lifecycle",
]);
export type ProtectedEvidenceFrameClass = z.infer<typeof ProtectedEvidenceFrameClass>;

export const ProtectedEvidenceReferenceStatus = z.enum([
  "declared",
  "open",
  "sealed_unindexed",
  "complete",
  "incomplete",
  "destroyed",
  "destruction_failed",
]);
export type ProtectedEvidenceReferenceStatus = z.infer<typeof ProtectedEvidenceReferenceStatus>;

export const ProtectedEvidenceReasonCode = z.enum([
  "capacity_exceeded",
  "frame_limit_exceeded",
  "duration_limit_exceeded",
  "byte_limit_exceeded",
  "event_limit_exceeded",
  "line_limit_exceeded",
  "provider_failure",
  "cancelled",
  "sink_unavailable",
  "integrity_failure",
  "crash_recovery",
  "prohibited_content",
  "deletion_failure",
]);
export type ProtectedEvidenceReasonCode = z.infer<typeof ProtectedEvidenceReasonCode>;

/**
 * The only protected-evidence shape allowed into CoordinationStore. It contains
 * no raw bytes, excerpts, prompts, reasons, credential values, or physical path.
 */
export const ProtectedEvidenceReference_v1 = z
  .object({
    schema_version: z.literal(PROTECTED_EVIDENCE_CONTRACT_VERSION),
    profile_id: z.literal(STAGE1_SYNTHETIC_EVIDENCE_PROFILE_ID),
    store_key: storeKey,
    capture_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    authorization_binding_digest: SHA256Hash,
    executor_binding_digest: SHA256Hash,
    environment_binding_digest: SHA256Hash,
    workspace_binding_digest: SHA256Hash,
    worker_session_id: opaqueId.optional(),
    status: ProtectedEvidenceReferenceStatus,
    retention_class: z.enum(["synthetic_complete", "incomplete", "prohibited_content"]),
    capture_root: SHA256Hash.optional(),
    verification_hash: SHA256Hash.optional(),
    frame_count: z.number().int().nonnegative().max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrames),
    event_count: z
      .number()
      .int()
      .nonnegative()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxJsonlEvents),
    total_bytes: z
      .number()
      .int()
      .nonnegative()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxContainerBytes),
    stdout_bytes: z
      .number()
      .int()
      .nonnegative()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxStdoutBytes),
    stderr_bytes: z
      .number()
      .int()
      .nonnegative()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxStderrBytes),
    provider_control_bytes: z
      .number()
      .int()
      .nonnegative()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxProviderControlBytes),
    declared_at: instant,
    opened_at: instant.optional(),
    sealed_at: instant.optional(),
    indexed_at: instant.optional(),
    terminal_at: instant.optional(),
    retention_expires_at: instant,
    reason_code: ProtectedEvidenceReasonCode.optional(),
    retry_after: instant.optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    const byteSubtotal =
      reference.stdout_bytes + reference.stderr_bytes + reference.provider_control_bytes;
    if (byteSubtotal > reference.total_bytes) {
      context.addIssue({
        code: "custom",
        path: ["total_bytes"],
        message: "classified byte counters cannot exceed total_bytes",
      });
    }
    requireOrdered(
      reference.declared_at,
      reference.retention_expires_at,
      "retention_expires_at",
      context,
      false
    );
    if (reference.opened_at) {
      requireOrdered(reference.declared_at, reference.opened_at, "opened_at", context);
    }
    if (reference.sealed_at && reference.opened_at) {
      requireOrdered(reference.opened_at, reference.sealed_at, "sealed_at", context);
    }
    if (reference.indexed_at && reference.sealed_at) {
      requireOrdered(reference.sealed_at, reference.indexed_at, "indexed_at", context);
    }

    const retentionStart = reference.terminal_at ?? reference.declared_at;
    const maximumRetentionMs =
      reference.retention_class === "synthetic_complete"
        ? STAGE1_SYNTHETIC_EVIDENCE_PROFILE.completeRetentionMs
        : reference.retention_class === "incomplete"
          ? STAGE1_SYNTHETIC_EVIDENCE_PROFILE.incompleteRetentionMs
          : STAGE1_SYNTHETIC_EVIDENCE_PROFILE.prohibitedQuarantineMs;
    if (
      Date.parse(reference.retention_expires_at) - Date.parse(retentionStart) >
      maximumRetentionMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["retention_expires_at"],
        message: "retention exceeds the selected Stage 1 class ceiling",
      });
    }

    const hasCounters =
      reference.frame_count !== 0 || reference.event_count !== 0 || reference.total_bytes !== 0;
    switch (reference.status) {
      case "declared":
        if (reference.retention_class !== "synthetic_complete") {
          addStateIssue("declared captures use the synthetic_complete retention class", context);
        }
        requireAbsent(
          reference,
          [
            "opened_at",
            "sealed_at",
            "indexed_at",
            "terminal_at",
            "capture_root",
            "verification_hash",
            "reason_code",
            "retry_after",
          ],
          context
        );
        if (hasCounters) addStateIssue("declared captures cannot have evidence counters", context);
        break;
      case "open":
        if (reference.retention_class !== "synthetic_complete") {
          addStateIssue("open captures use the synthetic_complete retention class", context);
        }
        requirePresent(reference, ["opened_at"], context);
        requireAbsent(
          reference,
          [
            "sealed_at",
            "indexed_at",
            "terminal_at",
            "capture_root",
            "verification_hash",
            "reason_code",
            "retry_after",
          ],
          context
        );
        break;
      case "sealed_unindexed":
        if (reference.retention_class !== "synthetic_complete") {
          addStateIssue("sealed captures use the synthetic_complete retention class", context);
        }
        requirePresent(reference, ["opened_at", "sealed_at", "capture_root"], context);
        requireAbsent(
          reference,
          ["indexed_at", "terminal_at", "verification_hash", "reason_code", "retry_after"],
          context
        );
        break;
      case "complete":
        if (reference.retention_class !== "synthetic_complete") {
          addStateIssue("complete captures use the synthetic_complete retention class", context);
        }
        requirePresent(
          reference,
          ["opened_at", "sealed_at", "indexed_at", "capture_root", "verification_hash"],
          context
        );
        requireAbsent(reference, ["terminal_at", "reason_code", "retry_after"], context);
        break;
      case "incomplete":
        if (reference.retention_class === "synthetic_complete") {
          addStateIssue("incomplete captures require a bounded failure retention class", context);
        }
        requirePresent(reference, ["terminal_at", "reason_code"], context);
        requireAbsent(reference, ["indexed_at", "verification_hash", "retry_after"], context);
        if (reference.sealed_at !== undefined && reference.capture_root === undefined) {
          addStateIssue("a sealed incomplete capture must retain its capture root", context);
        }
        if (
          (reference.reason_code === "prohibited_content") !==
          (reference.retention_class === "prohibited_content")
        ) {
          addStateIssue("prohibited content requires its one-hour retention class", context);
        }
        break;
      case "destroyed":
        requirePresent(reference, ["terminal_at"], context);
        requireAbsent(reference, ["retry_after"], context);
        break;
      case "destruction_failed":
        requirePresent(reference, ["terminal_at", "retry_after"], context);
        if (reference.reason_code !== "deletion_failure") {
          addStateIssue("destruction_failed requires deletion_failure", context);
        }
        break;
    }

    const encoded = JSON.stringify(reference);
    if (Buffer.byteLength(encoded, "utf8") > 4_096) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "protected evidence reference exceeds its coordination bound",
      });
    }
  });
export type ProtectedEvidenceReference_v1 = z.infer<typeof ProtectedEvidenceReference_v1>;

export function parseCoordinationEvidenceReference(input: unknown): ProtectedEvidenceReference_v1 {
  return ProtectedEvidenceReference_v1.parse(input);
}

const REFERENCE_TRANSITIONS = {
  declared: ["open", "incomplete"],
  open: ["sealed_unindexed", "incomplete"],
  sealed_unindexed: ["complete", "incomplete"],
  complete: ["destroyed", "destruction_failed"],
  incomplete: ["destroyed", "destruction_failed"],
  destroyed: [],
  destruction_failed: ["destroyed", "destruction_failed"],
} as const satisfies Record<
  ProtectedEvidenceReferenceStatus,
  readonly ProtectedEvidenceReferenceStatus[]
>;

export function canTransitionProtectedEvidenceReference(
  from: ProtectedEvidenceReferenceStatus,
  to: ProtectedEvidenceReferenceStatus
): boolean {
  return (REFERENCE_TRANSITIONS[from] as readonly ProtectedEvidenceReferenceStatus[]).includes(to);
}

export const ProtectedEvidenceReservationRequest_v1 = z
  .object({
    capture_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    authorization_binding_digest: SHA256Hash,
    executor_binding_digest: SHA256Hash,
    environment_binding_digest: SHA256Hash,
    workspace_binding_digest: SHA256Hash,
    reserved_bytes: z
      .number()
      .int()
      .positive()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxContainerBytes),
    reserved_frames: z.number().int().positive().max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrames),
    reserved_events: z
      .number()
      .int()
      .nonnegative()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxJsonlEvents),
    max_duration_ms: z
      .number()
      .int()
      .positive()
      .max(STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxDurationMs),
    max_tool_calls: z.number().int().positive().max(10_000).optional(),
  })
  .strict();
export type ProtectedEvidenceReservationRequest_v1 = z.infer<
  typeof ProtectedEvidenceReservationRequest_v1
>;

export const ProtectedEvidenceStoreUsage_v1 = z
  .object({
    live_captures: z.number().int().nonnegative(),
    reserved_bytes: z.number().int().nonnegative(),
  })
  .strict();
export type ProtectedEvidenceStoreUsage_v1 = z.infer<typeof ProtectedEvidenceStoreUsage_v1>;

export type ProtectedEvidenceAdmissionResult =
  | { admitted: true; reservation: ProtectedEvidenceReservationRequest_v1 }
  | { admitted: false; reason: "capture_capacity" | "store_capacity" | "invalid_request" };

/** Fail-closed capacity check that runs before worker dispatch. */
export function evaluateProtectedEvidenceAdmission(
  usageCandidate: unknown,
  requestCandidate: unknown
): ProtectedEvidenceAdmissionResult {
  const usage = ProtectedEvidenceStoreUsage_v1.safeParse(usageCandidate);
  const request = ProtectedEvidenceReservationRequest_v1.safeParse(requestCandidate);
  if (!usage.success || !request.success) return { admitted: false, reason: "invalid_request" };
  if (usage.data.live_captures + 1 > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxLiveCaptures) {
    return { admitted: false, reason: "capture_capacity" };
  }
  if (
    usage.data.reserved_bytes + request.data.reserved_bytes >
    STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxReservedStoreBytes
  ) {
    return { admitted: false, reason: "store_capacity" };
  }
  return { admitted: true, reservation: request.data };
}

export interface ProtectedEvidenceFrameInput {
  captureId: string;
  reservationToken: string;
  sequence: number;
  frameClass: ProtectedEvidenceFrameClass;
  bytes: Uint8Array;
  observedAt: string;
}

export type ProtectedEvidenceMutationResult =
  | { applied: true; reference: ProtectedEvidenceReference_v1; idempotentReplay: boolean }
  | {
      applied: false;
      reason:
        | "not_found"
        | "stale_reservation"
        | "invalid_transition"
        | "sequence_mismatch"
        | "limit_exceeded"
        | "prohibited_content"
        | "integrity_failure"
        | "sink_unavailable";
    };

export type ProtectedEvidenceReservationResult =
  | {
      admitted: true;
      reference: ProtectedEvidenceReference_v1;
      reservationToken: string;
      idempotentReplay: boolean;
    }
  | {
      admitted: false;
      reason: "capture_capacity" | "store_capacity" | "invalid_request" | "sink_unavailable";
    };

export type ProtectedEvidenceWriterCheckpointResult =
  | {
      available: true;
      reference: ProtectedEvidenceReference_v1;
      frameCount: number;
      chainHead: string;
    }
  | {
      available: false;
      reason: "not_found" | "stale_reservation" | "invalid_transition" | "sink_unavailable";
    };

/**
 * Trusted-coordinator port. Stage 1 deliberately exposes no raw read or export
 * method; reviewers receive only verified derived presentation elsewhere.
 */
export interface ProtectedEvidenceStore {
  reserveCapture(
    request: ProtectedEvidenceReservationRequest_v1
  ): Promise<ProtectedEvidenceReservationResult>;
  openCapture(input: {
    captureId: string;
    reservationToken: string;
    openedAt: string;
  }): Promise<ProtectedEvidenceMutationResult>;
  appendFrame(input: ProtectedEvidenceFrameInput): Promise<ProtectedEvidenceMutationResult>;
  getWriterCheckpoint(input: {
    captureId: string;
    reservationToken: string;
  }): Promise<ProtectedEvidenceWriterCheckpointResult>;
  sealCapture(input: {
    captureId: string;
    reservationToken: string;
    expectedFrameCount: number;
    expectedChainHead: string;
    sealedAt: string;
  }): Promise<ProtectedEvidenceMutationResult>;
  verifyAndIndexCapture(input: {
    captureId: string;
    reservationToken: string;
    expectedCaptureRoot: string;
    indexedAt: string;
  }): Promise<ProtectedEvidenceMutationResult>;
  markIncomplete(input: {
    captureId: string;
    reservationToken: string;
    reasonCode: ProtectedEvidenceReasonCode;
    terminalAt: string;
  }): Promise<ProtectedEvidenceMutationResult>;
  destroyCapture(input: {
    captureId: string;
    requestedAt: string;
  }): Promise<ProtectedEvidenceMutationResult>;
  sweep(now: string): Promise<ProtectedEvidenceReference_v1[]>;
  getReference(captureId: string): Promise<ProtectedEvidenceReference_v1 | null>;
}

function requirePresent<T extends object>(
  value: T,
  fields: readonly (keyof T)[],
  context: z.RefinementCtx
): void {
  for (const field of fields) {
    if (value[field] === undefined) {
      context.addIssue({
        code: "custom",
        path: [String(field)],
        message: `${String(field)} is required for this evidence state`,
      });
    }
  }
}

function requireAbsent<T extends object>(
  value: T,
  fields: readonly (keyof T)[],
  context: z.RefinementCtx
): void {
  for (const field of fields) {
    if (value[field] !== undefined) {
      context.addIssue({
        code: "custom",
        path: [String(field)],
        message: `${String(field)} is not valid for this evidence state`,
      });
    }
  }
}

function addStateIssue(message: string, context: z.RefinementCtx): void {
  context.addIssue({ code: "custom", path: ["status"], message });
}

function requireOrdered(
  earlier: string,
  later: string,
  path: string,
  context: z.RefinementCtx,
  equalAllowed = true
): void {
  const ordered = equalAllowed
    ? Date.parse(earlier) <= Date.parse(later)
    : Date.parse(earlier) < Date.parse(later);
  if (!ordered) {
    context.addIssue({ code: "custom", path: [path], message: `${path} is out of order` });
  }
}
