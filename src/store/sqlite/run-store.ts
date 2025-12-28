/**
 * SqliteRunStore — SQLite-based persistence for RunStore interface.
 *
 * This implementation provides durable, file-based persistence for run lifecycle
 * using SQLite via the better-sqlite3 package.
 *
 * Key Features:
 * - Schema auto-creation on first use
 * - Foreign key enforcement with cascade deletes
 * - Prepared statements for performance
 * - Transaction support for atomic operations
 * - Timestamps stored as UTC ISO 8601 strings
 *
 * @module store/sqlite/run-store
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  RunStore,
  RunRecord,
  StepOutcome,
  Receipt,
  RunState,
  ListRunsOptions,
} from "../run-store.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database row types for SQLite queries
 */
interface RunRow {
  runId: string;
  planHash: string;
  state: string;
  startedAt: string;
  completedAt: string | null;
  metadata: string | null;
}

interface StepRow {
  stepId: string;
  runId: string;
  nodeId: string;
  gateName: string;
  status: string;
  durationMs: number;
  logs: string | null;
  artifacts: string | null;
  timestamp: string;
}

interface ReceiptRow {
  receiptId: string;
  runId: string;
  reason: string;
  approver: string | null;
  timestamp: string;
}

interface CountRow {
  count: number;
}

/**
 * SqliteRunStore — SQLite-backed RunStore implementation.
 *
 * @example
 * ```typescript
 * // File-based database
 * const store = new SqliteRunStore("./runs.db");
 *
 * // In-memory database (for testing)
 * const memStore = new SqliteRunStore(":memory:");
 *
 * // Create and manage runs
 * await store.createRun({
 *   runId: "run-001",
 *   planHash: "sha256:abc123",
 *   state: "pending",
 *   startedAt: new Date().toISOString()
 * });
 *
 * // Clean up
 * await store.close();
 * ```
 */
export class SqliteRunStore implements RunStore {
  private db: DatabaseType;

  /**
   * Create a new SqliteRunStore.
   *
   * @param dbPath - Path to SQLite database file, or ":memory:" for in-memory
   */
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Initialize database schema.
   * Creates tables if they don't exist and enables foreign keys.
   */
  private initSchema(): void {
    // Enable foreign keys
    this.db.pragma("foreign_keys = ON");

    // Read and execute schema
    const schemaPath = join(__dirname, "schema.sql");
    let schemaSql: string;
    try {
      schemaSql = readFileSync(schemaPath, "utf-8");
    } catch {
      // Fallback to inline schema if file not found (e.g., in bundled dist)
      schemaSql = this.getInlineSchema();
    }
    this.db.exec(schemaSql);
  }

