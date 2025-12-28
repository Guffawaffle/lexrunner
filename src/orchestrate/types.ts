/**
 * Types for issue analysis and orchestration
 */

/**
 * Metadata extracted from an issue
 */
export interface IssueMetadata {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  assignees: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  affectedFiles: string[];
  affectedDirectories: string[];
  dependencies: string[]; // Issue dependencies (e.g., "Depends-on: #123")
  complexity: {
    estimatedFiles: number;
    estimatedLines: number;
    score: number; // 0-10
  };
  copilotAgent?: {
    assigned: boolean;
    agent?: string;
  };
  durationEstimate?: {
    hours: number;
    confidence: "low" | "medium" | "high";
  };
}

/**
 * Overlap score between two issues
 */
export interface OverlapScore {
  issue1: number;
  issue2: number;
  score: number; // 0-1, where 1 is complete overlap
  fileOverlap: number;
  directoryOverlap: number;
  labelOverlap: number;
  authorOverlap: number;
}

/**
 * Parallel work identification result
 */
export interface ParallelWorkGroup {
  issues: number[];
  avgOverlap: number;
  reason: string;
}

/**
 * Complete issue analysis result
 */
export interface IssueAnalysisResult {
  metadata: IssueMetadata[];
  overlapMatrix: OverlapScore[];
  parallelGroups: ParallelWorkGroup[];
  recommendations: string[];
}
