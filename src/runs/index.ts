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
	RunIndex,
	StartRunInput,
	GetStatusInput,
	RunStateFile,
} from "./types.js";

export {
	RunStateSchema,
	parseRunState,
	safeParseRunState,
	StartRunInputSchema,
	GetStatusInputSchema,
	RunNotFoundError,
} from "./types.js";

// Status builder
export { buildStatusResponse, getDefaultNextOptions } from "./statusBuilder.js";

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
	readRunLog,
} from "./storage.js";

// Manager
export { RunManager, createRunManager } from "./manager.js";
