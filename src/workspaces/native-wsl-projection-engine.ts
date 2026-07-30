import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { lstat, open, readFile, readdir, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

import {
  NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
  NativeWslProjectionManifest_v1,
  NativeWslProjectionRequest_v1,
  NativeWslProjectionSelection_v1,
  createNativeWslProjectionManifest,
  createNativeWslProjectionPathMapping,
  createNativeWslProjectionReceipt,
  createNativeWslProjectionSelection,
  createNativeWslSourceObservation,
  nativeWslProjectionId,
  type NativeWslProjectionManifest_v1 as NativeWslProjectionManifest,
  type NativeWslProjectionReasonCode,
  type NativeWslProjectionReceipt_v1 as NativeWslProjectionReceipt,
  type NativeWslProjectionRequest_v1 as NativeWslProjectionRequest,
  type NativeWslProjectionSelection_v1 as NativeWslProjectionSelection,
  type NativeWslSourceObservation_v1 as NativeWslSourceObservation,
} from "../schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import {
  NativeWslProjectionInventoryObservation_v1,
  planNativeWslProjection,
} from "../runs/agent-work-projection-planner.js";
import {
  ExecaCommandRunner,
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from "./command-runner.js";
import type { GitWorktreeBroker } from "./git-worktree-broker.js";
import {
  DirectoryBoundaryError,
  assertAnchoredDirectoryLocation,
  assertDirectoryIdentityBoundarySupported,
  captureDirectoryIdentity,
  createChildDirectory,
  identityOf,
  openChildDirectory,
  procChildPath,
  reopenDirectoryIdentity,
  sameDirectoryIdentity,
  tryOpenChildDirectory,
  type AnchoredDirectory,
  type DirectoryIdentity,
} from "./linux-directory-identity.js";
import { NodeGitWorktreeBroker } from "./node-git-worktree-broker.js";

const MANIFEST_FILE = "lexrunner-native-wsl-projection.json";
const SELECTION_FILE = "lexrunner-native-wsl-selection.json";
const OWNER_FILE = "lexrunner-native-wsl-owner.json";
const CONTROL_STAGING = ".lexrunner-projection-staging";
const CONTROL_LOCKS = ".lexrunner-projection-locks";
const CONTROL_QUARANTINE = ".lexrunner-projection-quarantine";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_STATE_FILE_BYTES = 256 * 1024;
const MAX_CONTROL_ENTRIES = 256;
const FULL_GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_GIT_ENV = Object.freeze({
  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_OPTIONAL_LOCKS: "0",
});

type CommandAction =
  | "source_root"
  | "source_remote"
  | "source_head"
  | "source_object_exists"
  | "source_object_type"
  | "source_status"
  | "clone_nonlocal"
  | "fetch_exact_object"
  | "verify_projected_object"
  | "checkout_exact_object"
  | "remove_projection_remote"
  | "list_projection_branches"
  | "remove_projection_branch"
  | "verify_projection_head"
  | "verify_projection_status";

export interface NativeWslProjectionCommandEvidence {
  action: CommandAction;
  argvHash: string;
  outcome: "passed" | "failed";
  exitCode: number | null;
  stdoutHash: string;
  stderrHash: string;
  durationMs: number;
}

/** Trusted state-file adapter used to inject filesystem failures in boundary tests. */
export interface NativeWslProjectionStateWriter {
  writeExclusive(directory: AnchoredDirectory, file: string, content: string): Promise<void>;
}

export interface NativeWslProjectionEngineOptions {
  gitExecutable?: string;
  runner?: CommandRunner;
  stateWriter?: NativeWslProjectionStateWriter;
  syncDirectory?: (directory: AnchoredDirectory) => void;
  defaultTimeoutMs?: number;
  now?: () => string;
  token?: () => string;
}

export interface NativeWslProjectionPrepareOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface NativeWslProjectionSuccess {
  ok: true;
  outcome: "prepared" | "reused";
  manifest: NativeWslProjectionManifest;
  receipt: NativeWslProjectionReceipt;
  sourceObservation: NativeWslSourceObservation;
  selection: NativeWslProjectionSelection;
  broker: GitWorktreeBroker;
  commandEvidence: NativeWslProjectionCommandEvidence[];
  recoveredReason?: NativeWslProjectionReasonCode;
}

export interface NativeWslProjectionFailure {
  ok: false;
  outcome: "rejected" | "quarantined";
  reasonCode: Exclude<NativeWslProjectionReasonCode, "projection_prepared" | "projection_reused">;
  receipt: NativeWslProjectionReceipt;
  sourceObservation?: NativeWslSourceObservation;
  commandEvidence: NativeWslProjectionCommandEvidence[];
}

export type NativeWslProjectionResult = NativeWslProjectionSuccess | NativeWslProjectionFailure;

export interface VerifiedNativeWslProjectionSelection {
  manifest: NativeWslProjectionManifest;
  receipt: NativeWslProjectionReceipt;
  sourceObservation: NativeWslSourceObservation;
  selectionDigest: string;
}

interface SourceIdentity {
  path: string;
  device: bigint;
  inode: bigint;
}

interface SourceObservationResult {
  observation?: NativeWslSourceObservation;
  failureReason?: NativeWslProjectionFailure["reasonCode"];
}

interface NativeBoundary {
  projectionRoot: AnchoredDirectory;
  worktreeRoot: AnchoredDirectory;
  projectionStaging: AnchoredDirectory;
  worktreeStaging: AnchoredDirectory;
  projectionLocks: AnchoredDirectory;
  projectionQuarantine: AnchoredDirectory;
  worktreeQuarantine: AnchoredDirectory;
}

interface ProjectionLock {
  directory: AnchoredDirectory;
  component: string;
  token: string;
}

interface OwnerMarker {
  schemaVersion: 1;
  kind: "lock" | "projection_staging" | "allocation_staging";
  projectionId: string;
  requestDigest: string;
  token: string;
  pid: number;
  createdAt: string;
}

interface GitStepSuccess {
  ok: true;
  stdout: string;
  exitCode: number;
}

interface GitStepFailure {
  ok: false;
  kind: Exclude<CommandResult, { ok: true }>["kind"];
}

type GitStepResult = GitStepSuccess | GitStepFailure;

interface StagingState {
  component: string;
  token: string;
  projectionContainer: AnchoredDirectory;
  repository?: AnchoredDirectory;
  allocation?: AnchoredDirectory;
  allocationPublished: boolean;
  repositoryPublished: boolean;
}

class ProjectionPreparationError extends Error {
  constructor(
    readonly reasonCode: NativeWslProjectionFailure["reasonCode"],
    message: string
  ) {
    super(message);
    this.name = "ProjectionPreparationError";
  }
}

/**
 * Broker-owned projection engine. It reads the mapped source checkout but
 * publishes only exact committed Git state into identity-anchored native
 * Linux roots.
 */
export class NativeWslProjectionEngine {
  private readonly gitExecutable: string;
  private readonly runner: CommandRunner;
  private readonly stateWriter: NativeWslProjectionStateWriter;
  private readonly syncDirectory: (directory: AnchoredDirectory) => void;
  private readonly defaultTimeoutMs: number;
  private readonly now: () => string;
  private readonly token: () => string;

  constructor(options: NativeWslProjectionEngineOptions = {}) {
    const timeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new TypeError("defaultTimeoutMs must be a positive safe integer");
    }
    this.gitExecutable = options.gitExecutable ?? "git";
    this.runner = options.runner ?? new ExecaCommandRunner();
    this.stateWriter = options.stateWriter ?? {
      writeExclusive: writeExclusiveText,
    };
    this.syncDirectory = options.syncDirectory ?? syncAnchoredDirectory;
    this.defaultTimeoutMs = timeout;
    this.now = options.now ?? (() => new Date().toISOString());
    this.token =
      options.token ?? (() => randomBytes(16).toString("hex").toLocaleLowerCase("en-US"));
  }

  async prepare(
    requestInput: NativeWslProjectionRequest,
    options: NativeWslProjectionPrepareOptions = {}
  ): Promise<NativeWslProjectionResult> {
    const request = NativeWslProjectionRequest_v1.parse(requestInput);
    const evidence: NativeWslProjectionCommandEvidence[] = [];
    let boundary: NativeBoundary | undefined;
    let lock: ProjectionLock | undefined;
    let staging: StagingState | undefined;
    let sourceObservation: NativeWslSourceObservation | undefined;
    let recoveredReason: NativeWslProjectionReasonCode | undefined;

    try {
      boundary = openNativeBoundary(request);
    } catch (error) {
      return this.failure(request, directoryFailureReason(error), evidence, sourceObservation);
    }

    try {
      lock = (await this.acquireLock(boundary, request)) ?? undefined;
      if (!lock) {
        return this.failure(request, "concurrent_request", evidence, sourceObservation);
      }

      const recovered = await this.recoverInterrupted(boundary, request);
      if (!recovered.ok) {
        return this.failure(
          request,
          recovered.reasonCode,
          evidence,
          sourceObservation,
          "quarantined"
        );
      }
      if (recovered.recovered) recoveredReason = "staging_interrupted";

      await invalidateProjectionSelection(boundary, request, this.syncDirectory);
      const sourceIdentity = captureSourceIdentity(request.source.wsl_repository_path);
      const observed = await this.observeSource(request, sourceIdentity, evidence, options);
      sourceObservation = observed.observation;
      if (observed.failureReason) {
        return this.failure(request, observed.failureReason, evidence, sourceObservation);
      }
      if (!sourceObservation) {
        return this.failure(request, "operation_failed", evidence, sourceObservation);
      }

      const existing = await this.inspectReady(boundary, request);
      if (existing.state === "ready") {
        const plan = planNativeWslProjection(request, existing);
        if (plan.action === "reuse_ready") {
          const reused = await this.verifyReady(
            boundary,
            request,
            existing.manifest,
            evidence,
            options
          );
          if (reused) {
            return await this.success(
              request,
              "reused",
              existing.manifest,
              reused,
              sourceObservation,
              evidence,
              recoveredReason
            );
          }
          await this.quarantineReady(boundary, request, existing.manifest, "native_state_stale");
          recoveredReason = "native_state_stale";
        } else if (plan.action === "quarantine_then_prepare") {
          await this.quarantineReady(boundary, request, existing.manifest, "native_state_stale");
          recoveredReason = "native_state_stale";
        } else {
          return this.failure(request, "native_state_conflict", evidence, sourceObservation);
        }
      } else if (existing.state === "invalid") {
        await this.quarantineInvalidReady(boundary, request);
        return this.failure(
          request,
          "native_state_conflict",
          evidence,
          sourceObservation,
          "quarantined"
        );
      }

      staging = await this.createStaging(boundary, request);
      const manifest = await this.populateStaging(
        boundary,
        staging,
        request,
        sourceIdentity,
        sourceObservation,
        evidence,
        options
      );
      await this.publish(boundary, staging, request);
      const broker = await this.verifyReady(boundary, request, manifest, evidence, options);
      if (!broker) {
        throw new ProjectionPreparationError(
          "native_state_stale",
          "published projection failed final verification"
        );
      }
      await this.removeProjectionContainer(boundary, staging);
      staging = undefined;
      return await this.success(
        request,
        "prepared",
        manifest,
        broker,
        sourceObservation,
        evidence,
        recoveredReason
      );
    } catch (error) {
      const reason =
        error instanceof ProjectionPreparationError
          ? error.reasonCode
          : directoryFailureReason(error);
      const quarantined =
        (staging ? !(await this.rollbackStaging(boundary, staging, request)) : false) ||
        (error instanceof ProjectionPreparationError &&
          error.reasonCode === "cleanup_failed_quarantined");
      return this.failure(
        request,
        quarantined ? "cleanup_failed_quarantined" : reason,
        evidence,
        sourceObservation,
        quarantined ? "quarantined" : "rejected"
      );
    } finally {
      if (lock) await this.releaseLock(boundary, lock);
      closeNativeBoundary(boundary);
    }
  }

  private async observeSource(
    request: NativeWslProjectionRequest,
    sourceIdentity: SourceIdentity,
    evidence: NativeWslProjectionCommandEvidence[],
    options: NativeWslProjectionPrepareOptions
  ): Promise<SourceObservationResult> {
    const preflight = () => assertSourceIdentity(sourceIdentity);
    const cwd = sourceIdentity.path;
    const root = await this.git(
      "source_root",
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--show-toplevel"],
      cwd,
      request,
      evidence,
      options,
      preflight
    );
    if (!root.ok) return commandObservationFailure(root);
    if (path.resolve(root.stdout.trim()) !== sourceIdentity.path) {
      return { failureReason: "repository_identity_mismatch" };
    }

    const remote = await this.git(
      "source_remote",
      ["remote", "get-url", "origin"],
      ["remote", "get-url", "origin"],
      cwd,
      request,
      evidence,
      options,
      preflight
    );
    if (!remote.ok) return commandObservationFailure(remote);

    const head = await this.git(
      "source_head",
      ["rev-parse", "--verify", "HEAD"],
      ["rev-parse", "--verify", "HEAD"],
      cwd,
      request,
      evidence,
      options,
      preflight
    );
    if (!head.ok || !FULL_GIT_OBJECT_ID.test(head.stdout.trim())) {
      return head.ok ? { failureReason: "operation_failed" } : commandObservationFailure(head);
    }

    const objectExists = await this.git(
      "source_object_exists",
      ["cat-file", "-e", `${request.base_sha}^{object}`],
      ["cat-file", "-e", "<requested-object>^{object}"],
      cwd,
      request,
      evidence,
      options,
      preflight,
      [1, 128]
    );
    if (!objectExists.ok) return commandObservationFailure(objectExists);

    let objectType: "commit" | "missing" | "other" = "missing";
    if (objectExists.exitCode === 0) {
      const type = await this.git(
        "source_object_type",
        ["cat-file", "-t", request.base_sha],
        ["cat-file", "-t", "<requested-object>"],
        cwd,
        request,
        evidence,
        options,
        preflight
      );
      if (!type.ok) return commandObservationFailure(type);
      objectType = type.stdout.trim() === "commit" ? "commit" : "other";
    }

    const status = await this.git(
      "source_status",
      ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
      ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
      cwd,
      request,
      evidence,
      options,
      preflight
    );
    if (!status.ok) return commandObservationFailure(status);

    try {
      assertSourceIdentity(sourceIdentity);
    } catch {
      return { failureReason: "source_replaced" };
    }

    const observation = createNativeWslSourceObservation({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      repository_id: request.repository.id,
      request_digest: request.request_digest,
      observed_remote_hash: computeCanonicalHash(remote.stdout.trim()),
      source_head_sha: head.stdout.trim(),
      requested_object_sha: request.base_sha,
      requested_object_type: objectType,
      cleanliness: status.stdout.length === 0 ? "clean" : "dirty",
      observed_at: this.now(),
    });

    if (observation.observed_remote_hash !== request.repository.expected_remote_hash) {
      return {
        observation,
        failureReason: "repository_identity_mismatch",
      };
    }
    if (objectType === "missing") {
      return { observation, failureReason: "source_object_missing" };
    }
    if (objectType !== "commit") {
      return { observation, failureReason: "source_object_not_commit" };
    }
    if (
      request.source.head_policy === "require_base" &&
      observation.source_head_sha !== request.base_sha
    ) {
      return { observation, failureReason: "source_head_mismatch" };
    }
    if (request.source.dirty_policy === "require_clean" && observation.cleanliness !== "clean") {
      return { observation, failureReason: "source_dirty" };
    }
    return { observation };
  }

  private async inspectReady(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest
  ): Promise<NativeWslProjectionInventoryObservation_v1> {
    const component = nativeWslProjectionId(request.request_digest);
    const ready = tryOpenChildDirectory(boundary.projectionRoot, component, "native projection");
    if (!ready) return { state: "absent" };
    try {
      const manifest = await readProjectionManifest(ready);
      return manifest
        ? { state: "ready", manifest }
        : { state: "invalid", projection_id: component };
    } finally {
      ready.close();
    }
  }

  private async verifyReady(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest,
    manifest: NativeWslProjectionManifest,
    evidence: NativeWslProjectionCommandEvidence[],
    options: NativeWslProjectionPrepareOptions
  ): Promise<GitWorktreeBroker | null> {
    const plan = planNativeWslProjection(request, {
      state: "ready",
      manifest,
    });
    if (!plan.selection_allowed) return null;

    let repository: AnchoredDirectory | undefined;
    let gitDirectory: AnchoredDirectory | undefined;
    let allocation: AnchoredDirectory | undefined;
    try {
      repository = openChildDirectory(
        boundary.projectionRoot,
        manifest.projection_id,
        "native projection"
      );
      gitDirectory = openChildDirectory(repository, ".git", "native projection Git directory");
      allocation = openChildDirectory(
        boundary.worktreeRoot,
        manifest.projection_id,
        "native allocation root"
      );
      if (
        !matchesClaim(repository, manifest.native_repository.directory_identity) ||
        !matchesClaim(gitDirectory, manifest.native_repository.git_directory_identity) ||
        !matchesClaim(allocation, manifest.native_worktree_root.directory_identity)
      ) {
        return null;
      }
      if (await hasAlternates(gitDirectory)) return null;

      const preflight = () => {
        assertAnchoredDirectoryLocation(repository!, "native projection");
        assertAnchoredDirectoryLocation(gitDirectory!, "native projection Git directory");
        assertAnchoredDirectoryLocation(allocation!, "native allocation root");
      };
      const head = await this.git(
        "verify_projection_head",
        [
          `--git-dir=${gitDirectory.procPath}`,
          `--work-tree=${repository.procPath}`,
          "rev-parse",
          "--verify",
          "HEAD",
        ],
        [
          "--git-dir=<native-git>",
          "--work-tree=<native-repository>",
          "rev-parse",
          "--verify",
          "HEAD",
        ],
        repository.procPath,
        request,
        evidence,
        options,
        preflight
      );
      if (!head.ok || head.stdout.trim() !== request.base_sha) return null;
      const status = await this.git(
        "verify_projection_status",
        [
          `--git-dir=${gitDirectory.procPath}`,
          `--work-tree=${repository.procPath}`,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ],
        [
          "--git-dir=<native-git>",
          "--work-tree=<native-repository>",
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ],
        repository.procPath,
        request,
        evidence,
        options,
        preflight
      );
      if (!status.ok || status.stdout.length !== 0) return null;

      return new NodeGitWorktreeBroker({
        repositoryId: request.repository.id,
        repositoryRoot: manifest.native_repository.path,
        worktreeRoot: manifest.native_worktree_root.path,
        hostId: request.native.host_id,
        gitRuntime: request.native.git_runtime,
        pathComparison: "case-sensitive",
        gitExecutable: this.gitExecutable,
        runner: this.runner,
        defaultTimeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      });
    } catch {
      return null;
    } finally {
      allocation?.close();
      gitDirectory?.close();
      repository?.close();
    }
  }

  private async createStaging(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest
  ): Promise<StagingState> {
    const token = validToken(this.token());
    const component = `${nativeWslProjectionId(request.request_digest)}-${token}`;
    const projectionContainer = createChildDirectory(
      boundary.projectionStaging,
      component,
      "projection staging"
    );
    try {
      await writeOwnerMarker(
        projectionContainer,
        {
          schemaVersion: 1,
          kind: "projection_staging",
          projectionId: nativeWslProjectionId(request.request_digest),
          requestDigest: request.request_digest,
          token,
          pid: process.pid,
          createdAt: this.now(),
        },
        this.stateWriter
      );
    } catch (error) {
      const removed = await removeExactlyCreatedDirectory(
        boundary.projectionStaging,
        component,
        projectionContainer
      );
      if (!removed) {
        const remaining = tryOpenChildDirectory(
          boundary.projectionStaging,
          component,
          "failed projection staging initialization"
        );
        if (
          remaining &&
          (await this.quarantineDirectory(
            boundary.projectionStaging,
            component,
            remaining,
            boundary.projectionQuarantine
          ))
        ) {
          throw new ProjectionPreparationError(
            "cleanup_failed_quarantined",
            "failed projection staging initialization was quarantined"
          );
        }
        throw new ProjectionPreparationError(
          "native_state_conflict",
          "failed projection staging initialization could not be contained"
        );
      }
      throw error;
    }
    return {
      component,
      token,
      projectionContainer,
      allocationPublished: false,
      repositoryPublished: false,
    };
  }

  private async populateStaging(
    boundary: NativeBoundary,
    staging: StagingState,
    request: NativeWslProjectionRequest,
    sourceIdentity: SourceIdentity,
    sourceObservation: NativeWslSourceObservation,
    evidence: NativeWslProjectionCommandEvidence[],
    options: NativeWslProjectionPrepareOptions
  ): Promise<NativeWslProjectionManifest> {
    const sourcePreflight = () => {
      assertSourceIdentity(sourceIdentity);
      assertAnchoredDirectoryLocation(staging.projectionContainer, "projection staging");
    };
    const repositoryTarget = procChildPath(staging.projectionContainer, "repository");
    const clone = await this.git(
      "clone_nonlocal",
      [
        "clone",
        "--no-local",
        "--no-hardlinks",
        "--no-checkout",
        "--no-tags",
        "--",
        sourceIdentity.path,
        repositoryTarget,
      ],
      [
        "clone",
        "--no-local",
        "--no-hardlinks",
        "--no-checkout",
        "--no-tags",
        "--",
        "<wsl-source>",
        "<native-staging>",
      ],
      staging.projectionContainer.procPath,
      request,
      evidence,
      options,
      sourcePreflight
    );
    if (!clone.ok) {
      throw commandPreparationError(clone);
    }

    staging.repository = openChildDirectory(
      staging.projectionContainer,
      "repository",
      "staged native repository"
    );
    const gitDirectory = openChildDirectory(
      staging.repository,
      ".git",
      "staged native Git directory"
    );
    try {
      const nativePreflight = () => {
        assertSourceIdentity(sourceIdentity);
        assertAnchoredDirectoryLocation(staging.projectionContainer, "projection staging");
        assertAnchoredDirectoryLocation(staging.repository!, "staged native repository");
        assertAnchoredDirectoryLocation(gitDirectory, "staged native Git directory");
      };
      const projectedObject = await this.git(
        "verify_projected_object",
        [
          `--git-dir=${gitDirectory.procPath}`,
          "rev-parse",
          "--verify",
          `${request.base_sha}^{commit}`,
        ],
        ["--git-dir=<native-git>", "rev-parse", "--verify", "<requested-object>^{commit}"],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight,
        [1, 128]
      );
      if (!projectedObject.ok) throw commandPreparationError(projectedObject);
      if (projectedObject.exitCode !== 0 || projectedObject.stdout.trim() !== request.base_sha) {
        const fetched = await this.git(
          "fetch_exact_object",
          [
            `--git-dir=${gitDirectory.procPath}`,
            "fetch",
            "--no-tags",
            "--force",
            "--",
            sourceIdentity.path,
            request.base_sha,
          ],
          [
            "--git-dir=<native-git>",
            "fetch",
            "--no-tags",
            "--force",
            "--",
            "<wsl-source>",
            "<requested-object>",
          ],
          staging.repository.procPath,
          request,
          evidence,
          options,
          nativePreflight
        );
        if (!fetched.ok) throw commandPreparationError(fetched);
      }

      const verifiedObject = await this.git(
        "verify_projected_object",
        [
          `--git-dir=${gitDirectory.procPath}`,
          "rev-parse",
          "--verify",
          `${request.base_sha}^{commit}`,
        ],
        ["--git-dir=<native-git>", "rev-parse", "--verify", "<requested-object>^{commit}"],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!verifiedObject.ok || verifiedObject.stdout.trim() !== request.base_sha) {
        throw new ProjectionPreparationError(
          "source_object_missing",
          "requested commit was not transported"
        );
      }

      const checkout = await this.git(
        "checkout_exact_object",
        [
          `--git-dir=${gitDirectory.procPath}`,
          `--work-tree=${staging.repository.procPath}`,
          "checkout",
          "--detach",
          "--force",
          request.base_sha,
        ],
        [
          "--git-dir=<native-git>",
          "--work-tree=<native-staging>",
          "checkout",
          "--detach",
          "--force",
          "<requested-object>",
        ],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!checkout.ok) throw commandPreparationError(checkout);

      const removeRemote = await this.git(
        "remove_projection_remote",
        [`--git-dir=${gitDirectory.procPath}`, "remote", "remove", "origin"],
        ["--git-dir=<native-git>", "remote", "remove", "origin"],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!removeRemote.ok) throw commandPreparationError(removeRemote);
      const branches = await this.git(
        "list_projection_branches",
        [`--git-dir=${gitDirectory.procPath}`, "for-each-ref", "--format=%(refname)", "refs/heads"],
        ["--git-dir=<native-git>", "for-each-ref", "--format=%(refname)", "refs/heads"],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!branches.ok) throw commandPreparationError(branches);
      const projectedBranches = boundedProjectionBranches(branches.stdout);
      for (const branch of projectedBranches) {
        const removedBranch = await this.git(
          "remove_projection_branch",
          [`--git-dir=${gitDirectory.procPath}`, "update-ref", "-d", branch],
          ["--git-dir=<native-git>", "update-ref", "-d", "<projected-branch>"],
          staging.repository.procPath,
          request,
          evidence,
          options,
          nativePreflight
        );
        if (!removedBranch.ok) throw commandPreparationError(removedBranch);
      }
      const remainingBranches = await this.git(
        "list_projection_branches",
        [`--git-dir=${gitDirectory.procPath}`, "for-each-ref", "--format=%(refname)", "refs/heads"],
        ["--git-dir=<native-git>", "for-each-ref", "--format=%(refname)", "refs/heads"],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!remainingBranches.ok || boundedProjectionBranches(remainingBranches.stdout).length > 0) {
        throw new ProjectionPreparationError(
          "operation_failed",
          "projected moving branch references could not be retired"
        );
      }
      if (await hasAlternates(gitDirectory)) {
        throw new ProjectionPreparationError(
          "operation_failed",
          "projected repository retained an alternates dependency"
        );
      }

      const head = await this.git(
        "verify_projection_head",
        [
          `--git-dir=${gitDirectory.procPath}`,
          `--work-tree=${staging.repository.procPath}`,
          "rev-parse",
          "--verify",
          "HEAD",
        ],
        ["--git-dir=<native-git>", "--work-tree=<native-staging>", "rev-parse", "--verify", "HEAD"],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!head.ok || head.stdout.trim() !== request.base_sha) {
        throw new ProjectionPreparationError(
          "native_state_stale",
          "staged HEAD did not match the requested commit"
        );
      }
      const status = await this.git(
        "verify_projection_status",
        [
          `--git-dir=${gitDirectory.procPath}`,
          `--work-tree=${staging.repository.procPath}`,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ],
        [
          "--git-dir=<native-git>",
          "--work-tree=<native-staging>",
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ],
        staging.repository.procPath,
        request,
        evidence,
        options,
        nativePreflight
      );
      if (!status.ok || status.stdout.length !== 0) {
        throw new ProjectionPreparationError(
          "native_state_stale",
          "staged repository was not clean"
        );
      }

      staging.allocation = createChildDirectory(
        boundary.worktreeStaging,
        staging.component,
        "allocation staging"
      );
      await writeOwnerMarker(
        staging.allocation,
        {
          schemaVersion: 1,
          kind: "allocation_staging",
          projectionId: nativeWslProjectionId(request.request_digest),
          requestDigest: request.request_digest,
          token: staging.token,
          pid: process.pid,
          createdAt: this.now(),
        },
        this.stateWriter
      );

      const projectionId = nativeWslProjectionId(request.request_digest);
      const nativeRepositoryPath = path.join(request.native.projection_root, projectionId);
      const nativeWorktreePath = path.join(request.native.worktree_root, projectionId);
      const mapping = createNativeWslProjectionPathMapping({
        schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
        projection_id: projectionId,
        repository_id: request.repository.id,
        base_sha: request.base_sha,
        request_digest: request.request_digest,
        roots: {
          windows_source: {
            runtime_id: request.source.windows_runtime,
            path: request.source.windows_repository_path,
            verification: "declared",
          },
          wsl_source: {
            runtime_id: request.source.wsl_git_runtime,
            path: request.source.wsl_repository_path,
            verification: "git_observed",
            observation_digest: sourceObservation.observation_digest,
          },
          native_repository: {
            runtime_id: request.native.git_runtime,
            path: nativeRepositoryPath,
            verification: "directory_identity",
            directory_identity: identityClaim(staging.repository),
          },
          native_worktree_root: {
            runtime_id: request.native.git_runtime,
            path: nativeWorktreePath,
            verification: "directory_identity",
            directory_identity: identityClaim(staging.allocation),
          },
        },
      });
      const manifest = createNativeWslProjectionManifest({
        schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
        projection_id: projectionId,
        repository_id: request.repository.id,
        base_sha: request.base_sha,
        request_digest: request.request_digest,
        source_observation: sourceObservation,
        native_host_id: request.native.host_id,
        native_repository: {
          path: nativeRepositoryPath,
          directory_identity: identityClaim(staging.repository),
          git_directory_identity: identityClaim(gitDirectory),
          head_sha: request.base_sha,
        },
        native_worktree_root: {
          path: nativeWorktreePath,
          directory_identity: identityClaim(staging.allocation),
        },
        path_mapping: mapping,
        created_at: this.now(),
      });
      await this.stateWriter.writeExclusive(
        gitDirectory,
        MANIFEST_FILE,
        `${JSON.stringify(manifest)}\n`
      );
      assertSourceIdentity(sourceIdentity);
      return manifest;
    } finally {
      gitDirectory.close();
    }
  }

  private async publish(
    boundary: NativeBoundary,
    staging: StagingState,
    request: NativeWslProjectionRequest
  ): Promise<void> {
    if (!staging.repository || !staging.allocation) {
      throw new ProjectionPreparationError("operation_failed", "projection staging was incomplete");
    }
    const projectionId = nativeWslProjectionId(request.request_digest);
    const repositoryTargetOccupied = childDirectoryExists(
      boundary.projectionRoot,
      projectionId,
      "native projection"
    );
    const allocationTargetOccupied = childDirectoryExists(
      boundary.worktreeRoot,
      projectionId,
      "native allocation root"
    );
    if (repositoryTargetOccupied || allocationTargetOccupied) {
      throw new ProjectionPreparationError(
        "native_state_conflict",
        "native publication target became occupied"
      );
    }

    const repositoryIdentity = identityOf(staging.repository);
    const allocationIdentity = identityOf(staging.allocation);
    staging.repository.close();
    staging.repository = undefined;
    staging.allocation.close();
    staging.allocation = undefined;

    await rename(
      procChildPath(staging.projectionContainer, "repository"),
      procChildPath(boundary.projectionRoot, projectionId)
    );
    staging.repositoryPublished = true;
    assertPublishedIdentity(
      path.join(boundary.projectionRoot.path, projectionId),
      repositoryIdentity,
      "native projection"
    );

    await rename(
      procChildPath(boundary.worktreeStaging, staging.component),
      procChildPath(boundary.worktreeRoot, projectionId)
    );
    staging.allocationPublished = true;
    assertPublishedIdentity(
      path.join(boundary.worktreeRoot.path, projectionId),
      allocationIdentity,
      "native allocation root"
    );
  }

  private async acquireLock(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest
  ): Promise<ProjectionLock | null> {
    const component = nativeWslProjectionId(request.request_digest);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let created: AnchoredDirectory | undefined;
      try {
        created = createChildDirectory(boundary.projectionLocks, component, "projection lock");
        const token = validToken(this.token());
        await writeOwnerMarker(
          created,
          {
            schemaVersion: 1,
            kind: "lock",
            projectionId: component,
            requestDigest: request.request_digest,
            token,
            pid: process.pid,
            createdAt: this.now(),
          },
          this.stateWriter
        );
        return { directory: created, component, token };
      } catch {
        if (created) {
          const removed = await removeExactlyCreatedDirectory(
            boundary.projectionLocks,
            component,
            created
          );
          if (!removed) {
            return null;
          }
          continue;
        }
        const existing = tryOpenChildDirectory(
          boundary.projectionLocks,
          component,
          "projection lock"
        );
        if (!existing) continue;
        const marker = await readOwnerMarker(existing);
        if (!marker || marker.kind !== "lock" || processIsAlive(marker.pid)) {
          existing.close();
          return null;
        }
        const removed = await removeOwnedDirectory(
          boundary.projectionLocks,
          component,
          existing,
          marker
        );
        if (!removed) return null;
      }
    }
    return null;
  }

  private async releaseLock(boundary: NativeBoundary, lock: ProjectionLock): Promise<void> {
    try {
      const marker = await readOwnerMarker(lock.directory);
      if (!marker || marker.kind !== "lock" || marker.token !== lock.token) {
        lock.directory.close();
        return;
      }
      await removeOwnedDirectory(boundary.projectionLocks, lock.component, lock.directory, marker);
    } catch {
      lock.directory.close();
    }
  }

  private async recoverInterrupted(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest
  ): Promise<{
    ok: boolean;
    recovered: boolean;
    reasonCode: NativeWslProjectionFailure["reasonCode"];
  }> {
    const projectionId = nativeWslProjectionId(request.request_digest);
    const projectionEntries = await boundedDirectoryEntries(boundary.projectionStaging);
    const allocationEntries = await boundedDirectoryEntries(boundary.worktreeStaging);
    const candidates = new Set(
      [...projectionEntries, ...allocationEntries].filter((entry) =>
        entry.startsWith(`${projectionId}-`)
      )
    );
    let recovered = false;
    for (const component of candidates) {
      for (const [parent, kind] of [
        [boundary.projectionStaging, "projection_staging"],
        [boundary.worktreeStaging, "allocation_staging"],
      ] as const) {
        const directory = tryOpenChildDirectory(
          parent,
          component,
          "interrupted projection staging"
        );
        if (!directory) continue;
        const marker = await readOwnerMarker(directory);
        if (
          !marker ||
          marker.kind !== kind ||
          marker.projectionId !== projectionId ||
          marker.requestDigest !== request.request_digest
        ) {
          const quarantined = await this.quarantineDirectory(
            parent,
            component,
            directory,
            kind === "projection_staging"
              ? boundary.projectionQuarantine
              : boundary.worktreeQuarantine
          );
          return {
            ok: false,
            recovered,
            reasonCode: quarantined ? "cleanup_failed_quarantined" : "native_state_conflict",
          };
        }
        if (!(await removeOwnedDirectory(parent, component, directory, marker))) {
          return {
            ok: false,
            recovered,
            reasonCode: "cleanup_failed_quarantined",
          };
        }
        recovered = true;
      }
    }
    return { ok: true, recovered, reasonCode: "staging_interrupted" };
  }

  private async rollbackStaging(
    boundary: NativeBoundary,
    staging: StagingState,
    request: NativeWslProjectionRequest
  ): Promise<boolean> {
    let clean = true;
    const projectionId = nativeWslProjectionId(request.request_digest);
    staging.repository?.close();
    staging.repository = undefined;
    staging.allocation?.close();
    staging.allocation = undefined;

    if (staging.repositoryPublished) {
      const repository = tryOpenChildDirectory(
        boundary.projectionRoot,
        projectionId,
        "published projection rollback"
      );
      if (repository) {
        await this.quarantineDirectory(
          boundary.projectionRoot,
          projectionId,
          repository,
          boundary.projectionQuarantine
        );
        clean = false;
      }
    }
    if (staging.allocationPublished) {
      const allocation = tryOpenChildDirectory(
        boundary.worktreeRoot,
        projectionId,
        "published allocation rollback"
      );
      if (allocation) {
        await this.quarantineDirectory(
          boundary.worktreeRoot,
          projectionId,
          allocation,
          boundary.worktreeQuarantine
        );
        clean = false;
      }
    } else {
      const allocation = tryOpenChildDirectory(
        boundary.worktreeStaging,
        staging.component,
        "allocation staging rollback"
      );
      if (allocation) {
        const marker = await readOwnerMarker(allocation);
        const removed =
          marker?.kind === "allocation_staging" &&
          marker.token === staging.token &&
          (await removeOwnedDirectory(
            boundary.worktreeStaging,
            staging.component,
            allocation,
            marker
          ));
        if (!removed) {
          allocation.close();
          const remaining = tryOpenChildDirectory(
            boundary.worktreeStaging,
            staging.component,
            "ambiguous allocation staging rollback"
          );
          if (remaining) {
            await this.quarantineDirectory(
              boundary.worktreeStaging,
              staging.component,
              remaining,
              boundary.worktreeQuarantine
            );
          }
          clean = false;
        }
      }
    }

    const marker = await readOwnerMarker(staging.projectionContainer);
    const removed =
      marker?.kind === "projection_staging" &&
      marker.token === staging.token &&
      (await removeOwnedDirectory(
        boundary.projectionStaging,
        staging.component,
        staging.projectionContainer,
        marker
      ));
    if (!removed) {
      staging.projectionContainer.close();
      const remaining = tryOpenChildDirectory(
        boundary.projectionStaging,
        staging.component,
        "ambiguous projection staging rollback"
      );
      if (remaining) {
        await this.quarantineDirectory(
          boundary.projectionStaging,
          staging.component,
          remaining,
          boundary.projectionQuarantine
        );
      }
      clean = false;
    }
    return clean;
  }

  private async removeProjectionContainer(
    boundary: NativeBoundary,
    staging: StagingState
  ): Promise<void> {
    const marker = await readOwnerMarker(staging.projectionContainer);
    if (
      !marker ||
      marker.kind !== "projection_staging" ||
      marker.token !== staging.token ||
      !(await removeOwnedDirectory(
        boundary.projectionStaging,
        staging.component,
        staging.projectionContainer,
        marker
      ))
    ) {
      throw new ProjectionPreparationError(
        "cleanup_failed_quarantined",
        "published projection staging ownership could not be retired"
      );
    }
  }

  private async quarantineReady(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest,
    manifest: NativeWslProjectionManifest,
    _reason: "native_state_stale"
  ): Promise<void> {
    const projectionId = nativeWslProjectionId(request.request_digest);
    const repository = openChildDirectory(
      boundary.projectionRoot,
      projectionId,
      "stale native projection"
    );
    const allocation = tryOpenChildDirectory(
      boundary.worktreeRoot,
      projectionId,
      "stale native allocation"
    );
    try {
      if (
        !matchesClaim(repository, manifest.native_repository.directory_identity) ||
        (allocation && !matchesClaim(allocation, manifest.native_worktree_root.directory_identity))
      ) {
        throw new ProjectionPreparationError(
          "native_state_conflict",
          "stale projection ownership was ambiguous"
        );
      }
      if (allocation) {
        const allocationQuarantined = await this.quarantineDirectory(
          boundary.worktreeRoot,
          projectionId,
          allocation,
          boundary.worktreeQuarantine
        );
        if (!allocationQuarantined) {
          throw new ProjectionPreparationError(
            "cleanup_failed_quarantined",
            "stale native allocation could not be quarantined"
          );
        }
      }
      const repositoryQuarantined = await this.quarantineDirectory(
        boundary.projectionRoot,
        projectionId,
        repository,
        boundary.projectionQuarantine
      );
      if (!repositoryQuarantined) {
        throw new ProjectionPreparationError(
          "cleanup_failed_quarantined",
          "stale native repository could not be quarantined"
        );
      }
    } catch (error) {
      repository.close();
      allocation?.close();
      throw error;
    }
  }

  private async quarantineInvalidReady(
    boundary: NativeBoundary,
    request: NativeWslProjectionRequest
  ): Promise<void> {
    const projectionId = nativeWslProjectionId(request.request_digest);
    const repository = openChildDirectory(
      boundary.projectionRoot,
      projectionId,
      "invalid native projection"
    );
    const allocation = tryOpenChildDirectory(
      boundary.worktreeRoot,
      projectionId,
      "invalid native allocation"
    );
    if (allocation) {
      const allocationQuarantined = await this.quarantineDirectory(
        boundary.worktreeRoot,
        projectionId,
        allocation,
        boundary.worktreeQuarantine
      );
      if (!allocationQuarantined) {
        throw new ProjectionPreparationError(
          "cleanup_failed_quarantined",
          "invalid native allocation could not be quarantined"
        );
      }
    }
    const repositoryQuarantined = await this.quarantineDirectory(
      boundary.projectionRoot,
      projectionId,
      repository,
      boundary.projectionQuarantine
    );
    if (!repositoryQuarantined) {
      throw new ProjectionPreparationError(
        "cleanup_failed_quarantined",
        "invalid native repository could not be quarantined"
      );
    }
  }

  private async quarantineDirectory(
    parent: AnchoredDirectory,
    component: string,
    directory: AnchoredDirectory,
    quarantineRoot: AnchoredDirectory
  ): Promise<boolean> {
    const quarantineComponent = `${component}-${validToken(this.token())}`;
    try {
      assertAnchoredDirectoryLocation(directory, "quarantined projection state");
      await rename(
        procChildPath(parent, component),
        procChildPath(quarantineRoot, quarantineComponent)
      );
      directory.close();
      return true;
    } catch {
      directory.close();
      return false;
    }
  }

  private async git(
    action: CommandAction,
    args: readonly string[],
    evidenceArgs: readonly string[],
    cwd: string,
    request: NativeWslProjectionRequest,
    evidence: NativeWslProjectionCommandEvidence[],
    options: NativeWslProjectionPrepareOptions,
    preflight: () => void,
    allowedNonzeroExitCodes: readonly number[] = []
  ): Promise<GitStepResult> {
    const command: CommandRequest = {
      executable: this.gitExecutable,
      args: [
        "-c",
        "credential.helper=",
        "-c",
        "core.askPass=",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ],
      cwd,
      env: SAFE_GIT_ENV,
      extendEnv: false,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
      preflight,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const result = await this.runner.run(command);
    const accepted =
      result.ok ||
      (result.kind === "nonzero_exit" &&
        result.exitCode !== null &&
        allowedNonzeroExitCodes.includes(result.exitCode));
    evidence.push({
      action,
      argvHash: computeCanonicalHash({
        executable: "git",
        args: [
          "-c",
          "credential.helper=",
          "-c",
          "core.askPass=",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.untrackedCache=false",
          ...evidenceArgs,
        ],
        requestDigest: request.request_digest,
      }),
      outcome: accepted ? "passed" : "failed",
      exitCode: result.ok ? 0 : result.exitCode,
      stdoutHash: computeCanonicalHash(result.stdout),
      stderrHash: computeCanonicalHash(result.stderr),
      durationMs: boundedDuration(result.durationMs),
    });
    if (accepted) {
      return {
        ok: true,
        stdout: result.stdout,
        exitCode: result.ok ? 0 : (result.exitCode ?? 1),
      };
    }
    return { ok: false, kind: result.kind };
  }

  private async success(
    request: NativeWslProjectionRequest,
    outcome: "prepared" | "reused",
    manifest: NativeWslProjectionManifest,
    broker: GitWorktreeBroker,
    sourceObservation: NativeWslSourceObservation,
    commandEvidence: NativeWslProjectionCommandEvidence[],
    recoveredReason?: NativeWslProjectionReasonCode
  ): Promise<NativeWslProjectionSuccess> {
    const receipt = createNativeWslProjectionReceipt({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      request_id: request.request_id,
      request_digest: request.request_digest,
      outcome,
      reason_code: outcome === "prepared" ? "projection_prepared" : "projection_reused",
      source_observation_digest: sourceObservation.observation_digest,
      projection_digest: manifest.manifest_digest,
      mapping_digest: manifest.path_mapping.mapping_digest,
      completed_at: this.now(),
    });
    const selection = createNativeWslProjectionSelection({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      manifest_digest: manifest.manifest_digest,
      receipt,
      source_observation: sourceObservation,
    });
    await persistProjectionSelection(manifest, selection, this.token(), this.syncDirectory);
    return {
      ok: true,
      outcome,
      manifest,
      receipt,
      sourceObservation,
      selection,
      broker,
      commandEvidence,
      ...(recoveredReason ? { recoveredReason } : {}),
    };
  }

  private failure(
    request: NativeWslProjectionRequest,
    reasonCode: NativeWslProjectionFailure["reasonCode"],
    commandEvidence: NativeWslProjectionCommandEvidence[],
    sourceObservation?: NativeWslSourceObservation,
    outcome: "rejected" | "quarantined" = "rejected"
  ): NativeWslProjectionFailure {
    const receipt = createNativeWslProjectionReceipt({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      request_id: request.request_id,
      request_digest: request.request_digest,
      outcome,
      reason_code: reasonCode,
      ...(sourceObservation
        ? {
            source_observation_digest: sourceObservation.observation_digest,
          }
        : {}),
      completed_at: this.now(),
    });
    return {
      ok: false,
      outcome,
      reasonCode,
      receipt,
      ...(sourceObservation ? { sourceObservation } : {}),
      commandEvidence,
    };
  }
}

