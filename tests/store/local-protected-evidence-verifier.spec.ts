import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LocalProtectedEvidenceVerificationError,
  LocalProtectedEvidenceVerifier,
} from "../../src/store/local-protected-evidence-verifier.js";
import {
  LocalProtectedEvidenceStore,
  computeProtectedEvidenceFrameHash,
  initialProtectedEvidenceChainHead,
} from "../../src/store/local-protected-evidence-store.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";

const at = (seconds: number) => `2026-08-09T12:00:${String(seconds).padStart(2, "0")}.000Z`;
const hash = (value: string) => computeCanonicalHash({ value });

describe("LocalProtectedEvidenceVerifier", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), "lexrunner-evidence-verifier-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("replays a sealed container through a verifier-only raw-read port", async () => {
    const completed = await captureFixture(root);
    const verifier = new LocalProtectedEvidenceVerifier(root, { attestRoot: async () => true });

    const verified = await verifier.readVerifiedCapture("capture-1");

    expect(verified.reference).toEqual(completed);
    expect(verified.frames.map((frame) => frame.frameClass)).toEqual([
      "provider_receipt",
      "executor_stdout",
    ]);
    expect(Buffer.from(verified.frames[1]!.bytes).toString("utf8")).toContain("thread.started");
  });

  it("fails closed when sealed evidence bytes change after indexing", async () => {
    const completed = await captureFixture(root);
    const physical = completed.store_key.replace("pe:", "pe-");
    const frame = path.join(root, "captures", physical, "00000002.frame");
    const bytes = await fs.readFile(frame);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    await fs.writeFile(frame, bytes);
    const verifier = new LocalProtectedEvidenceVerifier(root, { attestRoot: async () => true });

    await expect(verifier.readVerifiedCapture("capture-1")).rejects.toMatchObject<
      Partial<LocalProtectedEvidenceVerificationError>
    >({ code: "frame_invalid" });
  });

  it("re-attests the protected root on every verification read", async () => {
    await captureFixture(root);
    const verifier = new LocalProtectedEvidenceVerifier(root, { attestRoot: async () => false });

    await expect(verifier.readVerifiedCapture("capture-1")).rejects.toMatchObject<
      Partial<LocalProtectedEvidenceVerificationError>
    >({ code: "root_untrusted" });
  });
});

async function captureFixture(root: string) {
  const store = new LocalProtectedEvidenceStore(root, {
    attestRoot: async () => true,
    syncDirectory: async () => undefined,
    now: () => at(0),
    random: (length) => Buffer.alloc(length, 0x11),
  });
  const binding = hash("binding");
  const reserved = await store.reserveCapture({
    capture_id: "capture-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: binding,
    executor_binding_digest: binding,
    environment_binding_digest: binding,
    workspace_binding_digest: binding,
    reserved_bytes: 64 * 1_024,
    reserved_frames: 10,
    reserved_events: 10,
    max_duration_ms: 60_000,
  });
  if (!reserved.admitted) throw new Error(`capture reservation failed: ${reserved.reason}`);
  const opened = await store.openCapture({
    captureId: "capture-1",
    reservationToken: reserved.reservationToken,
    openedAt: at(1),
  });
  if (!opened.applied) throw new Error(`capture open failed: ${opened.reason}`);

  const payloads = [
    {
      frameClass: "provider_receipt" as const,
      observedAt: at(2),
      bytes: Buffer.from('{"operation_id":"operation-1"}\n', "utf8"),
    },
    {
      frameClass: "executor_stdout" as const,
      observedAt: at(3),
      bytes: Buffer.from('{"type":"thread.started","thread_id":"thread-1"}\n', "utf8"),
    },
  ];
  let chainHead = initialProtectedEvidenceChainHead();
  for (const [index, payload] of payloads.entries()) {
    const sequence = index + 1;
    chainHead = computeProtectedEvidenceFrameHash({
      captureId: "capture-1",
      sequence,
      previousFrameHash: chainHead,
      ...payload,
    });
    const appended = await store.appendFrame({
      captureId: "capture-1",
      reservationToken: reserved.reservationToken,
      sequence,
      ...payload,
    });
    if (!appended.applied) throw new Error(`capture append failed: ${appended.reason}`);
  }
  const sealed = await store.sealCapture({
    captureId: "capture-1",
    reservationToken: reserved.reservationToken,
    expectedFrameCount: payloads.length,
    expectedChainHead: chainHead,
    sealedAt: at(4),
  });
  if (!sealed.applied || !sealed.reference.capture_root) {
    throw new Error("capture seal failed");
  }
  const indexed = await store.verifyAndIndexCapture({
    captureId: "capture-1",
    reservationToken: reserved.reservationToken,
    expectedCaptureRoot: sealed.reference.capture_root,
    indexedAt: at(5),
  });
  if (!indexed.applied || indexed.reference.status !== "complete") {
    throw new Error("capture verification failed");
  }
  return indexed.reference;
}
