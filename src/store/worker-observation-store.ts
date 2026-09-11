import { z } from "zod";
import { SHA256Hash, computeCanonicalHash } from "../schemas/task-contract.js";
import { WorkerDispatchRecord_v1, type WorkerDispatchRecord } from "./worker-dispatch-store.js";

/** Caller-reported evidence only. Recording it never advances a lifecycle or grants authority. */
export const WorkerObservationInput_v1 = z
  .object({
    sessionId: WorkerDispatchRecord_v1.shape.sessionId,
    claimId: WorkerDispatchRecord_v1.shape.claimId,
    requestHash: SHA256Hash,
    workerId: WorkerDispatchRecord_v1.shape.workerId,
    observationId: z.string().min(1).max(256),
    observerId: z.string().min(1).max(256),
    turnId: z.string().min(1),
    kind: z.enum(["acknowledged", "completed", "failed", "interrupted"]),
    observedAt: z.string().datetime({ offset: true }),
    evidenceHash: SHA256Hash,
    summary: z.string().max(8192),
  })
  .strict();
export type WorkerObservationInput = z.infer<typeof WorkerObservationInput_v1>;
export const WorkerObservationRecord_v1 = WorkerObservationInput_v1.extend({
  schemaVersion: z.literal("1.0.0"),
  attemptId: WorkerDispatchRecord_v1.shape.attemptId,
  runId: WorkerDispatchRecord_v1.shape.runId,
  packetHash: SHA256Hash,
  envelopeHash: SHA256Hash,
  recordedAt: z.string().datetime({ offset: true }),
  observationHash: SHA256Hash,
}).strict();
export type WorkerObservationRecord = z.infer<typeof WorkerObservationRecord_v1>;
export type WorkerObservationResult =
  | { recorded: true; replay: boolean; record: WorkerObservationRecord }
  | {
      recorded: false;
      reason:
        | "dispatch_missing"
        | "identity_mismatch"
        | "invalid_time"
        | "observation_conflict"
        | "observation_limit";
    };
export interface WorkerObservationStore {
  recordWorkerObservation(
    input: WorkerObservationInput,
    recordedAt: string
  ): Promise<WorkerObservationResult>;
  listWorkerObservations(sessionId: string): Promise<WorkerObservationRecord[]>;
}

export function parseWorkerObservation(input: WorkerObservationInput, recordedAt: string) {
  const parsed = WorkerObservationInput_v1.parse(input);
  WorkerObservationRecord_v1.shape.recordedAt.parse(recordedAt);
  return parsed;
}

/** Caller serializes journal writes; dispatch identity is immutable even after leases expire. */
export function reduceWorkerObservation(
  input: WorkerObservationInput,
  recordedAt: string,
  dispatch: WorkerDispatchRecord | null,
  prior: WorkerObservationRecord[]
): WorkerObservationResult {
  if (!dispatch) return { recorded: false, reason: "dispatch_missing" };
  if (
    input.sessionId !== dispatch.sessionId ||
    input.claimId !== dispatch.claimId ||
    input.requestHash !== dispatch.requestHash ||
    input.workerId !== dispatch.workerId
  )
    return { recorded: false, reason: "identity_mismatch" };
  if (
    Date.parse(input.observedAt) < Date.parse(dispatch.claimedAt) ||
    Date.parse(recordedAt) < Date.parse(input.observedAt)
  )
    return { recorded: false, reason: "invalid_time" };
  const observationHash = computeCanonicalHash(input);
  const existing = prior.find((record) => record.observationId === input.observationId);
  if (existing)
    return existing.observationHash === observationHash
      ? { recorded: true, replay: true, record: structuredClone(existing) }
      : { recorded: false, reason: "observation_conflict" };
  if (prior.length >= 128) return { recorded: false, reason: "observation_limit" };
  const record = WorkerObservationRecord_v1.parse({
    ...input,
    schemaVersion: "1.0.0",
    attemptId: dispatch.attemptId,
    runId: dispatch.runId,
    packetHash: dispatch.packetHash,
    envelopeHash: dispatch.envelopeHash,
    recordedAt,
    observationHash,
  });
  return { recorded: true, replay: false, record };
}