  /**
   * Get inline schema for bundled environments where schema.sql may not be available.
   */
  private getInlineSchema(): string {
    return `
			PRAGMA foreign_keys = ON;

			CREATE TABLE IF NOT EXISTS runs (
				runId TEXT PRIMARY KEY,
				planHash TEXT NOT NULL,
				state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'aborted')),
				startedAt TEXT NOT NULL,
				completedAt TEXT,
				metadata TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);
			CREATE INDEX IF NOT EXISTS idx_runs_startedAt ON runs(startedAt);

			CREATE TABLE IF NOT EXISTS steps (
				stepId TEXT PRIMARY KEY,
				runId TEXT NOT NULL,
				nodeId TEXT NOT NULL,
				gateName TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'skipped', 'blocked')),
				durationMs INTEGER NOT NULL,
				logs TEXT,
				artifacts TEXT,
				timestamp TEXT NOT NULL,
				FOREIGN KEY (runId) REFERENCES runs(runId) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_steps_runId ON steps(runId);
			CREATE INDEX IF NOT EXISTS idx_steps_timestamp ON steps(timestamp);

			CREATE TABLE IF NOT EXISTS receipts (
				receiptId TEXT PRIMARY KEY,
				runId TEXT NOT NULL,
				reason TEXT NOT NULL,
				approver TEXT,
				timestamp TEXT NOT NULL,
				FOREIGN KEY (runId) REFERENCES runs(runId) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_receipts_runId ON receipts(runId);

			CREATE TABLE IF NOT EXISTS schema_version (
				version TEXT PRIMARY KEY,
				appliedAt TEXT NOT NULL
			);

			INSERT OR IGNORE INTO schema_version (version, appliedAt) 
			VALUES ('1.0.0', datetime('now'));
		`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Run CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new run record.
   *
   * @param run - The run record to create
   * @throws Error if run with same runId already exists
   */
  async createRun(run: RunRecord): Promise<void> {
    const stmt = this.db.prepare(`
			INSERT INTO runs (runId, planHash, state, startedAt, completedAt, metadata)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

    try {
      stmt.run(
        run.runId,
        run.planHash,
        run.state,
        run.startedAt,
        run.completedAt ?? null,
        run.metadata ? JSON.stringify(run.metadata) : null
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        throw new Error(`Run with runId '${run.runId}' already exists`);
      }
      throw err;
    }
  }

  /**
   * Update an existing run record.
   *
   * @param runId - The run identifier to update
   * @param updates - Partial updates to apply
   * @throws Error if run with given runId does not exist
   */
  async updateRun(runId: string, updates: Partial<Omit<RunRecord, "runId">>): Promise<void> {
    // First check if run exists
    const existing = await this.getRun(runId);
    if (!existing) {
      throw new Error(`Run with runId '${runId}' not found`);
    }

    // Build dynamic update statement
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.planHash !== undefined) {
      fields.push("planHash = ?");
      values.push(updates.planHash);
    }
    if (updates.state !== undefined) {
      fields.push("state = ?");
      values.push(updates.state);
    }
    if (updates.startedAt !== undefined) {
      fields.push("startedAt = ?");
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      fields.push("completedAt = ?");
      values.push(updates.completedAt);
    }
    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    if (fields.length === 0) {
      return; // Nothing to update
    }

    values.push(runId);
    const stmt = this.db.prepare(`UPDATE runs SET ${fields.join(", ")} WHERE runId = ?`);
    stmt.run(...values);
  }

  /**
   * Get a run record by ID.
   *
   * @param runId - The run identifier
   * @returns The run record, or null if not found
   */
  async getRun(runId: string): Promise<RunRecord | null> {
    const stmt = this.db.prepare(`
			SELECT runId, planHash, state, startedAt, completedAt, metadata
			FROM runs WHERE runId = ?
		`);

    const row = stmt.get(runId) as RunRow | undefined;
    if (!row) {
      return null;
    }

    return this.rowToRunRecord(row);
  }

  /**
   * List run records with optional filtering and pagination.
   *
   * @param options - Optional filtering and pagination options
   * @returns Array of run records matching the criteria
   */
  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    let sql = "SELECT runId, planHash, state, startedAt, completedAt, metadata FROM runs";
    const params: unknown[] = [];

    if (options?.state) {
      sql += " WHERE state = ?";
      params.push(options.state);
    }

    sql += " ORDER BY startedAt DESC";

    // SQLite requires LIMIT when using OFFSET
    if (options?.limit !== undefined || options?.offset !== undefined) {
      // Use -1 for unlimited when only offset is specified
      sql += " LIMIT ?";
      params.push(options?.limit ?? -1);
    }

    if (options?.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as RunRow[];

    return rows.map((row) => this.rowToRunRecord(row));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step outcomes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Append a step outcome to a run.
   *
   * @param step - The step outcome to append
   */
  async appendStep(step: StepOutcome): Promise<void> {
    const stmt = this.db.prepare(`
			INSERT INTO steps (stepId, runId, nodeId, gateName, status, durationMs, logs, artifacts, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

    stmt.run(
      step.stepId,
      step.runId,
      step.nodeId,
      step.gateName,
      step.status,
      step.durationMs,
      step.logs ?? null,
      step.artifacts ? JSON.stringify(step.artifacts) : null,
      step.timestamp
    );
  }

  /**
   * Get all step outcomes for a run.
   *
   * @param runId - The run identifier
   * @returns Array of step outcomes for the run, ordered by timestamp
   */
  async getStepsForRun(runId: string): Promise<StepOutcome[]> {
    const stmt = this.db.prepare(`
			SELECT stepId, runId, nodeId, gateName, status, durationMs, logs, artifacts, timestamp
			FROM steps WHERE runId = ? ORDER BY timestamp ASC
		`);

    const rows = stmt.all(runId) as StepRow[];
    return rows.map((row) => this.rowToStepOutcome(row));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Receipts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save a receipt for scope/risk escalation.
   *
   * @param receipt - The receipt to save
   */
  async saveReceipt(receipt: Receipt): Promise<void> {
    const stmt = this.db.prepare(`
			INSERT INTO receipts (receiptId, runId, reason, approver, timestamp)
			VALUES (?, ?, ?, ?, ?)
		`);

    stmt.run(
      receipt.receiptId,
      receipt.runId,
      receipt.reason,
      receipt.approver ?? null,
      receipt.timestamp
    );
  }

  /**
   * Get all receipts for a run.
   *
   * @param runId - The run identifier
   * @returns Array of receipts for the run
   */
  async getReceiptsForRun(runId: string): Promise<Receipt[]> {
    const stmt = this.db.prepare(`
			SELECT receiptId, runId, reason, approver, timestamp
			FROM receipts WHERE runId = ? ORDER BY timestamp ASC
		`);

    const rows = stmt.all(runId) as ReceiptRow[];
    return rows.map((row) => this.rowToReceipt(row));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the count of runs, optionally filtered by state.
   *
   * @param state - Optional state filter
   * @returns Number of runs matching the criteria
   */
  async getRunCount(state?: RunState): Promise<number> {
    let sql = "SELECT COUNT(*) as count FROM runs";
    const params: unknown[] = [];

    if (state) {
      sql += " WHERE state = ?";
      params.push(state);
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as CountRow;
    return row.count;
  }

  /**
   * Close the store and release any resources.
   */
  async close(): Promise<void> {
    this.db.close();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transaction Support
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a function within a transaction.
   * If the function throws, the transaction is rolled back.
   *
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert a database row to a RunRecord.
   */
  private rowToRunRecord(row: RunRow): RunRecord {
    const record: RunRecord = {
      runId: row.runId,
      planHash: row.planHash,
      state: row.state as RunState,
      startedAt: row.startedAt,
    };

    if (row.completedAt) {
      record.completedAt = row.completedAt;
    }

    if (row.metadata) {
      try {
        record.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
        // Ignore parse errors for metadata
      }
    }

    return record;
  }

  /**
   * Convert a database row to a StepOutcome.
   */
  private rowToStepOutcome(row: StepRow): StepOutcome {
    const step: StepOutcome = {
      stepId: row.stepId,
      runId: row.runId,
      nodeId: row.nodeId,
      gateName: row.gateName,
      status: row.status as "pass" | "fail" | "skipped" | "blocked",
      durationMs: row.durationMs,
      timestamp: row.timestamp,
    };

    if (row.logs) {
      step.logs = row.logs;
    }

    if (row.artifacts) {
      try {
        step.artifacts = JSON.parse(row.artifacts) as string[];
      } catch {
        // Ignore parse errors for artifacts
      }
    }

    return step;
  }

  /**
   * Convert a database row to a Receipt.
   */
  private rowToReceipt(row: ReceiptRow): Receipt {
    const receipt: Receipt = {
      receiptId: row.receiptId,
      runId: row.runId,
      reason: row.reason,
      timestamp: row.timestamp,
    };

    if (row.approver) {
      receipt.approver = row.approver;
    }

    return receipt;
  }
}
