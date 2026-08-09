import { randomUUID } from "node:crypto";

import { computeCanonicalHash } from "../src/schemas/task-contract.js";
import {
  LocalProtectedEvidenceStore,
  computeProtectedEvidenceFrameHash,
  initialProtectedEvidenceChainHead,
} from "../src/store/local-protected-evidence-store.js";
import {
  WindowsProtectedEvidenceAuthority,
  defaultWindowsProtectedEvidenceRoot,
} from "../src/store/windows-protected-evidence-authority.js";
import { canonicalJSONStringify } from "../src/util/canonicalJson.js";

const authority = new WindowsProtectedEvidenceAuthority();

try {
  const root = defaultWindowsProtectedEvidenceRoot();
  if (!(await authority.attestRoot(root))) {
    throw new Error("The protected-evidence root failed Windows authority attestation");
  }

  const declaredAt = new Date();
  const captureId = `qualification-${randomUUID()}`;
  const binding = computeCanonicalHash({
    kind: "windows-protected-evidence-qualification",
    capture_id: captureId,
  });
  const store = new LocalProtectedEvidenceStore(root, {
    attestRoot: (candidate) => authority.attestRoot(candidate),
    syncDirectory: (directory) => authority.syncDirectory(directory),
    now: () => declaredAt.toISOString(),
  });

  const reservation = await store.reserveCapture({
    capture_id: captureId,
    attempt_id: `qualification-attempt-${randomUUID()}`,
    delegation_id: `qualification-delegation-${randomUUID()}`,
    authorization_binding_digest: binding,
    executor_binding_digest: binding,
    environment_binding_digest: binding,
    workspace_binding_digest: binding,
    reserved_bytes: 4_096,
    reserved_frames: 1,
    reserved_events: 0,
    max_duration_ms: 60_000,
  });
  if (!reservation.admitted) {
    throw new Error(`Protected-evidence reservation was denied: ${reservation.reason}`);
  }

  const openedAt = new Date(declaredAt.getTime() + 1_000).toISOString();
  const opened = await store.openCapture({
    captureId,
    reservationToken: reservation.reservationToken,
    openedAt,
  });
  if (!opened.applied) throw new Error(`Protected-evidence open failed: ${opened.reason}`);

  const observedAt = new Date(declaredAt.getTime() + 2_000).toISOString();
  const bytes = Buffer.from(
    canonicalJSONStringify({
      schema_version: "1.0.0",
      control: "evidence_sink_protected",
      root_attested: true,
      authority: "windows-operator-dacl",
      directory_sync: "win32-directory-handle",
    }),
    "utf8"
  );
  const chainHead = computeProtectedEvidenceFrameHash({
    captureId,
    sequence: 1,
    frameClass: "control_evidence",
    observedAt,
    bytes,
    previousFrameHash: initialProtectedEvidenceChainHead(),
  });
  const appended = await store.appendFrame({
    captureId,
    reservationToken: reservation.reservationToken,
    sequence: 1,
    frameClass: "control_evidence",
    observedAt,
    bytes,
  });
  if (!appended.applied) throw new Error(`Protected-evidence append failed: ${appended.reason}`);

  const sealedAt = new Date(declaredAt.getTime() + 3_000).toISOString();
  const sealed = await store.sealCapture({
    captureId,
    reservationToken: reservation.reservationToken,
    expectedFrameCount: 1,
    expectedChainHead: chainHead,
    sealedAt,
  });
  if (!sealed.applied) throw new Error(`Protected-evidence seal failed: ${sealed.reason}`);
  const captureRoot = sealed.reference.capture_root;
  if (!captureRoot) throw new Error("Protected-evidence seal omitted its capture root");

  const indexed = await store.verifyAndIndexCapture({
    captureId,
    reservationToken: reservation.reservationToken,
    expectedCaptureRoot: captureRoot,
    indexedAt: new Date(declaredAt.getTime() + 4_000).toISOString(),
  });
  if (!indexed.applied) {
    throw new Error(`Protected-evidence fresh verification failed: ${indexed.reason}`);
  }
  if (indexed.reference.status !== "complete" || !indexed.reference.verification_hash) {
    throw new Error("Protected-evidence qualification did not reach complete verification");
  }

  process.stdout.write(
    canonicalJSONStringify({
      capture_id: indexed.reference.capture_id,
      store_key: indexed.reference.store_key,
      capture_root: indexed.reference.capture_root,
      verification_hash: indexed.reference.verification_hash,
    })
  );
} finally {
  await authority.close();
}
