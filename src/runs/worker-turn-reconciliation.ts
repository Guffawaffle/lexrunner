import { z } from "zod";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { WorkerDispatchRecord_v1 } from "../store/worker-dispatch-store.js";
import {
  WorkerObservationInput_v1,
  WorkerObservationRecord_v1,
} from "../store/worker-observation-store.js";
import {
  MAX_SESSION_EVIDENCE_BYTES,
  MAX_TURN_EVIDENCE_BYTES,
  TerminalTurnNotification,
  turnEvidenceHash,
} from "../store/worker-turn-evidence.js";

const Snapshot = z
  .object({
    dispatch: WorkerDispatchRecord_v1,
    observations: z.array(WorkerObservationRecord_v1).max(128),
    artifacts: z
      .array(
        z
          .object({
            observationId: WorkerObservationInput_v1.shape.observationId,
            notificationJson: z.string().max(MAX_TURN_EVIDENCE_BYTES),
          })
          .strict()
      )
      .max(128),
    // Caller declaration about this capture, not an attestation of complete task evidence.
    captureDisposition: z.enum(["unknown", "incomplete", "drained"]),
  })
  .strict();
export type WorkerTurnReconciliationInput = z.infer<typeof Snapshot>;
export type WorkerTurnReconciliationBlocker =
  | "capture_unsettled"
  | "acknowledgement_missing"
  | "terminal_report_missing"
  | "turn_conflict"
  | "outcome_conflict"
  | "evidence_conflict"
  | "artifact_missing";
export interface WorkerTurnReconciliation {
  scope: "supplied_snapshot";
  snapshotHash: string;
  verification: "not_performed";
  state: "unresolved" | "reported_terminal";
  blockers: WorkerTurnReconciliationBlocker[];
  acknowledgedTurnId: string | null;
  candidate: null | {
    turnId: string;
    reportedOutcome: "completed" | "failed" | "interrupted";
    evidenceHash: string;
    observationIds: string[];
  };
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure assessment of a supplied snapshot. No store writes, execution grants or completion claims. */
export function reconcileWorkerTurn(
  input: WorkerTurnReconciliationInput
): WorkerTurnReconciliation {
  const parsed = Snapshot.safeParse(input);
  if (!parsed.success) throw new Error("invalid_reconciliation_snapshot");
  const { dispatch, observations, artifacts, captureDisposition } = parsed.data;
  const byId = new Map(observations.map((record) => [record.observationId, record]));
  if (byId.size !== observations.length) throw new Error("duplicate_observation");
  const artifactById = new Map(
    artifacts.map((artifact) => [artifact.observationId, artifact.notificationJson])
  );
  if (artifactById.size !== artifacts.length) throw new Error("duplicate_artifact");
  let totalBytes = 0;
  for (const artifact of artifacts) {
    if (!byId.has(artifact.observationId)) throw new Error("orphan_artifact");
    const bytes = Buffer.byteLength(artifact.notificationJson, "utf8");
    totalBytes += bytes;
    if (bytes > MAX_TURN_EVIDENCE_BYTES || totalBytes > MAX_SESSION_EVIDENCE_BYTES)
      throw new Error("reconciliation_evidence_limit");
  }
  if (
    dispatch.acknowledgement &&
    Date.parse(dispatch.acknowledgement.observedAt) < Date.parse(dispatch.claimedAt)
  )
    throw new Error("invalid_acknowledgement_time");
  const blockers = new Set<WorkerTurnReconciliationBlocker>();
  if (captureDisposition !== "drained") blockers.add("capture_unsettled");
  if (!dispatch.acknowledgement) blockers.add("acknowledgement_missing");
  for (const record of observations) {
    for (const key of [
      "sessionId",
      "claimId",
      "requestHash",
      "workerId",
      "attemptId",
      "runId",
      "packetHash",
      "envelopeHash",
    ] as const)
      if (record[key] !== dispatch[key]) throw new Error("observation_binding_mismatch");
    const {
      schemaVersion: _,
      attemptId: _a,
      runId: _r,
      packetHash: _p,
      envelopeHash: _e,
      recordedAt,
      observationHash,
      ...report
    } = record;
    if (computeCanonicalHash(WorkerObservationInput_v1.parse(report)) !== observationHash)
      throw new Error("observation_hash_mismatch");
    if (
      Date.parse(record.observedAt) < Date.parse(dispatch.claimedAt) ||
      Date.parse(recordedAt) < Date.parse(record.observedAt)
    )
      throw new Error("invalid_observation_time");
    const artifact = artifactById.get(record.observationId);
    if (artifact === undefined) {
      if (record.kind !== "acknowledged") blockers.add("artifact_missing");
      continue;
    }
    if (turnEvidenceHash(artifact) !== record.evidenceHash)
      throw new Error("artifact_hash_mismatch");
    let event: z.infer<typeof TerminalTurnNotification>;
    try {
      event = TerminalTurnNotification.parse(JSON.parse(artifact));
    } catch {
      throw new Error("invalid_terminal_artifact");
    }
    if (
      event.params.threadId !== record.workerId ||
      event.params.turn.id !== record.turnId ||
      event.params.turn.status !== record.kind
    )
      throw new Error("artifact_observation_mismatch");
  }
  const turns = new Set(observations.map((record) => record.turnId));
  if (dispatch.acknowledgement) turns.add(dispatch.acknowledgement.turnId);
  if (turns.size > 1) blockers.add("turn_conflict");
  const terminal = observations.filter((record) => record.kind !== "acknowledged");
  if (!terminal.length) blockers.add("terminal_report_missing");
  if (new Set(terminal.map((record) => record.kind)).size > 1) blockers.add("outcome_conflict");
  if (new Set(terminal.map((record) => record.evidenceHash)).size > 1)
    blockers.add("evidence_conflict");
  const snapshotHash = computeCanonicalHash({
    dispatch,
    captureDisposition,
    observations: [...observations].sort((a, b) => compare(a.observationId, b.observationId)),
    artifacts: artifacts
      .map((artifact) => ({
        observationId: artifact.observationId,
        evidenceHash: turnEvidenceHash(artifact.notificationJson),
      }))
      .sort((a, b) => compare(a.observationId, b.observationId)),
  });
  const orderedBlockers = [...blockers].sort(compare);
  return {
    scope: "supplied_snapshot",
    snapshotHash,
    verification: "not_performed",
    state: blockers.size ? "unresolved" : "reported_terminal",
    blockers: orderedBlockers,
    acknowledgedTurnId: dispatch.acknowledgement?.turnId ?? null,
    candidate: blockers.size
      ? null
      : {
          turnId: dispatch.acknowledgement!.turnId,
          reportedOutcome: terminal[0].kind as "completed" | "failed" | "interrupted",
          evidenceHash: terminal[0].evidenceHash,
          observationIds: terminal.map((record) => record.observationId).sort(compare),
        },
  };
}
