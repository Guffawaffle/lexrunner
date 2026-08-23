import { isTerminalAttemptStatus } from "../../schemas/agent-work.js";
import { isTerminalWorkerSession } from "../workspace-lifecycle-domains.js";
import { computeCanonicalHash } from "../../schemas/task-contract.js";
import {
  ATTEMPT_AWAITABLE_CONTRACT_VERSION,
  MAX_ATTEMPT_AWAITABLE_DURATION_MS,
  MIN_ATTEMPT_AWAITABLE_DURATION_MS,
  AttemptAwaitableRecord_v1,
  AttemptAwaitableTerminalResult_v1,
  ExternalAwaitableDescriptor_v1,
  completionForAttemptAwaitable,
  deliveryIdForAttemptAwaitable,
  statusForAwaitableOutcome,
} from "../../runs/attempt-awaitable-contract.js";
import {
  AttemptAwaitableEvent_v1,
  type AcknowledgeAttemptAwaitableDeliveryInput,
  type AttemptAwaitableEvent_v1 as AttemptAwaitableEvent,
  type AttemptAwaitableLeaseCredential,
  type AttemptAwaitableStore,
  type BeginAttemptAwaitableDeliveryInput,
  type CancelAttemptAwaitableInput,
  type ClaimAttemptAwaitableObservationInput,
  type ClaimAttemptAwaitableObservationResult,
  type CompleteAttemptAwaitableInput,
  type MutateAttemptAwaitableResult,
  type RegisterAttemptAwaitableInput,
  type RegisterAttemptAwaitableResult,
  type ReleaseAttemptAwaitableObservationInput,
} from "../attempt-awaitable-store.js";
import type { JsonValue } from "../coordination-store.js";
import { InMemoryWorkspaceLifecycleStore } from "./workspace-lifecycle-store.js";

type AwaitableRecord = ReturnType<typeof AttemptAwaitableRecord_v1.parse>;

