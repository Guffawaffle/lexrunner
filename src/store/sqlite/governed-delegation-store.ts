import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DelegationDecisionReceipt_v1,
  DelegationOffer_v1,
  DelegationProtocolState_v1,
  authorizeDelegationInvocationBinding,
  computeDelegationOfferHash,
  recordDelegationDecision,
} from "../../runs/governed-attempt-protocol.js";
import { computeCanonicalHash } from "../../schemas/task-contract.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import {
  GOVERNED_DELEGATION_STORE_VERSION,
  GovernedDelegationEvent_v1,
  GovernedDelegationRecord_v1,
  redactDelegationReason,
  type AuthorizeGovernedDelegationInvocationInput,
  type AuthorizeGovernedDelegationInvocationResult,
  type CreateGovernedDelegationInput,
  type CreateGovernedDelegationResult,
  type GovernedDelegationEvent_v1 as GovernedDelegationEvent,
  type GovernedDelegationRecord_v1 as GovernedDelegationRecord,
  type GovernedDelegationStore,
  type RecordGovernedDelegationDecisionInput,
  type RecordGovernedDelegationDecisionResult,
} from "../governed-delegation-store.js";
import type { SqliteCoordinationStoreOptions } from "./coordination-store.js";
import { SqliteWorkspaceLifecycleStore } from "./workspace-lifecycle-store.js";

const INLINE_GOVERNED_DELEGATION_MIGRATION = `
CREATE TABLE IF NOT EXISTS governed_delegations (
 delegationId TEXT PRIMARY KEY, attemptId TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0),
 status TEXT NOT NULL CHECK(status IN ('offered','accepted','declined')),
 offerHash TEXT NOT NULL, stateJson TEXT NOT NULL CHECK(length(stateJson)<=262144),
 acceptanceReceiptHash TEXT, declineReceiptHash TEXT,
 declineReasonPresent INTEGER CHECK(declineReasonPresent IS NULL OR declineReasonPresent IN (0,1)),
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_governed_delegations_attempt
 ON governed_delegations(attemptId,createdAt,delegationId);
CREATE TABLE IF NOT EXISTS governed_delegation_events (
 delegationId TEXT NOT NULL, attemptId TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0),
 delegationRevision INTEGER NOT NULL CHECK(delegationRevision>=0),
 mutationId TEXT NOT NULL, mutationFingerprint TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('delegation_offered','delegation_accepted','delegation_declined',
  'delegation_invocation_authorized','delegation_invocation_denied')),
 decisionReceiptHash TEXT,
 declineReasonPresent INTEGER CHECK(declineReasonPresent IS NULL OR declineReasonPresent IN (0,1)),
 authorizationBindingHash TEXT,
 denialReason TEXT CHECK(denialReason IS NULL OR denialReason IN
  ('not_accepted','delegation_declined','binding_mismatch')),
 createdAt TEXT NOT NULL,
 PRIMARY KEY(delegationId,sequence), UNIQUE(delegationId,mutationId),
 FOREIGN KEY(delegationId) REFERENCES governed_delegations(delegationId) ON DELETE RESTRICT);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(11,'governed-delegations',datetime('now'));
`;

interface DelegationRow {
  delegationId: string;
  attemptId: string;
  revision: number;
  status: string;
  offerHash: string;
  stateJson: string;
  acceptanceReceiptHash: string | null;
  declineReceiptHash: string | null;
  declineReasonPresent: number | null;
  createdAt: string;
  updatedAt: string;
}

interface DelegationEventRow {
  delegationId: string;
  attemptId: string;
  sequence: number;
  delegationRevision: number;
  mutationId: string;
  mutationFingerprint: string;
  type: string;
  decisionReceiptHash: string | null;
  declineReasonPresent: number | null;
  authorizationBindingHash: string | null;
  denialReason: string | null;
  createdAt: string;
}

