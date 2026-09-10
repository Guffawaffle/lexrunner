import { z } from "zod";
import type {
  HeartbeatWorkerSessionInput,
  WorkerSessionRecord,
  WorkerSessionMutationFailureReason,
} from "./workspace-lifecycle-store.js";
import { SHA256Hash } from "../schemas/task-contract.js";

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const instant = z.string().datetime({ offset: true });
export const WorkerDispatchRecord_v1 = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    sessionId: id,
    attemptId: id,
    runId: id,
    claimId: id,
    packetId: id,
    packetHash: SHA256Hash,
    envelopeId: id,
    envelopeHash: SHA256Hash,
    requestHash: SHA256Hash,
    workerId: z.string().min(1).max(1024),
    workspaceLeaseId: id,
    workspaceLeaseRevision: z.number().int().nonnegative(),
    controllerId: id,
    controllerLeaseId: id,
    fencingToken: z.number().int().positive(),
    claimedAt: instant,
    acknowledgement: z.object({ turnId: id, observedAt: instant }).strict().optional(),
  })
  .strict();
export type WorkerDispatchRecord = z.infer<typeof WorkerDispatchRecord_v1>;

/** One claim slot per attached session. This is bookkeeping, not an external execution grant. */
export interface ClaimWorkerDispatchInput extends Omit<
  HeartbeatWorkerSessionInput,
  "status" | "mutationId"
> {
  claimId: string;
  packetHash: string;
  requestHash: string;
}
export interface AcknowledgeWorkerDispatchInput extends ClaimWorkerDispatchInput {
  turnId: string;
}
export type WorkerDispatchResult =
  | { recorded: true; newlyClaimed: boolean; record: WorkerDispatchRecord }
  | {
      recorded: false;
      reason:
        | WorkerSessionMutationFailureReason
        | "dispatch_conflict"
        | "dispatch_missing"
        | "acknowledgement_conflict";
    };

export interface WorkerDispatchStore {
  claimWorkerDispatch(input: ClaimWorkerDispatchInput): Promise<WorkerDispatchResult>;
  acknowledgeWorkerDispatch(input: AcknowledgeWorkerDispatchInput): Promise<WorkerDispatchResult>;
  getWorkerDispatch(sessionId: string): Promise<WorkerDispatchRecord | null>;
}

/** Validate before entering the synchronous store transaction. */
export function dispatchWorkerInput(input: ClaimWorkerDispatchInput): HeartbeatWorkerSessionInput {
  id.parse(input.claimId);
  SHA256Hash.parse(input.packetHash);
  SHA256Hash.parse(input.requestHash);
  instant.parse(input.now);
  return { ...input, mutationId: input.claimId };
}

/** Pure transition; caller must hold the canonical live-worker/controller critical section. */
export function reduceWorkerDispatch(
  input: ClaimWorkerDispatchInput,
  session: WorkerSessionRecord,
  prior: WorkerDispatchRecord | null,
  acknowledgement?: { turnId: string }
): WorkerDispatchResult {
  if (acknowledgement) id.parse(acknowledgement.turnId);
  if (input.packetHash !== session.packetHash)
    return { recorded: false, reason: "identity_mismatch" };
  if (
    prior &&
    (prior.claimId !== input.claimId ||
      prior.requestHash !== input.requestHash ||
      prior.packetHash !== session.packetHash ||
      prior.sessionId !== session.sessionId ||
      prior.envelopeHash !== session.executionEnvelopeHash)
  )
    return { recorded: false, reason: "dispatch_conflict" };
  if (
    prior &&
    Date.parse(input.now) < Date.parse(prior.acknowledgement?.observedAt ?? prior.claimedAt)
  ) {
    return { recorded: false, reason: "invalid_time" };
  }
  if (acknowledgement) {
    if (!prior) return { recorded: false, reason: "dispatch_missing" };
    if (prior.acknowledgement && prior.acknowledgement.turnId !== acknowledgement.turnId) {
      return { recorded: false, reason: "acknowledgement_conflict" };
    }
    return {
      recorded: true,
      newlyClaimed: false,
      record: WorkerDispatchRecord_v1.parse({
        ...prior,
        acknowledgement: prior.acknowledgement ?? {
          turnId: acknowledgement.turnId,
          observedAt: input.now,
        },
      }),
    };
  }
  if (prior) return { recorded: true, newlyClaimed: false, record: structuredClone(prior) };
  return {
    recorded: true,
    newlyClaimed: true,
    record: WorkerDispatchRecord_v1.parse({
      schemaVersion: "1.0.0",
      sessionId: session.sessionId,
      attemptId: session.attemptId,
      runId: session.runId,
      claimId: input.claimId,
      packetId: session.packetId,
      packetHash: session.packetHash,
      envelopeId: session.executionEnvelopeId,
      envelopeHash: session.executionEnvelopeHash,
      workerId: session.workerId,
      requestHash: input.requestHash,
      workspaceLeaseId: session.workspaceLeaseId,
      workspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      claimedAt: input.now,
    }),
  };
}