function openNativeBoundary(request: NativeWslProjectionRequest): NativeBoundary {
  assertDirectoryIdentityBoundarySupported("case-sensitive");
  const projectionIdentity = captureDirectoryIdentity(
    request.native.projection_root,
    "projection root"
  );
  const worktreeIdentity = captureDirectoryIdentity(request.native.worktree_root, "worktree root");
  const projectionRoot = reopenDirectoryIdentity(projectionIdentity, "projection root");
  let worktreeRoot: AnchoredDirectory | undefined;
  let projectionStaging: AnchoredDirectory | undefined;
  let worktreeStaging: AnchoredDirectory | undefined;
  let projectionLocks: AnchoredDirectory | undefined;
  let projectionQuarantine: AnchoredDirectory | undefined;
  let worktreeQuarantine: AnchoredDirectory | undefined;
  try {
    worktreeRoot = reopenDirectoryIdentity(worktreeIdentity, "worktree root");
    projectionStaging = ensureControlDirectory(projectionRoot, CONTROL_STAGING);
    worktreeStaging = ensureControlDirectory(worktreeRoot, CONTROL_STAGING);
    projectionLocks = ensureControlDirectory(projectionRoot, CONTROL_LOCKS);
    projectionQuarantine = ensureControlDirectory(projectionRoot, CONTROL_QUARANTINE);
    worktreeQuarantine = ensureControlDirectory(worktreeRoot, CONTROL_QUARANTINE);
    return {
      projectionRoot,
      worktreeRoot,
      projectionStaging,
      worktreeStaging,
      projectionLocks,
      projectionQuarantine,
      worktreeQuarantine,
    };
  } catch (error) {
    worktreeQuarantine?.close();
    projectionQuarantine?.close();
    projectionLocks?.close();
    worktreeStaging?.close();
    projectionStaging?.close();
    worktreeRoot?.close();
    projectionRoot.close();
    throw error;
  }
}

