import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AttemptStatus, isTerminalAttemptStatus } from "../../schemas/agent-work.js";
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
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
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
import type { SqliteCoordinationStoreOptions } from "./coordination-store.js";
import { WorkerSessionStatus, isTerminalWorkerSession } from "../workspace-lifecycle-domains.js";
import { SqliteWorkspaceLifecycleStore } from "./workspace-lifecycle-store.js";

const INLINE_MIGRATION = `
CREATE TABLE IF NOT EXISTS attempt_awaitables (
 awaitableId TEXT PRIMARY KEY, attemptId TEXT NOT NULL, workerSessionId TEXT,
 revision INTEGER NOT NULL CHECK(revision>=0),
 status TEXT NOT NULL CHECK(status IN
 ('registered','observing','satisfied','terminal_failed','deadline','cancelled','subject_drift','observation_error')),
 deadlineAt TEXT NOT NULL, observerLeaseExpiresAt TEXT,
 deliveryStatus TEXT CHECK(deliveryStatus IS NULL OR deliveryStatus IN ('pending','delivered')),
 recordJson TEXT NOT NULL CHECK(length(recordJson)<=262144),
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, terminalAt TEXT,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE RESTRICT,
 FOREIGN KEY(workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS idx_attempt_awaitables_recovery
 ON attempt_awaitables(status,observerLeaseExpiresAt,createdAt,awaitableId);
CREATE INDEX IF NOT EXISTS idx_attempt_awaitables_delivery
 ON attempt_awaitables(deliveryStatus,terminalAt,awaitableId);
CREATE INDEX IF NOT EXISTS idx_attempt_awaitables_target
 ON attempt_awaitables(attemptId,workerSessionId,createdAt,awaitableId);
CREATE TABLE IF NOT EXISTS attempt_awaitable_events (
 awaitableId TEXT NOT NULL, attemptId TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0),
 awaitableRevision INTEGER NOT NULL CHECK(awaitableRevision>=0), mutationId TEXT NOT NULL UNIQUE,
 mutationFingerprint TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN
 ('awaitable_registered','awaitable_observation_claimed','awaitable_observation_released',
  'awaitable_terminal_recorded','awaitable_delivery_attempted','awaitable_delivery_acknowledged')),
 payloadJson TEXT NOT NULL CHECK(length(payloadJson)<=262144), createdAt TEXT NOT NULL,
 PRIMARY KEY(awaitableId,sequence),
 FOREIGN KEY(awaitableId) REFERENCES attempt_awaitables(awaitableId) ON DELETE RESTRICT);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(16,'attempt-awaitables',datetime('now'));
`;

interface AwaitableRow {
  awaitableId: string;
  attemptId: string;
  workerSessionId: string | null;
  revision: number;
  status: string;
  deadlineAt: string;
  observerLeaseExpiresAt: string | null;
  deliveryStatus: string | null;
  recordJson: string;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}

interface AwaitableEventRow {
  awaitableId: string;
  attemptId: string;
  sequence: number;
  awaitableRevision: number;
  mutationId: string;
  mutationFingerprint: string;
  type: string;
  payloadJson: string;
  createdAt: string;
}

type AwaitableRecord = ReturnType<typeof AttemptAwaitableRecord_v1.parse>;

