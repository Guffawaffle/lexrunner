import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentWorkAttemptReceiptService } from "../../src/runs/agent-work-attempt-receipt-service.js";
import { createAttemptExecutionPathMapping } from "../../src/runs/agent-work-path-mapping.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import type {
  AttemptReceiptSubmissionResult,
  AttemptRecord,
  LaunchEnvelopeBindingRecord,
  WorkerSessionRecord,
  WorkspaceLifecycleLeaseRecord,
} from "../../src/store/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";

const BASE_SHA = "d".repeat(40);
const PACKET_HASH = `sha256:${"c".repeat(64)}`;
const CREATED_AT = "2026-07-14T12:00:00.000Z";

let tempRoot: string;
let repositoryRoot: string;
let allocationRoot: string;
let worktreePath: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "lexrunner-receipt-service-"));
  repositoryRoot = join(tempRoot, "repository");
  allocationRoot = join(tempRoot, "worktrees");
  worktreePath = join(allocationRoot, "attempt-1");
  mkdirSync(repositoryRoot);
  mkdirSync(worktreePath, { recursive: true });
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("AgentWorkAttemptReceiptService submission acknowledgement", () => {
  it("projects a durable receipt record to bounded prompt-safe metadata", async () => {
    const result = successfulSubmission({
      receiptId: "r".repeat(5_000),
      attemptId: "a".repeat(5_000),
    });
    const submitAttemptReceipt = vi.fn(async () => result);
    const service = new AgentWorkAttemptReceiptService(evidenceBoundStore(submitAttemptReceipt));

    const acknowledgement = await service.submit(receiptSubmissionInput());

    expect(acknowledgement).toMatchObject({
      submitted: true,
      receiptHash: `sha256:${"b".repeat(64)}`,
      outcome: "completed",
      disposition: "verification_pending",
      attemptRevision: 7,
      attemptStatus: "receipt_submitted",
      event: {
        type: "attempt_receipt_submitted",
        sequence: 11,
        createdAt: "2026-07-14T12:00:02.000Z",
      },
      idempotentReplay: false,
    });
    if (!acknowledgement.submitted) throw new Error("expected acknowledgement");
    expect(Buffer.byteLength(acknowledgement.receiptId, "utf8")).toBe(4_096);
    expect(Buffer.byteLength(acknowledgement.attemptId, "utf8")).toBe(4_096);
    expect(acknowledgement.receiptId.endsWith("…")).toBe(true);
    expect(Object.keys(acknowledgement).sort()).toEqual([
      "attemptId",
      "attemptRevision",
      "attemptStatus",
      "disposition",
      "event",
      "idempotentReplay",
      "outcome",
      "receiptHash",
      "receiptId",
      "submitted",
    ]);
    expect(JSON.stringify(acknowledgement)).not.toContain("receiptJson");
    expect(JSON.stringify(acknowledgement)).not.toContain("stored worker summary");
  });

  it("preserves compact rejection metadata without manufacturing an acknowledgement", async () => {
    const result = {
      submitted: false,
      reason: "stale_attempt_revision",
      currentAttemptRevision: 8,
    } as const satisfies AttemptReceiptSubmissionResult;
    const service = new AgentWorkAttemptReceiptService({
      ...evidenceBoundStore(),
      submitAttemptReceipt: vi.fn(async () => result),
    } as never);

    await expect(service.submit(receiptSubmissionInput())).resolves.toEqual(result);
  });
});