function closeNativeBoundary(boundary?: NativeBoundary): void {
  if (!boundary) return;
  boundary.worktreeQuarantine.close();
  boundary.projectionQuarantine.close();
  boundary.projectionLocks.close();
  boundary.worktreeStaging.close();
  boundary.projectionStaging.close();
  boundary.worktreeRoot.close();
  boundary.projectionRoot.close();
}

function ensureControlDirectory(parent: AnchoredDirectory, component: string): AnchoredDirectory {
  const existing = tryOpenChildDirectory(parent, component, "projection control directory");
  if (existing) return existing;
  try {
    return createChildDirectory(parent, component, "projection control directory");
  } catch (error) {
    const raced = tryOpenChildDirectory(parent, component, "projection control directory");
    if (raced) return raced;
    throw error;
  }
}

function childDirectoryExists(
  parent: AnchoredDirectory,
  component: string,
  label: string
): boolean {
  const directory = tryOpenChildDirectory(parent, component, label);
  if (!directory) return false;
  directory.close();
  return true;
}

function captureSourceIdentity(sourcePath: string): SourceIdentity {
  try {
    const resolved = path.resolve(sourcePath);
    const real = realpathSync(resolved);
    const stats = lstatSync(resolved, { bigint: true });
    if (!stats.isDirectory() || real !== resolved) {
      throw new ProjectionPreparationError(
        "source_replaced",
        "mapped source must be an exact non-symlink directory"
      );
    }
    return {
      path: resolved,
      device: stats.dev,
      inode: stats.ino,
    };
  } catch (error) {
    if (error instanceof ProjectionPreparationError) throw error;
    throw new ProjectionPreparationError(
      "source_replaced",
      "mapped source directory was unavailable"
    );
  }
}

