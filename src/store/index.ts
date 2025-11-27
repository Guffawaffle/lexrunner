/**
 * Store Layer — Persistence abstraction for run lifecycle.
 *
 * This module exports the RunStore interface and available implementations.
 *
 * @module store
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { RunStore } from "./run-store.js";
import { SqliteRunStore } from "./sqlite/index.js";

// Interface and types
export type {
        RunStore,
        RunRecord,
        StepOutcome,
        Receipt,
        RunState,
        StepStatus,
        ListRunsOptions,
} from "./run-store.js";

export {
        RunRecordSchema,
        StepOutcomeSchema,
        ReceiptSchema,
        RunStateSchema,
        StepStatusSchema,
        parseRunRecord,
        safeParseRunRecord,
        parseStepOutcome,
        safeParseStepOutcome,
        parseReceipt,
        safeParseReceipt,
} from "./run-store.js";

// Implementations
export { InMemoryRunStore, InMemoryRunStoreOptions } from "./inmemory/index.js";
export { SqliteRunStore } from "./sqlite/index.js";

/**
 * Default database path for persistent run storage.
 * Located at ~/.lexrunner/runs.db
 */
export const DEFAULT_RUNSTORE_DB_PATH = path.join(os.homedir(), ".lexrunner", "runs.db");

/**
 * Options for creating a RunStore.
 */
export interface CreateRunStoreOptions {
        /**
         * Path to the SQLite database file.
         * Defaults to ~/.lexrunner/runs.db
         */
        dbPath?: string;
}

/**
 * Create a RunStore with the default SqliteRunStore implementation.
 *
 * This factory function creates a SqliteRunStore with the standard database path,
 * ensuring the parent directory exists.
 *
 * @param options - Optional configuration for the store
 * @returns A RunStore instance backed by SQLite
 *
 * @example
 * ```typescript
 * // Use default path (~/.lexrunner/runs.db)
 * const store = createRunStore();
 *
 * // Use custom path
 * const store = createRunStore({ dbPath: "./my-runs.db" });
 * ```
 */
export function createRunStore(options?: CreateRunStoreOptions): RunStore {
        const dbPath = options?.dbPath ?? DEFAULT_RUNSTORE_DB_PATH;

        // Ensure parent directory exists
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
        }

        return new SqliteRunStore(dbPath);
}