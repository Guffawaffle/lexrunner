import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AttemptAuthorization_v1,
  AttemptExecutorEvent_v1,
  AttemptExecutorHandle_v1,
  GovernedAttemptResult_v1,
} from "../../runs/governed-attempt-executor.js";
import {
  GovernedAttemptVerificationContext_v1,
  GovernedAttemptVerificationReceipt_v1,
} from "../../runs/governed-attempt-verification.js";
import { computeCanonicalHash } from "../../schemas/task-contract.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import {
  GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
  GovernedAttemptOperationEvent_v1,
  GovernedAttemptOperationRecord_v1,
  operationStatusForEvent,
  type AppendGovernedAttemptOperationEventInput,
  type AppendGovernedAttemptOperationEventResult,
  type CreateGovernedAttemptOperationInput,
  type CreateGovernedAttemptOperationResult,
  type GovernedAttemptOperationEvent_v1 as GovernedAttemptOperationEvent,
  type GovernedAttemptOperationRecord_v1 as GovernedAttemptOperationRecord,
  type GovernedAttemptOperationStore,
  type RecordGovernedAttemptOperationResultInput,
  type RecordGovernedAttemptOperationResultResult,
  type RecordGovernedAttemptOperationVerificationInput,
  type RecordGovernedAttemptOperationVerificationResult,
} from "../governed-attempt-operation-store.js";
import type { SqliteCoordinationStoreOptions } from "./coordination-store.js";
import { SqliteGovernedDelegationStore } from "./governed-delegation-store.js";

const INLINE_MIGRATION = `
CREATE TABLE IF NOT EXISTS governed_attempt_operations (
 operationId TEXT PRIMARY KEY, attemptId TEXT NOT NULL, delegationId TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0),
 status TEXT NOT NULL CHECK(status IN ('running','declined','completed','failed','cancelled','lost')),
 createMutationId TEXT NOT NULL UNIQUE, createMutationFingerprint TEXT NOT NULL,
 handleJson TEXT NOT NULL CHECK(length(handleJson)<=262144),
 authorizationJson TEXT NOT NULL CHECK(length(authorizationJson)<=262144),
 evidenceReservationJson TEXT CHECK(evidenceReservationJson IS NULL OR length(evidenceReservationJson)<=262144),
 evidenceDeclarationJson TEXT CHECK(evidenceDeclarationJson IS NULL OR length(evidenceDeclarationJson)<=262144),
 verificationContextJson TEXT CHECK(verificationContextJson IS NULL OR length(verificationContextJson)<=262144),
 lastEventSequence INTEGER NOT NULL CHECK(lastEventSequence>=0),
 resultJson TEXT CHECK(resultJson IS NULL OR length(resultJson)<=262144), resultHash TEXT,
 verificationJson TEXT CHECK(verificationJson IS NULL OR length(verificationJson)<=262144),
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, terminalAt TEXT,
 FOREIGN KEY(delegationId) REFERENCES governed_delegations(delegationId) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS idx_governed_attempt_operations_delegation
 ON governed_attempt_operations(delegationId,createdAt,operationId);
CREATE TABLE IF NOT EXISTS governed_attempt_operation_events (
 operationId TEXT NOT NULL, attemptId TEXT NOT NULL, delegationId TEXT NOT NULL,
 operationRevision INTEGER NOT NULL CHECK(operationRevision>0), mutationId TEXT NOT NULL,
 mutationFingerprint TEXT NOT NULL, executorSequence INTEGER NOT NULL CHECK(executorSequence>0),
 eventJson TEXT NOT NULL CHECK(length(eventJson)<=262144), createdAt TEXT NOT NULL,
 PRIMARY KEY(operationId,executorSequence), UNIQUE(mutationId),
 FOREIGN KEY(operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS governed_attempt_operation_result_mutations (
 mutationId TEXT PRIMARY KEY, operationId TEXT NOT NULL, mutationFingerprint TEXT NOT NULL,
 FOREIGN KEY(operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS governed_attempt_operation_verification_mutations (
 mutationId TEXT PRIMARY KEY, operationId TEXT NOT NULL, mutationFingerprint TEXT NOT NULL,
 FOREIGN KEY(operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(12,'governed-attempt-operations',datetime('now'));
`;

