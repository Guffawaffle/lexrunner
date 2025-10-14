/**
 * Orchestration module - Conflict prediction and batch optimization
 */

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