function assertSourceIdentity(expected: SourceIdentity): void {
  const stats = lstatSync(expected.path, { bigint: true });
  const real = realpathSync(expected.path);
  if (
    !stats.isDirectory() ||
    real !== expected.path ||
    stats.dev !== expected.device ||
    stats.ino !== expected.inode
  ) {
    throw new ProjectionPreparationError(
      "source_replaced",
      "mapped source directory identity changed"
    );
  }
}

function identityClaim(directory: AnchoredDirectory): {
  device: string;
  inode: string;
} {
  return {
    device: directory.device.toString(10),
    inode: directory.inode.toString(10),
  };
}

function matchesClaim(
  directory: AnchoredDirectory,
  claim: { device: string; inode: string }
): boolean {
  return (
    directory.device.toString(10) === claim.device && directory.inode.toString(10) === claim.inode
  );
}

function boundedProjectionBranches(stdout: string): string[] {
  if (Buffer.byteLength(stdout, "utf8") > MAX_COMMAND_OUTPUT_BYTES) {
    throw new ProjectionPreparationError(
      "operation_failed",
      "projected branch inventory exceeded its evidence bound"
    );
  }
  const branches = stdout.split("\n").filter((value) => value.length > 0);
  if (branches.length > MAX_CONTROL_ENTRIES) {
    throw new ProjectionPreparationError(
      "operation_failed",
      "projected branch inventory exceeded its entry bound"
    );
  }
  for (const branch of branches) {
    if (
      Buffer.byteLength(branch, "utf8") > 4_096 ||
      !branch.startsWith("refs/heads/") ||
      branch.includes("\0")
    ) {
      throw new ProjectionPreparationError(
        "operation_failed",
        "projected branch inventory was invalid"
      );
    }
  }
  return branches;
}

