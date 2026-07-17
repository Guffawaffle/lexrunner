import { describe, expect, it, vi } from "vitest";

import { AgentWorkAttemptReceiptService } from "../../src/runs/agent-work-attempt-receipt-service.js";
import type { AttemptReceiptSubmissionResult } from "../../src/store/workspace-lifecycle-store.js";

describe("AgentWorkAttemptReceiptService submission acknowledgement", () => {
  it("projects a durable receipt record to bounded prompt-safe metadata", async () => {
    const result = successfulSubmission({
      receiptId: "r".repeat(5_000),
      attemptId: "a".repeat(5_000),
    });
    const submitAttemptReceipt = vi.fn(async () => result);
    const service = new AgentWorkAttemptReceiptService({ submitAttemptReceipt } as never);

    const acknowledgement = await service.submit({} as never);

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
      submitAttemptReceipt: vi.fn(async () => result),
    } as never);

    await expect(service.submit({} as never)).resolves.toEqual(result);
  });
});

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