interface OperationRow {
  operationId: string;
  attemptId: string;
  delegationId: string;
  revision: number;
  status: string;
  createMutationId: string;
  createMutationFingerprint: string;
  handleJson: string;
  authorizationJson: string | null;
  evidenceReservationJson: string | null;
  evidenceDeclarationJson: string | null;
  verificationContextJson: string | null;
  lastEventSequence: number;
  resultJson: string | null;
  resultHash: string | null;
  verificationJson: string | null;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}

interface OperationEventRow {
  operationId: string;
  attemptId: string;
  delegationId: string;
  operationRevision: number;
  mutationId: string;
  mutationFingerprint: string;
  executorSequence: number;
  eventJson: string;
  createdAt: string;
}

interface ResultMutationRow {
  mutationId: string;
  operationId: string;
  mutationFingerprint: string;
}

interface VerificationMutationRow {
  mutationId: string;
  operationId: string;
  mutationFingerprint: string;
}

export class SqliteGovernedAttemptOperationStore
  extends SqliteGovernedDelegationStore
  implements GovernedAttemptOperationStore
{
  constructor(dbPath: string, options: SqliteCoordinationStoreOptions = {}) {
    super(dbPath, options);
    if (!options.readOnly) {
      try {
        this.applyOperationMigration();
        this.applyOperationBindingMigration();
        this.applyOperationVerificationMigration();
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
  }

  async createAttemptOperation(
    input: CreateGovernedAttemptOperationInput
  ): Promise<CreateGovernedAttemptOperationResult> {
    const handle = AttemptExecutorHandle_v1.parse(input.handle);
    const authorization = AttemptAuthorization_v1.parse(input.authorization);
    const verificationContext = input.verificationContext
      ? GovernedAttemptVerificationContext_v1.parse(input.verificationContext)
      : undefined;
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "operation_create",
      handle,
      authorization,
      ...(input.evidenceReservation ? { evidence_reservation: input.evidenceReservation } : {}),
      ...(input.evidenceDeclaration ? { evidence_declaration: input.evidenceDeclaration } : {}),
      ...(verificationContext ? { verification_context: verificationContext } : {}),
    });
    return this.db.transaction(() => {
      const replay = this.db
        .prepare("SELECT * FROM governed_attempt_operations WHERE createMutationId=?")
        .get(input.mutationId) as OperationRow | undefined;
      if (replay) {
        if (
          replay.operationId !== handle.operation_id ||
          replay.createMutationFingerprint !== fingerprint
        ) {
          return { created: false, reason: "mutation_conflict" } as const;
        }
        return { created: true, record: recordFromRow(replay), idempotentReplay: true } as const;
      }
      const existing = this.operation(handle.operation_id);
      if (existing) {
        if (
          computeCanonicalHash({
            kind: "operation_create",
            handle: existing.handle,
            authorization: existing.authorization,
            ...(existing.evidence_reservation
              ? { evidence_reservation: existing.evidence_reservation }
              : {}),
            ...(existing.evidence_declaration
              ? { evidence_declaration: existing.evidence_declaration }
              : {}),
            ...(existing.verification_context
              ? { verification_context: existing.verification_context }
              : {}),
          }) !== fingerprint
        ) {
          return { created: false, reason: "operation_conflict" } as const;
        }
        return { created: true, record: existing, idempotentReplay: true } as const;
      }
      if (!this.getDelegationSync(handle.delegation_id)) {
        return { created: false, reason: "binding_mismatch" } as const;
      }
      if (
        verificationContext?.repository_corpus &&
        !this.repositoryLifecycleMatches(
          handle.attempt_id,
          verificationContext.repository_corpus,
          now
        )
      ) {
        return { created: false, reason: "binding_mismatch" } as const;
      }
      const mutation =
        this.db
          .prepare("SELECT 1 FROM governed_attempt_operation_events WHERE mutationId=?")
          .get(input.mutationId) ??
        this.db
          .prepare("SELECT 1 FROM governed_attempt_operation_result_mutations WHERE mutationId=?")
          .get(input.mutationId) ??
        this.db
          .prepare(
            "SELECT 1 FROM governed_attempt_operation_verification_mutations WHERE mutationId=?"
          )
          .get(input.mutationId);
      if (mutation) return { created: false, reason: "mutation_conflict" } as const;
      const record = GovernedAttemptOperationRecord_v1.parse({
        schema_version: GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
        operation_id: handle.operation_id,
        attempt_id: handle.attempt_id,
        delegation_id: handle.delegation_id,
        revision: 0,
        status: "running",
        handle,
        authorization,
        ...(input.evidenceReservation ? { evidence_reservation: input.evidenceReservation } : {}),
        ...(input.evidenceDeclaration ? { evidence_declaration: input.evidenceDeclaration } : {}),
        ...(verificationContext ? { verification_context: verificationContext } : {}),
        last_event_sequence: 0,
        created_at: now,
        updated_at: now,
      });
      this.db
        .prepare(
          `INSERT INTO governed_attempt_operations(
            operationId,attemptId,delegationId,revision,status,createMutationId,
            createMutationFingerprint,handleJson,authorizationJson,evidenceReservationJson,
            evidenceDeclarationJson,verificationContextJson,lastEventSequence,resultJson,resultHash,
            verificationJson,createdAt,updatedAt,terminalAt
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          record.operation_id,
          record.attempt_id,
          record.delegation_id,
          record.revision,
          record.status,
          input.mutationId,
          fingerprint,
          canonicalJSONStringify(record.handle),
          canonicalJSONStringify(record.authorization),
          record.evidence_reservation ? canonicalJSONStringify(record.evidence_reservation) : null,
          record.evidence_declaration ? canonicalJSONStringify(record.evidence_declaration) : null,
          record.verification_context ? canonicalJSONStringify(record.verification_context) : null,
          0,
          null,
          null,
          null,
          record.created_at,
          record.updated_at,
          null
        );
      return { created: true, record, idempotentReplay: false } as const;
    })();
  }

  async appendAttemptOperationEvent(
    input: AppendGovernedAttemptOperationEventInput
  ): Promise<AppendGovernedAttemptOperationEventResult> {
    const executorEvent = AttemptExecutorEvent_v1.parse(input.event);
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "operation_event",
      operation_id: input.operationId,
      expected_revision: input.expectedRevision,
      event: executorEvent,
    });
    return this.db.transaction(() => {
      const replayRow = this.db
        .prepare("SELECT * FROM governed_attempt_operation_events WHERE mutationId=?")
        .get(input.mutationId) as OperationEventRow | undefined;
      if (replayRow) {
        const replay = eventFromRow(replayRow);
        if (
          replay.operation_id !== input.operationId ||
          replay.mutation_fingerprint !== fingerprint
        ) {
          return { appended: false, reason: "mutation_conflict" } as const;
        }
        return {
          appended: true,
          record: this.requireOperation(input.operationId),
          event: replay,
          idempotentReplay: true,
        } as const;
      }
      const current = this.operation(input.operationId);
      if (!current) return { appended: false, reason: "not_found" } as const;
      if (current.revision !== input.expectedRevision) {
        return { appended: false, reason: "stale_revision" } as const;
      }
      if (current.status !== "running") {
        return { appended: false, reason: "terminal_latched" } as const;
      }
      if (executorEvent.sequence !== current.last_event_sequence + 1) {
        return { appended: false, reason: "sequence_mismatch" } as const;
      }
      const status = operationStatusForEvent(executorEvent);
      const revision = current.revision + 1;
      this.db
        .prepare(
          `UPDATE governed_attempt_operations SET revision=?,status=?,lastEventSequence=?,
             updatedAt=?,terminalAt=? WHERE operationId=? AND revision=?`
        )
        .run(
          revision,
          status,
          executorEvent.sequence,
          now,
          status === "running" ? null : now,
          current.operation_id,
          current.revision
        );
      const event = GovernedAttemptOperationEvent_v1.parse({
        schema_version: GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
        operation_id: current.operation_id,
        attempt_id: current.attempt_id,
        delegation_id: current.delegation_id,
        operation_revision: revision,
        mutation_id: input.mutationId,
        mutation_fingerprint: fingerprint,
        event: executorEvent,
        created_at: now,
      });
      this.db
        .prepare(
          `INSERT INTO governed_attempt_operation_events(
            operationId,attemptId,delegationId,operationRevision,mutationId,mutationFingerprint,
            executorSequence,eventJson,createdAt
          ) VALUES(?,?,?,?,?,?,?,?,?)`
        )
        .run(
          event.operation_id,
          event.attempt_id,
          event.delegation_id,
          event.operation_revision,
          event.mutation_id,
          event.mutation_fingerprint,
          event.event.sequence,
          canonicalJSONStringify(event.event),
          event.created_at
        );
      return {
        appended: true,
        record: this.requireOperation(input.operationId),
        event,
        idempotentReplay: false,
      } as const;
    })();
  }

  async recordAttemptOperationResult(
    input: RecordGovernedAttemptOperationResultInput
  ): Promise<RecordGovernedAttemptOperationResultResult> {
    const result = GovernedAttemptResult_v1.parse(input.result);
    const now = normalizeInstant(input.now);
    const resultHash = computeCanonicalHash(result);
    const fingerprint = computeCanonicalHash({
      kind: "operation_result",
      operation_id: input.operationId,
      expected_revision: input.expectedRevision,
      result_hash: resultHash,
    });
    return this.db.transaction(() => {
      const replay = this.db
        .prepare("SELECT * FROM governed_attempt_operation_result_mutations WHERE mutationId=?")
        .get(input.mutationId) as ResultMutationRow | undefined;
      if (replay) {
        if (
          replay.operationId !== input.operationId ||
          replay.mutationFingerprint !== fingerprint
        ) {
          return { recorded: false, reason: "mutation_conflict" } as const;
        }
        return {
          recorded: true,
          record: this.requireOperation(input.operationId),
          idempotentReplay: true,
        } as const;
      }
      const current = this.operation(input.operationId);
      if (!current) return { recorded: false, reason: "not_found" } as const;
      if (current.revision !== input.expectedRevision) {
        return { recorded: false, reason: "stale_revision" } as const;
      }
      if (current.status === "running") {
        return { recorded: false, reason: "result_conflict" } as const;
      }
      if (
        result.attempt_id !== current.attempt_id ||
        result.delegation_id !== current.delegation_id ||
        result.authorization_binding_digest !== current.handle.authorization_binding_digest
      ) {
        return { recorded: false, reason: "binding_mismatch" } as const;
      }
      if (current.result_hash && current.result_hash !== resultHash) {
        return { recorded: false, reason: "result_conflict" } as const;
      }
      this.db
        .prepare(
          `UPDATE governed_attempt_operations SET revision=?,resultJson=?,resultHash=?,updatedAt=?
           WHERE operationId=? AND revision=?`
        )
        .run(
          current.revision + 1,
          canonicalJSONStringify(result),
          resultHash,
          now,
          current.operation_id,
          current.revision
        );
      this.db
        .prepare(
          `INSERT INTO governed_attempt_operation_result_mutations(
            mutationId,operationId,mutationFingerprint
          ) VALUES(?,?,?)`
        )
        .run(input.mutationId, input.operationId, fingerprint);
      return {
        recorded: true,
        record: this.requireOperation(input.operationId),
        idempotentReplay: false,
      } as const;
    })();
  }

  async recordAttemptOperationVerification(
    input: RecordGovernedAttemptOperationVerificationInput
  ): Promise<RecordGovernedAttemptOperationVerificationResult> {
    const verification = GovernedAttemptVerificationReceipt_v1.parse(input.verification);
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "operation_verification",
      operation_id: input.operationId,
      expected_revision: input.expectedRevision,
      receipt_hash: verification.receipt_hash,
    });
    return this.db.transaction(() => {
      const replay = this.db
        .prepare(
          "SELECT * FROM governed_attempt_operation_verification_mutations WHERE mutationId=?"
        )
        .get(input.mutationId) as VerificationMutationRow | undefined;
      if (replay) {
        if (
          replay.operationId !== input.operationId ||
          replay.mutationFingerprint !== fingerprint
        ) {
          return { recorded: false, reason: "mutation_conflict" } as const;
        }
        return {
          recorded: true,
          record: this.requireOperation(input.operationId),
          idempotentReplay: true,
        } as const;
      }
      const current = this.operation(input.operationId);
      if (!current) return { recorded: false, reason: "not_found" } as const;
      if (current.revision !== input.expectedRevision) {
        return { recorded: false, reason: "stale_revision" } as const;
      }
      if (!current.result || !current.result_hash) {
        return { recorded: false, reason: "verification_conflict" } as const;
      }
      if (
        verification.operation_id !== current.operation_id ||
        verification.operation_result_hash !== current.result_hash ||
        verification.authorization_binding_digest !== current.authorization.binding_digest ||
        verification.verification_context_hash !== current.verification_context?.context_hash ||
        verification.capture_id !== current.evidence_declaration?.capture_id
      ) {
        return { recorded: false, reason: "binding_mismatch" } as const;
      }
      if (current.verification && current.verification.receipt_hash !== verification.receipt_hash) {
        return { recorded: false, reason: "verification_conflict" } as const;
      }
      this.db
        .prepare(
          `UPDATE governed_attempt_operations SET revision=?,verificationJson=?,updatedAt=?
           WHERE operationId=? AND revision=?`
        )
        .run(
          current.revision + 1,
          canonicalJSONStringify(verification),
          now,
          current.operation_id,
          current.revision
        );
      this.db
        .prepare(
          `INSERT INTO governed_attempt_operation_verification_mutations(
            mutationId,operationId,mutationFingerprint
          ) VALUES(?,?,?)`
        )
        .run(input.mutationId, input.operationId, fingerprint);
      return {
        recorded: true,
        record: this.requireOperation(input.operationId),
        idempotentReplay: false,
      } as const;
    })();
  }

  async getAttemptOperation(operationId: string): Promise<GovernedAttemptOperationRecord | null> {
    return this.operation(operationId);
  }

  async listRecoverableAttemptOperations(): Promise<GovernedAttemptOperationRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM governed_attempt_operations
         WHERE status='running' OR (
           status='completed' AND (
             resultJson IS NULL OR (verificationContextJson IS NOT NULL AND verificationJson IS NULL)
           )
         )
         ORDER BY createdAt,operationId`
      )
      .all() as OperationRow[];
    return rows.map(recordFromRow);
  }

  async listAttemptOperationEvents(operationId: string): Promise<GovernedAttemptOperationEvent[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM governed_attempt_operation_events WHERE operationId=? ORDER BY executorSequence"
      )
      .all(operationId) as OperationEventRow[];
    return rows.map(eventFromRow);
  }

  private operation(operationId: string): GovernedAttemptOperationRecord | null {
    const row = this.db
      .prepare("SELECT * FROM governed_attempt_operations WHERE operationId=?")
      .get(operationId) as OperationRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  private requireOperation(operationId: string): GovernedAttemptOperationRecord {
    const record = this.operation(operationId);
    if (!record) throw new Error("Governed Attempt operation is missing");
    return record;
  }

  private getDelegationSync(delegationId: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM governed_delegations WHERE delegationId=?").get(delegationId)
    );
  }

  private applyOperationMigration(): void {
    let sql = INLINE_MIGRATION;
    try {
      const migrationPath = fileURLToPath(
        new URL("./migrations/012-governed-attempt-operations.sql", import.meta.url)
      );
      sql = readFileSync(migrationPath, "utf8");
    } catch {
      // Published bundles use the equivalent inline migration.
    }
    this.db.exec(sql);
  }

  private applyOperationBindingMigration(): void {
    const columns = this.db.prepare("PRAGMA table_info(governed_attempt_operations)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "authorizationJson")) {
      this.db.exec("ALTER TABLE governed_attempt_operations ADD COLUMN authorizationJson TEXT");
    }
    if (!columns.some((column) => column.name === "evidenceReservationJson")) {
      this.db.exec(
        "ALTER TABLE governed_attempt_operations ADD COLUMN evidenceReservationJson TEXT"
      );
    }
    if (!columns.some((column) => column.name === "evidenceDeclarationJson")) {
      this.db.exec(
        "ALTER TABLE governed_attempt_operations ADD COLUMN evidenceDeclarationJson TEXT"
      );
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
         VALUES(13,'governed-attempt-operation-binding',datetime('now'))`
      )
      .run();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
         VALUES(14,'governed-attempt-evidence-binding',datetime('now'))`
      )
      .run();
  }

  private applyOperationVerificationMigration(): void {
    const columns = this.db.prepare("PRAGMA table_info(governed_attempt_operations)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "verificationContextJson")) {
      this.db.exec(
        "ALTER TABLE governed_attempt_operations ADD COLUMN verificationContextJson TEXT"
      );
    }
    if (!columns.some((column) => column.name === "verificationJson")) {
      this.db.exec("ALTER TABLE governed_attempt_operations ADD COLUMN verificationJson TEXT");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS governed_attempt_operation_verification_mutations (
        mutationId TEXT PRIMARY KEY,
        operationId TEXT NOT NULL,
        mutationFingerprint TEXT NOT NULL,
        FOREIGN KEY (operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT
      )
    `);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
         VALUES(15,'governed-attempt-independent-verification',datetime('now'))`
      )
      .run();
  }
}

function recordFromRow(row: OperationRow): GovernedAttemptOperationRecord {
  let handle: unknown;
  let authorization: unknown;
  let evidenceReservation: unknown;
  let evidenceDeclaration: unknown;
  let verificationContext: unknown;
  let result: unknown;
  let verification: unknown;
  try {
    handle = JSON.parse(row.handleJson) as unknown;
    if (!row.authorizationJson) {
      throw new Error("Legacy governed Attempt operation lacks an authorization binding");
    }
    authorization = JSON.parse(row.authorizationJson) as unknown;
    evidenceReservation = row.evidenceReservationJson
      ? (JSON.parse(row.evidenceReservationJson) as unknown)
      : undefined;
    evidenceDeclaration = row.evidenceDeclarationJson
      ? (JSON.parse(row.evidenceDeclarationJson) as unknown)
      : undefined;
    verificationContext = row.verificationContextJson
      ? (JSON.parse(row.verificationContextJson) as unknown)
      : undefined;
    result = row.resultJson ? (JSON.parse(row.resultJson) as unknown) : undefined;
    verification = row.verificationJson ? (JSON.parse(row.verificationJson) as unknown) : undefined;
  } catch {
    throw new Error("Corrupt governed Attempt operation JSON");
  }
  return GovernedAttemptOperationRecord_v1.parse({
    schema_version: GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
    operation_id: row.operationId,
    attempt_id: row.attemptId,
    delegation_id: row.delegationId,
    revision: row.revision,
    status: row.status,
    handle,
    authorization,
    ...(evidenceReservation ? { evidence_reservation: evidenceReservation } : {}),
    ...(evidenceDeclaration ? { evidence_declaration: evidenceDeclaration } : {}),
    ...(verificationContext ? { verification_context: verificationContext } : {}),
    last_event_sequence: row.lastEventSequence,
    ...(result ? { result, result_hash: row.resultHash } : {}),
    ...(verification ? { verification } : {}),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    ...(row.terminalAt ? { terminal_at: row.terminalAt } : {}),
  });
}

function eventFromRow(row: OperationEventRow): GovernedAttemptOperationEvent {
  let event: unknown;
  try {
    event = JSON.parse(row.eventJson) as unknown;
  } catch {
    throw new Error("Corrupt governed Attempt operation event JSON");
  }
  return GovernedAttemptOperationEvent_v1.parse({
    schema_version: GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
    operation_id: row.operationId,
    attempt_id: row.attemptId,
    delegation_id: row.delegationId,
    operation_revision: row.operationRevision,
    mutation_id: row.mutationId,
    mutation_fingerprint: row.mutationFingerprint,
    event,
    created_at: row.createdAt,
  });
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid governed operation timestamp");
  return new Date(timestamp).toISOString();
}