async function hasAlternates(gitDirectory: AnchoredDirectory): Promise<boolean> {
  try {
    const alternate = await lstat(
      path.join(gitDirectory.procPath, "objects", "info", "alternates")
    );
    return alternate.isFile() || alternate.isSymbolicLink();
  } catch (error) {
    return !isNodeError(error) || error.code !== "ENOENT";
  }
}

async function writeOwnerMarker(
  directory: AnchoredDirectory,
  marker: OwnerMarker,
  writer: NativeWslProjectionStateWriter
): Promise<void> {
  await writer.writeExclusive(directory, OWNER_FILE, `${JSON.stringify(marker)}\n`);
}

async function writeExclusiveText(
  directory: AnchoredDirectory,
  file: string,
  content: string
): Promise<void> {
  assertAnchoredDirectoryLocation(directory, "owned projection directory");
  const handle = await open(
    path.join(directory.procPath, file),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readOwnerMarker(directory: AnchoredDirectory): Promise<OwnerMarker | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readBoundedText(path.join(directory.procPath, OWNER_FILE))
    );
    return isOwnerMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isOwnerMarker(value: unknown): value is OwnerMarker {
  if (typeof value !== "object" || value === null) return false;
  const marker = value as Partial<OwnerMarker>;
  return (
    marker.schemaVersion === 1 &&
    (marker.kind === "lock" ||
      marker.kind === "projection_staging" ||
      marker.kind === "allocation_staging") &&
    typeof marker.projectionId === "string" &&
    marker.projectionId.length <= 128 &&
    typeof marker.requestDigest === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(marker.requestDigest) &&
    typeof marker.token === "string" &&
    /^[a-f0-9]{16,64}$/u.test(marker.token) &&
    Number.isSafeInteger(marker.pid) &&
    marker.pid! > 0 &&
    typeof marker.createdAt === "string" &&
    marker.createdAt.length <= 64
  );
}

/**
 * Resolve the engine-authored current selection through the identity-anchored
 * native repository. Caller-supplied canonical hashes are not provenance.
 */
export function loadNativeWslProjectionSelection(
  repositoryRoot: string,
  expectedSelectionDigest: string
): VerifiedNativeWslProjectionSelection {
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedSelectionDigest)) {
    throw new Error("Projection selection authority is invalid");
  }

  const repositoryIdentity = captureDirectoryIdentity(
    repositoryRoot,
    "native projection repository"
  );
  const repository = reopenDirectoryIdentity(repositoryIdentity, "native projection repository");
  let gitDirectory: AnchoredDirectory | undefined;
  try {
    gitDirectory = openChildDirectory(repository, ".git", "native projection Git directory");
    const manifest = NativeWslProjectionManifest_v1.parse(
      readAnchoredJson(gitDirectory, MANIFEST_FILE)
    );
    const selection = NativeWslProjectionSelection_v1.parse(
      readAnchoredJson(gitDirectory, SELECTION_FILE)
    );
    if (
      selection.selection_digest !== expectedSelectionDigest ||
      manifest.native_repository.path !== repositoryRoot ||
      !matchesIdentityClaim(repository, manifest.native_repository.directory_identity) ||
      !matchesIdentityClaim(gitDirectory, manifest.native_repository.git_directory_identity) ||
      selection.manifest_digest !== manifest.manifest_digest ||
      selection.receipt.request_digest !== manifest.request_digest ||
      selection.receipt.projection_digest !== manifest.manifest_digest ||
      selection.receipt.mapping_digest !== manifest.path_mapping.mapping_digest ||
      selection.source_observation.repository_id !== manifest.repository_id ||
      selection.source_observation.request_digest !== manifest.request_digest ||
      selection.source_observation.requested_object_sha !== manifest.base_sha ||
      selection.source_observation.requested_object_type !== "commit" ||
      (selection.receipt.outcome === "prepared" &&
        selection.source_observation.observation_digest !==
          manifest.source_observation.observation_digest)
    ) {
      throw new Error("Projection selection authority does not match the native projection");
    }
    return {
      manifest,
      receipt: selection.receipt,
      sourceObservation: selection.source_observation,
      selectionDigest: selection.selection_digest,
    };
  } catch {
    throw new Error("Projection selection authority is unavailable");
  } finally {
    gitDirectory?.close();
    repository.close();
  }
}

