/**
 * Types for file-change analysis and intersection detection
 */

/**
 * Represents a file change in a PR
 */
export interface FileChange {
	filename: string;
	status: "added" | "modified" | "removed" | "renamed";
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	previousFilename?: string; // For renames
}

/**
 * File change information for a specific PR
 */
export interface PRFileChanges {
	prNumber: number;
	prName: string;
	files: FileChange[];
}

/**
 * Represents an intersection between PRs on specific files
 */
export interface FileIntersection {
	prs: string[]; // PR identifiers like "PR-101", "PR-102"
	files: string[]; // List of shared files
	confidence: number; // 0.0 to 1.0
}

/**
 * Heuristic types for dependency detection
 */
export type HeuristicType = 
	| "shared-files"
	| "directory-proximity"
	| "test-overlap";

/**
 * Dependency suggestion based on file analysis
 */
export interface DependencySuggestion {
	from: string; // Source PR identifier
	to: string; // Target PR identifier
	reason: string;
	confidence: number; // 0.0 to 1.0
	sharedFiles: string[];
	heuristic?: HeuristicType; // Which heuristic generated this suggestion
}

/**
 * Conflict prediction based on file overlap
 */
export interface ConflictPrediction {
	prs: string[]; // PR identifiers involved
	files: string[]; // Files with potential conflicts
	severity: "low" | "medium" | "high";
	reason: string;
}

/**
 * Complete file analysis result
 */
export interface FileAnalysisResult {
	fileIntersections: FileIntersection[];
	suggestions: DependencySuggestion[];
	conflicts: ConflictPrediction[];
}

/**
 * Cache entry for file analysis
 */
export interface FileAnalysisCache {
	prNumber: number;
	sha: string;
	timestamp: string;
	files: FileChange[];
}
