import { randomUUID } from "node:crypto";

import {
  ATTEMPT_AWAITABLE_CONTRACT_VERSION,
  MAX_ATTEMPT_AWAITABLE_DURATION_MS,
  MIN_ATTEMPT_AWAITABLE_DURATION_MS,
  AxfExternalAwaitResult_v1,
  AttemptAwaitableTerminalResult_v1,
  completionForAttemptAwaitable,
  type AxfExternalAwaitResult_v1 as AxfExternalAwaitResult,
  type AttemptAwaitableCompletion_v1 as AttemptAwaitableCompletion,
  type AttemptAwaitableRecord_v1 as AttemptAwaitableRecord,
  type ExternalAwaitableDescriptor_v1 as ExternalAwaitableDescriptor,
} from "./attempt-awaitable-contract.js";
import type {
  AttemptAwaitableLeaseCredential,
  AttemptAwaitableStore,
  MutateAttemptAwaitableResult,
  RegisterAttemptAwaitableResult,
} from "../store/attempt-awaitable-store.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";

const DEFAULT_LEASE_GRACE_MS = 60_000;

export interface AttemptAwaitableObservationRequest {
  descriptor: ExternalAwaitableDescriptor;
  deadlineMs: number;
  signal: AbortSignal;
}

/** AXF-facing port. Authority is supplied by this host adapter, never by the durable descriptor. */
export interface AttemptAwaitableObserver {
  observe(request: AttemptAwaitableObservationRequest): Promise<AxfExternalAwaitResult>;
}

/**
 * Provider-neutral continuation port. Implementations may enqueue a session message, notify a
 * coordinator, or persist another outbox entry. They must deduplicate by completion.delivery_id.
 */
export interface AttemptAwaitableNotifier {
  deliver(completion: AttemptAwaitableCompletion): Promise<void>;
}

export type AttemptAwaitableSupervisorNotice =
  | { type: "observation_started"; awaitableId: string }
  | { type: "observation_released"; awaitableId: string; reason: string }
  | { type: "terminal_recorded"; awaitableId: string; outcome: string }
  | { type: "delivery_succeeded"; awaitableId: string; deliveryId: string }
  | {
      type: "operation_failed";
      awaitableId: string;
      operation: "observe" | "release" | "deliver";
      message: string;
    };

export interface AttemptAwaitableSupervisorOptions {
  observerId: string;
  now?: () => string;
  leaseGraceMs?: number;
  createLeaseId?: (awaitableId: string) => string;
  onNotice?: (notice: AttemptAwaitableSupervisorNotice) => void | Promise<void>;
}

export interface RegisterDurableAttemptAwaitableInput {
  awaitableId: string;
  attemptId: string;
  workerSessionId?: string;
  descriptor: ExternalAwaitableDescriptor;
  deadlineMs: number;
  mutationId: string;
}

export interface RegisterDurableAttemptAwaitableResult {
  registration: RegisterAttemptAwaitableResult;
  attachment?: AttemptAwaitableAttachmentResult;
}

export type AttemptAwaitableAttachmentResult =
  | "attached"
  | "delivery_attached"
  | "already_attached"
  | "held_by_other"
  | "not_found"
  | "not_recoverable";

/**
 * Durable registration, restart recovery, and at-least-once completion delivery for Attempt-bound
 * external awaitables. Recovery performs one inventory read; live waiting happens inside AXF and
 * notification is event-driven. This supervisor never polls from the model or from LexRunner.
 */
