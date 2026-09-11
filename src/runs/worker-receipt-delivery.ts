import {
  AgentTaskPacket_v1,
  ExecutionEnvelope_v1,
  validateAgentTaskReceiptV2PacketReferences,
} from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import {
  FinalAgentMessage,
  reduceWorkerReceiptEvidence,
  type WorkerReceiptEvidenceStore,
  type WorkerReceiptSnapshot,
} from "../store/worker-receipt-evidence.js";
import type {
  AttemptReceiptStore,
  TaskPacketBindingStore,
  LaunchEnvelopeBindingStore,
  WorkerSessionStore,
  WorkspaceLifecycleStore,
  EndWorkerSessionInput,
} from "../store/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { AgentWorkAttemptReceiptService } from "./agent-work-attempt-receipt-service.js";
import { AgentWorkWorkerSessionService } from "./agent-work-worker-session-service.js";
import {
  AgentWorkAttemptVerificationService,
  type RunAttemptVerificationInput,
} from "./agent-work-attempt-verification-service.js";
import { codexReceiptRequest, decodeCodexReceipt } from "./codex-receipt-contract.js";
import { reconcileWorkerTurn } from "./worker-turn-reconciliation.js";

type Store = WorkerReceiptEvidenceStore &
  AttemptReceiptStore &
  TaskPacketBindingStore &
  LaunchEnvelopeBindingStore &
  WorkerSessionStore &
  WorkspaceLifecycleStore;
export type WorkerReceiptDeliveryInput = Omit<
  EndWorkerSessionInput,
  "mutationId" | "now" | "status" | "exitReason" | "exitCode" | "exitSummary"
> & {
  /** Host observation, not a value inferred from database completeness. */
  captureDisposition: "unknown" | "incomplete" | "drained";
};

/** Rebuild provenance from durable source bytes. Never scrape terminal payloads or prose. */
export function assessWorkerReceipt(
  snapshot: WorkerReceiptSnapshot,
  captureDisposition: WorkerReceiptDeliveryInput["captureDisposition"]
) {
  const reconciliation = reconcileWorkerTurn({ ...snapshot.turn, captureDisposition });
  if (!reconciliation.candidate || reconciliation.candidate.reportedOutcome !== "completed")
    throw new Error("receipt_turn_unresolved");
  if (snapshot.receipts.length !== 1)
    throw new Error(snapshot.receipts.length ? "receipt_conflict" : "receipt_missing");
  const source = snapshot.receipts[0];
  const {
    recordHash,
    sourceHash,
    attemptId,
    runId,
    packetHash,
    envelopeHash,
    recordedAt,
    ...capture
  } = source;
  const checked = reduceWorkerReceiptEvidence(capture, recordedAt, snapshot.turn.dispatch, []);
  if (
    !checked.recorded ||
    canonicalJSONStringify(checked.record) !== canonicalJSONStringify(source)
  )
    throw new Error("receipt_provenance_mismatch");
  const event = FinalAgentMessage.parse(JSON.parse(source.notificationJson));
  if (event.params.turnId !== reconciliation.candidate.turnId)
    throw new Error("receipt_turn_mismatch");
  let value: unknown;
  try {
    value = JSON.parse(event.params.item.text);
  } catch {
    throw new Error("invalid_task_receipt");
  }
  let receipt;
  try {
    receipt = decodeCodexReceipt(value);
  } catch {
    throw new Error("invalid_task_receipt");
  }
  const dispatch = snapshot.turn.dispatch;
  if (
    receipt.run_id !== runId ||
    receipt.attempt_id !== attemptId ||
    receipt.packet_hash !== packetHash ||
    receipt.packet_id !== dispatch.packetId ||
    receipt.worker_session_id !== dispatch.sessionId ||
    receipt.workspace_lease_id !== dispatch.workspaceLeaseId ||
    Date.parse(receipt.worker_completed_at) > Date.parse(source.observedAt)
  )
    throw new Error("receipt_binding_mismatch");
  return {
    receipt,
    provenance: {
      sessionId: dispatch.sessionId,
      claimId: dispatch.claimId,
      requestHash: dispatch.requestHash,
      workerId: dispatch.workerId,
      turnId: event.params.turnId,
      itemId: event.params.item.id,
      observationId: source.observationId,
      sourceHash,
      recordHash,
      envelopeHash,
      reconciliationHash: reconciliation.snapshotHash,
      receiptHash: computeCanonicalHash(receipt),
    },
  };
}

/** Opt-in foreground delivery. The caller supplies authority; no task resend or verifier replacement. */
export class WorkerReceiptDeliveryService {
  private readonly receipts: Pick<AgentWorkAttemptReceiptService, "submit">;
  private readonly sessions: Pick<AgentWorkWorkerSessionService, "end">;
  constructor(
    private readonly store: Store,
    private readonly now: () => string = () => new Date().toISOString(),
    services?: {
      receipts: Pick<AgentWorkAttemptReceiptService, "submit">;
      sessions: Pick<AgentWorkWorkerSessionService, "end">;
    }
  ) {
    this.receipts = services?.receipts ?? new AgentWorkAttemptReceiptService(store);
    this.sessions = services?.sessions ?? new AgentWorkWorkerSessionService(store);
  }

