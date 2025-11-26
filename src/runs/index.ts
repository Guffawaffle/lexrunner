/**
 * Runs Module - Public API
 *
 * Re-exports all public types and classes from the runs module.
 */

// Types
export type {
	RunState,
	CreateRunParams,
	RunFilter,
	RunIndexEntry,
	RunIndex
} from "./types.js";

export {
	RunStateSchema,
	parseRunState,
	safeParseRunState
} from "./types.js";

// Storage utilities
export {
	getRunsDir,
	ensureRunsDir,
	getRunStatePath,
	getRunDir,
	getIndexPath,
	writeRunState,
	readRunState,
	deleteRunState,
	readIndex,
	writeIndex,
	upsertIndexEntry,
	removeIndexEntry,
	ensureRunDir,
	appendToRunLog,
	readRunLog
} from "./storage.js";

// Manager
export { RunManager, createRunManager } from "./manager.js";