export class SqliteAttemptAwaitableStore
  extends SqliteWorkspaceLifecycleStore
  implements AttemptAwaitableStore
{
  constructor(dbPath: string, options: SqliteCoordinationStoreOptions = {}) {
    super(dbPath, options);
    if (!options.readOnly) {
      try {
        this.applyAwaitableMigration();
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
  }

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
    return this.immediateTransaction(() => {
      const replay = this.eventByMutation(input.mutationId);
      if (replay) {
        if (
          replay.awaitableId !== input.awaitableId ||
          replay.mutationFingerprint !== fingerprint ||
          replay.type !== "awaitable_registered"
        ) {
          return { registered: false, reason: "mutation_conflict" } as const;
        }
        return {
          registered: true,
          record: this.requireAwaitable(input.awaitableId),
          idempotentReplay: true,
        } as const;
      }
      if (this.awaitable(input.awaitableId)) {
        return { registered: false, reason: "awaitable_conflict" } as const;
      }
      const attempt = this.db
        .prepare("SELECT status FROM attempts WHERE attemptId=?")
        .get(input.attemptId) as { status: string } | undefined;
      const attemptStatus = AttemptStatus.safeParse(attempt?.status);
      if (!attemptStatus.success || isTerminalAttemptStatus(attemptStatus.data)) {
        return { registered: false, reason: "attempt_not_live" } as const;
      }
      if (input.workerSessionId) {
        const session = this.db
          .prepare("SELECT attemptId,status FROM worker_sessions WHERE sessionId=?")
          .get(input.workerSessionId) as { attemptId: string; status: string } | undefined;
        const sessionStatus = WorkerSessionStatus.safeParse(session?.status);
        if (
          !session ||
          session.attemptId !== input.attemptId ||
          !sessionStatus.success ||
          isTerminalWorkerSession(sessionStatus.data)
        ) {
          return { registered: false, reason: "target_mismatch" } as const;
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
      this.insertAwaitable(record);
      this.insertEvent(record, input.mutationId, fingerprint, "awaitable_registered", {
        descriptor_hash: descriptorHash,
        deadline_at: deadlineAt,
        ...(input.workerSessionId ? { worker_session_id: input.workerSessionId } : {}),
      });
      return { registered: true, record, idempotentReplay: false } as const;
    });
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
    return this.immediateTransaction(() => {
      const replay = this.eventByMutation(input.mutationId);
      if (replay) {
        if (
          replay.awaitableId !== input.awaitableId ||
          replay.mutationFingerprint !== fingerprint ||
          replay.type !== "awaitable_observation_claimed"
        ) {
          return { claimed: false, reason: "mutation_conflict" } as const;
        }
        const event = eventFromRow(replay);
        const payload = event.payload as Record<string, JsonValue>;
        return {
          claimed: true,
          record: this.requireAwaitable(input.awaitableId),
          lease: {
            observer_id: String(payload.observer_id),
            lease_id: String(payload.lease_id),
            fencing_token: Number(payload.fencing_token),
            acquired_at: String(payload.acquired_at),
            expires_at: String(payload.expires_at),
          },
          idempotentReplay: true,
        } as const;
      }
      const current = this.awaitable(input.awaitableId);
      if (!current) return { claimed: false, reason: "not_found" } as const;
      if (isTerminal(current)) {
        return { claimed: false, reason: "terminal_latched", record: current } as const;
      }
      if (current.revision !== input.expectedRevision) {
        return { claimed: false, reason: "stale_revision", record: current } as const;
      }
      if (
        current.observer_lease &&
        Date.parse(current.observer_lease.expires_at) > Date.parse(now)
      ) {
        return { claimed: false, reason: "held_by_other", record: current } as const;
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
      this.updateAwaitable(record, current.revision);
      this.insertEvent(
        record,
        input.mutationId,
        fingerprint,
        "awaitable_observation_claimed",
        lease
      );
      return { claimed: true, record, lease, idempotentReplay: false } as const;
    });
  }

  async releaseAttemptAwaitableObservation(
    input: ReleaseAttemptAwaitableObservationInput
  ): Promise<MutateAttemptAwaitableResult> {
    return this.mutateAwaitable(
      input,
      "awaitable_observation_released",
      { kind: "attempt_awaitable_release", lease: input.lease },
      (current, now) => {
        if (isTerminal(current)) return failure("terminal_latched");
        if (current.status !== "observing") return failure("not_observing");
        if (!leaseMatches(current, input.lease)) return failure("lease_mismatch");
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
        if (isTerminal(current)) return failure("terminal_latched");
        if (current.status !== "observing") return failure("not_observing");
        if (!leaseMatches(current, input.lease)) return failure("lease_mismatch");
        if (terminalResult.provider !== current.descriptor.kind) return failure("target_mismatch");
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
        if (isTerminal(current)) return failure("terminal_latched");
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
        if (!isTerminal(current) || !current.delivery) return failure("not_terminal");
        if (current.delivery.status !== "pending") return failure("delivery_conflict");
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
        if (!isTerminal(current) || !current.delivery) return failure("not_terminal");
        if (
          current.delivery.delivery_id !== input.deliveryId ||
          current.delivery.completion_hash !== input.completionHash ||
          current.delivery.status !== "pending"
        ) {
          return failure("delivery_conflict");
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
    return this.awaitable(awaitableId);
  }

  async listRecoverableAttemptAwaitables(nowCandidate: string): Promise<AwaitableRecord[]> {
    normalizeInstant(nowCandidate);
    return (
      this.db
        .prepare(
          `SELECT * FROM attempt_awaitables
           WHERE status IN ('registered','observing')
           ORDER BY createdAt,awaitableId`
        )
        .all() as AwaitableRow[]
    ).map(recordFromRow);
  }

  async listPendingAttemptAwaitableDeliveries(): Promise<AwaitableRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT * FROM attempt_awaitables WHERE deliveryStatus='pending'
           ORDER BY terminalAt,awaitableId`
        )
        .all() as AwaitableRow[]
    ).map(recordFromRow);
  }

  async listAttemptAwaitableEvents(awaitableId: string): Promise<AttemptAwaitableEvent[]> {
    return (
      this.db
        .prepare("SELECT * FROM attempt_awaitable_events WHERE awaitableId=? ORDER BY sequence")
        .all(awaitableId) as AwaitableEventRow[]
    ).map(eventFromRow);
  }

  private mutateAwaitable(
    input: { awaitableId: string; expectedRevision: number; mutationId: string; now: string },
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
  ): MutateAttemptAwaitableResult {
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      ...semantic,
      awaitable_id: input.awaitableId,
      expected_revision: input.expectedRevision,
    });
    return this.immediateTransaction(() => {
      const replay = this.eventByMutation(input.mutationId);
      if (replay) {
        if (
          replay.awaitableId !== input.awaitableId ||
          replay.mutationFingerprint !== fingerprint ||
          replay.type !== eventType
        ) {
          return { updated: false, reason: "mutation_conflict" } as const;
        }
        return {
          updated: true,
          record: this.requireAwaitable(input.awaitableId),
          idempotentReplay: true,
        } as const;
      }
      const current = this.awaitable(input.awaitableId);
      if (!current) return { updated: false, reason: "not_found" } as const;
      if (current.revision !== input.expectedRevision) {
        return { updated: false, reason: "stale_revision", record: current } as const;
      }
      const outcome = action(current, now);
      if (!outcome.ok) return { updated: false, reason: outcome.reason, record: current } as const;
      this.updateAwaitable(outcome.record, current.revision);
      this.insertEvent(outcome.record, input.mutationId, fingerprint, eventType, outcome.payload);
      return { updated: true, record: outcome.record, idempotentReplay: false } as const;
    });
  }

  private insertAwaitable(record: AwaitableRecord): void {
    this.db
      .prepare(
        `INSERT INTO attempt_awaitables(
          awaitableId,attemptId,workerSessionId,revision,status,deadlineAt,
          observerLeaseExpiresAt,deliveryStatus,recordJson,createdAt,updatedAt,terminalAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(...rowValues(record));
  }

  private updateAwaitable(record: AwaitableRecord, expectedRevision: number): void {
    const changed = this.db
      .prepare(
        `UPDATE attempt_awaitables SET attemptId=?,workerSessionId=?,revision=?,status=?,deadlineAt=?,
          observerLeaseExpiresAt=?,deliveryStatus=?,recordJson=?,createdAt=?,updatedAt=?,terminalAt=?
         WHERE awaitableId=? AND revision=?`
      )
      .run(
        record.attempt_id,
        record.worker_session_id ?? null,
        record.revision,
        record.status,
        record.deadline_at,
        record.observer_lease?.expires_at ?? null,
        record.delivery?.status ?? null,
        canonicalJSONStringify(record),
        record.created_at,
        record.updated_at,
        record.terminal_at ?? null,
        record.awaitable_id,
        expectedRevision
      );
    if (changed.changes !== 1) throw new Error("Attempt awaitable revision changed concurrently");
  }

  private insertEvent(
    record: AwaitableRecord,
    mutationId: string,
    mutationFingerprint: string,
    type: AttemptAwaitableEvent["type"],
    payload: JsonValue
  ): void {
    const sequence = (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence),0)+1 AS value FROM attempt_awaitable_events WHERE awaitableId=?"
        )
        .get(record.awaitable_id) as { value: number }
    ).value;
    const event = AttemptAwaitableEvent_v1.parse({
      schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
      awaitable_id: record.awaitable_id,
      attempt_id: record.attempt_id,
      sequence,
      awaitable_revision: record.revision,
      mutation_id: mutationId,
      mutation_fingerprint: mutationFingerprint,
      type,
      payload,
      created_at: record.updated_at,
    });
    this.db
      .prepare(
        `INSERT INTO attempt_awaitable_events(
          awaitableId,attemptId,sequence,awaitableRevision,mutationId,mutationFingerprint,
          type,payloadJson,createdAt
        ) VALUES(?,?,?,?,?,?,?,?,?)`
      )
      .run(
        event.awaitable_id,
        event.attempt_id,
        event.sequence,
        event.awaitable_revision,
        event.mutation_id,
        event.mutation_fingerprint,
        event.type,
        canonicalJSONStringify(event.payload),
        event.created_at
      );
  }

  private awaitable(awaitableId: string): AwaitableRecord | null {
    const row = this.db
      .prepare("SELECT * FROM attempt_awaitables WHERE awaitableId=?")
      .get(awaitableId) as AwaitableRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  private requireAwaitable(awaitableId: string): AwaitableRecord {
    const record = this.awaitable(awaitableId);
    if (!record) throw new Error(`Attempt awaitable '${awaitableId}' disappeared`);
    return record;
  }

  private eventByMutation(mutationId: string): AwaitableEventRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM attempt_awaitable_events WHERE mutationId=?")
        .get(mutationId) as AwaitableEventRow | undefined) ?? null
    );
  }

  private applyAwaitableMigration(): void {
    let sql = INLINE_MIGRATION;
    try {
      const migrationPath = fileURLToPath(
        new URL("./migrations/016-attempt-awaitables.sql", import.meta.url)
      );
      sql = readFileSync(migrationPath, "utf8");
    } catch {
      // Published bundles use the equivalent inline migration above.
    }
    this.db.exec(sql);
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
  completionForAttemptAwaitable(record);
  return record;
}

function rowValues(record: AwaitableRecord): unknown[] {
  return [
    record.awaitable_id,
    record.attempt_id,
    record.worker_session_id ?? null,
    record.revision,
    record.status,
    record.deadline_at,
    record.observer_lease?.expires_at ?? null,
    record.delivery?.status ?? null,
    canonicalJSONStringify(record),
    record.created_at,
    record.updated_at,
    record.terminal_at ?? null,
  ];
}

function recordFromRow(row: AwaitableRow): AwaitableRecord {
  const record = AttemptAwaitableRecord_v1.parse(JSON.parse(row.recordJson));
  if (
    record.awaitable_id !== row.awaitableId ||
    record.attempt_id !== row.attemptId ||
    (record.worker_session_id ?? null) !== row.workerSessionId ||
    record.revision !== row.revision ||
    record.status !== row.status ||
    record.deadline_at !== row.deadlineAt ||
    (record.observer_lease?.expires_at ?? null) !== row.observerLeaseExpiresAt ||
    (record.delivery?.status ?? null) !== row.deliveryStatus ||
    record.created_at !== row.createdAt ||
    record.updated_at !== row.updatedAt ||
    (record.terminal_at ?? null) !== row.terminalAt
  ) {
    throw new Error(`Attempt awaitable row '${row.awaitableId}' is internally inconsistent`);
  }
  return record;
}

function eventFromRow(row: AwaitableEventRow): AttemptAwaitableEvent {
  return AttemptAwaitableEvent_v1.parse({
    schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
    awaitable_id: row.awaitableId,
    attempt_id: row.attemptId,
    sequence: row.sequence,
    awaitable_revision: row.awaitableRevision,
    mutation_id: row.mutationId,
    mutation_fingerprint: row.mutationFingerprint,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as JsonValue,
    created_at: row.createdAt,
  });
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

function failure(reason: Extract<MutateAttemptAwaitableResult, { updated: false }>["reason"]): {
  ok: false;
  reason: Extract<MutateAttemptAwaitableResult, { updated: false }>["reason"];
} {
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
