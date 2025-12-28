/**
 * Orchestration module - Tools for pyramid orchestration
 *
 * Includes:
 * - Conflict prediction and batch optimization
 * - Agent assignment for batch operations
 * - Conflict clustering by file and symbol
 */

// Conflict prediction exports
export {
  predictConflicts,
  buildConflictGraph,
  computeMIS,
  computeAllMISBatches,
  simulateMerge,
  parseMergeTreeOutput,
} from "./conflictPredictor.js";

export type {
  ConflictReport,
  ConflictGraph,
  MISBatch,
  PRWithFiles,
  ConflictDetail,
  MergeSimulationResult,
  Symbol,
  ConflictCluster,
  ClusteredConflictReport,
} from "./types.js";

// Conflict clustering exports
export {
  extractSymbols,
  normalizeSignature,
  normalizeWhitespace,
  detectRename,
  findAffectedSymbols,
  clusterConflicts,
  generateClusteredReport,
  writeConflictsJson,
} from "./conflictClustering.js";

// Agent assignment exports
export * from "./agentAssigner.js";
