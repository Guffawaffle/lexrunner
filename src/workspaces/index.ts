export type {
  CommandFailure,
  CommandFailureKind,
  CommandRequest,
  CommandResult,
  CommandRunner,
  CommandSuccess,
} from "./command-runner.js";
export { ExecaCommandRunner } from "./command-runner.js";

export type {
  BrokerCommandEvidence,
  BrokerFailure,
  BrokerFailureReason,
  BrokerOperation,
  BrokerOperationOptions,
  CreateWorktreeResult,
  GitWorktreeBroker,
  ObserveWorktreeResult,
  RemoveWorktreeResult,
  WorktreePreservationReason,
  WorktreeTarget,
} from "./git-worktree-broker.js";

export type {
  GitStatusEntryKind,
  GitStatusPorcelainV1Record,
  GitWorktreePorcelainRecord,
} from "./git-worktree-porcelain.js";
export {
  parseGitStatusPorcelainV1Z,
  parseGitWorktreePorcelainZ,
} from "./git-worktree-porcelain.js";

export type { NodeGitWorktreeBrokerOptions } from "./node-git-worktree-broker.js";
export { NodeGitWorktreeBroker } from "./node-git-worktree-broker.js";

export type {
  NativeWslProjectionCommandEvidence,
  NativeWslProjectionEngineOptions,
  NativeWslProjectionFailure,
  NativeWslProjectionInspection,
  NativeWslProjectionLifecycleState,
  NativeWslProjectionPrepareOptions,
  NativeWslProjectionCleanupReason,
  NativeWslProjectionCleanupResult,
  NativeWslProjectionQuarantineSummary,
  NativeWslProjectionResult,
  NativeWslProjectionStateWriter,
  NativeWslProjectionSuccess,
} from "./native-wsl-projection-engine.js";
export { NativeWslProjectionEngine } from "./native-wsl-projection-engine.js";

export type {
  AllocateWorkspaceInput,
  HeartbeatCoordinatedWorkspaceInput,
  ReleaseCoordinatedWorkspaceInput,
  ResumeCoordinatedWorkspaceInput,
  ResumeWorkspaceInput,
  WorkspaceCoordinatorAuth,
  WorkspaceCoordinatorBrokerOptions,
  WorkspaceCoordinatorFailure,
  WorkspaceCoordinatorPhase,
  WorkspaceCoordinatorResult,
  WorkspaceCoordinatorSuccess,
  WorkspaceCoordinatorSuccessOutcome,
  WorkspaceMutationStep,
} from "./workspace-coordinator.js";
export { WorkspaceCoordinator } from "./workspace-coordinator.js";