export class InMemoryAttemptAwaitableStore
  extends InMemoryWorkspaceLifecycleStore
  implements AttemptAwaitableStore
{
  private readonly awaitables = new Map<string, AwaitableRecord>();
  private readonly awaitableEvents = new Map<string, AttemptAwaitableEvent[]>();

  async registerAttemptAwaitable(
    input: RegisterAttemptAwaitableInput
  ): Promise<RegisterAttemptAwaitableResult> {
    const descriptor = ExternalAwaitableDescriptor_v1.parse(input.descriptor);
    const now = normalizeInstant(input.now);
    const deadlineAt = normalizeInstant(input.deadlineAt);
    requireDeadline(now, deadlineAt);
    const descriptorHash = computeCanonicalHash(descriptor);
    const fingerprint = computeCanonicalHash({
      kind: "attempt_awaitable_register",
      awaitable_id: input.awaitableId,
      attempt_id: input.attemptId,
      ...(input.workerSessionId ? { worker_session_id: input.workerSessionId } : {}),
      descriptor_hash: descriptorHash,
      deadline_at: deadlineAt,
    });
    const replay = this.findMutation(input.mutationId);
    if (replay) {
      if (
        replay.awaitable_id !== input.awaitableId ||
        replay.mutation_fingerprint !== fingerprint ||
        replay.type !== "awaitable_registered"
      ) {
        return { registered: false, reason: "mutation_conflict" };
      }
      return {
        registered: true,
        record: clone(this.awaitables.get(input.awaitableId)!),
        idempotentReplay: true,
      };
    }
    const existing = this.awaitables.get(input.awaitableId);
    if (existing) return { registered: false, reason: "awaitable_conflict" };
    const attempt = await this.getAttempt(input.attemptId);
    if (!attempt || isTerminalAttemptStatus(attempt.status)) {
      return { registered: false, reason: "attempt_not_live" };
    }
    if (input.workerSessionId) {
      const session = await this.getWorkerSession(input.workerSessionId);
      if (
        !session ||
        session.attemptId !== input.attemptId ||
        isTerminalWorkerSession(session.status)
      ) {
        return { registered: false, reason: "target_mismatch" };
      }
    }
    const record = AttemptAwaitableRecord_v1.parse({
      schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
      awaitable_id: input.awaitableId,
      attempt_id: input.attemptId,
      ...(input.workerSessionId ? { worker_session_id: input.workerSessionId } : {}),
      revision: 0,
      descriptor,
      descriptor_hash: descriptorHash,
      status: "registered",
      deadline_at: deadlineAt,
      observer_fencing_token: 0,
      created_at: now,
      updated_at: now,
    });
    this.appendEvent(record, input.mutationId, fingerprint, "awaitable_registered", {
      descriptor_hash: descriptorHash,
      deadline_at: deadlineAt,
      ...(input.workerSessionId ? { worker_session_id: input.workerSessionId } : {}),
    });
    this.awaitables.set(record.awaitable_id, record);
    return { registered: true, record: clone(record), idempotentReplay: false };
  }

  async claimAttemptAwaitableObservation(
    input: ClaimAttemptAwaitableObservationInput
  ): Promise<ClaimAttemptAwaitableObservationResult> {
    const now = normalizeInstant(input.now);
    const ttlMs = normalizeTtl(input.ttlMs);
    const fingerprint = computeCanonicalHash({
      kind: "attempt_awaitable_claim",
      awaitable_id: input.awaitableId,
      expected_revision: input.expectedRevision,
      observer_id: input.observerId,
      lease_id: input.leaseId,
      ttl_ms: ttlMs,
    });
    const replay = this.findMutation(input.mutationId);
    if (replay) {
      if (
        replay.awaitable_id !== input.awaitableId ||
        replay.mutation_fingerprint !== fingerprint ||
        replay.type !== "awaitable_observation_claimed"
      ) {
        return { claimed: false, reason: "mutation_conflict" };
      }
      const record = this.awaitables.get(input.awaitableId)!;
      const payload = replay.payload as Record<string, JsonValue>;
      return {
        claimed: true,
        record: clone(record),
        lease: {
          observer_id: String(payload.observer_id),
          lease_id: String(payload.lease_id),
          fencing_token: Number(payload.fencing_token),
          acquired_at: String(payload.acquired_at),
          expires_at: String(payload.expires_at),
        },
        idempotentReplay: true,
      };
    }
    const current = this.awaitables.get(input.awaitableId);
    if (!current) return { claimed: false, reason: "not_found" };
    if (isTerminal(current)) {
      return { claimed: false, reason: "terminal_latched", record: clone(current) };
    }
    if (current.revision !== input.expectedRevision) {
      return { claimed: false, reason: "stale_revision", record: clone(current) };
    }
    if (current.observer_lease && Date.parse(current.observer_lease.expires_at) > Date.parse(now)) {
      return { claimed: false, reason: "held_by_other", record: clone(current) };
    }
    const fencingToken = current.observer_fencing_token + 1;
    const lease = {
      observer_id: input.observerId,
      lease_id: input.leaseId,
      fencing_token: fencingToken,
      acquired_at: now,
      expires_at: new Date(Date.parse(now) + ttlMs).toISOString(),
    };
    const record = AttemptAwaitableRecord_v1.parse({
      ...current,
      revision: current.revision + 1,
      status: "observing",
      observer_fencing_token: fencingToken,
      observer_lease: lease,
      updated_at: now,
    });
    this.appendEvent(record, input.mutationId, fingerprint, "awaitable_observation_claimed", lease);
    this.awaitables.set(record.awaitable_id, record);
    return { claimed: true, record: clone(record), lease: clone(lease), idempotentReplay: false };
  }

  async releaseAttemptAwaitableObservation(
    input: ReleaseAttemptAwaitableObservationInput
  ): Promise<MutateAttemptAwaitableResult> {
    return this.mutateAwaitable(
      input,
      "awaitable_observation_released",
      { kind: "attempt_awaitable_release", lease: input.lease },
      (current, now) => {
        if (isTerminal(current)) return failure("terminal_latched", current);
        if (current.status !== "observing") return failure("not_observing", current);
        if (!leaseMatches(current, input.lease)) return failure("lease_mismatch", current);
        return success(
          AttemptAwaitableRecord_v1.parse({
            ...current,
            revision: current.revision + 1,
            status: "registered",
            observer_lease: undefined,
            updated_at: now,
          }),
          { fencing_token: input.lease.fencingToken }
        );
      }
    );
  }

  async completeAttemptAwaitable(
    input: CompleteAttemptAwaitableInput
  ): Promise<MutateAttemptAwaitableResult> {
    const terminalResult = AttemptAwaitableTerminalResult_v1.parse(input.result);
    return this.mutateAwaitable(
      input,
      "awaitable_terminal_recorded",
      { kind: "attempt_awaitable_complete", lease: input.lease, result: terminalResult },
      (current, now) => {
        if (isTerminal(current)) return failure("terminal_latched", current);
        if (current.status !== "observing") return failure("not_observing", current);
        if (!leaseMatches(current, input.lease)) return failure("lease_mismatch", current);
        if (terminalResult.provider !== current.descriptor.kind) {
          return failure("target_mismatch", current);
        }
        return success(terminalRecord(current, terminalResult, now), {
          outcome: terminalResult.outcome,
          result_hash: computeCanonicalHash(terminalResult),
        });
      }
    );
  }

  async cancelAttemptAwaitable(
    input: CancelAttemptAwaitableInput
  ): Promise<MutateAttemptAwaitableResult> {
    return this.mutateAwaitable(
      input,
      "awaitable_terminal_recorded",
      { kind: "attempt_awaitable_cancel" },
      (current, now) => {
        if (isTerminal(current)) return failure("terminal_latched", current);
        const result = AttemptAwaitableTerminalResult_v1.parse({
          schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
          provider: current.descriptor.kind,
          outcome: "cancelled",
          source: "lexrunner",
          observed_at: now,
          reason_code: "operator_cancelled",
        });
        return success(terminalRecord(current, result, now), {
          outcome: "cancelled",
          result_hash: computeCanonicalHash(result),
        });
      }
    );
  }

  async beginAttemptAwaitableDelivery(
    input: BeginAttemptAwaitableDeliveryInput
  ): Promise<MutateAttemptAwaitableResult> {
    return this.mutateAwaitable(
      input,
      "awaitable_delivery_attempted",
      { kind: "attempt_awaitable_delivery_attempt" },
      (current, now) => {
        if (!isTerminal(current) || !current.delivery) return failure("not_terminal", current);
        if (current.delivery.status !== "pending") return failure("delivery_conflict", current);
        return success(
          AttemptAwaitableRecord_v1.parse({
            ...current,
            revision: current.revision + 1,
            delivery: {
              ...current.delivery,
              attempt_count: current.delivery.attempt_count + 1,
              last_attempt_at: now,
            },
            updated_at: now,
          }),
          { delivery_id: current.delivery.delivery_id }
        );
      }
    );
  }

  async acknowledgeAttemptAwaitableDelivery(
    input: AcknowledgeAttemptAwaitableDeliveryInput
  ): Promise<MutateAttemptAwaitableResult> {
    return this.mutateAwaitable(
      input,
      "awaitable_delivery_acknowledged",
      {
        kind: "attempt_awaitable_delivery_acknowledge",
        delivery_id: input.deliveryId,
        completion_hash: input.completionHash,
      },
      (current, now) => {
        if (!isTerminal(current) || !current.delivery) return failure("not_terminal", current);
        if (
          current.delivery.delivery_id !== input.deliveryId ||
          current.delivery.completion_hash !== input.completionHash
        ) {
          return failure("delivery_conflict", current);
        }
        if (current.delivery.status === "delivered") {
          return failure("delivery_conflict", current);
        }
        return success(
          AttemptAwaitableRecord_v1.parse({
            ...current,
            revision: current.revision + 1,
            delivery: { ...current.delivery, status: "delivered", delivered_at: now },
            updated_at: now,
          }),
          { delivery_id: input.deliveryId, completion_hash: input.completionHash }
        );
      }
    );
  }

  async getAttemptAwaitable(awaitableId: string): Promise<AwaitableRecord | null> {
    const record = this.awaitables.get(awaitableId);
    return record ? clone(record) : null;
  }

  async listRecoverableAttemptAwaitables(nowCandidate: string): Promise<AwaitableRecord[]> {
    normalizeInstant(nowCandidate);
    return [...this.awaitables.values()]
      .filter((record) => record.status === "registered" || record.status === "observing")
      .sort(compareRecords)
      .map(clone);
  }

  async listPendingAttemptAwaitableDeliveries(): Promise<AwaitableRecord[]> {
    return [...this.awaitables.values()]
      .filter((record) => record.delivery?.status === "pending")
      .sort(compareRecords)
      .map(clone);
  }

  async listAttemptAwaitableEvents(awaitableId: string): Promise<AttemptAwaitableEvent[]> {
    return (this.awaitableEvents.get(awaitableId) ?? []).map(clone);
  }

  private async mutateAwaitable(
    input: {
      awaitableId: string;
      expectedRevision: number;
      mutationId: string;
      now: string;
    },
    eventType: AttemptAwaitableEvent["type"],
    semantic: Record<string, unknown>,
    action: (
      current: AwaitableRecord,
      now: string
    ) =>
      | { ok: true; record: AwaitableRecord; payload: JsonValue }
      | {
          ok: false;
          reason: Extract<MutateAttemptAwaitableResult, { updated: false }>["reason"];
        }
  ): Promise<MutateAttemptAwaitableResult> {
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      ...semantic,
      awaitable_id: input.awaitableId,
      expected_revision: input.expectedRevision,
    });
    const replay = this.findMutation(input.mutationId);
    if (replay) {
      if (
        replay.awaitable_id !== input.awaitableId ||
        replay.mutation_fingerprint !== fingerprint ||
        replay.type !== eventType
      ) {
        return { updated: false, reason: "mutation_conflict" };
      }
      return {
        updated: true,
        record: clone(this.awaitables.get(input.awaitableId)!),
        idempotentReplay: true,
      };
    }
    const current = this.awaitables.get(input.awaitableId);
    if (!current) return { updated: false, reason: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { updated: false, reason: "stale_revision", record: clone(current) };
    }
    const outcome = action(current, now);
    if (!outcome.ok) return { updated: false, reason: outcome.reason, record: clone(current) };
    this.appendEvent(outcome.record, input.mutationId, fingerprint, eventType, outcome.payload);
    this.awaitables.set(input.awaitableId, outcome.record);
    return { updated: true, record: clone(outcome.record), idempotentReplay: false };
  }

  private appendEvent(
    record: AwaitableRecord,
    mutationId: string,
    mutationFingerprint: string,
    type: AttemptAwaitableEvent["type"],
    payload: JsonValue
  ): void {
    const events = this.awaitableEvents.get(record.awaitable_id) ?? [];
    const event = AttemptAwaitableEvent_v1.parse({
      schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
      awaitable_id: record.awaitable_id,
      attempt_id: record.attempt_id,
      sequence: events.length + 1,
      awaitable_revision: record.revision,
      mutation_id: mutationId,
      mutation_fingerprint: mutationFingerprint,
      type,
      payload,
      created_at: record.updated_at,
    });
    events.push(event);
    this.awaitableEvents.set(record.awaitable_id, events);
  }

  private findMutation(mutationId: string): AttemptAwaitableEvent | undefined {
    for (const events of this.awaitableEvents.values()) {
      const event = events.find((candidate) => candidate.mutation_id === mutationId);
      if (event) return event;
    }
    return undefined;
  }
}

