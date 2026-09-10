import { SqliteWorkspaceLifecycleStore } from "./workspace-lifecycle-store.js";
import type { SqliteCoordinationStoreOptions } from "./coordination-store.js";
import {
  WorkerDispatchRecord_v1,
  dispatchWorkerInput,
  reduceWorkerDispatch,
  type WorkerDispatchStore,
  type WorkerDispatchRecord,
  type ClaimWorkerDispatchInput,
  type AcknowledgeWorkerDispatchInput,
  type WorkerDispatchResult,
} from "../worker-dispatch-store.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";

/** Additive opt-in store; shares the lifecycle connection and BEGIN IMMEDIATE boundary. */
export class SqliteWorkerDispatchStore
  extends SqliteWorkspaceLifecycleStore
  implements WorkerDispatchStore
{
  constructor(dbPath: string, options: SqliteCoordinationStoreOptions = {}) {
    super(dbPath, options);
    try {
      if (!options.readOnly)
        this.db.exec(`
        CREATE TABLE IF NOT EXISTS worker_dispatches (
          sessionId TEXT PRIMARY KEY,
          recordJson TEXT NOT NULL,
          FOREIGN KEY(sessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT
        );
        INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
          VALUES(17,'worker-dispatches',datetime('now'));
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private dispatch(sessionId: string): WorkerDispatchRecord | null {
    const row = this.db
      .prepare("SELECT recordJson FROM worker_dispatches WHERE sessionId = ?")
      .get(sessionId) as { recordJson: string } | undefined;
    return row ? WorkerDispatchRecord_v1.parse(JSON.parse(row.recordJson)) : null;
  }
  async getWorkerDispatch(sessionId: string): Promise<WorkerDispatchRecord | null> {
    return this.dispatch(sessionId);
  }
  async claimWorkerDispatch(input: ClaimWorkerDispatchInput): Promise<WorkerDispatchResult> {
    return this.mutateDispatch(input);
  }
  async acknowledgeWorkerDispatch(
    input: AcknowledgeWorkerDispatchInput
  ): Promise<WorkerDispatchResult> {
    return this.mutateDispatch(input, { turnId: input.turnId });
  }
  private mutateDispatch(
    input: ClaimWorkerDispatchInput,
    acknowledgement?: { turnId: string }
  ): WorkerDispatchResult {
    const result = this.withLiveWorkerSession(dispatchWorkerInput(input), (session) => {
      const result = reduceWorkerDispatch(
        input,
        session,
        this.dispatch(session.sessionId),
        acknowledgement
      );
      if (result.recorded)
        this.db
          .prepare(
            `INSERT INTO worker_dispatches(sessionId,recordJson) VALUES(?,?)
        ON CONFLICT(sessionId) DO UPDATE SET recordJson=excluded.recordJson`
          )
          .run(session.sessionId, canonicalJSONStringify(result.record));
      return result;
    });
    return "updated" in result ? { recorded: false, reason: result.reason } : result;
  }
}
