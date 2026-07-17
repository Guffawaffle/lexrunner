import { describe, expect, it } from "vitest";
import {
  computeCanonicalHash,
  computeCanonicalHashFromCompactJSON,
} from "../../src/schemas/task-contract.js";
import {
  MAX_CANONICAL_ENVELOPE_BYTES,
  validateCanonicalEnvelope,
} from "../../src/store/workspace-lifecycle-evidence.js";
import type {
  AttemptRecord,
  BindLaunchEnvelopeInput,
  WorkspaceLifecycleLeaseRecord,
} from "../../src/store/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";

const attempt: AttemptRecord = {
  attemptId: "attempt-1",
  runId: "run-1",
  runRevision: 0,
  workItemId: "work-1",
  workItemRevision: 7,
  packetId: "packet-1",
  packetHash: `sha256:${"a".repeat(64)}`,
  baseSha: "b".repeat(40),
  revision: 2,
  status: "launching",
  workspaceLeaseId: "workspace-lease-1",
  receiptId: null,
  verificationId: null,
  createdAt: "2026-07-17T12:00:00.000Z",
  updatedAt: "2026-07-17T12:00:02.000Z",
  completedAt: null,
};

const lease: WorkspaceLifecycleLeaseRecord = {
  leaseId: "workspace-lease-1",
  runId: "run-1",
  runRevision: 0,
  workItemId: "work-1",
  workItemRevision: 7,
  packetId: "packet-1",
  packetHash: `sha256:${"a".repeat(64)}`,
  revision: 0,
  controllerId: "controller-1",
  controllerLeaseId: "controller-lease-1",
  fencingToken: 1,
  repositoryId: "repository-1",
  hostId: "host-1",
  gitRuntime: "wsl-git",
  projectRoot: "/srv/project",
  branch: "agent/work-1",
  worktreePath: "/srv/worktrees/work-1",
  baseSha: "b".repeat(40),
  status: "active",
  attemptId: "attempt-1",
  acquiredAt: "2026-07-17T12:00:01.000Z",
  heartbeatAt: "2026-07-17T12:00:01.000Z",
  expiresAt: "2026-07-17T12:10:00.000Z",
};

function envelopeFixture(): Record<string, unknown> {
  return {
    schema_version: "1.0.0",
    envelope_id: "envelope-1",
    run_id: "run-1",
    attempt_id: "attempt-1",
    packet_id: "packet-1",
    packet_hash: `sha256:${"a".repeat(64)}`,
    workspace_lease_id: "workspace-lease-1",
    workspace_lease_revision: 0,
    expected_head_sha: "b".repeat(40),
    branch: "agent/work-1",
    runtime: {
      host_id: "host-1",
      git_runtime: "wsl-git",
      worker_runtime: "codex-native",
    },
    paths: { worktree_root: "/srv/worktrees/work-1" },
    created_at: "2026-07-17T12:00:02.250Z",
  };
}

function bindingInput(envelope = envelopeFixture()): BindLaunchEnvelopeInput {
  return {
    runId: "run-1",
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-lease-1",
    expectedRunRevision: 0,
    expectedAttemptRevision: 2,
    expectedWorkspaceLeaseRevision: 0,
    controller: {
      runId: "run-1",
      controllerId: "controller-1",
      leaseId: "controller-lease-1",
      fencingToken: 1,
    },
    authorizationMutationId: "launch-1",
    envelopeId: "envelope-1",
    envelopeHash: computeCanonicalHash(envelope),
    envelopeJson: canonicalJSONStringify(envelope),
    createdAt: "2026-07-17T12:00:02.250Z",
  };
}

function mutatedEnvelope(mutate: (envelope: Record<string, any>) => void) {
  const envelope = envelopeFixture() as Record<string, any>;
  mutate(envelope);
  return bindingInput(envelope);
}

describe("canonical workspace launch-envelope evidence", () => {
  it("accepts a canonical envelope bound to the request, Attempt, and lease", () => {
    const input = bindingInput();
    const parsedCanonicalEnvelope = JSON.parse(input.envelopeJson);

    expect(validateCanonicalEnvelope(input, attempt, lease)).toEqual(envelopeFixture());
    expect(computeCanonicalHashFromCompactJSON(JSON.stringify(parsedCanonicalEnvelope))).toBe(
      computeCanonicalHash(envelopeFixture())
    );
  });

  it("rejects oversized, malformed, non-canonical, and hash-mismatched JSON", () => {
    const oversized = bindingInput();
    oversized.envelopeJson = "x".repeat(MAX_CANONICAL_ENVELOPE_BYTES + 1);

    const malformed = bindingInput();
    malformed.envelopeJson = "{";

    const nonCanonical = bindingInput();
    nonCanonical.envelopeJson = JSON.stringify(envelopeFixture());

    const hashMismatch = bindingInput();
    hashMismatch.envelopeHash = `sha256:${"f".repeat(64)}`;

    for (const input of [oversized, malformed, nonCanonical, hashMismatch]) {
      expect(validateCanonicalEnvelope(input, attempt, lease)).toBeNull();
    }
  });

  it.each([
    ["request envelope identity", (value: Record<string, any>) => (value.envelope_id = "other")],
    ["request run identity", (value: Record<string, any>) => (value.run_id = "other")],
    ["request attempt identity", (value: Record<string, any>) => (value.attempt_id = "other")],
    ["Attempt packet identity", (value: Record<string, any>) => (value.packet_id = "other")],
    [
      "Attempt packet hash",
      (value: Record<string, any>) => (value.packet_hash = `sha256:${"c".repeat(64)}`),
    ],
    [
      "request workspace lease",
      (value: Record<string, any>) => (value.workspace_lease_id = "other"),
    ],
    [
      "request workspace revision",
      (value: Record<string, any>) => (value.workspace_lease_revision = 1),
    ],
    ["Attempt head", (value: Record<string, any>) => (value.expected_head_sha = "c".repeat(40))],
    ["lease branch", (value: Record<string, any>) => (value.branch = "agent/other")],
    [
      "request timestamp",
      (value: Record<string, any>) => (value.created_at = "2026-07-17T12:00:03.000Z"),
    ],
    ["lease host", (value: Record<string, any>) => (value.runtime.host_id = "other")],
    [
      "lease Git runtime",
      (value: Record<string, any>) => (value.runtime.git_runtime = "win32-git"),
    ],
    [
      "lease worktree",
      (value: Record<string, any>) => (value.paths.worktree_root = "/srv/worktrees/other"),
    ],
  ])("rejects a mismatched %s binding", (_label, mutate) => {
    const input = mutatedEnvelope(mutate);

    expect(validateCanonicalEnvelope(input, attempt, lease)).toBeNull();
  });

  it.each([
    ["missing runtime record", (value: Record<string, any>) => (value.runtime = null)],
    ["array runtime record", (value: Record<string, any>) => (value.runtime = [])],
    ["missing paths record", (value: Record<string, any>) => (value.paths = null)],
    ["array paths record", (value: Record<string, any>) => (value.paths = [])],
  ])("rejects %s", (_label, mutate) => {
    const input = mutatedEnvelope(mutate);

    expect(validateCanonicalEnvelope(input, attempt, lease)).toBeNull();
  });
});