async function invalidateProjectionSelection(
  boundary: NativeBoundary,
  request: NativeWslProjectionRequest,
  syncDirectory: (directory: AnchoredDirectory) => void
): Promise<void> {
  const repository = tryOpenChildDirectory(
    boundary.projectionRoot,
    nativeWslProjectionId(request.request_digest),
    "native projection"
  );
  if (!repository) return;
  let gitDirectory: AnchoredDirectory | undefined;
  try {
    gitDirectory =
      tryOpenChildDirectory(repository, ".git", "native projection Git directory") ?? undefined;
    if (!gitDirectory) return;
    assertAnchoredDirectoryLocation(gitDirectory, "native projection Git directory");
    let removed = false;
    try {
      await unlink(procChildPath(gitDirectory, SELECTION_FILE));
      removed = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    if (removed) {
      try {
        syncDirectory(gitDirectory);
      } catch (error) {
        // A failed first sync cannot be reported as a durable revocation.
        // Retry the directory sync to make the already-absent authority
        // durable, but still fail this preparation attempt.
        try {
          syncDirectory(gitDirectory);
        } catch {
          // Preserve the first durability error; current-process lookup is
          // already fail-closed because the authority file is absent.
        }
        throw error;
      }
    }
  } finally {
    gitDirectory?.close();
    repository.close();
  }
}

async function persistProjectionSelection(
  manifest: NativeWslProjectionManifest,
  selection: NativeWslProjectionSelection,
  token: string,
  syncDirectory: (directory: AnchoredDirectory) => void
): Promise<void> {
  const safeToken = validToken(token);
  const repository = reopenDirectoryIdentity(
    directoryIdentityFromClaim(
      manifest.native_repository.path,
      manifest.native_repository.directory_identity
    ),
    "native projection repository"
  );
  let gitDirectory: AnchoredDirectory | undefined;
  const temporaryFile = `${SELECTION_FILE}.${safeToken}.tmp`;
  let published = false;
  try {
    gitDirectory = openChildDirectory(repository, ".git", "native projection Git directory");
    if (!matchesIdentityClaim(gitDirectory, manifest.native_repository.git_directory_identity)) {
      throw new ProjectionPreparationError(
        "native_state_stale",
        "native projection Git directory identity changed before selection"
      );
    }
    await writeExclusiveText(gitDirectory, temporaryFile, `${canonicalJSONStringify(selection)}\n`);
    assertAnchoredDirectoryLocation(gitDirectory, "native projection Git directory");
    await rename(
      procChildPath(gitDirectory, temporaryFile),
      procChildPath(gitDirectory, SELECTION_FILE)
    );
    published = true;
    syncDirectory(gitDirectory);
    const resolved = loadNativeWslProjectionSelection(
      manifest.native_repository.path,
      selection.selection_digest
    );
    if (resolved.selectionDigest !== selection.selection_digest) {
      throw new ProjectionPreparationError(
        "native_state_stale",
        "native projection selection could not be verified"
      );
    }
  } catch (error) {
    if (gitDirectory) {
      await unlink(procChildPath(gitDirectory, temporaryFile)).catch(() => undefined);
      if (published) {
        try {
          await unlink(procChildPath(gitDirectory, SELECTION_FILE));
        } catch (cleanupError) {
          if (!isNodeError(cleanupError) || cleanupError.code !== "ENOENT") {
            throw cleanupError;
          }
        }
        syncDirectory(gitDirectory);
      }
    }
    throw error;
  } finally {
    gitDirectory?.close();
    repository.close();
  }
}

function syncAnchoredDirectory(directory: AnchoredDirectory): void {
  assertAnchoredDirectoryLocation(directory, "native projection state directory");
  fsyncSync(directory.fd);
}

function readAnchoredJson(directory: AnchoredDirectory, file: string): unknown {
  assertAnchoredDirectoryLocation(directory, "native projection state directory");
  const descriptor = openSync(
    procChildPath(directory, file),
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > MAX_STATE_FILE_BYTES) {
      throw new Error("projection state file is invalid");
    }
    return JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } finally {
    closeSync(descriptor);
  }
}