function evidenceBoundStore(submitAttemptReceipt = vi.fn()) {
  const attempt: AttemptRecord = {
    attemptId: "attempt-1",
    runId: "run-1",
    runRevision: 1,
    workItemId: "work-1",
    workItemRevision: 3,
    packetId: "packet-1",
    packetHash: PACKET_HASH,
    baseSha: BASE_SHA,
    revision: 6,
    status: "running",
    workspaceLeaseId: "workspace-1",
    receiptId: null,
    verificationId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
  };
  const lease: WorkspaceLifecycleLeaseRecord = {
    leaseId: "workspace-1",
    runId: "run-1",
    runRevision: 1,
    workItemId: "work-1",
    workItemRevision: 3,
    packetId: "packet-1",
    packetHash: PACKET_HASH,
    revision: 4,
    controllerId: "controller-1",
    controllerLeaseId: "controller-lease-1",
    fencingToken: 1,
    repositoryId: "repository-1",
    hostId: "host-1",
    gitRuntime: "wsl-git",
    projectRoot: repositoryRoot,
    branch: "agent/work-1",
    worktreePath,
    attemptId: "attempt-1",
    baseSha: BASE_SHA,
    status: "active",
    acquiredAt: CREATED_AT,
    heartbeatAt: CREATED_AT,
    expiresAt: "2026-07-14T13:00:00.000Z",
  };
  const mapping = createAttemptExecutionPathMapping({
    repositoryId: lease.repositoryId,
    baseSha: attempt.baseSha,
    hostId: lease.hostId,
    gitRuntime: lease.gitRuntime,
    repositoryRoot: lease.projectRoot,
    allocationRoot,
    worktreePath: lease.worktreePath,
  });
  const envelope = {
    schema_version: "1.0.0",
    envelope_id: "envelope-1",
    run_id: attempt.runId,
    attempt_id: attempt.attemptId,
    packet_id: attempt.packetId,
    packet_hash: attempt.packetHash,
    workspace_lease_id: lease.leaseId,
    workspace_lease_revision: lease.revision,
    expected_head_sha: attempt.baseSha,
    branch: lease.branch,
    runtime: {
      host_id: lease.hostId,
      os: "linux",
      architecture: "x64",
      git_runtime: lease.gitRuntime,
      worker_runtime: "codex-native",
    },
    paths: {
      project_root: worktreePath,
      execution_root: worktreePath,
      allocation_root: allocationRoot,
      worktree_root: worktreePath,
    },
    path_mappings: [mapping],
    exposed_environment_keys: [],
    created_at: CREATED_AT,
  };
  const envelopeHash = computeCanonicalHash(envelope);
  const binding: LaunchEnvelopeBindingRecord = {
    runId: attempt.runId,
    attemptId: attempt.attemptId,
    workspaceLeaseId: lease.leaseId,
    attemptRevision: attempt.revision,
    workspaceLeaseRevision: lease.revision,
    authorizationMutationId: "launch-1",
    envelopeId: envelope.envelope_id,
    envelopeHash,
    envelopeJson: canonicalJSONStringify(envelope),
    controllerId: lease.controllerId,
    controllerLeaseId: lease.controllerLeaseId,
    fencingToken: lease.fencingToken,
    createdAt: envelope.created_at,
  };
  const session: WorkerSessionRecord = {
    sessionId: "worker-1",
    revision: 2,
    runId: attempt.runId,
    attemptId: attempt.attemptId,
    packetId: attempt.packetId,
    packetHash: attempt.packetHash,
    workspaceLeaseId: lease.leaseId,
    workspaceLeaseRevision: lease.revision,
    executionEnvelopeId: binding.envelopeId,
    executionEnvelopeHash: binding.envelopeHash,
    hostId: lease.hostId,
    workerRuntime: "codex-native",
    gitRuntime: lease.gitRuntime,
    backend: "host-subagent",
    workerId: "worker-native-1",
    status: "completed",
    startedAt: CREATED_AT,
    heartbeatAt: CREATED_AT,
    endedAt: "2026-07-14T12:00:01.000Z",
  };

  return {
    getAttempt: vi.fn(async () => attempt),
    getWorkspaceLease: vi.fn(async () => lease),
    getWorkerSession: vi.fn(async () => session),
    getLaunchEnvelopeBinding: vi.fn(async () => binding),
    submitAttemptReceipt,
  } as never;
}

function receiptSubmissionInput() {
  return {
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-1",
    workerSessionId: "worker-1",
  } as never;
}

function successfulSubmission(
  overrides: { receiptId?: string; attemptId?: string } = {}
): Extract<AttemptReceiptSubmissionResult, { submitted: true }> {
  const receiptId = overrides.receiptId ?? "receipt-1";
  const attemptId = overrides.attemptId ?? "attempt-1";
  return {
    submitted: true,
    receipt: {
      receiptId,
      receiptHash: `sha256:${"b".repeat(64)}`,
      receiptJson: '{"summary":"stored worker summary"}',
      runId: "run-1",
      workItemId: "work-1",
      workItemRevision: 3,
      attemptId,
      packetId: "packet-1",
      packetHash: `sha256:${"c".repeat(64)}`,
      workspaceLeaseId: "workspace-1",
      workspaceLeaseRevision: 4,
      workerSessionId: "worker-1",
      workerSessionRevision: 2,
      workerRuntime: "codex",
      observedBaseSha: "d".repeat(40),
      patchHash: `sha256:${"e".repeat(64)}`,
      outcome: "completed",
      disposition: "verification_pending",
      submittedAt: "2026-07-14T12:00:01.000Z",
      recordedAt: "2026-07-14T12:00:02.000Z",
      controllerId: "controller-1",
      controllerLeaseId: "controller-lease-1",
      fencingToken: 1,
      resultingAttemptRevision: 7,
      resultingAttemptStatus: "receipt_submitted",
    },
    attempt: {
      attemptId,
      runId: "run-1",
      runRevision: 1,
      workItemId: "work-1",
      workItemRevision: 3,
      packetId: "packet-1",
      packetHash: `sha256:${"c".repeat(64)}`,
      baseSha: "d".repeat(40),
      revision: 7,
      status: "receipt_submitted",
      workspaceLeaseId: "workspace-1",
      receiptId,
      verificationId: null,
      createdAt: "2026-07-14T11:00:00.000Z",
      updatedAt: "2026-07-14T12:00:02.000Z",
      completedAt: null,
    },
    event: {
      runId: "run-1",
      attemptId,
      receiptId,
      receiptHash: `sha256:${"b".repeat(64)}`,
      mutationId: "submit-1",
      sequence: 11,
      attemptRevision: 7,
      workspaceLeaseRevision: 4,
      workerSessionRevision: 2,
      controllerId: "controller-1",
      controllerLeaseId: "controller-lease-1",
      fencingToken: 1,
      type: "attempt_receipt_submitted",
      disposition: "verification_pending",
      outcome: "completed",
      createdAt: "2026-07-14T12:00:02.000Z",
    },
    idempotentReplay: false,
  };
}
