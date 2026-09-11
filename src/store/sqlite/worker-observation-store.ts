import { SqliteWorkerDispatchStore } from "./worker-dispatch-store.js";
import {
  reduceWorkerReceiptEvidence,
  type WorkerReceiptCapture,
  type WorkerReceiptEvidence,
  type WorkerReceiptEvidenceStore,
  type WorkerReceiptSnapshot,
} from "../worker-receipt-evidence.js";
import type {
  WorkerEvidenceSnapshot,
  WorkerEvidenceSnapshotStore,
} from "../worker-evidence-snapshot.js";
import {
  parseTurnEvidence,
  turnEvidenceHash,
  MAX_SESSION_EVIDENCE_BYTES,
  type WorkerTurnEvidenceStore,
  type WorkerTurnCaptureInput,
  type WorkerTurnCaptureResult,
} from "../worker-turn-evidence.js";
import type { SqliteCoordinationStoreOptions } from "./coordination-store.js";
import { WorkerDispatchRecord_v1 } from "../worker-dispatch-store.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import {
  parseWorkerObservation,
  reduceWorkerObservation,
  WorkerObservationRecord_v1,
  type WorkerObservationStore,
  type WorkerObservationInput,
  type WorkerObservationRecord,
  type WorkerObservationResult,
} from "../worker-observation-store.js";