  private async load(input: WorkerReceiptDeliveryInput) {
    const snapshot = await this.store.getWorkerReceiptSnapshot(input.sessionId);
    if (!snapshot) throw new Error("receipt_missing");
    const assessed = assessWorkerReceipt(snapshot, input.captureDisposition);
    const { receipt } = assessed;
    const dispatch = snapshot.turn.dispatch;
    if (
      input.runId !== dispatch.runId ||
      input.attemptId !== dispatch.attemptId ||
      input.workspaceLeaseId !== dispatch.workspaceLeaseId
    )
      throw new Error("delivery_binding_mismatch");
    const [packetBinding, envelopeBinding, session] = await Promise.all([
      this.store.getTaskPacketBinding(input.attemptId),
      this.store.getLaunchEnvelopeBinding(input.attemptId),
      this.store.getWorkerSession(input.sessionId),
    ]);
    if (!packetBinding || !envelopeBinding || !session)
      throw new Error("canonical_binding_missing");
    const packet = AgentTaskPacket_v1.parse(JSON.parse(packetBinding.packetJson));
    const envelope = ExecutionEnvelope_v1.parse(JSON.parse(envelopeBinding.envelopeJson));
    if (
      packet.packet_hash !== dispatch.packetHash ||
      computeCanonicalHash(envelope) !== dispatch.envelopeHash ||
      computeCanonicalHash(
        codexReceiptRequest(packet, envelope, dispatch.workerId, dispatch.sessionId)
      ) !== dispatch.requestHash ||
      receipt.work_item_id !== packet.work_item.work_item_id ||
      receipt.work_item_revision !== packet.work_item.revision ||
      receipt.observed_base_sha !== packet.repository.base_sha ||
      receipt.worker_runtime !== session.workerRuntime ||
      receipt.workspace_lease_revision !== session.workspaceLeaseRevision ||
      Date.parse(receipt.worker_started_at) < Date.parse(session.startedAt) ||
      !validateAgentTaskReceiptV2PacketReferences(packet, receipt).valid
    )
      throw new Error("receipt_request_mismatch");
    return { ...assessed, session };
  }

  async deliver(input: WorkerReceiptDeliveryInput) {
    input = structuredClone(input);
    const { receipt, provenance, session } = await this.load(input);
    const marker = `codex-receipt:${provenance.recordHash}`;
    const existing = await this.store.getAttemptReceiptForAttempt(input.attemptId);
    if (existing) {
      if (
        session.status !== "completed" ||
        session.exitReason !== marker ||
        existing.workerSessionId !== input.sessionId ||
        existing.receiptHash !== provenance.receiptHash ||
        existing.receiptJson !== canonicalJSONStringify(receipt)
      )
        throw new Error("receipt_conflict");
      return {
        state: "submitted" as const,
        replay: true,
        provenance,
        receiptId: existing.receiptId,
        disposition: existing.disposition,
        verification: "not_performed" as const,
      };
    }
    const now = this.now();
    if (!Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(receipt.submitted_at))
      throw new Error("invalid_delivery_time");
    let revision = input.expectedSessionRevision;
    if (session.status === "completed") {
      // Recovery after a committed end whose response was lost: accept only our exact source marker.
      if (
        session.exitReason !== marker ||
        session.revision !== input.expectedSessionRevision + 1 ||
        !session.endedAt ||
        Date.parse(session.endedAt) < Date.parse(receipt.worker_completed_at)
      )
        throw new Error("session_end_conflict");
      revision = session.revision;
    } else {
      if (session.revision !== input.expectedSessionRevision)
        throw new Error("stale_session_revision");
      const ended = await this.sessions.end({
        ...input,
        now,
        status: "completed",
        exitReason: marker,
        mutationId: `receipt-end:${computeCanonicalHash({ source: provenance.recordHash, now, controller: input.controller })}`,
      });
      if (!ended.updated) return { state: "blocked" as const, reason: ended.reason, provenance };
      revision = ended.workerSession.revision;
    }
    const result = await this.receipts.submit({
      runId: input.runId,
      expectedRunRevision: input.expectedRunRevision,
      controller: input.controller,
      attemptId: input.attemptId,
      expectedAttemptRevision: input.expectedAttemptRevision,
      workspaceLeaseId: input.workspaceLeaseId,
      expectedWorkspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
      workerSessionId: input.sessionId,
      expectedWorkerSessionRevision: revision,
      receipt,
      now: this.now(),
      mutationId: `receipt-submit:${computeCanonicalHash({ source: provenance.recordHash, now, controller: input.controller })}`,
    });
    if (!result.submitted) return { state: "blocked" as const, reason: result.reason, provenance };
    return {
      state: "submitted" as const,
      replay: result.idempotentReplay,
      provenance,
      receiptId: result.receiptId,
      disposition: result.disposition,
      verification: "not_performed" as const,
    };
  }

  /** Explicit verification request, using current evidence and the caller's existing verifier. */
  async verify(
    input: WorkerReceiptDeliveryInput,
    request: RunAttemptVerificationInput,
    verifier: Pick<AgentWorkAttemptVerificationService, "run">
  ) {
    input = structuredClone(input);
    request = structuredClone(request);
    const { receipt, provenance, session } = await this.load(input);
    const existing = await this.store.getAttemptReceiptForAttempt(input.attemptId);
    if (
      !existing ||
      existing.receiptHash !== provenance.receiptHash ||
      existing.receiptJson !== canonicalJSONStringify(receipt) ||
      existing.workerSessionId !== input.sessionId ||
      session.status !== "completed" ||
      session.exitReason !== `codex-receipt:${provenance.recordHash}`
    )
      throw new Error("submitted_receipt_provenance_mismatch");
    if (
      request.runId !== input.runId ||
      request.attemptId !== input.attemptId ||
      request.workerSessionId !== input.sessionId ||
      request.workspaceLeaseId !== input.workspaceLeaseId ||
      request.receiptId !== receipt.receipt_id ||
      request.receiptHash !== provenance.receiptHash
    )
      throw new Error("verification_receipt_mismatch");
    return verifier.run(request);
  }
}
