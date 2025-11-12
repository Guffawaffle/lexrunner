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

/**
 * Symbol information extracted from code
 */
export interface Symbol {
	name: string;
	type: "function" | "class" | "interface" | "type" | "const" | "let" | "var" | "import" | "export";
	line: number;
	signature?: string;
}

/**
 * Clustered conflict group by file and symbol
 */
export interface ConflictCluster {
	file: string;
	symbols: string[];
	conflictType: "both-modified" | "rename" | "whitespace" | "mixed";
	details: {
		lineRange: string;
		affectedSymbols: Symbol[];
	};
}

/**
 * Complete conflict clustering report
 */
export interface ClusteredConflictReport {
	analyzedAt: string;
	baseBranch: string;
	clusters: ConflictCluster[];
	summary: {
		totalClusters: number;
		fileCount: number;
		symbolCount: number;
		conflictTypes: Record<string, number>;
	};
}
