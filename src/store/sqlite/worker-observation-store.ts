import { SqliteWorkerDispatchStore } from "./worker-dispatch-store.js";
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
  implements WorkerObservationStore
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
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private observations(sessionId: string): WorkerObservationRecord[] {
    const rows = this.db
      .prepare("SELECT recordJson FROM worker_observations WHERE sessionId = ? ORDER BY rowid")
      .all(sessionId) as { recordJson: string }[];
    return rows.map((row) => WorkerObservationRecord_v1.parse(JSON.parse(row.recordJson)));
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
