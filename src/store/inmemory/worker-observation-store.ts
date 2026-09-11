import { InMemoryWorkerDispatchStore } from "./worker-dispatch-store.js";
import {
  parseTurnEvidence,
  turnEvidenceHash,
  MAX_SESSION_EVIDENCE_BYTES,
  type WorkerTurnEvidenceStore,
  type WorkerTurnCaptureInput,
  type WorkerTurnCaptureResult,
} from "../worker-turn-evidence.js";
import {
  parseWorkerObservation,
  reduceWorkerObservation,
  type WorkerObservationStore,
  type WorkerObservationInput,
  type WorkerObservationRecord,
  type WorkerObservationResult,
} from "../worker-observation-store.js";

export class InMemoryWorkerObservationStore
  extends InMemoryWorkerDispatchStore
  implements WorkerObservationStore, WorkerTurnEvidenceStore
{
  private readonly observations = new Map<string, WorkerObservationRecord[]>();
  private readonly evidence = new Map<string, Map<string, string>>();
  async getWorkerTurnEvidence(sessionId: string, observationId: string): Promise<string | null> {
    const json = this.evidence.get(sessionId)?.get(observationId) ?? null;
    if (
      json !== null &&
      this.observations.get(sessionId)?.find((x) => x.observationId === observationId)
        ?.evidenceHash !== turnEvidenceHash(json)
    )
      throw new Error("evidence_hash_mismatch");
    return json;
  }
  async recordWorkerTurnEvidence(
    input: WorkerTurnCaptureInput,
    recordedAt: string
  ): Promise<WorkerTurnCaptureResult> {
    const captured = parseTurnEvidence(input);
    const parsed = parseWorkerObservation(captured.observation, recordedAt);
    const dispatch = await this.getWorkerDispatch(parsed.sessionId);
    const prior = this.observations.get(parsed.sessionId) ?? [];
    const result = reduceWorkerObservation(parsed, recordedAt, dispatch, prior);
    if (!result.recorded) return result;
    const artifacts = this.evidence.get(parsed.sessionId) ?? new Map<string, string>();
    const existing = artifacts.get(parsed.observationId);
    if (existing !== undefined && existing !== captured.notificationJson)
      throw new Error("evidence_conflict");
    if (
      existing === undefined &&
      [...artifacts.values()].reduce((n, json) => n + Buffer.byteLength(json, "utf8"), 0) +
        captured.bytes >
        MAX_SESSION_EVIDENCE_BYTES
    )
      return { recorded: false, reason: "evidence_limit" };
    // Both writes occur synchronously; no visibility of an observation without its artifact.
    artifacts.set(parsed.observationId, captured.notificationJson);
    this.evidence.set(parsed.sessionId, artifacts);
    if (!result.replay)
      this.observations.set(parsed.sessionId, [...prior, structuredClone(result.record)]);
    return result;
  }
  async listWorkerObservations(sessionId: string): Promise<WorkerObservationRecord[]> {
    return structuredClone(this.observations.get(sessionId) ?? []);
  }
  async recordWorkerObservation(
    input: WorkerObservationInput,
    recordedAt: string
  ): Promise<WorkerObservationResult> {
    const parsed = parseWorkerObservation(input, recordedAt);
    const dispatch = await this.getWorkerDispatch(parsed.sessionId);
    // No await from the journal read through append. Dispatch identity cannot change.
    const prior = this.observations.get(parsed.sessionId) ?? [];
    const result = reduceWorkerObservation(parsed, recordedAt, dispatch, prior);
    if (result.recorded && !result.replay)
      this.observations.set(parsed.sessionId, [...prior, structuredClone(result.record)]);
    return result;
  }
}
