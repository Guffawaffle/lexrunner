import { describe, expect, it } from "vitest";

import {
  PROTECTED_EVIDENCE_CONTRACT_VERSION,
  STAGE1_SYNTHETIC_EVIDENCE_PROFILE,
  STAGE1_SYNTHETIC_EVIDENCE_PROFILE_ID,
  ProtectedEvidenceReference_v1,
  canTransitionProtectedEvidenceReference,
  evaluateProtectedEvidenceAdmission,
  parseCoordinationEvidenceReference,
  type ProtectedEvidenceReference_v1 as EvidenceReference,
} from "../../src/store/protected-evidence-store.js";

const ROOT = `sha256:${"a".repeat(64)}`;
const VERIFICATION = `sha256:${"b".repeat(64)}`;

describe("Stage 1 protected evidence profile", () => {
  it("freezes the selected synthetic ceilings and retention bounds", () => {
    expect(STAGE1_SYNTHETIC_EVIDENCE_PROFILE).toEqual(
      expect.objectContaining({
        maxDurationMs: 900_000,
        maxFrameBytes: 65_536,
        maxStdoutBytes: 8_388_608,
        maxStderrBytes: 2_097_152,
        maxProviderControlBytes: 4_194_304,
        maxContainerBytes: 16_777_216,
        maxJsonlEvents: 10_000,
        maxJsonlLineBytes: 1_048_576,
        maxFrames: 65_536,
        maxLiveCaptures: 32,
        maxReservedStoreBytes: 536_870_912,
        completeRetentionMs: 259_200_000,
        incompleteRetentionMs: 86_400_000,
        prohibitedQuarantineMs: 3_600_000,
      })
    );
    expect(Object.isFrozen(STAGE1_SYNTHETIC_EVIDENCE_PROFILE)).toBe(true);
  });

  it("admits only pre-reserved bounded captures and fails closed at store limits", () => {
    const request = reservation();
    expect(
      evaluateProtectedEvidenceAdmission({ live_captures: 0, reserved_bytes: 0 }, request)
    ).toMatchObject({ admitted: true });
    expect(
      evaluateProtectedEvidenceAdmission({ live_captures: 32, reserved_bytes: 0 }, request)
    ).toEqual({ admitted: false, reason: "capture_capacity" });
    expect(
      evaluateProtectedEvidenceAdmission(
        {
          live_captures: 1,
          reserved_bytes: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxReservedStoreBytes,
        },
        request
      )
    ).toEqual({ admitted: false, reason: "store_capacity" });
    expect(
      evaluateProtectedEvidenceAdmission(
        { live_captures: 0, reserved_bytes: 0 },
        { ...request, reserved_bytes: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxContainerBytes + 1 }
      )
    ).toEqual({ admitted: false, reason: "invalid_request" });
  });
});

