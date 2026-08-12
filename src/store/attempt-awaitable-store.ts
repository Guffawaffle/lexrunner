import { z } from "zod";

import {
  ATTEMPT_AWAITABLE_CONTRACT_VERSION,
  AttemptAwaitableRecord_v1,
  AttemptAwaitableTerminalResult_v1,
  ExternalAwaitableDescriptor_v1,
  containsAttemptAwaitableCredentialValue,
  type AttemptAwaitableObserverLease_v1 as AttemptAwaitableObserverLease,
  type AttemptAwaitableRecord_v1 as AttemptAwaitableRecord,
  type AttemptAwaitableTerminalResult_v1 as AttemptAwaitableTerminalResult,
  type ExternalAwaitableDescriptor_v1 as ExternalAwaitableDescriptor,
} from "../runs/attempt-awaitable-contract.js";
import { SHA256Hash } from "../schemas/task-contract.js";
import type { JsonValue } from "./coordination-store.js";

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
  .refine(
    (value) => !containsAttemptAwaitableCredentialValue(value),
    "opaque identifiers must not contain credential material"
  );
const instant = z.string().datetime({ offset: true });

export const AttemptAwaitableEventType_v1 = z.enum([
  "awaitable_registered",
  "awaitable_observation_claimed",
  "awaitable_observation_released",
  "awaitable_terminal_recorded",
  "awaitable_delivery_attempted",
  "awaitable_delivery_acknowledged",
]);
export type AttemptAwaitableEventType_v1 = z.infer<typeof AttemptAwaitableEventType_v1>;

export const AttemptAwaitableEvent_v1 = z
  .object({
    schema_version: z.literal(ATTEMPT_AWAITABLE_CONTRACT_VERSION),
    awaitable_id: opaqueId,
    attempt_id: opaqueId,
    sequence: z.number().int().positive(),
    awaitable_revision: z.number().int().nonnegative(),
    mutation_id: opaqueId,
    mutation_fingerprint: SHA256Hash,
    type: AttemptAwaitableEventType_v1,
    payload: z.custom<JsonValue>(),
    created_at: instant,
  })
  .strict();
export type AttemptAwaitableEvent_v1 = z.infer<typeof AttemptAwaitableEvent_v1>;

export interface AttemptAwaitableLeaseCredential {
  observerId: string;
  leaseId: string;
  fencingToken: number;
}

export interface RegisterAttemptAwaitableInput {
  awaitableId: string;
  attemptId: string;
  workerSessionId?: string;
  descriptor: ExternalAwaitableDescriptor;
  deadlineAt: string;
  mutationId: string;
  now: string;
}

export interface ClaimAttemptAwaitableObservationInput {
  awaitableId: string;
  expectedRevision: number;
  observerId: string;
  leaseId: string;
  ttlMs: number;
  mutationId: string;
  now: string;
}

export interface ReleaseAttemptAwaitableObservationInput {
  awaitableId: string;
  expectedRevision: number;
  lease: AttemptAwaitableLeaseCredential;
  mutationId: string;
  now: string;
}

export interface CompleteAttemptAwaitableInput {
  awaitableId: string;
  expectedRevision: number;
  lease: AttemptAwaitableLeaseCredential;
  result: AttemptAwaitableTerminalResult;
  mutationId: string;
  now: string;
}

export interface CancelAttemptAwaitableInput {
  awaitableId: string;
  expectedRevision: number;
  mutationId: string;
  now: string;
}

export interface BeginAttemptAwaitableDeliveryInput {
  awaitableId: string;
  expectedRevision: number;
  mutationId: string;
  now: string;
}

export interface AcknowledgeAttemptAwaitableDeliveryInput {
  awaitableId: string;
  expectedRevision: number;
  deliveryId: string;
  completionHash: string;
  mutationId: string;
  now: string;
}

export type AttemptAwaitableMutationFailureReason =
  | "not_found"
  | "attempt_not_live"
  | "target_mismatch"
  | "awaitable_conflict"
  | "mutation_conflict"
  | "stale_revision"
  | "held_by_other"
  | "lease_mismatch"
  | "terminal_latched"
  | "not_observing"
  | "not_terminal"
  | "delivery_conflict";

export type RegisterAttemptAwaitableResult =
  | { registered: true; record: AttemptAwaitableRecord; idempotentReplay: boolean }
  | { registered: false; reason: AttemptAwaitableMutationFailureReason };

export type ClaimAttemptAwaitableObservationResult =
  | {
      claimed: true;
      record: AttemptAwaitableRecord;
      lease: AttemptAwaitableObserverLease;
      idempotentReplay: boolean;
    }
  | {
      claimed: false;
      reason: AttemptAwaitableMutationFailureReason;
      record?: AttemptAwaitableRecord;
    };

export type MutateAttemptAwaitableResult =
  | { updated: true; record: AttemptAwaitableRecord; idempotentReplay: boolean }
  | {
      updated: false;
      reason: AttemptAwaitableMutationFailureReason;
      record?: AttemptAwaitableRecord;
    };

export interface AttemptAwaitableStore {
  registerAttemptAwaitable(
    input: RegisterAttemptAwaitableInput
  ): Promise<RegisterAttemptAwaitableResult>;
  claimAttemptAwaitableObservation(
    input: ClaimAttemptAwaitableObservationInput
  ): Promise<ClaimAttemptAwaitableObservationResult>;
  releaseAttemptAwaitableObservation(
    input: ReleaseAttemptAwaitableObservationInput
  ): Promise<MutateAttemptAwaitableResult>;
  completeAttemptAwaitable(
    input: CompleteAttemptAwaitableInput
  ): Promise<MutateAttemptAwaitableResult>;
  cancelAttemptAwaitable(input: CancelAttemptAwaitableInput): Promise<MutateAttemptAwaitableResult>;
  beginAttemptAwaitableDelivery(
    input: BeginAttemptAwaitableDeliveryInput
  ): Promise<MutateAttemptAwaitableResult>;
  acknowledgeAttemptAwaitableDelivery(
    input: AcknowledgeAttemptAwaitableDeliveryInput
  ): Promise<MutateAttemptAwaitableResult>;
  getAttemptAwaitable(awaitableId: string): Promise<AttemptAwaitableRecord | null>;
  listRecoverableAttemptAwaitables(now: string): Promise<AttemptAwaitableRecord[]>;
  listPendingAttemptAwaitableDeliveries(): Promise<AttemptAwaitableRecord[]>;
  listAttemptAwaitableEvents(awaitableId: string): Promise<AttemptAwaitableEvent_v1[]>;
}

export function parseAttemptAwaitableRecord(value: unknown): AttemptAwaitableRecord {
  return AttemptAwaitableRecord_v1.parse(value);
}

export function parseAttemptAwaitableDescriptor(value: unknown): ExternalAwaitableDescriptor {
  return ExternalAwaitableDescriptor_v1.parse(value);
}

export function parseAttemptAwaitableTerminalResult(
  value: unknown
): AttemptAwaitableTerminalResult {
  return AttemptAwaitableTerminalResult_v1.parse(value);
}
