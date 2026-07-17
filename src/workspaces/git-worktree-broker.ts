import type {
  WorkspaceIdentity,
  WorkspaceObservation,
} from "../store/workspace-lifecycle-store.js";

export interface WorktreeTarget extends WorkspaceIdentity {
  /** Immutable full Git object ID used to create this Attempt workspace. */
  baseSha: string;
}

export interface BrokerOperationOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type BrokerOperation = "create" | "observe" | "remove";

export interface BrokerCommandEvidence {
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
}

export type BrokerFailureReason =
  | "invalid_base_sha"
  | "invalid_branch"
  | "invalid_path"
  | "runtime_mismatch"
  | "path_conflict"
  | "branch_conflict"
  | "containment_violation"
  | "identity_mismatch"
  | "dirty_workspace"
  | "command_failed"
  | "timeout"
  | "aborted";

export interface BrokerFailure {
  ok: false;
  operation: BrokerOperation;
  reason: BrokerFailureReason;
  message: string;
  command?: BrokerCommandEvidence;
  observation?: WorkspaceObservation;
}

export interface CreateWorktreeSuccess {
  ok: true;
  outcome: "created" | "reused";
  observation: WorkspaceObservation;
}

export type CreateWorktreeResult = CreateWorktreeSuccess | BrokerFailure;

export interface ObserveWorktreeSuccess {
  ok: true;
  outcome: "observed";
  observation: WorkspaceObservation;
}

export type ObserveWorktreeResult = ObserveWorktreeSuccess | BrokerFailure;

export type WorktreePreservationReason =
  | "dirty"
  | "missing"
  | "unregistered"
  | "wrong_repository"
  | "wrong_branch"
  | "identity_ambiguous";

export interface RemoveWorktreeSuccess {
  ok: true;
  outcome: "removed" | "preserved";
  preservationReason?: WorktreePreservationReason;
  observation: WorkspaceObservation;
}

export type RemoveWorktreeResult = RemoveWorktreeSuccess | BrokerFailure;

/**
 * Git side-effect port. Durable ownership and fencing remain the
 * WorkspaceLifecycleStore's responsibility; the broker only observes and
 * mutates the declared runtime's Git worktree registry.
 */
export interface GitWorktreeBroker {
  create(target: WorktreeTarget, options?: BrokerOperationOptions): Promise<CreateWorktreeResult>;
  observe(target: WorktreeTarget, options?: BrokerOperationOptions): Promise<ObserveWorktreeResult>;
  remove(target: WorktreeTarget, options?: BrokerOperationOptions): Promise<RemoveWorktreeResult>;
}