function directoryIdentityFromClaim(
  pathValue: string,
  claim: { device: string; inode: string }
): DirectoryIdentity {
  return {
    path: pathValue,
    device: BigInt(claim.device),
    inode: BigInt(claim.inode),
  };
}

function matchesIdentityClaim(
  actual: Pick<DirectoryIdentity, "device" | "inode">,
  claim: { device: string; inode: string }
): boolean {
  return actual.device.toString(10) === claim.device && actual.inode.toString(10) === claim.inode;
}

async function readProjectionManifest(
  repository: AnchoredDirectory
): Promise<NativeWslProjectionManifest | null> {
  let gitDirectory: AnchoredDirectory | undefined;
  try {
    gitDirectory = openChildDirectory(repository, ".git", "native projection Git directory");
    const parsed: unknown = JSON.parse(
      await readBoundedText(path.join(gitDirectory.procPath, MANIFEST_FILE))
    );
    const result = NativeWslProjectionManifest_v1.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  } finally {
    gitDirectory?.close();
  }
}

async function readBoundedText(file: string): Promise<string> {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.size > MAX_STATE_FILE_BYTES) {
    throw new Error("projection state file is invalid");
  }
  return readFile(file, "utf8");
}

async function boundedDirectoryEntries(directory: AnchoredDirectory): Promise<string[]> {
  const entries = await readdir(directory.procPath);
  if (entries.length > MAX_CONTROL_ENTRIES) {
    throw new ProjectionPreparationError(
      "operation_failed",
      "projection control directory exceeded its bounded inventory"
    );
  }
  return entries;
}

