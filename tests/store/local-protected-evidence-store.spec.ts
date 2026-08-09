import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import {
  LocalProtectedEvidenceStore,
  computeProtectedEvidenceFrameHash,
  initialProtectedEvidenceChainHead,
} from "../../src/store/local-protected-evidence-store.js";
import type {
  ProtectedEvidenceMutationResult,
  ProtectedEvidenceReservationRequest_v1,
  ProtectedEvidenceReservationResult,
} from "../../src/store/protected-evidence-store.js";
import { ProtectedEvidenceReference_v1 } from "../../src/store/protected-evidence-store.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const START = "2026-08-09T12:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("LocalProtectedEvidenceStore", () => {
  it("durably chains, seals, freshly verifies, and indexes a bounded capture", async () => {
    const { store } = await fixture();
    const reservation = admitted(await store.reserveCapture(request()));
    applied(
      await store.openCapture({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        openedAt: at(1),
      })
    );

    let head = initialProtectedEvidenceChainHead();
    const frames = [
      { frameClass: "executor_event" as const, bytes: Buffer.from('{"type":"thread.started"}') },
      { frameClass: "executor_stdout" as const, bytes: Buffer.from("synthetic review") },
    ];
    for (const [index, frame] of frames.entries()) {
      const sequence = index + 1;
      const observedAt = at(sequence + 1);
      const next = computeProtectedEvidenceFrameHash({
        captureId: "capture-1",
        sequence,
        frameClass: frame.frameClass,
        observedAt,
        bytes: frame.bytes,
        previousFrameHash: head,
      });
      const append = applied(
        await store.appendFrame({
          captureId: "capture-1",
          reservationToken: reservation.reservationToken,
          sequence,
          frameClass: frame.frameClass,
          bytes: frame.bytes,
          observedAt,
        })
      );
      expect(append.reference.frame_count).toBe(sequence);
      head = next;
    }

    const replay = applied(
      await store.appendFrame({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        sequence: 2,
        frameClass: "executor_stdout",
        bytes: frames[1]!.bytes,
        observedAt: at(3),
      })
    );
    expect(replay.idempotentReplay).toBe(true);

    const sealed = applied(
      await store.sealCapture({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        expectedFrameCount: 2,
        expectedChainHead: head,
        sealedAt: at(4),
      })
    );
    expect(sealed.reference).toMatchObject({
      status: "sealed_unindexed",
      frame_count: 2,
      event_count: 1,
    });
    const completed = applied(
      await store.verifyAndIndexCapture({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        expectedCaptureRoot: sealed.reference.capture_root!,
        indexedAt: at(5),
      })
    );
    expect(completed.reference).toMatchObject({
      status: "complete",
      capture_root: sealed.reference.capture_root,
    });
    expect(completed.reference.verification_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(store).not.toHaveProperty("readCapture");
    expect(store).not.toHaveProperty("exportCapture");
  });

  it("makes tampered or missing sealed frames terminal integrity failures", async () => {
    for (const corruption of ["tamper", "missing"] as const) {
      const { root, store } = await fixture();
      const captureId = `capture-${corruption}`;
      const capture = await sealedCapture(store, captureId);
      const directory = sealedDirectory(root, capture.storeKey);
      const firstFrame = path.join(directory, "00000001.frame");
      if (corruption === "tamper") {
        const bytes = await readFile(firstFrame);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
        await writeFile(firstFrame, bytes);
      } else {
        await unlink(firstFrame);
      }
      const result = applied(
        await store.verifyAndIndexCapture({
          captureId,
          reservationToken: capture.token,
          expectedCaptureRoot: capture.captureRoot,
          indexedAt: at(5),
        })
      );
      expect(result.reference).toMatchObject({
        status: "incomplete",
        reason_code: "integrity_failure",
        retention_class: "incomplete",
      });
    }
  });

  it("destroys a split credential canary before recording a content-free failure", async () => {
    const canary = Buffer.from("operator-credential-canary");
    const { root, store } = await fixture({ prohibitedSentinels: [canary] });
    const reservation = admitted(await store.reserveCapture(request()));
    applied(
      await store.openCapture({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        openedAt: at(1),
      })
    );
    applied(
      await store.appendFrame({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        sequence: 1,
        frameClass: "executor_stdout",
        bytes: Buffer.from("operator-credential-"),
        observedAt: at(2),
      })
    );
    const prohibited = applied(
      await store.appendFrame({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        sequence: 2,
        frameClass: "executor_stdout",
        bytes: Buffer.from("canary"),
        observedAt: at(3),
      })
    );
    expect(prohibited.reference).toMatchObject({
      status: "incomplete",
      reason_code: "prohibited_content",
      retention_class: "prohibited_content",
    });
    const retained = Buffer.concat(await readAllFiles(root));
    expect(retained.includes(canary)).toBe(false);
    expect(await readdir(path.join(root, "captures"))).toEqual([]);
  });

  it("fails closed when root protection is absent or drifts after reservation", async () => {
    const root = await temporaryRoot();
    const unavailable = new LocalProtectedEvidenceStore(root, {
      attestRoot: async () => false,
      syncDirectory: async () => undefined,
      now: () => START,
    });
    await expect(unavailable.reserveCapture(request())).resolves.toEqual({
      admitted: false,
      reason: "sink_unavailable",
    });

    let protectedRoot = true;
    const drifting = new LocalProtectedEvidenceStore(root, {
      attestRoot: async () => protectedRoot,
      syncDirectory: async () => undefined,
      now: () => START,
    });
    const reservation = admitted(
      await drifting.reserveCapture(request({ capture_id: "capture-drift" }))
    );
    protectedRoot = false;
    await expect(
      drifting.openCapture({
        captureId: "capture-drift",
        reservationToken: reservation.reservationToken,
        openedAt: at(1),
      })
    ).resolves.toEqual({ applied: false, reason: "sink_unavailable" });
  });

  it("latches duration and reservation overflow instead of dispatching unbounded evidence", async () => {
    const { store } = await fixture();
    const duration = admitted(
      await store.reserveCapture(
        request({ capture_id: "capture-duration", max_duration_ms: 1_000 })
      )
    );
    applied(
      await store.openCapture({
        captureId: "capture-duration",
        reservationToken: duration.reservationToken,
        openedAt: at(1),
      })
    );
    expect(
      applied(
        await store.appendFrame({
          captureId: "capture-duration",
          reservationToken: duration.reservationToken,
          sequence: 1,
          frameClass: "executor_stdout",
          bytes: Buffer.from("late"),
          observedAt: at(3),
        })
      ).reference
    ).toMatchObject({ status: "incomplete", reason_code: "duration_limit_exceeded" });

    const bytes = admitted(
      await store.reserveCapture(request({ capture_id: "capture-bytes", reserved_bytes: 1 }))
    );
    applied(
      await store.openCapture({
        captureId: "capture-bytes",
        reservationToken: bytes.reservationToken,
        openedAt: at(1),
      })
    );
    expect(
      applied(
        await store.appendFrame({
          captureId: "capture-bytes",
          reservationToken: bytes.reservationToken,
          sequence: 1,
          frameClass: "executor_stdout",
          bytes: Buffer.from("x"),
          observedAt: at(2),
        })
      ).reference
    ).toMatchObject({ status: "incomplete", reason_code: "byte_limit_exceeded" });
  });

  it("recovers an exact frame persisted before its metadata after coordinator restart", async () => {
    const { root, store } = await fixture();
    const reservation = admitted(await store.reserveCapture(request()));
    applied(
      await store.openCapture({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        openedAt: at(1),
      })
    );
    const frame = {
      captureId: "capture-1",
      reservationToken: reservation.reservationToken,
      sequence: 1,
      frameClass: "executor_event" as const,
      bytes: Buffer.from('{"type":"thread.started"}'),
      observedAt: at(2),
    };
    applied(await store.appendFrame(frame));

    const recordPath = path.join(root, "records", (await readdir(path.join(root, "records")))[0]!);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      chainHead: string;
      reference: Record<string, unknown>;
      request: unknown;
      requestHash: string;
      reservationToken: string;
    };
    record.chainHead = initialProtectedEvidenceChainHead();
    Object.assign(record.reference, {
      frame_count: 0,
      event_count: 0,
      total_bytes: 0,
      stdout_bytes: 0,
      stderr_bytes: 0,
      provider_control_bytes: 0,
    });
    expect(ProtectedEvidenceReference_v1.safeParse(record.reference)).toMatchObject({
      success: true,
    });
    expect(record.requestHash).toBe(computeCanonicalHash(record.request));
    expect(record.reservationToken).toMatch(/^[0-9a-f]{64}$/u);
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");

    const restarted = protectedStore(root);
    expect(await restarted.getReference("capture-1")).not.toBeNull();
    const recovered = applied(await restarted.appendFrame(frame));
    expect(recovered.reference).toMatchObject({ frame_count: 1, event_count: 1 });
    const head = computeProtectedEvidenceFrameHash({
      ...frame,
      previousFrameHash: initialProtectedEvidenceChainHead(),
    });
    const sealed = applied(
      await restarted.sealCapture({
        captureId: "capture-1",
        reservationToken: reservation.reservationToken,
        expectedFrameCount: 1,
        expectedChainHead: head,
        sealedAt: at(3),
      })
    );
    expect(sealed.reference.status).toBe("sealed_unindexed");
  });
});