/** SQLite authority boundary for durable Delegation decisions and invocation permits. */
export class SqliteGovernedDelegationStore
  extends SqliteWorkspaceLifecycleStore
  implements GovernedDelegationStore
{
  constructor(dbPath: string, options: SqliteCoordinationStoreOptions = {}) {
    super(dbPath, options);
    if (!options.readOnly) {
      try {
        this.applyGovernedDelegationMigration();
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
  }

  async createDelegation(
    input: CreateGovernedDelegationInput
  ): Promise<CreateGovernedDelegationResult> {
    const offer = DelegationOffer_v1.parse(input.offer);
    const now = normalizeInstant(input.now);
    const offerHash = computeDelegationOfferHash(offer);
    const fingerprint = computeCanonicalHash({ kind: "offer", offer });
    return this.db.transaction(() => {
      const replay = this.mutationEvent(offer.delegation_id, input.mutationId);
      if (replay) {
        if (replay.mutation_fingerprint !== fingerprint || replay.type !== "delegation_offered") {
          return { created: false, reason: "mutation_conflict" } as const;
        }
        return {
          created: true,
          record: this.requireDelegation(offer.delegation_id),
          event: replay,
          idempotentReplay: true,
        } as const;
      }

      const existing = this.delegation(offer.delegation_id);
      if (existing) {
        if (existing.offer_hash !== offerHash) {
          return { created: false, reason: "delegation_conflict" } as const;
        }
        const event = this.events(offer.delegation_id)[0];
        if (!event) throw new Error("Governed Delegation is missing its offer event");
        return { created: true, record: existing, event, idempotentReplay: true } as const;
      }

      const state = DelegationProtocolState_v1.parse({
        schema_version: "1.0.0",
        offer,
        offer_hash: offerHash,
        status: "offered",
      });
      const record = GovernedDelegationRecord_v1.parse({
        schema_version: GOVERNED_DELEGATION_STORE_VERSION,
        delegation_id: offer.delegation_id,
        attempt_id: offer.attempt_id,
        revision: 0,
        status: "offered",
        state,
        offer_hash: offerHash,
        created_at: now,
        updated_at: now,
      });
      this.db
        .prepare(
          `INSERT INTO governed_delegations(
            delegationId,attemptId,revision,status,offerHash,stateJson,
            acceptanceReceiptHash,declineReceiptHash,declineReasonPresent,createdAt,updatedAt
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          record.delegation_id,
          record.attempt_id,
          record.revision,
          record.status,
          record.offer_hash,
          canonicalJSONStringify(record.state),
          null,
          null,
          null,
          record.created_at,
          record.updated_at
        );
      const event = this.insertEvent({
        schema_version: GOVERNED_DELEGATION_STORE_VERSION,
        delegation_id: record.delegation_id,
        attempt_id: record.attempt_id,
        sequence: 1,
        delegation_revision: 0,
        mutation_id: input.mutationId,
        mutation_fingerprint: fingerprint,
        type: "delegation_offered",
        created_at: now,
      });
      return { created: true, record, event, idempotentReplay: false } as const;
    })();
  }

  async recordDelegationDecision(
    input: RecordGovernedDelegationDecisionInput
  ): Promise<RecordGovernedDelegationDecisionResult> {
    const receipt = DelegationDecisionReceipt_v1.parse(input.receipt);
    const now = normalizeInstant(input.now);
    const receiptHash = computeCanonicalHash(receipt);
    const fingerprint = computeCanonicalHash({
      kind: "decision",
      delegation_id: input.delegationId,
      expected_revision: input.expectedRevision,
      receipt_hash: receiptHash,
    });
    return this.db.transaction(() => {
      const replay = this.mutationEvent(input.delegationId, input.mutationId);
      if (replay) {
        if (
          replay.mutation_fingerprint !== fingerprint ||
          !["delegation_accepted", "delegation_declined"].includes(replay.type)
        ) {
          return { recorded: false, reason: "mutation_conflict" } as const;
        }
        return {
          recorded: true,
          record: this.requireDelegation(input.delegationId),
          event: replay,
          decisionReceiptHash: replay.decision_receipt_hash!,
          idempotentReplay: true,
        } as const;
      }

      const current = this.delegation(input.delegationId);
      if (!current) return { recorded: false, reason: "not_found" } as const;
      if (current.revision !== input.expectedRevision) {
        return { recorded: false, reason: "stale_revision" } as const;
      }
      const decision = recordDelegationDecision(current.state, receipt);
      if (!decision.recorded) return { recorded: false, reason: decision.reason } as const;

      const state = redactDelegationReason(decision.state);
      const record = GovernedDelegationRecord_v1.parse({
        ...current,
        revision: current.revision + 1,
        status: state.status,
        state,
        ...(receipt.decision === "accept"
          ? { acceptance_receipt_hash: receiptHash }
          : {
              decline_receipt_hash: receiptHash,
              decline_reason_present: receipt.reason !== undefined,
            }),
        updated_at: now,
      });
      const changed = this.db
        .prepare(
          `UPDATE governed_delegations SET
            revision=?,status=?,stateJson=?,acceptanceReceiptHash=?,declineReceiptHash=?,
            declineReasonPresent=?,updatedAt=?
           WHERE delegationId=? AND revision=?`
        )
        .run(
          record.revision,
          record.status,
          canonicalJSONStringify(record.state),
          record.acceptance_receipt_hash ?? null,
          record.decline_receipt_hash ?? null,
          record.decline_reason_present === undefined
            ? null
            : record.decline_reason_present
              ? 1
              : 0,
          record.updated_at,
          record.delegation_id,
          current.revision
        );
      if (changed.changes !== 1) {
        return { recorded: false, reason: "stale_revision" } as const;
      }
      const event = this.insertEvent({
        schema_version: GOVERNED_DELEGATION_STORE_VERSION,
        delegation_id: record.delegation_id,
        attempt_id: record.attempt_id,
        sequence: this.nextSequence(record.delegation_id),
        delegation_revision: record.revision,
        mutation_id: input.mutationId,
        mutation_fingerprint: fingerprint,
        type: receipt.decision === "accept" ? "delegation_accepted" : "delegation_declined",
        decision_receipt_hash: receiptHash,
        ...(receipt.decision === "decline"
          ? { decline_reason_present: receipt.reason !== undefined }
          : {}),
        created_at: now,
      });
      return {
        recorded: true,
        record,
        event,
        decisionReceiptHash: receiptHash,
        idempotentReplay: false,
      } as const;
    })();
  }

  async authorizeDelegationInvocation(
    input: AuthorizeGovernedDelegationInvocationInput
  ): Promise<AuthorizeGovernedDelegationInvocationResult> {
    const request = structuredClone(input.request);
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "authorize",
      delegation_id: input.delegationId,
      expected_revision: input.expectedRevision,
      request,
      ...(input.repositoryLifecycleGuard
        ? { repository_lifecycle_guard: input.repositoryLifecycleGuard }
        : {}),
    });
    return this.db.transaction(() => {
      const replay = this.mutationEvent(input.delegationId, input.mutationId);
      if (replay) {
        if (
          replay.mutation_fingerprint !== fingerprint ||
          !["delegation_invocation_authorized", "delegation_invocation_denied"].includes(
            replay.type
          )
        ) {
          return { authorized: false, reason: "mutation_conflict" } as const;
        }
        const current = this.requireDelegation(input.delegationId);
        if (current.status === "declined") {
          return { authorized: false, reason: "delegation_declined", record: current } as const;
        }
        if (replay.type === "delegation_invocation_denied") {
          return {
            authorized: false,
            reason: replay.denial_reason!,
            record: current,
            event: replay,
            idempotentReplay: true,
          } as const;
        }
        return {
          authorized: true,
          record: current,
          event: replay,
          authorizationBindingHash: replay.authorization_binding_hash!,
          idempotentReplay: true,
        } as const;
      }

      const current = this.delegation(input.delegationId);
      if (!current) return { authorized: false, reason: "not_found" } as const;
      if (current.revision !== input.expectedRevision) {
        return { authorized: false, reason: "stale_revision" } as const;
      }
      const lifecycleAuthorized =
        !input.repositoryLifecycleGuard ||
        this.repositoryLifecycleMatches(current.attempt_id, input.repositoryLifecycleGuard, now);
      const authorization = lifecycleAuthorized
        ? authorizeDelegationInvocationBinding(
            {
              status: current.status,
              offer: current.state.offer,
              offerHash: current.offer_hash,
              ...(current.acceptance_receipt_hash
                ? { acceptanceReceiptHash: current.acceptance_receipt_hash }
                : {}),
            },
            request
          )
        : ({ authorized: false, reason: "binding_mismatch" } as const);
      const event = this.insertEvent({
        schema_version: GOVERNED_DELEGATION_STORE_VERSION,
        delegation_id: current.delegation_id,
        attempt_id: current.attempt_id,
        sequence: this.nextSequence(current.delegation_id),
        delegation_revision: current.revision,
        mutation_id: input.mutationId,
        mutation_fingerprint: fingerprint,
        type: authorization.authorized
          ? "delegation_invocation_authorized"
          : "delegation_invocation_denied",
        ...(authorization.authorized
          ? { authorization_binding_hash: authorization.authorizationBindingHash }
          : { denial_reason: authorization.reason }),
        created_at: now,
      });
      if (!authorization.authorized) {
        return {
          authorized: false,
          reason: authorization.reason,
          record: current,
          event,
          idempotentReplay: false,
        } as const;
      }
      return {
        authorized: true,
        record: current,
        event,
        authorizationBindingHash: authorization.authorizationBindingHash,
        idempotentReplay: false,
      } as const;
    })();
  }

  async getDelegation(delegationId: string): Promise<GovernedDelegationRecord | null> {
    return this.delegation(delegationId);
  }

  async listDelegationEvents(delegationId: string): Promise<GovernedDelegationEvent[]> {
    return this.events(delegationId);
  }

  protected repositoryLifecycleMatches(
    attemptId: string,
    binding: AuthorizeGovernedDelegationInvocationInput["repositoryLifecycleGuard"] & {},
    now: string
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT a.status AS attemptStatus, a.workspaceLeaseId AS attemptWorkspaceLeaseId,
                a.packetHash AS attemptPacketHash, l.status AS leaseStatus,
                l.revision AS leaseRevision, l.packetHash AS leasePacketHash,
                l.expiresAt AS leaseExpiresAt, e.workspaceLeaseId AS envelopeWorkspaceLeaseId,
                e.workspaceLeaseRevision AS envelopeWorkspaceLeaseRevision,
                e.envelopeHash AS envelopeHash, p.packetHash AS packetBindingHash
           FROM attempts a
           JOIN workspace_leases l ON l.leaseId=a.workspaceLeaseId AND l.attemptId=a.attemptId
           JOIN launch_envelope_bindings e ON e.attemptId=a.attemptId
           JOIN task_packet_bindings p ON p.attemptId=a.attemptId
          WHERE a.attemptId=?`
      )
      .get(attemptId) as
      | {
          attemptStatus: string;
          attemptWorkspaceLeaseId: string;
          attemptPacketHash: string;
          leaseStatus: string;
          leaseRevision: number;
          leasePacketHash: string;
          leaseExpiresAt: string;
          envelopeWorkspaceLeaseId: string;
          envelopeWorkspaceLeaseRevision: number;
          envelopeHash: string;
          packetBindingHash: string;
        }
      | undefined;
    return Boolean(
      row &&
      row.attemptStatus === "running" &&
      row.attemptWorkspaceLeaseId === binding.workspace_lease_id &&
      row.attemptPacketHash === binding.task_packet_hash &&
      row.leaseStatus === "active" &&
      row.leaseRevision >= binding.workspace_lease_revision &&
      row.leasePacketHash === binding.task_packet_hash &&
      Date.parse(row.leaseExpiresAt) > Date.parse(now) &&
      row.envelopeWorkspaceLeaseId === binding.workspace_lease_id &&
      row.envelopeWorkspaceLeaseRevision === binding.workspace_lease_revision &&
      row.envelopeHash === binding.launch_envelope_hash &&
      row.packetBindingHash === binding.task_packet_hash
    );
  }

  private delegation(delegationId: string): GovernedDelegationRecord | null {
    const row = this.db
      .prepare("SELECT * FROM governed_delegations WHERE delegationId=?")
      .get(delegationId) as DelegationRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  private requireDelegation(delegationId: string): GovernedDelegationRecord {
    const record = this.delegation(delegationId);
    if (!record) throw new Error("Governed Delegation event is missing its record");
    return record;
  }

  private events(delegationId: string): GovernedDelegationEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM governed_delegation_events WHERE delegationId=? ORDER BY sequence")
      .all(delegationId) as DelegationEventRow[];
    return rows.map(eventFromRow);
  }

  private mutationEvent(delegationId: string, mutationId: string): GovernedDelegationEvent | null {
    const row = this.db
      .prepare("SELECT * FROM governed_delegation_events WHERE delegationId=? AND mutationId=?")
      .get(delegationId, mutationId) as DelegationEventRow | undefined;
    return row ? eventFromRow(row) : null;
  }

  private nextSequence(delegationId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM governed_delegation_events WHERE delegationId=?"
      )
      .get(delegationId) as { sequence: number };
    return row.sequence;
  }

  private insertEvent(candidate: GovernedDelegationEvent): GovernedDelegationEvent {
    const event = GovernedDelegationEvent_v1.parse(candidate);
    this.db
      .prepare(
        `INSERT INTO governed_delegation_events(
          delegationId,attemptId,sequence,delegationRevision,mutationId,mutationFingerprint,type,
          decisionReceiptHash,declineReasonPresent,authorizationBindingHash,denialReason,createdAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        event.delegation_id,
        event.attempt_id,
        event.sequence,
        event.delegation_revision,
        event.mutation_id,
        event.mutation_fingerprint,
        event.type,
        event.decision_receipt_hash ?? null,
        event.decline_reason_present === undefined ? null : event.decline_reason_present ? 1 : 0,
        event.authorization_binding_hash ?? null,
        event.denial_reason ?? null,
        event.created_at
      );
    return event;
  }

  private applyGovernedDelegationMigration(): void {
    let sql = INLINE_GOVERNED_DELEGATION_MIGRATION;
    try {
      const migrationPath = fileURLToPath(
        new URL("./migrations/011-governed-delegations.sql", import.meta.url)
      );
      sql = readFileSync(migrationPath, "utf8");
    } catch {
      // Published bundles use the equivalent inline migration above.
    }
    this.db.exec(sql);
  }
}

function recordFromRow(row: DelegationRow): GovernedDelegationRecord {
  let state: unknown;
  try {
    state = JSON.parse(row.stateJson);
  } catch {
    throw new Error("Corrupt governed Delegation state JSON");
  }
  return GovernedDelegationRecord_v1.parse({
    schema_version: GOVERNED_DELEGATION_STORE_VERSION,
    delegation_id: row.delegationId,
    attempt_id: row.attemptId,
    revision: row.revision,
    status: row.status,
    state,
    offer_hash: row.offerHash,
    ...(row.acceptanceReceiptHash ? { acceptance_receipt_hash: row.acceptanceReceiptHash } : {}),
    ...(row.declineReceiptHash ? { decline_receipt_hash: row.declineReceiptHash } : {}),
    ...(row.declineReasonPresent === null
      ? {}
      : { decline_reason_present: row.declineReasonPresent === 1 }),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function eventFromRow(row: DelegationEventRow): GovernedDelegationEvent {
  return GovernedDelegationEvent_v1.parse({
    schema_version: GOVERNED_DELEGATION_STORE_VERSION,
    delegation_id: row.delegationId,
    attempt_id: row.attemptId,
    sequence: row.sequence,
    delegation_revision: row.delegationRevision,
    mutation_id: row.mutationId,
    mutation_fingerprint: row.mutationFingerprint,
    type: row.type,
    ...(row.decisionReceiptHash ? { decision_receipt_hash: row.decisionReceiptHash } : {}),
    ...(row.declineReasonPresent === null
      ? {}
      : { decline_reason_present: row.declineReasonPresent === 1 }),
    ...(row.authorizationBindingHash
      ? { authorization_binding_hash: row.authorizationBindingHash }
      : {}),
    ...(row.denialReason ? { denial_reason: row.denialReason } : {}),
    created_at: row.createdAt,
  });
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid governed Delegation timestamp");
  return new Date(timestamp).toISOString();
}
