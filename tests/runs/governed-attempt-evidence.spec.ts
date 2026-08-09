import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GovernedAttemptEvidenceError,
  ProtectedEvidenceCaptureSession,
} from "../../src/runs/governed-attempt-evidence.js";
import { LocalProtectedEvidenceStore } from "../../src/store/local-protected-evidence-store.js";
import type { ProtectedEvidenceReservationRequest_v1 } from "../../src/store/protected-evidence-store.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("ProtectedEvidenceCaptureSession", () => {
  it("resumes its protected checkpoint and completes without exposing raw evidence", async () => {
    const root = await temporaryRoot();
    const store = protectedStore(root);
    const reservation = request();
    const first = await ProtectedEvidenceCaptureSession.open({
      store,
      reservation,
      openedAt: at(1),
    });
    const firstFrame = await first.append({
      frameClass: "executor_event",
      bytes: Buffer.from('{"type":"thread.started"}'),
      observedAt: at(2),
    });
    expect(firstFrame).toMatchObject({ captureId: "capture-1", sequence: 1 });

    const resumed = await ProtectedEvidenceCaptureSession.open({
      store: protectedStore(root),
      reservation,
      openedAt: at(20),
    });
    expect(resumed.getReference()).toMatchObject({ status: "open", frame_count: 1 });
    const secondFrame = await resumed.append({
      frameClass: "executor_stdout",
      bytes: Buffer.from("synthetic result"),
      observedAt: at(3),
    });
    expect(secondFrame.sequence).toBe(2);
    expect(secondFrame.evidenceRef).not.toBe(firstFrame.evidenceRef);

    const complete = await resumed.sealAndVerify({ sealedAt: at(4), indexedAt: at(5) });
    expect(complete).toMatchObject({ status: "complete", frame_count: 2 });
    expect(complete.capture_root).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(resumed).not.toHaveProperty("read");
    expect(resumed).not.toHaveProperty("export");
  });

  it("turns a sink policy violation into a terminal evidence error", async () => {
    const root = await temporaryRoot();
    const store = protectedStore(root, [Buffer.from("credential-canary")]);
    const session = await ProtectedEvidenceCaptureSession.open({
      store,
      reservation: request(),
      openedAt: at(1),
    });
    await expect(
      session.append({
        frameClass: "executor_stdout",
        bytes: Buffer.from("credential-canary"),
        observedAt: at(2),
      })
    ).rejects.toMatchObject<Partial<GovernedAttemptEvidenceError>>({
      code: "append_failed",
      sinkReason: "prohibited_content",
    });
    expect(session.getReference()).toMatchObject({
      status: "incomplete",
      reason_code: "prohibited_content",
    });
  });

  it("never orders an eager caller timestamp before the durable reservation", async () => {
    const root = await temporaryRoot();
    const store = new LocalProtectedEvidenceStore(root, {
      attestRoot: async () => true,
      syncDirectory: async () => undefined,
      now: () => at(2),
    });
    const session = await ProtectedEvidenceCaptureSession.open({
      store,
      reservation: request(),
      openedAt: at(1),
    });
    expect(session.getReference()).toMatchObject({
      declared_at: at(2),
      opened_at: at(2),
      status: "open",
    });
  });
});

function protectedStore(root: string, prohibitedSentinels: readonly Uint8Array[] = []) {
  return new LocalProtectedEvidenceStore(root, {
    attestRoot: async () => true,
    syncDirectory: async () => undefined,
    now: () => at(0),
    prohibitedSentinels,
  });
}

function request(): ProtectedEvidenceReservationRequest_v1 {
  return {
    capture_id: "capture-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: DIGEST,
    executor_binding_digest: DIGEST,
    environment_binding_digest: DIGEST,
    workspace_binding_digest: DIGEST,
    reserved_bytes: 1_000_000,
    reserved_frames: 10,
    reserved_events: 10,
    max_duration_ms: 60_000,
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lexrunner-evidence-session-"));
  roots.push(root);
  return root;
}

function at(seconds: number): string {
  return `2026-08-09T13:00:${String(seconds).padStart(2, "0")}.000Z`;
}