async function removeOwnedDirectory(
  parent: AnchoredDirectory,
  component: string,
  directory: AnchoredDirectory,
  marker: OwnerMarker
): Promise<boolean> {
  try {
    const current = await readOwnerMarker(directory);
    if (!current || current.token !== marker.token || current.kind !== marker.kind) {
      directory.close();
      return false;
    }
    assertAnchoredDirectoryLocation(directory, "owned projection directory");
    await clearAnchoredDirectory(directory);
    assertAnchoredDirectoryLocation(directory, "owned projection directory");
    directory.close();
    await rmdir(procChildPath(parent, component));
    return true;
  } catch {
    directory.close();
    return false;
  }
}

async function removeExactlyCreatedDirectory(
  parent: AnchoredDirectory,
  component: string,
  directory: AnchoredDirectory
): Promise<boolean> {
  try {
    assertAnchoredDirectoryLocation(directory, "newly created projection directory");
    await clearAnchoredDirectory(directory);
    assertAnchoredDirectoryLocation(directory, "newly created projection directory");
    directory.close();
    await rmdir(procChildPath(parent, component));
    return true;
  } catch {
    directory.close();
    return false;
  }
}

async function clearAnchoredDirectory(directory: AnchoredDirectory): Promise<void> {
  const entries = await readdir(directory.procPath, { withFileTypes: true });
  if (entries.length > MAX_CONTROL_ENTRIES * 100) {
    throw new Error("owned projection directory exceeded cleanup bounds");
  }
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const child = openChildDirectory(directory, entry.name, "owned projection cleanup child");
      await clearAnchoredDirectory(child);
      assertAnchoredDirectoryLocation(child, "owned projection cleanup child");
      child.close();
      await rmdir(procChildPath(directory, entry.name));
    } else {
      await unlink(procChildPath(directory, entry.name));
    }
  }
}

function assertPublishedIdentity(
  absolutePath: string,
  expected: DirectoryIdentity,
  label: string
): void {
  const observed = captureDirectoryIdentity(absolutePath, label);
  if (!sameDirectoryIdentity(observed, expected)) {
    throw new ProjectionPreparationError(
      "native_state_conflict",
      `${label} identity changed during publication`
    );
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 24 * 60 * 60 * 1_000));
}

function commandObservationFailure(result: GitStepFailure): SourceObservationResult {
  return {
    failureReason:
      result.kind === "preflight_error"
        ? "source_replaced"
        : result.kind === "timeout" || result.kind === "aborted"
          ? "operation_failed"
          : "operation_failed",
  };
}

function commandPreparationError(result: GitStepFailure): ProjectionPreparationError {
  return new ProjectionPreparationError(
    result.kind === "preflight_error" ? "source_replaced" : "operation_failed",
    "bounded Git operation failed"
  );
}

function directoryFailureReason(error: unknown): NativeWslProjectionFailure["reasonCode"] {
  if (error instanceof ProjectionPreparationError) return error.reasonCode;
  if (error instanceof DirectoryBoundaryError) {
    return error.reasonCode === "wsl_drvfs_9p"
      ? "unsupported_filesystem"
      : "containment_unavailable";
  }
  return "operation_failed";
}

function validToken(value: string): string {
  if (!/^[a-f0-9]{16,64}$/u.test(value)) {
    throw new TypeError("projection token must be 16-64 lowercase hexadecimal characters");
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
