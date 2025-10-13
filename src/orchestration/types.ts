/**
 * Types for conflict prediction and orchestration
 */

/**
 * Conflict graph representation
 */
export interface ConflictGraph {
	nodes: string[];
	edges: Array<{
		from: string;
		to: string;
		sharedFiles: string[];
	}>;
}

/**
 * Maximal Independent Set batch
 */
export interface MISBatch {
	id: string;
	prs: string[];
	reason: string;
}

/**
 * Conflict details from merge-tree simulation
 */
export interface ConflictDetail {
	file: string;
	lines: string;
	type: string;
}

/**
 * Merge simulation result
 */
export interface MergeSimulationResult {
	status: 'clean' | 'conflict';
	conflicts: ConflictDetail[];
}

/**
 * Complete conflict report
 */
export interface ConflictReport {
	analyzedAt: string;
	baseBranch: string;
	conflictGraph: ConflictGraph;
	misBatches: MISBatch[];
	mergeTreeSimulation: Record<string, MergeSimulationResult>;
	recommendations: {
		safeBatch: string[];
		sequential: string[];
	};
}

/**
 * PR with file list for conflict analysis
 */
export interface PRWithFiles {
	number: number;
	files: string[];
	head?: string;
}
