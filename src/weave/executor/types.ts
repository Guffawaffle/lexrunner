/**
 * D1 Executor Types
 *
 * Types for the deterministic executor layer.
 *
 * @module
 */

import type { PlannedIntervention, InterventionType } from "../planner/index.js";

// =============================================================================
// EXECUTION RESULT
// =============================================================================

/**
 * Result of executing an intervention
 */
export interface InterventionResult {
  interventionId: string;
  type: InterventionType;
  success: boolean;
  /** Output data from the intervention */
  output?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** When execution started */
  startedAt: string;
  /** When execution completed */
  completedAt: string;
}

/**
 * Handler function for a specific intervention type
 */
export type InterventionHandler<T extends InterventionType = InterventionType> = (
  intervention: PlannedIntervention & { type: T },
  context: ExecutionContext
) => Promise<InterventionResult>;

// =============================================================================
// EXECUTION CONTEXT
// =============================================================================

/**
 * GitHub API interface (abstracted for testing)
 */
export interface GitHubAPI {
  listPullRequests(
    owner: string,
    repo: string,
    state?: "open" | "closed" | "all"
  ): Promise<unknown[]>;
  getPullRequest(owner: string, repo: string, number: number): Promise<unknown>;
  mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    options: MergeOptions
  ): Promise<boolean>;
  updatePullRequest(
    owner: string,
    repo: string,
    number: number,
    data: Record<string, unknown>
  ): Promise<void>;
  getCommitStatus(owner: string, repo: string, ref: string): Promise<CIStatus>;
}

export interface MergeOptions {
  method: "squash" | "merge" | "rebase";
  commitTitle?: string;
  commitMessage?: string;
}

export interface CIStatus {
  state: "pending" | "success" | "failure" | "error";
  statuses: Array<{ context: string; state: string; description?: string }>;
}

/**
 * Shell executor interface (abstracted for testing)
 */
export interface ShellExecutor {
  run(command: string, options?: { cwd?: string; timeout?: number }): Promise<ShellResult>;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Git operations interface
 */
export interface GitOperations {
  pull(repoPath: string): Promise<void>;
  getCurrentBranch(repoPath: string): Promise<string>;
  hasUncommittedChanges(repoPath: string): Promise<boolean>;
  commit(repoPath: string, message: string): Promise<void>;
  push(repoPath: string): Promise<void>;
}

/**
 * Context provided to intervention handlers
 */
export interface ExecutionContext {
  github: GitHubAPI;
  shell: ShellExecutor;
  git: GitOperations;
  /** Working directory for repo operations */
  workspaceRoot: string;
  /** Map of repo name to local path */
  repoPaths: Map<string, string>;
  /** Dry run mode - don't execute side effects */
  dryRun: boolean;
  /** Emit audit events */
  emitAudit: (event: AuditEvent) => void;
}

// =============================================================================
// AUDIT EVENTS
// =============================================================================

export interface AuditEvent {
  timestamp: string;
  interventionId: string;
  type: InterventionType;
  action: "start" | "complete" | "fail" | "skip";
  determinism: "D1" | "D2" | "D3";
  details?: Record<string, unknown>;
}
