import { open, stat, writeFile } from "node:fs/promises";
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

const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DIRTY_PATHS = 200;
const EVIDENCE_TAIL_BYTES = 4_096;
const ATTEMPT_MARKER_FILE = "lexrunner-attempt.json";
const MAX_ATTEMPT_MARKER_BYTES = 64 * 1024;

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

/**
 * Cross-platform Node implementation of the STFC worktree safety contract.
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

    this.repositoryId = options.repositoryId;
    this.repositoryRoot = options.repositoryRoot;
    this.worktreeRoot = options.worktreeRoot;
    this.hostId = options.hostId;
    this.gitRuntime = options.gitRuntime;
    this.pathComparison = options.pathComparison;
    this.gitExecutable = options.gitExecutable ?? "git";
    this.runner = options.runner ?? new ExecaCommandRunner();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxDirtyPaths = options.maxDirtyPaths ?? DEFAULT_MAX_DIRTY_PATHS;
    if (
      this.sameNativePath(this.repositoryRoot, this.worktreeRoot) ||
      this.isStrictlyUnderRoot(this.worktreeRoot, this.repositoryRoot) ||
      this.isStrictlyUnderRoot(this.repositoryRoot, this.worktreeRoot)
    ) {
      throw new Error("repositoryRoot and worktreeRoot must not overlap");
    }
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

    const branchValidation = await this.git(
      "create",
      ["check-ref-format", "--branch", target.branch],
      this.repositoryRoot,
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

    const commit = await this.git(
      "create",
      ["rev-parse", "--verify", `${target.baseSha}^{commit}`],
      this.repositoryRoot,
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

    const before = await this.observe(target, options);
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

    const branch = await this.git(
      "create",
      ["show-ref", "--verify", "--quiet", `refs/heads/${target.branch}`],
      this.repositoryRoot,
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

    const created = await this.git(
      "create",
      ["worktree", "add", "-b", target.branch, target.worktreePath, target.baseSha],
      this.repositoryRoot,
      options
    );
    if (!created.ok) {
      // A command can be interrupted after Git commits the registry mutation.
      // Without a successfully written Attempt marker ownership is ambiguous,
      // so fail closed while attaching the observed postcondition for reconciliation.
      const recovered = await this.observe(target, options);
      return recovered.ok ? { ...created, observation: recovered.observation } : created;
    }

    const markerFailure = await this.writeAttemptMarker(target, options);
    if (markerFailure) return markerFailure;

    const after = await this.observe(target, options);
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
  }

  async observe(
    target: WorktreeTarget,
    options: BrokerOperationOptions = {}
  ): Promise<ObserveWorktreeResult> {
    const runtimeFailure = this.runtimeFailure(target, "observe");
    if (runtimeFailure) return runtimeFailure;

    const listed = await this.git(
      "observe",
      ["worktree", "list", "--porcelain", "-z"],
      this.repositoryRoot,
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
    const exists = await pathExists(target.worktreePath);
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
      const status = await this.git(
        "observe",
        [
          "-C",
          target.worktreePath,
          "status",
          "--porcelain=v1",
          "-z",
          "--ignored=matching",
          "--untracked-files=all",
        ],
        this.repositoryRoot,
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

      const marker = await this.readAttemptMarker(target, options);
      if (!marker.ok) return marker;
      markerVerified = marker.matches;
      markerReason = marker.reason ?? markerReason;
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
    const observed = await this.observe(target, options);
    if (!observed.ok) return { ...observed, operation: "remove" };
    const observation = observed.observation;

    const preservationReason = this.preservationReason(target, observation);
    if (preservationReason) {
      return { ok: true, outcome: "preserved", preservationReason, observation };
    }

    const removed = await this.git(
      "remove",
      ["worktree", "remove", target.worktreePath],
      this.repositoryRoot,
      options
    );
    if (!removed.ok) return removed;

    const after = await this.observe(target, options);
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

  private async writeAttemptMarker(
    target: WorktreeTarget,
    options: BrokerOperationOptions
  ): Promise<BrokerFailure | null> {
    const gitDir = await this.git(
      "create",
      ["-C", target.worktreePath, "rev-parse", "--absolute-git-dir"],
      this.repositoryRoot,
      options
    );
    if (!gitDir.ok) return gitDir;
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
      await writeFile(
        path.join(gitDir.stdout.trim(), ATTEMPT_MARKER_FILE),
        `${JSON.stringify(marker)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        }
      );
      return null;
    } catch (error) {
      return this.failure(
        "create",
        "identity_mismatch",
        `Worktree was created but its Attempt marker could not be written: ${errorMessage(error)}`,
        gitDir
      );
    }
  }

  private async readAttemptMarker(
    target: WorktreeTarget,
    options: BrokerOperationOptions
  ): Promise<{ ok: true; matches: boolean; reason?: string } | BrokerFailure> {
    const gitDir = await this.git(
      "observe",
      ["-C", target.worktreePath, "rev-parse", "--absolute-git-dir"],
      this.repositoryRoot,
      options
    );
    if (!gitDir.ok) return gitDir;

    let marker: AttemptMarker;
    try {
      const parsed: unknown = JSON.parse(
        await readBoundedText(
          path.join(gitDir.stdout.trim(), ATTEMPT_MARKER_FILE),
          MAX_ATTEMPT_MARKER_BYTES
        )
      );
      if (!isAttemptMarker(parsed)) {
        return { ok: true, matches: false, reason: "worktree Attempt marker is malformed" };
      }
      marker = parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { ok: true, matches: false, reason: "worktree Attempt marker is missing" };
      }
      return {
        ok: true,
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
      ok: true,
      matches,
      ...(matches ? {} : { reason: "worktree Attempt marker does not match the target identity" }),
    };
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
    allowedNonzeroExitCodes: readonly number[] = []
  ): Promise<GitExecutionResult> {
    const request: CommandRequest = {
      executable: this.gitExecutable,
      args,
      cwd,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
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
        args: [...request.args],
        cwd: request.cwd,
      };
    }
    return this.commandFailure(operation, request, result);
  }

  private commandFailure(
    operation: BrokerOperation,
    request: CommandRequest,
    result: Exclude<CommandResult, { ok: true }>
  ): BrokerFailure {
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

function branchName(ref: string | undefined): string | null {
  if (!ref) return null;
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
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
  const handle = await open(filePath, "r");
  try {
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