/** Opt-in journal on the existing lifecycle database; never changes lifecycle records. */
export class SqliteWorkerObservationStore
  extends SqliteWorkerDispatchStore
  implements
    WorkerObservationStore,
    WorkerTurnEvidenceStore,
    WorkerEvidenceSnapshotStore,
    WorkerReceiptEvidenceStore
{
  constructor(dbPath: string, options: SqliteCoordinationStoreOptions = {}) {
    super(dbPath, options);
    try {
      if (!options.readOnly)
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS worker_observations (
          sessionId TEXT NOT NULL,
          observationId TEXT NOT NULL,
          recordJson TEXT NOT NULL,
          PRIMARY KEY(sessionId, observationId),
          FOREIGN KEY(sessionId) REFERENCES worker_dispatches(sessionId) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
          VALUES(18,'worker-observations',datetime('now'));
        CREATE TABLE IF NOT EXISTS worker_turn_evidence (
          sessionId TEXT NOT NULL, observationId TEXT NOT NULL,
          notificationJson TEXT NOT NULL, byteLength INTEGER NOT NULL,
          PRIMARY KEY(sessionId,observationId),
          FOREIGN KEY(sessionId,observationId) REFERENCES worker_observations(sessionId,observationId) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
          VALUES(19,'worker-turn-evidence',datetime('now'));
        CREATE TABLE IF NOT EXISTS worker_receipt_evidence (
          sessionId TEXT NOT NULL, observationId TEXT NOT NULL, recordJson TEXT NOT NULL,
          PRIMARY KEY(sessionId,observationId),
          FOREIGN KEY(sessionId) REFERENCES worker_dispatches(sessionId) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
          VALUES(20,'worker-receipt-evidence',datetime('now'));
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private receiptEvidence(sessionId: string): WorkerReceiptEvidence[] {
    return (
      this.db
        .prepare("SELECT recordJson FROM worker_receipt_evidence WHERE sessionId=? ORDER BY rowid")
        .all(sessionId) as { recordJson: string }[]
    ).map((row) => JSON.parse(row.recordJson) as WorkerReceiptEvidence);
  }
  async recordWorkerReceiptEvidence(input: WorkerReceiptCapture, recordedAt: string) {
    return this.immediateTransaction(() => {
      const row = this.db
        .prepare("SELECT recordJson FROM worker_dispatches WHERE sessionId=?")
        .get(input.sessionId) as { recordJson: string } | undefined;
      const result = reduceWorkerReceiptEvidence(
        input,
        recordedAt,
        row ? WorkerDispatchRecord_v1.parse(JSON.parse(row.recordJson)) : null,
        this.receiptEvidence(input.sessionId)
      );
      if (result.recorded && !result.replay)
        this.db
          .prepare(
            "INSERT INTO worker_receipt_evidence(sessionId,observationId,recordJson) VALUES(?,?,?)"
          )
          .run(input.sessionId, input.observationId, canonicalJSONStringify(result.record));
      return result;
    });
  }
  async getWorkerReceiptSnapshot(sessionId: string): Promise<WorkerReceiptSnapshot | null> {
    return this.db
      .transaction(() => {
        const turn = this.readWorkerEvidenceSnapshot(sessionId);
        return turn ? { turn, receipts: this.receiptEvidence(sessionId) } : null;
      })
      .deferred();
  }
  private observations(sessionId: string): WorkerObservationRecord[] {
    const rows = this.db
      .prepare("SELECT recordJson FROM worker_observations WHERE sessionId = ? ORDER BY rowid")
      .all(sessionId) as { recordJson: string }[];
    return rows.map((row) => WorkerObservationRecord_v1.parse(JSON.parse(row.recordJson)));
  }
  async getWorkerEvidenceSnapshot(sessionId: string): Promise<WorkerEvidenceSnapshot | null> {
    return this.readWorkerEvidenceSnapshot(sessionId);
  }
  private readWorkerEvidenceSnapshot(sessionId: string): WorkerEvidenceSnapshot | null {
    // A deferred read transaction works on read-only connections and pins one SQLite view.
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare("SELECT recordJson FROM worker_dispatches WHERE sessionId=?")
          .get(sessionId) as { recordJson: string } | undefined;
        if (!row) return null;
        const dispatch = WorkerDispatchRecord_v1.parse(JSON.parse(row.recordJson));
        const observations = this.observations(sessionId);
        const artifacts = this.db
          .prepare(
            "SELECT observationId,notificationJson FROM worker_turn_evidence WHERE sessionId=? ORDER BY rowid"
          )
          .all(sessionId) as Array<{ observationId: string; notificationJson: string }>;
        return { dispatch, observations, artifacts };
      })
      .deferred();
  }
  async getWorkerTurnEvidence(sessionId: string, observationId: string): Promise<string | null> {
    const row = this.db
      .prepare(
        `SELECT e.notificationJson, o.recordJson FROM worker_turn_evidence e
      JOIN worker_observations o USING(sessionId,observationId) WHERE e.sessionId=? AND e.observationId=?`
      )
      .get(sessionId, observationId) as
      { notificationJson: string; recordJson: string } | undefined;
    if (!row) return null;
    if (
      WorkerObservationRecord_v1.parse(JSON.parse(row.recordJson)).evidenceHash !==
      turnEvidenceHash(row.notificationJson)
    )
      throw new Error("evidence_hash_mismatch");
    return row.notificationJson;
  }
  async recordWorkerTurnEvidence(
    input: WorkerTurnCaptureInput,
    recordedAt: string
  ): Promise<WorkerTurnCaptureResult> {
    const captured = parseTurnEvidence(input);
    const parsed = parseWorkerObservation(captured.observation, recordedAt);
    return this.immediateTransaction(() => {
      const row = this.db
        .prepare("SELECT recordJson FROM worker_dispatches WHERE sessionId=?")
        .get(parsed.sessionId) as { recordJson: string } | undefined;
      const dispatch = row ? WorkerDispatchRecord_v1.parse(JSON.parse(row.recordJson)) : null;
      const result = reduceWorkerObservation(
        parsed,
        recordedAt,
        dispatch,
        this.observations(parsed.sessionId)
      );
      if (!result.recorded) return result;
      const existing = this.db
        .prepare(
          "SELECT notificationJson FROM worker_turn_evidence WHERE sessionId=? AND observationId=?"
        )
        .get(parsed.sessionId, parsed.observationId) as { notificationJson: string } | undefined;
      if (existing && existing.notificationJson !== captured.notificationJson)
        throw new Error("evidence_conflict");
      const total = this.db
        .prepare(
          "SELECT COALESCE(SUM(byteLength),0) AS bytes FROM worker_turn_evidence WHERE sessionId=?"
        )
        .get(parsed.sessionId) as { bytes: number };
      if (!existing && total.bytes + captured.bytes > MAX_SESSION_EVIDENCE_BYTES)
        return { recorded: false, reason: "evidence_limit" };
      if (!result.replay)
        this.db
          .prepare(
            "INSERT INTO worker_observations(sessionId,observationId,recordJson) VALUES(?,?,?)"
          )
          .run(parsed.sessionId, parsed.observationId, canonicalJSONStringify(result.record));
      if (!existing)
        this.db
          .prepare(
            "INSERT INTO worker_turn_evidence(sessionId,observationId,notificationJson,byteLength) VALUES(?,?,?,?)"
          )
          .run(parsed.sessionId, parsed.observationId, captured.notificationJson, captured.bytes);
      return result;
    });
  }
  async listWorkerObservations(sessionId: string): Promise<WorkerObservationRecord[]> {
    return this.observations(sessionId);
  }
  async recordWorkerObservation(
    input: WorkerObservationInput,
    recordedAt: string
  ): Promise<WorkerObservationResult> {
    const parsed = parseWorkerObservation(input, recordedAt);
    return this.immediateTransaction(() => {
      const row = this.db
        .prepare("SELECT recordJson FROM worker_dispatches WHERE sessionId = ?")
        .get(parsed.sessionId) as { recordJson: string } | undefined;
      const dispatch = row ? WorkerDispatchRecord_v1.parse(JSON.parse(row.recordJson)) : null;
      const result = reduceWorkerObservation(
        parsed,
        recordedAt,
        dispatch,
        this.observations(parsed.sessionId)
      );
      if (result.recorded && !result.replay)
        this.db
          .prepare(
            "INSERT INTO worker_observations(sessionId,observationId,recordJson) VALUES(?,?,?)"
          )
          .run(parsed.sessionId, parsed.observationId, canonicalJSONStringify(result.record));
      return result;
    });
  }
}