function terminalRecord(
  current: AwaitableRecord,
  result: ReturnType<typeof AttemptAwaitableTerminalResult_v1.parse>,
  now: string
): AwaitableRecord {
  const resultHash = computeCanonicalHash(result);
  const deliveryId = deliveryIdForAttemptAwaitable(current.awaitable_id);
  const completion = {
    schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
    delivery_id: deliveryId,
    awaitable_id: current.awaitable_id,
    attempt_id: current.attempt_id,
    ...(current.worker_session_id ? { worker_session_id: current.worker_session_id } : {}),
    descriptor_hash: current.descriptor_hash,
    result,
    result_hash: resultHash,
    terminal_at: now,
  };
  const record = AttemptAwaitableRecord_v1.parse({
    ...current,
    revision: current.revision + 1,
    status: statusForAwaitableOutcome(result.outcome),
    observer_lease: undefined,
    result,
    result_hash: resultHash,
    delivery: {
      delivery_id: deliveryId,
      status: "pending",
      completion_hash: computeCanonicalHash(completion),
      attempt_count: 0,
    },
    updated_at: now,
    terminal_at: now,
  });
  // Keep the construction path and the contract helper in lockstep.
  completionForAttemptAwaitable(record);
  return record;
}

function leaseMatches(current: AwaitableRecord, lease: AttemptAwaitableLeaseCredential): boolean {
  return (
    current.observer_lease?.observer_id === lease.observerId &&
    current.observer_lease.lease_id === lease.leaseId &&
    current.observer_lease.fencing_token === lease.fencingToken
  );
}