export class AttemptAwaitableSupervisor {
  private readonly observations = new Map<
    string,
    { controller: AbortController; completion: Promise<void> }
  >();
  private readonly deliveries = new Map<string, Promise<void>>();
  private readonly leaseExpiryWakeups = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; completion: Promise<void>; resolve: () => void }
  >();
  private readonly now: () => string;
  private readonly leaseGraceMs: number;
  private readonly createLeaseId: (awaitableId: string) => string;
  private stopping = false;

  constructor(
    private readonly store: AttemptAwaitableStore,
    private readonly observer: AttemptAwaitableObserver,
    private readonly notifier: AttemptAwaitableNotifier,
    private readonly options: AttemptAwaitableSupervisorOptions
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseGraceMs = normalizeLeaseGrace(options.leaseGraceMs ?? DEFAULT_LEASE_GRACE_MS);
    this.createLeaseId = options.createLeaseId ?? (() => `lease:${randomUUID()}`);
  }

  async register(
    input: RegisterDurableAttemptAwaitableInput
  ): Promise<RegisterDurableAttemptAwaitableResult> {
    const deadlineMs = normalizeDeadline(input.deadlineMs);
    const now = this.now();
    const deadlineAt = new Date(Date.parse(now) + deadlineMs).toISOString();
    const registration = await this.store.registerAttemptAwaitable({
      awaitableId: input.awaitableId,
      attemptId: input.attemptId,
      ...(input.workerSessionId ? { workerSessionId: input.workerSessionId } : {}),
      descriptor: input.descriptor,
      deadlineAt,
      mutationId: input.mutationId,
      now,
    });
    if (!registration.registered) return { registration };
    return { registration, attachment: await this.attach(input.awaitableId) };
  }

  async recover(): Promise<{
    observations: string[];
    deliveries: string[];
    heldByOther: string[];
  }> {
    if (this.stopping) return { observations: [], deliveries: [], heldByOther: [] };
    const now = this.now();
    const [recoverable, pending] = await Promise.all([
      this.store.listRecoverableAttemptAwaitables(now),
      this.store.listPendingAttemptAwaitableDeliveries(),
    ]);
    const observations: string[] = [];
    const deliveries: string[] = [];
    const heldByOther: string[] = [];
    for (const record of recoverable) {
      const result = await this.attach(record.awaitable_id);
      if (result === "attached" || result === "already_attached") {
        observations.push(record.awaitable_id);
      } else if (result === "held_by_other") {
        heldByOther.push(record.awaitable_id);
      }
    }
    for (const record of pending) {
      if (this.attachDelivery(record.awaitable_id)) deliveries.push(record.awaitable_id);
    }
    return { observations, deliveries, heldByOther };
  }

  async attach(awaitableId: string): Promise<AttemptAwaitableAttachmentResult> {
    if (this.stopping) return "not_recoverable";
    if (this.observations.has(awaitableId)) return "already_attached";
    const current = await this.store.getAttemptAwaitable(awaitableId);
    if (!current) return "not_found";
    if (current.delivery?.status === "pending") {
      this.attachDelivery(awaitableId);
      return "delivery_attached";
    }
    if (!isLive(current)) return "not_recoverable";
    const now = this.now();
    if (current.observer_lease && Date.parse(current.observer_lease.expires_at) > Date.parse(now)) {
      this.scheduleLeaseExpiryWakeup(current);
      return "held_by_other";
    }
    const remainingMs = Math.max(0, Date.parse(current.deadline_at) - Date.parse(now));
    const leaseId = this.createLeaseId(awaitableId);
    const claim = await this.store.claimAttemptAwaitableObservation({
      awaitableId,
      expectedRevision: current.revision,
      observerId: this.options.observerId,
      leaseId,
      ttlMs: Math.max(
        MIN_ATTEMPT_AWAITABLE_DURATION_MS,
        Math.min(MAX_ATTEMPT_AWAITABLE_DURATION_MS + 60_000, remainingMs + this.leaseGraceMs)
      ),
      mutationId: derivedMutationId("claim", leaseId),
      now,
    });
    if (!claim.claimed) {
      if (claim.reason === "held_by_other") return "held_by_other";
      if (claim.record?.delivery?.status === "pending") {
        this.attachDelivery(awaitableId);
        return "delivery_attached";
      }
      return claim.reason === "not_found" ? "not_found" : "not_recoverable";
    }
    const controller = new AbortController();
    const lease: AttemptAwaitableLeaseCredential = {
      observerId: claim.lease.observer_id,
      leaseId: claim.lease.lease_id,
      fencingToken: claim.lease.fencing_token,
    };
    const completion = this.runObservation(claim.record, lease, controller.signal).finally(() => {
      this.observations.delete(awaitableId);
    });
    this.observations.set(awaitableId, { controller, completion });
    await this.notice({ type: "observation_started", awaitableId });
    return "attached";
  }

  async cancel(awaitableId: string, mutationId: string): Promise<MutateAttemptAwaitableResult> {
    const current = await this.store.getAttemptAwaitable(awaitableId);
    if (!current) return { updated: false, reason: "not_found" };
    const result = await this.store.cancelAttemptAwaitable({
      awaitableId,
      expectedRevision: current.revision,
      mutationId,
      now: this.now(),
    });
    if (result.updated) {
      this.clearLeaseExpiryWakeup(awaitableId);
      this.observations.get(awaitableId)?.controller.abort();
      this.attachDelivery(awaitableId);
    }
    return result;
  }

  async get(awaitableId: string): Promise<AttemptAwaitableRecord | null> {
    return this.store.getAttemptAwaitable(awaitableId);
  }

  async wait(awaitableId: string): Promise<void> {
    await this.leaseExpiryWakeups.get(awaitableId)?.completion;
    await this.observations.get(awaitableId)?.completion;
    await this.deliveries.get(awaitableId);
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const awaitableId of this.leaseExpiryWakeups.keys()) {
      this.clearLeaseExpiryWakeup(awaitableId);
    }
    for (const observation of this.observations.values()) observation.controller.abort();
    await Promise.allSettled([
      ...[...this.observations.values()].map((value) => value.completion),
      ...this.deliveries.values(),
    ]);
  }

  private async runObservation(
    record: AttemptAwaitableRecord,
    lease: AttemptAwaitableLeaseCredential,
    stopSignal: AbortSignal
  ): Promise<void> {
    const remainingMs = Math.max(0, Date.parse(record.deadline_at) - Date.parse(this.now()));
    if (remainingMs === 0) {
      await this.recordLexRunnerDeadline(record.awaitable_id, lease);
      return;
    }
    const deadlineController = new AbortController();
    const timer = setTimeout(() => deadlineController.abort(), remainingMs);
    const signal = AbortSignal.any([stopSignal, deadlineController.signal]);
    const observationDeadlineMs = Math.max(MIN_ATTEMPT_AWAITABLE_DURATION_MS, remainingMs);
    try {
      const observerResult = AxfExternalAwaitResult_v1.parse(
        await this.observer.observe({
          descriptor: record.descriptor,
          deadlineMs: observationDeadlineMs,
          signal,
        })
      );
      if (observerResult.provider !== record.descriptor.kind) {
        throw new Error("AXF result provider does not match the durable descriptor");
      }
      if (observerResult.effectiveDeadlineMs !== observationDeadlineMs) {
        throw new Error("AXF result deadline does not match the requested observation bound");
      }
      if (observerResult.outcome === "cancelled") {
        if (deadlineController.signal.aborted && !stopSignal.aborted) {
          await this.recordLexRunnerDeadline(record.awaitable_id, lease);
        } else {
          await this.release(record.awaitable_id, lease, "observer_cancelled");
        }
        return;
      }
      const terminalResult = AttemptAwaitableTerminalResult_v1.parse({
        schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
        provider: observerResult.provider,
        outcome: observerResult.outcome,
        source: "observer",
        observed_at: this.now(),
        observer_result: observerResult,
      });
      const completed = await this.complete(record.awaitable_id, lease, terminalResult);
      if (completed?.updated) {
        await this.notice({
          type: "terminal_recorded",
          awaitableId: record.awaitable_id,
          outcome: terminalResult.outcome,
        });
        this.attachDelivery(record.awaitable_id);
      }
    } catch (error) {
      if (deadlineController.signal.aborted && !stopSignal.aborted) {
        await this.recordLexRunnerDeadline(record.awaitable_id, lease);
        return;
      }
      await this.release(record.awaitable_id, lease, "observation_interrupted");
      if (stopSignal.aborted) return;
      await this.notice({
        type: "operation_failed",
        awaitableId: record.awaitable_id,
        operation: "observe",
        message: safeErrorName(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordLexRunnerDeadline(
    awaitableId: string,
    lease: AttemptAwaitableLeaseCredential
  ): Promise<void> {
    const current = await this.store.getAttemptAwaitable(awaitableId);
    if (!current || !leaseMatches(current, lease)) return;
    const result = AttemptAwaitableTerminalResult_v1.parse({
      schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
      provider: current.descriptor.kind,
      outcome: "deadline",
      source: "lexrunner",
      observed_at: this.now(),
      reason_code: "deadline_elapsed",
    });
    const completed = await this.complete(awaitableId, lease, result);
    if (completed?.updated) {
      await this.notice({ type: "terminal_recorded", awaitableId, outcome: "deadline" });
      this.attachDelivery(awaitableId);
    }
  }

  private async complete(
    awaitableId: string,
    lease: AttemptAwaitableLeaseCredential,
    result: ReturnType<typeof AttemptAwaitableTerminalResult_v1.parse>
  ): Promise<MutateAttemptAwaitableResult | null> {
    const current = await this.store.getAttemptAwaitable(awaitableId);
    if (!current || !leaseMatches(current, lease)) return null;
    return this.store.completeAttemptAwaitable({
      awaitableId,
      expectedRevision: current.revision,
      lease,
      result,
      mutationId: derivedMutationId("complete", lease.leaseId),
      now: this.now(),
    });
  }

  private async release(
    awaitableId: string,
    lease: AttemptAwaitableLeaseCredential,
    reason: string
  ): Promise<void> {
    const current = await this.store.getAttemptAwaitable(awaitableId);
    if (!current || !leaseMatches(current, lease)) return;
    const result = await this.store.releaseAttemptAwaitableObservation({
      awaitableId,
      expectedRevision: current.revision,
      lease,
      mutationId: derivedMutationId("release", lease.leaseId),
      now: this.now(),
    });
    if (result.updated) {
      await this.notice({ type: "observation_released", awaitableId, reason });
    } else {
      await this.notice({
        type: "operation_failed",
        awaitableId,
        operation: "release",
        message: result.reason,
      });
    }
  }

  private attachDelivery(awaitableId: string): boolean {
    if (this.stopping || this.deliveries.has(awaitableId)) return false;
    const delivery = this.runDelivery(awaitableId).finally(() => {
      this.deliveries.delete(awaitableId);
    });
    this.deliveries.set(awaitableId, delivery);
    return true;
  }

  private scheduleLeaseExpiryWakeup(record: AttemptAwaitableRecord): void {
    if (this.stopping || this.leaseExpiryWakeups.has(record.awaitable_id)) return;
    const delayMs = Math.max(
      0,
      Date.parse(record.observer_lease!.expires_at) - Date.parse(this.now()) + 1
    );
    let resolve!: () => void;
    const completion = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const timer = setTimeout(() => {
      this.leaseExpiryWakeups.delete(record.awaitable_id);
      void this.attach(record.awaitable_id).finally(resolve);
    }, delayMs);
    this.leaseExpiryWakeups.set(record.awaitable_id, { timer, completion, resolve });
  }

  private clearLeaseExpiryWakeup(awaitableId: string): void {
    const wakeup = this.leaseExpiryWakeups.get(awaitableId);
    if (!wakeup) return;
    clearTimeout(wakeup.timer);
    this.leaseExpiryWakeups.delete(awaitableId);
    wakeup.resolve();
  }

  private async runDelivery(awaitableId: string): Promise<void> {
    const current = await this.store.getAttemptAwaitable(awaitableId);
    if (!current?.delivery || current.delivery.status !== "pending") return;
    const attemptNumber = current.delivery.attempt_count + 1;
    const begun = await this.store.beginAttemptAwaitableDelivery({
      awaitableId,
      expectedRevision: current.revision,
      mutationId: derivedMutationId("deliver", {
        delivery_id: current.delivery.delivery_id,
        attempt: attemptNumber,
      }),
      now: this.now(),
    });
    if (!begun.updated || begun.record.delivery?.status !== "pending") return;
    const completion = completionForAttemptAwaitable(begun.record);
    try {
      await this.notifier.deliver(completion);
    } catch (error) {
      await this.notice({
        type: "operation_failed",
        awaitableId,
        operation: "deliver",
        message: safeErrorName(error),
      });
      return;
    }
    const acknowledged = await this.store.acknowledgeAttemptAwaitableDelivery({
      awaitableId,
      expectedRevision: begun.record.revision,
      deliveryId: completion.delivery_id,
      completionHash: begun.record.delivery.completion_hash,
      mutationId: derivedMutationId("acknowledge", completion.delivery_id),
      now: this.now(),
    });
    if (acknowledged.updated) {
      await this.notice({
        type: "delivery_succeeded",
        awaitableId,
        deliveryId: completion.delivery_id,
      });
    } else {
      await this.notice({
        type: "operation_failed",
        awaitableId,
        operation: "deliver",
        message: acknowledged.reason,
      });
    }
  }

  private async notice(notice: AttemptAwaitableSupervisorNotice): Promise<void> {
    try {
      await this.options.onNotice?.(notice);
    } catch {
      // Observability hooks cannot change durable lifecycle semantics.
    }
  }
}

function normalizeDeadline(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_ATTEMPT_AWAITABLE_DURATION_MS ||
    value > MAX_ATTEMPT_AWAITABLE_DURATION_MS
  ) {
    throw new Error(
      `deadlineMs must be an integer between ${MIN_ATTEMPT_AWAITABLE_DURATION_MS} and ${MAX_ATTEMPT_AWAITABLE_DURATION_MS}`
    );
  }
  return value;
}

function normalizeLeaseGrace(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new Error("leaseGraceMs must be an integer between 0 and 60000");
  }
  return value;
}

function isLive(record: AttemptAwaitableRecord): boolean {
  return record.status === "registered" || record.status === "observing";
}

function leaseMatches(
  record: AttemptAwaitableRecord,
  lease: AttemptAwaitableLeaseCredential
): boolean {
  return (
    record.observer_lease?.observer_id === lease.observerId &&
    record.observer_lease.lease_id === lease.leaseId &&
    record.observer_lease.fencing_token === lease.fencingToken
  );
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return Array.from(error.name || "Error")
    .slice(0, 128)
    .join("");
}

function derivedMutationId(kind: string, identity: unknown): string {
  return `${kind}:${computeCanonicalHash(identity)}`;
}
