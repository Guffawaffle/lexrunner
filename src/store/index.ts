/**
 * Store Layer — Persistence abstraction for run lifecycle.
 *
 * This module exports the RunStore interface and available implementations.
 *
 * @module store
 */

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

// Import for factory
import type { RunStore } from "./run-store.js";
import { SqliteRunStore } from "./sqlite/index.js";
import { join } from "path";

/**
 * Options for creating a RunStore.
 */
export interface CreateRunStoreOptions {
	/**
	 * Path to SQLite database file.
	 * Defaults to `.lexrunner/runs.db` relative to baseDir.
	 */
	dbPath?: string;

	/**
	 * Base directory for run storage.
	 * Defaults to current working directory.
	 */
	baseDir?: string;
}

/**
 * Default database path relative to baseDir.
 */
const DEFAULT_DB_PATH = ".lexrunner/runs.db";

/**
 * Create a RunStore instance with default configuration.
 *
 * Uses SqliteRunStore by default with a database at `.lexrunner/runs.db`.
 *
 * @param options - Optional configuration
 * @returns A configured RunStore instance
 *
 * @example
 * ```typescript
 * // Default configuration
 * const store = createRunStore();
 *
 * // Custom database path
 * const store = createRunStore({ dbPath: "/path/to/custom.db" });
 *
 * // Custom base directory
 * const store = createRunStore({ baseDir: "/my/project" });
 * ```
 */
export function createRunStore(options: CreateRunStoreOptions = {}): RunStore {
	const baseDir = options.baseDir ?? process.cwd();
	const dbPath = options.dbPath ?? join(baseDir, DEFAULT_DB_PATH);
	return new SqliteRunStore(dbPath);
}