async function fixture(options: { prohibitedSentinels?: readonly Uint8Array[] } = {}) {
  const root = await temporaryRoot();
  return { root, store: protectedStore(root, options) };
}

function protectedStore(
  root: string,
  options: { prohibitedSentinels?: readonly Uint8Array[] } = {}
) {
  return new LocalProtectedEvidenceStore(root, {
    attestRoot: async () => true,
    syncDirectory: async () => undefined,
    now: () => START,
    ...options,
  });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lexrunner-protected-evidence-"));
  roots.push(root);
  return root;
}

function request(
  overrides: Partial<ProtectedEvidenceReservationRequest_v1> = {}
): ProtectedEvidenceReservationRequest_v1 {
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
    ...overrides,
  };
}

async function sealedCapture(store: LocalProtectedEvidenceStore, captureId: string) {
  const reservation = admitted(await store.reserveCapture(request({ capture_id: captureId })));
  applied(
    await store.openCapture({
      captureId,
      reservationToken: reservation.reservationToken,
      openedAt: at(1),
    })
  );
  const bytes = Buffer.from("synthetic evidence");
  applied(
    await store.appendFrame({
      captureId,
      reservationToken: reservation.reservationToken,
      sequence: 1,
      frameClass: "executor_stdout",
      bytes,
      observedAt: at(2),
    })
  );
  const head = computeProtectedEvidenceFrameHash({
    captureId,
    sequence: 1,
    frameClass: "executor_stdout",
    bytes,
    observedAt: at(2),
    previousFrameHash: initialProtectedEvidenceChainHead(),
  });
  const sealed = applied(
    await store.sealCapture({
      captureId,
      reservationToken: reservation.reservationToken,
      expectedFrameCount: 1,
      expectedChainHead: head,
      sealedAt: at(3),
    })
  );
  return {
    token: reservation.reservationToken,
    storeKey: sealed.reference.store_key,
    captureRoot: sealed.reference.capture_root!,
  };
}

function sealedDirectory(root: string, storeKey: string): string {
  return path.join(root, "captures", storeKey.replace("pe:", "pe-"));
}

async function readAllFiles(root: string): Promise<Buffer[]> {
  const result: Buffer[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await readAllFiles(target)));
    else if (entry.isFile()) result.push(await readFile(target));
  }
  return result;
}

function admitted(result: ProtectedEvidenceReservationResult) {
  if (!result.admitted) throw new Error(`capture was not admitted: ${result.reason}`);
  return result;
}

function applied(result: ProtectedEvidenceMutationResult) {
  if (!result.applied) throw new Error(`evidence mutation failed: ${result.reason}`);
  return result;
}

function at(seconds: number): string {
  return `2026-08-09T12:00:${String(seconds).padStart(2, "0")}.000Z`;
}