function isTerminal(record: AwaitableRecord): boolean {
  return !["registered", "observing"].includes(record.status);
}

function success(
  record: AwaitableRecord,
  payload: JsonValue
): { ok: true; record: AwaitableRecord; payload: JsonValue } {
  return { ok: true, record, payload };
}

function failure(
  reason: Extract<MutateAttemptAwaitableResult, { updated: false }>["reason"],
  _record: AwaitableRecord
): { ok: false; reason: Extract<MutateAttemptAwaitableResult, { updated: false }>["reason"] } {
  return { ok: false, reason };
}

function requireDeadline(now: string, deadlineAt: string): void {
  const duration = Date.parse(deadlineAt) - Date.parse(now);
  if (
    duration < MIN_ATTEMPT_AWAITABLE_DURATION_MS ||
    duration > MAX_ATTEMPT_AWAITABLE_DURATION_MS
  ) {
    throw new Error("Attempt awaitable deadline is outside the AXF bound");
  }
}

function normalizeTtl(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < 1_000 ||
    value > MAX_ATTEMPT_AWAITABLE_DURATION_MS + 60_000
  ) {
    throw new Error("Attempt awaitable observer TTL is invalid");
  }
  return value;
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid Attempt awaitable timestamp");
  return new Date(timestamp).toISOString();
}

function compareRecords(left: AwaitableRecord, right: AwaitableRecord): number {
  return left.created_at === right.created_at
    ? left.awaitable_id.localeCompare(right.awaitable_id)
    : left.created_at.localeCompare(right.created_at);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
