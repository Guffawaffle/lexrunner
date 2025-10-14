/**
 * Orchestration module - Tools for pyramid orchestration
 *
 * Includes:
 * - Conflict prediction and batch optimization
 * - Agent assignment for batch operations
 */

// Conflict prediction exports
export {
	predictConflicts,
	buildConflictGraph,
	computeMIS,
	computeAllMISBatches,
	simulateMerge,
	parseMergeTreeOutput
} from "./conflictPredictor.js";

export type {
	ConflictReport,
	ConflictGraph,
	MISBatch,
	PRWithFiles,
	ConflictDetail,
	MergeSimulationResult
} from "./types.js";

// Agent assignment exports
export * from './agentAssigner.js';