describe("CoordinationStore-safe protected evidence references", () => {
  it("accepts bounded opaque metadata without exposing a physical path or raw content", () => {
    const reference = parseCoordinationEvidenceReference(declaredReference());
    expect(reference).toMatchObject({ status: "declared", frame_count: 0, total_bytes: 0 });
    expect(JSON.stringify(reference)).not.toContain("Users");
    expect(JSON.stringify(reference)).not.toContain("secret-output-canary");
  });

  it("rejects raw bytes, prompts, reasons, excerpts, credentials, and physical paths", () => {
    for (const forbidden of [
      { raw_stdout: "secret" },
      { prompt: "source text" },
      { reason: "worker volunteered this" },
      { excerpt: "private line" },
      { credential: "token" },
      { physical_path: "C:\\Users\\Guff\\evidence" },
    ]) {
      expect(
        ProtectedEvidenceReference_v1.safeParse({ ...declaredReference(), ...forbidden }).success
      ).toBe(false);
    }
  });

  it("requires a fresh verification and index before evidence can become complete", () => {
    expect(canTransitionProtectedEvidenceReference("open", "complete")).toBe(false);
    expect(canTransitionProtectedEvidenceReference("incomplete", "complete")).toBe(false);
    expect(canTransitionProtectedEvidenceReference("sealed_unindexed", "complete")).toBe(true);

    expect(
      ProtectedEvidenceReference_v1.safeParse({
        ...openReference(),
        status: "complete",
      }).success
    ).toBe(false);
    expect(ProtectedEvidenceReference_v1.safeParse(completeReference()).success).toBe(true);
  });

  it("never allows a partial, failed, or destroyed capture to return to a complete state", () => {
    expect(canTransitionProtectedEvidenceReference("declared", "complete")).toBe(false);
    expect(canTransitionProtectedEvidenceReference("incomplete", "sealed_unindexed")).toBe(false);
    expect(canTransitionProtectedEvidenceReference("destruction_failed", "complete")).toBe(false);
    expect(canTransitionProtectedEvidenceReference("destroyed", "complete")).toBe(false);
  });

  it("makes overflow and prohibited content explicit without retaining sensitive detail", () => {
    for (const reason_code of [
      "byte_limit_exceeded",
      "event_limit_exceeded",
      "provider_failure",
      "prohibited_content",
    ] as const) {
      const reference = ProtectedEvidenceReference_v1.parse({
        ...openReference(),
        status: "incomplete",
        terminal_at: "2026-08-09T08:00:03Z",
        reason_code,
        retention_class: reason_code === "prohibited_content" ? "prohibited_content" : "incomplete",
        retention_expires_at:
          reason_code === "prohibited_content" ? "2026-08-09T09:00:03Z" : "2026-08-10T08:00:03Z",
      });
      expect(reference.reason_code).toBe(reason_code);
      expect(reference).not.toHaveProperty("reason");
      expect(reference).not.toHaveProperty("excerpt");
      expect(reference).not.toHaveProperty("value_hash");
    }
  });

  it("keeps deletion failure explicit and retryable instead of disappearing", () => {
    const failed = ProtectedEvidenceReference_v1.parse({
      ...completeReference(),
      status: "destruction_failed",
      indexed_at: "2026-08-09T08:00:04Z",
      terminal_at: "2026-08-09T08:00:05Z",
      reason_code: "deletion_failure",
      retry_after: "2026-08-09T08:05:05Z",
    });
    expect(failed).toMatchObject({
      status: "destruction_failed",
      reason_code: "deletion_failure",
      store_key: "pe:0123456789abcdef0123456789abcdef",
    });

    expect(
      ProtectedEvidenceReference_v1.safeParse({
        ...failed,
        reason_code: "integrity_failure",
      }).success
    ).toBe(false);
  });

  it("enforces 72-hour, 24-hour, and one-hour retention classes", () => {
    const tooLongComplete = {
      ...completeReference(),
      retention_expires_at: "2026-08-12T08:00:01Z",
    };
    expect(ProtectedEvidenceReference_v1.safeParse(tooLongComplete).success).toBe(false);

    const incomplete = {
      ...openReference(),
      status: "incomplete",
      retention_class: "incomplete",
      terminal_at: "2026-08-09T08:00:03Z",
      reason_code: "cancelled",
      retention_expires_at: "2026-08-10T08:00:04Z",
    };
    expect(ProtectedEvidenceReference_v1.safeParse(incomplete).success).toBe(false);

    const prohibited = {
      ...incomplete,
      retention_class: "prohibited_content",
      reason_code: "prohibited_content",
      retention_expires_at: "2026-08-09T09:00:04Z",
    };
    expect(ProtectedEvidenceReference_v1.safeParse(prohibited).success).toBe(false);
  });

  it("rejects counter overflow and inconsistent classified byte totals", () => {
    expect(
      ProtectedEvidenceReference_v1.safeParse({
        ...openReference(),
        stdout_bytes: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxStdoutBytes + 1,
        total_bytes: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxStdoutBytes + 1,
      }).success
    ).toBe(false);
    expect(
      ProtectedEvidenceReference_v1.safeParse({
        ...openReference(),
        total_bytes: 1,
        stdout_bytes: 1,
        stderr_bytes: 1,
      }).success
    ).toBe(false);
  });
});

function reservation() {
  return {
    capture_id: "capture-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: ROOT,
    executor_binding_digest: ROOT,
    environment_binding_digest: ROOT,
    workspace_binding_digest: ROOT,
    reserved_bytes: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxContainerBytes,
    reserved_frames: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrames,
    reserved_events: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxJsonlEvents,
    max_duration_ms: STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxDurationMs,
  };
}

function declaredReference(): EvidenceReference {
  return {
    schema_version: PROTECTED_EVIDENCE_CONTRACT_VERSION,
    profile_id: STAGE1_SYNTHETIC_EVIDENCE_PROFILE_ID,
    store_key: "pe:0123456789abcdef0123456789abcdef",
    capture_id: "capture-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: ROOT,
    executor_binding_digest: ROOT,
    environment_binding_digest: ROOT,
    workspace_binding_digest: ROOT,
    status: "declared",
    retention_class: "synthetic_complete",
    frame_count: 0,
    event_count: 0,
    total_bytes: 0,
    stdout_bytes: 0,
    stderr_bytes: 0,
    provider_control_bytes: 0,
    declared_at: "2026-08-09T08:00:00Z",
    retention_expires_at: "2026-08-12T08:00:00Z",
  };
}

function openReference(): EvidenceReference {
  return ProtectedEvidenceReference_v1.parse({
    ...declaredReference(),
    status: "open",
    opened_at: "2026-08-09T08:00:01Z",
    frame_count: 1,
    event_count: 1,
    total_bytes: 32,
    stdout_bytes: 32,
  });
}

function completeReference(): EvidenceReference {
  return ProtectedEvidenceReference_v1.parse({
    ...openReference(),
    status: "complete",
    sealed_at: "2026-08-09T08:00:02Z",
    indexed_at: "2026-08-09T08:00:03Z",
    capture_root: ROOT,
    verification_hash: VERIFICATION,
  });
}
