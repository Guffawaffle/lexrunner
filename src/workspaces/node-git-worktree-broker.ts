import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceObservation } from "../store/workspace-lifecycle-store.js";
import {
  ExecaCommandRunner,
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from "./command-runner.js";
import type {
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
import {
  parseGitStatusPorcelainV1Z,
  parseGitWorktreePorcelainZ,
  type GitWorktreePorcelainRecord,
} from "./git-worktree-porcelain.js";
import {
  DirectoryBoundaryError,
  assertAnchoredDirectoryLocation,
  captureDirectoryIdentity,
  createChildDirectory,
  identityOf,
  openChildDirectory,
  reopenDirectoryIdentity,
  sameDirectoryIdentity,
  tryOpenChildDirectory,
  assertDirectoryIdentityBoundarySupported,
  type AnchoredDirectory,
  type DirectoryIdentity,
} from "./linux-directory-identity.js";

const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DIRTY_PATHS = 200;
const EVIDENCE_TAIL_BYTES = 4_096;
const ATTEMPT_MARKER_FILE = "lexrunner-attempt.json";
const MAX_ATTEMPT_MARKER_BYTES = 64 * 1024;
const MAX_GITDIR_FILE_BYTES = 16 * 1024;

export interface NodeGitWorktreeBrokerOptions {
  repositoryId: string;
  repositoryRoot: string;
  worktreeRoot: string;
  hostId: string;
  gitRuntime: string;
  /** Native comparison behavior of the declared Git runtime. */
  pathComparison: "case-sensitive" | "case-insensitive";
  gitExecutable?: string;
  runner?: CommandRunner;
  defaultTimeoutMs?: number;
  maxDirtyPaths?: number;
}

interface GitExecutionSuccess {
  ok: true;
  exitCode: number;
  stdout: string;
  stderr: string;
  executable: string;
  args: string[];
  cwd: string;
}

interface AttemptMarker {
  schemaVersion: 1;
  repositoryId: string;
  attemptId: string;
  hostId: string;
  gitRuntime: string;
  projectRoot: string;
  worktreePath: string;
  branch: string;
  baseSha: string;
}

type GitExecutionResult = GitExecutionSuccess | BrokerFailure;

interface OperationBoundary {
  repository: AnchoredDirectory;
  repositoryGit: AnchoredDirectory;
  targetParent: AnchoredDirectory;
  targetName: string;
  target: AnchoredDirectory | null;
}

/**
 * Node implementation of the STFC worktree safety contract.
 * One instance is bound to one repository, host, and Git runtime. It never
 * rewrites paths between runtimes and never force-removes a worktree.
 */
export class NodeGitWorktreeBroker implements GitWorktreeBroker {
  private readonly repositoryId: string;
  private readonly repositoryRoot: string;
  private readonly worktreeRoot: string;
  private readonly hostId: string;
  private readonly gitRuntime: string;
  private readonly pathComparison: NodeGitWorktreeBrokerOptions["pathComparison"];
  private readonly gitExecutable: string;
  private readonly runner: CommandRunner;
  private readonly defaultTimeoutMs: number;
  private readonly maxDirtyPaths: number;
  private readonly repositoryIdentity: DirectoryIdentity;
  private readonly repositoryGitIdentity: DirectoryIdentity;
  private readonly worktreeRootIdentity: DirectoryIdentity;

  constructor(options: NodeGitWorktreeBrokerOptions) {
    if (
      !options.repositoryId ||
      !options.repositoryRoot ||
      !options.worktreeRoot ||
      !options.hostId ||
      !options.gitRuntime
    ) {
      throw new Error(
        "repositoryId, repositoryRoot, worktreeRoot, hostId, and gitRuntime are required"
      );
    }
    if (
      !path.isAbsolute(options.repositoryRoot) ||
      !path.isAbsolute(options.worktreeRoot) ||
      options.repositoryRoot.includes("\0") ||
      options.worktreeRoot.includes("\0")
    ) {
      throw new Error("repositoryRoot and worktreeRoot must be runtime-native absolute paths");
    }
    if (!Number.isSafeInteger(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS)) {
      throw new Error("defaultTimeoutMs must be a positive safe integer");
    }
    if ((options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
      throw new Error("defaultTimeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.maxDirtyPaths ?? DEFAULT_MAX_DIRTY_PATHS)) {
      throw new Error("maxDirtyPaths must be a positive safe integer");
    }
    if ((options.maxDirtyPaths ?? DEFAULT_MAX_DIRTY_PATHS) <= 0) {
      throw new Error("maxDirtyPaths must be a positive safe integer");
    }
    if (nativePathsOverlap(options.repositoryRoot, options.worktreeRoot, options.pathComparison)) {
      throw new Error("repositoryRoot and worktreeRoot must not overlap");
    }

    assertDirectoryIdentityBoundarySupported(options.pathComparison);
    this.repositoryIdentity = captureDirectoryIdentity(options.repositoryRoot, "repositoryRoot");
    this.worktreeRootIdentity = captureDirectoryIdentity(options.worktreeRoot, "worktreeRoot");
    const repository = reopenDirectoryIdentity(this.repositoryIdentity, "repositoryRoot");
    try {
      const repositoryGit = openChildDirectory(repository, ".git", "repository Git directory");
      try {
        this.repositoryGitIdentity = identityOf(repositoryGit);
      } finally {
        repositoryGit.close();
      }
    } finally {
      repository.close();
    }

    this.repositoryId = options.repositoryId;
    this.repositoryRoot = this.repositoryIdentity.path;
    this.worktreeRoot = this.worktreeRootIdentity.path;
    this.hostId = options.hostId;
    this.gitRuntime = options.gitRuntime;
    this.pathComparison = options.pathComparison;
    this.gitExecutable = options.gitExecutable ?? "git";
    this.runner = options.runner ?? new ExecaCommandRunner();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxDirtyPaths = options.maxDirtyPaths ?? DEFAULT_MAX_DIRTY_PATHS;
  }

  async create(
    target: WorktreeTarget,
    options: BrokerOperationOptions = {}
  ): Promise<CreateWorktreeResult> {
    const runtimeFailure = this.runtimeFailure(target, "create");
    if (runtimeFailure) return runtimeFailure;
    if (!FULL_GIT_OBJECT_ID.test(target.baseSha)) {
      return this.failure(
        "create",
        "invalid_base_sha",
        "baseSha must be a lowercase full SHA-1 or SHA-256 object ID"
      );
    }

    const boundary = this.openOperationBoundary(target, "create");
    if ("ok" in boundary) return boundary;
    try {
      const branchValidation = await this.gitMain(
        boundary,
        "create",
        ["check-ref-format", "--branch", target.branch],
        options
      );
      if (!branchValidation.ok) {
        if (
          branchValidation.reason === "command_failed" &&
          branchValidation.command?.exitCode !== null
        ) {
          return { ...branchValidation, reason: "invalid_branch" };
        }
        return branchValidation;
      }

      const commit = await this.gitMain(
        boundary,
        "create",
        ["rev-parse", "--verify", `${target.baseSha}^{commit}`],
        options
      );
      if (!commit.ok) {
        if (commit.reason === "command_failed" && commit.command?.exitCode !== null) {
          return { ...commit, reason: "invalid_base_sha" };
        }
        return commit;
      }
      if (commit.stdout.trim() !== target.baseSha) {
        return this.failure(
          "create",
          "invalid_base_sha",
          "baseSha did not resolve to the exact supplied commit",
          commit
        );
      }

      const before = await this.observeAnchored(target, boundary, options);
      if (!before.ok) return { ...before, operation: "create" };
      const observation = before.observation;
      if (observation.registered) {
        if (
          observation.exists &&
          observation.repositoryId === target.repositoryId &&
          observation.branch === target.branch &&
          observation.headSha === target.baseSha &&
          observation.attemptId === target.attemptId
        ) {
          if (observation.cleanliness === "dirty") {
            return this.failure(
              "create",
              "dirty_workspace",
              "An existing matching worktree is dirty and requires explicit reconciliation",
              undefined,
              observation
            );
          }
          return { ok: true, outcome: "reused", observation };
        }
        return this.failure(
          "create",
          "identity_mismatch",
          "A registered worktree at the target path does not match the requested identity",
          undefined,
          observation
        );
      }
      if (observation.exists) {
        return this.failure(
          "create",
          "path_conflict",
          "The target path already exists but is not the requested registered worktree",
          undefined,
          observation
        );
      }

      const branch = await this.gitMain(
        boundary,
        "create",
        ["show-ref", "--verify", "--quiet", `refs/heads/${target.branch}`],
        options,
        [1]
      );
      if (!branch.ok) return branch;
      if (branch.exitCode === 0) {
        return this.failure(
          "create",
          "branch_conflict",
          `Local branch '${target.branch}' already exists`,
          branch
        );
      }

      try {
        const targetDirectory = createChildDirectory(
          boundary.targetParent,
          boundary.targetName,
          "worktree target"
        );
        boundary.target = targetDirectory;
      } catch (error) {
        return this.containmentFailure("create", error);
      }
      const targetDirectory = boundary.target;
      if (!targetDirectory) {
        return this.failure(
          "create",
          "containment_violation",
          "The reserved worktree target directory identity is unavailable"
        );
      }

      const created = await this.gitMain(
        boundary,
        "create",
        ["worktree", "add", "-b", target.branch, targetDirectory.procPath, target.baseSha],
        options
      );
      if (!created.ok) {
        // A command can be interrupted after Git commits the registry mutation.
        // Without a successfully written Attempt marker ownership is ambiguous,
        // so fail closed while attaching the observed postcondition for reconciliation.
        const recovered = await this.observeAnchored(target, boundary, options);
        return recovered.ok ? { ...created, observation: recovered.observation } : created;
      }

      const markerFailure = await this.writeAttemptMarker(target, boundary);
      if (markerFailure) return markerFailure;

      const after = await this.observeAnchored(target, boundary, options);
      if (!after.ok) return { ...after, operation: "create" };
      if (!this.isExactCreatedObservation(target, after.observation)) {
        return this.failure(
          "create",
          "identity_mismatch",
          "Git reported success but the registered worktree postcondition did not match",
          created,
          after.observation
        );
      }
      return { ok: true, outcome: "created", observation: after.observation };
    } finally {
      closeOperationBoundary(boundary);
    }
  }

  async observe(
    target: WorktreeTarget,
    options: BrokerOperationOptions = {}
  ): Promise<ObserveWorktreeResult> {
    const runtimeFailure = this.runtimeFailure(target, "observe");
    if (runtimeFailure) return runtimeFailure;

    const boundary = this.openOperationBoundary(target, "observe");
    if ("ok" in boundary) return boundary;
    try {
      return await this.observeAnchored(target, boundary, options);
    } finally {
      closeOperationBoundary(boundary);
    }
  }

  private async observeAnchored(
    target: WorktreeTarget,
    boundary: OperationBoundary,
    options: BrokerOperationOptions
  ): Promise<ObserveWorktreeResult> {
    const listed = await this.gitMain(
      boundary,
      "observe",
      ["worktree", "list", "--porcelain", "-z"],
      options
    );
    if (!listed.ok) return listed;

    let records: GitWorktreePorcelainRecord[];
    try {
      records = parseGitWorktreePorcelainZ(listed.stdout);
    } catch (error) {
      return this.failure(
        "observe",
        "identity_mismatch",
        error instanceof Error ? error.message : String(error),
        listed
      );
    }

    const pathMatches = records.filter((record) =>
      this.sameNativePath(record.worktree, target.worktreePath)
    );
    const exists = boundary.target !== null;
    if (pathMatches.length !== 1) {
      return {
        ok: true,
        outcome: "observed",
        observation: this.unverifiedObservation(
          target,
          exists,
          pathMatches.length > 1
            ? "multiple registered worktrees matched the runtime-native path"
            : exists
              ? "path exists but is not registered in the declared repository"
              : "worktree path is missing"
        ),
      };
    }

    const record = pathMatches[0];
    const observedBranch = branchName(record.branch);
    let cleanliness: WorkspaceObservation["cleanliness"] = "clean";
    let dirtyPaths: string[] | undefined;
    let reason: string | undefined;
    let markerVerified = false;
    let markerReason = "worktree attempt marker is unavailable";
    if (exists) {
      const worktreeGit = await this.openWorktreeGitDirectory(boundary, "observe");
      if ("ok" in worktreeGit) return worktreeGit;
      try {
        const status = await this.gitWorktree(
          boundary,
          worktreeGit,
          "observe",
          ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=all"],
          options
        );
        if (!status.ok) return status;
        try {
          const entries = parseGitStatusPorcelainV1Z(status.stdout);
          const allPaths = entries.flatMap((entry) =>
            entry.originalPath ? [entry.path, entry.originalPath] : [entry.path]
          );
          const uniquePaths = [...new Set(allPaths)];
          cleanliness = uniquePaths.length === 0 ? "clean" : "dirty";
          if (uniquePaths.length > 0) dirtyPaths = uniquePaths.slice(0, this.maxDirtyPaths);
          if (uniquePaths.length > this.maxDirtyPaths) {
            reason = `dirty path evidence truncated to ${this.maxDirtyPaths} entries`;
          }
        } catch (error) {
          return this.failure(
            "observe",
            "identity_mismatch",
            error instanceof Error ? error.message : String(error),
            status
          );
        }

        const marker = await this.readAttemptMarker(target, worktreeGit);
        markerVerified = marker.matches;
        markerReason = marker.reason ?? markerReason;
      } finally {
        worktreeGit.close();
      }
    }

    const identityVerified =
      exists &&
      !record.bare &&
      !record.detached &&
      !record.locked &&
      !record.prunable &&
      observedBranch === target.branch &&
      markerVerified;
    const ambiguousReason =
      reason ??
      (record.bare
        ? "registered entry is bare"
        : record.detached
          ? "registered worktree is detached"
          : record.locked
            ? (record.lockedReason ?? "registered worktree is locked")
            : record.prunable
              ? (record.prunableReason ?? "registered worktree is prunable")
              : observedBranch !== target.branch
                ? "registered worktree branch does not match"
                : !markerVerified
                  ? markerReason
                  : undefined);

    return {
      ok: true,
      outcome: "observed",
      observation: {
        exists,
        registered: true,
        repositoryId: this.repositoryId,
        hostId: this.hostId,
        gitRuntime: this.gitRuntime,
        projectRoot: target.projectRoot,
        branch: observedBranch,
        worktreePath: target.worktreePath,
        attemptId: identityVerified ? target.attemptId : null,
        headSha: record.head ?? null,
        cleanliness,
        ...(dirtyPaths ? { dirtyPaths } : {}),
        ...(ambiguousReason ? { reason: ambiguousReason } : {}),
      },
    };
  }

  async remove(
    target: WorktreeTarget,
    options: BrokerOperationOptions = {}
  ): Promise<RemoveWorktreeResult> {
    const runtimeFailure = this.runtimeFailure(target, "remove");
    if (runtimeFailure) return runtimeFailure;

    const boundary = this.openOperationBoundary(target, "remove");
    if ("ok" in boundary) return boundary;
    try {
      const observed = await this.observeAnchored(target, boundary, options);
      if (!observed.ok) return { ...observed, operation: "remove" };
      const observation = observed.observation;

      const preservationReason = this.preservationReason(target, observation);
      if (preservationReason) {
        return { ok: true, outcome: "preserved", preservationReason, observation };
      }

      const targetDirectory = boundary.target;
      if (!targetDirectory) {
        return { ok: true, outcome: "preserved", preservationReason: "missing", observation };
      }
      const removed = await this.gitMain(
        boundary,
        "remove",
        ["worktree", "remove", targetDirectory.procPath],
        options
      );
      if (!removed.ok) return removed;

      targetDirectory.close();
      boundary.target = null;
      try {
        boundary.target = tryOpenChildDirectory(
          boundary.targetParent,
          boundary.targetName,
          "worktree target"
        );
      } catch (error) {
        return this.containmentFailure("remove", error);
      }

      const after = await this.observeAnchored(target, boundary, options);
      if (!after.ok) return { ...after, operation: "remove" };
      if (after.observation.registered || after.observation.exists) {
        return this.failure(
          "remove",
          "identity_mismatch",
          "Git reported removal but the worktree path or registration remains",
          removed,
          after.observation
        );
      }
      return { ok: true, outcome: "removed", observation: after.observation };
    } finally {
      closeOperationBoundary(boundary);
    }
  }

  private runtimeFailure(target: WorktreeTarget, operation: BrokerOperation): BrokerFailure | null {
    if (
      target.repositoryId !== this.repositoryId ||
      target.hostId !== this.hostId ||
      target.gitRuntime !== this.gitRuntime
    ) {
      return this.failure(
        operation,
        "runtime_mismatch",
        "Target repository, host, and Git runtime must match the broker binding"
      );
    }
    if (
      !path.isAbsolute(target.projectRoot) ||
      !path.isAbsolute(target.worktreePath) ||
      target.projectRoot.includes("\0") ||
      target.worktreePath.includes("\0")
    ) {
      return this.failure(
        operation,
        "invalid_path",
        "projectRoot and worktreePath must be runtime-native absolute paths"
      );
    }
    if (!this.sameNativePath(target.projectRoot, this.repositoryRoot)) {
      return this.failure(
        operation,
        "runtime_mismatch",
        "Target project root must match the broker repository root"
      );
    }
    if (!this.isStrictlyUnderRoot(target.worktreePath, this.worktreeRoot)) {
      return this.failure(
        operation,
        "invalid_path",
        "worktreePath must be a strict descendant of the broker worktreeRoot"
      );
    }
    return null;
  }

  private openOperationBoundary(
    target: WorktreeTarget,
    operation: BrokerOperation
  ): OperationBoundary | BrokerFailure {
    let repository: AnchoredDirectory | null = null;
    let repositoryGit: AnchoredDirectory | null = null;
    let targetParent: AnchoredDirectory | null = null;
    let targetDirectory: AnchoredDirectory | null = null;
    try {
      repository = reopenDirectoryIdentity(this.repositoryIdentity, "repositoryRoot");
      repositoryGit = openChildDirectory(repository, ".git", "repository Git directory");
      if (!sameDirectoryIdentity(repositoryGit, this.repositoryGitIdentity)) {
        throw new DirectoryBoundaryError(
          "identity_changed",
          "The repository Git directory was replaced after broker initialization"
        );
      }

      const allocationRoot = reopenDirectoryIdentity(this.worktreeRootIdentity, "worktreeRoot");
      const relative = path.relative(this.worktreeRoot, path.resolve(target.worktreePath));
      const components = relative.split(path.sep);
      const targetName = components.pop();
      if (!targetName) {
        allocationRoot.close();
        throw new DirectoryBoundaryError("invalid_path", "The worktree target has no basename");
      }

      targetParent = allocationRoot;
      for (const component of components) {
        const child = openChildDirectory(targetParent, component, "worktree target ancestor");
        targetParent.close();
        targetParent = child;
      }
      targetDirectory = tryOpenChildDirectory(targetParent, targetName, "worktree target");
      return {
        repository,
        repositoryGit,
        targetParent,
        targetName,
        target: targetDirectory,
      };
    } catch (error) {
      targetDirectory?.close();
      targetParent?.close();
      repositoryGit?.close();
      repository?.close();
      return this.containmentFailure(operation, error);
    }
  }

  private containmentFailure(operation: BrokerOperation, error: unknown): BrokerFailure {
    const message =
      error instanceof DirectoryBoundaryError
        ? error.message
        : `Directory identity containment failed: ${errorMessage(error)}`;
    return this.failure(operation, "containment_violation", message);
  }

  private gitMain(
    boundary: OperationBoundary,
    operation: BrokerOperation,
    args: readonly string[],
    options: BrokerOperationOptions,
    allowedNonzeroExitCodes: readonly number[] = []
  ): Promise<GitExecutionResult> {
    const anchoredArgs = [
      `--git-dir=${boundary.repositoryGit.procPath}`,
      `--work-tree=${boundary.repository.procPath}`,
      ...args,
    ];
    const evidenceArgs = [
      `--git-dir=${this.repositoryGitIdentity.path}`,
      `--work-tree=${this.repositoryRoot}`,
      ...args.map((arg) =>
        boundary.target && arg === boundary.target.procPath ? boundary.target.path : arg
      ),
    ];
    return this.git(
      operation,
      anchoredArgs,
      boundary.repository.procPath,
      options,
      allowedNonzeroExitCodes,
      () => this.assertOperationBoundary(boundary),
      { args: evidenceArgs, cwd: this.repositoryRoot }
    );
  }

  private gitWorktree(
    boundary: OperationBoundary,
    worktreeGit: AnchoredDirectory,
    operation: BrokerOperation,
    args: readonly string[],
    options: BrokerOperationOptions
  ): Promise<GitExecutionResult> {
    if (!boundary.target) {
      return Promise.resolve(
        this.failure(
          operation,
          "containment_violation",
          "The worktree target directory identity is unavailable"
        )
      );
    }
    const anchoredArgs = [
      `--git-dir=${worktreeGit.procPath}`,
      `--work-tree=${boundary.target.procPath}`,
      ...args,
    ];
    const evidenceArgs = [
      `--git-dir=${path.join(
        this.repositoryGitIdentity.path,
        "worktrees",
        path.basename(boundary.target.path)
      )}`,
      `--work-tree=${boundary.target.path}`,
      ...args,
    ];
    return this.git(
      operation,
      anchoredArgs,
      boundary.target.procPath,
      options,
      [],
      () => this.assertOperationBoundary(boundary, worktreeGit),
      { args: evidenceArgs, cwd: boundary.target.path }
    );
  }

  private assertOperationBoundary(
    boundary: OperationBoundary,
    worktreeGit?: AnchoredDirectory
  ): void {
    assertAnchoredDirectoryLocation(boundary.repository, "repositoryRoot");
    assertAnchoredDirectoryLocation(boundary.repositoryGit, "repository Git directory");
    assertAnchoredDirectoryLocation(boundary.targetParent, "worktree target parent");
    if (boundary.target) assertAnchoredDirectoryLocation(boundary.target, "worktree target");
    if (worktreeGit) {
      assertAnchoredDirectoryLocation(worktreeGit, "worktree Git directory");
    }
  }

  private async writeAttemptMarker(
    target: WorktreeTarget,
    boundary: OperationBoundary
  ): Promise<BrokerFailure | null> {
    const gitDirectory = await this.openWorktreeGitDirectory(boundary, "create");
    if ("ok" in gitDirectory) return gitDirectory;
    const marker: AttemptMarker = {
      schemaVersion: 1,
      repositoryId: this.repositoryId,
      attemptId: target.attemptId,
      hostId: this.hostId,
      gitRuntime: this.gitRuntime,
      projectRoot: target.projectRoot,
      worktreePath: target.worktreePath,
      branch: target.branch,
      baseSha: target.baseSha,
    };
    try {
      this.assertOperationBoundary(boundary, gitDirectory);
      const handle = await open(
        path.join(gitDirectory.procPath, ATTEMPT_MARKER_FILE),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      try {
        await handle.writeFile(`${JSON.stringify(marker)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return null;
    } catch (error) {
      return this.failure(
        "create",
        "containment_violation",
        `Worktree was created but its Attempt marker could not be written: ${errorMessage(error)}`
      );
    } finally {
      gitDirectory.close();
    }
  }

  private async readAttemptMarker(
    target: WorktreeTarget,
    gitDirectory: AnchoredDirectory
  ): Promise<{ matches: boolean; reason?: string }> {
    let marker: AttemptMarker;
    try {
      const parsed: unknown = JSON.parse(
        await readBoundedText(
          path.join(gitDirectory.procPath, ATTEMPT_MARKER_FILE),
          MAX_ATTEMPT_MARKER_BYTES
        )
      );
      if (!isAttemptMarker(parsed)) {
        return { matches: false, reason: "worktree Attempt marker is malformed" };
      }
      marker = parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { matches: false, reason: "worktree Attempt marker is missing" };
      }
      return {
        matches: false,
        reason: `worktree Attempt marker is unreadable: ${errorMessage(error)}`,
      };
    }

    const matches =
      marker.schemaVersion === 1 &&
      marker.repositoryId === this.repositoryId &&
      marker.attemptId === target.attemptId &&
      marker.hostId === this.hostId &&
      marker.gitRuntime === this.gitRuntime &&
      this.sameNativePath(marker.projectRoot, target.projectRoot) &&
      this.sameNativePath(marker.worktreePath, target.worktreePath) &&
      marker.branch === target.branch &&
      marker.baseSha === target.baseSha;
    return {
      matches,
      ...(matches ? {} : { reason: "worktree Attempt marker does not match the target identity" }),
    };
  }

  private async openWorktreeGitDirectory(
    boundary: OperationBoundary,
    operation: BrokerOperation
  ): Promise<AnchoredDirectory | BrokerFailure> {
    if (!boundary.target) {
      return this.failure(
        operation,
        "containment_violation",
        "The worktree target directory identity is unavailable"
      );
    }

    try {
      this.assertOperationBoundary(boundary);
    } catch (error) {
      return this.containmentFailure(operation, error);
    }

    let gitFile: string;
    try {
      gitFile = await readBoundedText(
        path.join(boundary.target.procPath, ".git"),
        MAX_GITDIR_FILE_BYTES
      );
    } catch (error) {
      return this.containmentFailure(operation, error);
    }
    const line = gitFile.endsWith("\n") ? gitFile.slice(0, -1) : gitFile;
    if (!line.startsWith("gitdir: ") || line.includes("\n") || line.includes("\r")) {
      return this.failure(
        operation,
        "containment_violation",
        "The worktree .git file is malformed or ambiguous"
      );
    }
    const gitDirectoryPath = line.slice("gitdir: ".length);
    if (!path.isAbsolute(gitDirectoryPath) || gitDirectoryPath.includes("\0")) {
      return this.failure(
        operation,
        "containment_violation",
        "The worktree Git directory must be an absolute path inside the anchored repository"
      );
    }
    const normalized = path.resolve(gitDirectoryPath);
    const relative = path.relative(this.repositoryGitIdentity.path, normalized);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      return this.failure(
        operation,
        "containment_violation",
        "The worktree Git directory is outside the anchored repository Git directory"
      );
    }

    let current: AnchoredDirectory | null = null;
    try {
      for (const component of relative.split(path.sep)) {
        const child = openChildDirectory(
          current ?? boundary.repositoryGit,
          component,
          "worktree Git directory"
        );
        current?.close();
        current = child;
      }
      if (!current) throw new DirectoryBoundaryError("invalid_path", "Missing worktree Git path");
      return current;
    } catch (error) {
      current?.close();
      return this.containmentFailure(operation, error);
    }
  }

  private preservationReason(
    target: WorktreeTarget,
    observation: WorkspaceObservation
  ): WorktreePreservationReason | null {
    if (!observation.exists) return "missing";
    if (!observation.registered) return "unregistered";
    if (observation.repositoryId !== target.repositoryId) return "wrong_repository";
    if (observation.branch !== target.branch) return "wrong_branch";
    if (observation.reason) return "identity_ambiguous";
    if (observation.attemptId !== target.attemptId) return "identity_ambiguous";
    if (observation.cleanliness === "dirty") return "dirty";
    return null;
  }

  private isExactCreatedObservation(
    target: WorktreeTarget,
    observation: WorkspaceObservation
  ): boolean {
    return (
      observation.exists &&
      observation.registered &&
      observation.repositoryId === target.repositoryId &&
      observation.branch === target.branch &&
      observation.attemptId === target.attemptId &&
      observation.headSha === target.baseSha &&
      observation.cleanliness === "clean" &&
      !observation.reason
    );
  }

  private unverifiedObservation(
    target: WorktreeTarget,
    exists: boolean,
    reason: string
  ): WorkspaceObservation {
    return {
      exists,
      registered: false,
      repositoryId: null,
      hostId: this.hostId,
      gitRuntime: this.gitRuntime,
      projectRoot: null,
      branch: null,
      worktreePath: target.worktreePath,
      attemptId: null,
      headSha: null,
      cleanliness: "clean",
      reason,
    };
  }

  private sameNativePath(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return this.pathComparison === "case-insensitive"
      ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
      : normalizedLeft === normalizedRight;
  }

  private isStrictlyUnderRoot(candidate: string, root: string): boolean {
    const normalizedCandidate = path.resolve(candidate);
    const normalizedRoot = path.resolve(root);
    const comparedCandidate =
      this.pathComparison === "case-insensitive"
        ? normalizedCandidate.toLocaleLowerCase("en-US")
        : normalizedCandidate;
    const comparedRoot =
      this.pathComparison === "case-insensitive"
        ? normalizedRoot.toLocaleLowerCase("en-US")
        : normalizedRoot;
    const relative = path.relative(comparedRoot, comparedCandidate);
    return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  }

  private async git(
    operation: BrokerOperation,
    args: readonly string[],
    cwd: string,
    options: BrokerOperationOptions,
    allowedNonzeroExitCodes: readonly number[] = [],
    preflight?: () => void,
    evidence?: { args: readonly string[]; cwd: string }
  ): Promise<GitExecutionResult> {
    const request: CommandRequest = {
      executable: this.gitExecutable,
      args,
      cwd,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      ...(preflight ? { preflight } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const result = await this.runner.run(request);
    if (
      result.ok ||
      (result.kind === "nonzero_exit" &&
        result.exitCode !== null &&
        allowedNonzeroExitCodes.includes(result.exitCode))
    ) {
      return {
        ok: true,
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout,
        stderr: result.stderr,
        executable: request.executable,
        args: [...(evidence?.args ?? request.args)],
        cwd: evidence?.cwd ?? request.cwd,
      };
    }
    return this.commandFailure(
      operation,
      evidence ? { ...request, args: evidence.args, cwd: evidence.cwd } : request,
      result
    );
  }

  private commandFailure(
    operation: BrokerOperation,
    request: CommandRequest,
    result: Exclude<CommandResult, { ok: true }>
  ): BrokerFailure {
    if (result.kind === "preflight_error") {
      return this.failure(operation, "containment_violation", result.message);
    }
    const reason: BrokerFailureReason =
      result.kind === "timeout"
        ? "timeout"
        : result.kind === "aborted"
          ? "aborted"
          : "command_failed";
    return this.failure(operation, reason, result.message, {
      ok: true,
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr,
      executable: request.executable,
      args: [...request.args],
      cwd: request.cwd,
      actualExitCode: result.exitCode,
    });
  }

  private failure(
    operation: BrokerOperation,
    reason: BrokerFailureReason,
    message: string,
    command?: GitExecutionSuccess & { actualExitCode?: number | null },
    observation?: WorkspaceObservation
  ): BrokerFailure {
    let evidence: BrokerCommandEvidence | undefined;
    if (command) {
      evidence = {
        executable: command.executable,
        args: command.args,
        cwd: command.cwd,
        exitCode: "actualExitCode" in command ? (command.actualExitCode ?? null) : command.exitCode,
        stdoutTail: tail(command.stdout, EVIDENCE_TAIL_BYTES),
        stderrTail: tail(command.stderr, EVIDENCE_TAIL_BYTES),
      };
    }
    return {
      ok: false,
      operation,
      reason,
      message,
      ...(evidence ? { command: evidence } : {}),
      ...(observation ? { observation } : {}),
    };
  }
}

function closeOperationBoundary(boundary: OperationBoundary): void {
  boundary.target?.close();
  boundary.targetParent.close();
  boundary.repositoryGit.close();
  boundary.repository.close();
}

function nativePathsOverlap(
  left: string,
  right: string,
  comparison: NodeGitWorktreeBrokerOptions["pathComparison"]
): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return comparison === "case-insensitive" ? resolved.toLocaleLowerCase("en-US") : resolved;
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft === normalizedRight) return true;
  const relativeLeft = path.relative(normalizedLeft, normalizedRight);
  const relativeRight = path.relative(normalizedRight, normalizedLeft);
  const isDescendant = (relative: string): boolean =>
    relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  return isDescendant(relativeLeft) || isDescendant(relativeRight);
}

function branchName(ref: string | undefined): string | null {
  if (!ref) return null;
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAttemptMarker(value: unknown): value is AttemptMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return (
    marker.schemaVersion === 1 &&
    typeof marker.repositoryId === "string" &&
    typeof marker.attemptId === "string" &&
    typeof marker.hostId === "string" &&
    typeof marker.gitRuntime === "string" &&
    typeof marker.projectRoot === "string" &&
    typeof marker.worktreePath === "string" &&
    typeof marker.branch === "string" &&
    typeof marker.baseSha === "string"
  );
}

async function readBoundedText(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(`${filePath} is not a regular file`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error(`Attempt marker exceeds ${maxBytes} bytes`);
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function tail(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(bytes.byteLength - maxBytes).toString("utf8");
}
