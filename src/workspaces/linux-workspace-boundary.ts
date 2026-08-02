import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import {
  ExecaCommandRunner,
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from "./command-runner.js";
import {
  DirectoryBoundaryError,
  assertAnchoredDirectoryLocation,
  captureDirectoryIdentity,
  createChildDirectory,
  identityOf,
  openChildDirectory,
  procChildPath,
  reopenDirectoryIdentity,
  tryOpenChildDirectory,
  type AnchoredDirectory,
} from "./linux-directory-identity.js";
import {
  WORKSPACE_BOUNDARY_CONTRACT_VERSION,
  WorkspaceBoundaryCapabilityDecision_v1,
  createWorkspaceBoundaryDirectoryIdentity,
  createWorkspaceBoundaryLeaseReceipt,
  createWorkspaceBoundaryOperationReceipt,
  workspaceBoundaryLeaseBrand,
  type WorkspaceBoundary,
  type WorkspaceBoundaryAcquireRequest,
  type WorkspaceBoundaryDirectoryCapability,
  type WorkspaceBoundaryDirectoryIdentity_v1,
  type WorkspaceBoundaryError_v1,
  type WorkspaceBoundaryLease,
  type WorkspaceBoundaryLeaseReceipt_v1,
  type WorkspaceBoundaryOperationKind,
  type WorkspaceBoundaryOperationReceipt_v1,
  type WorkspaceBoundaryProcessArgument,
  type WorkspaceBoundaryProcessRequest,
  type WorkspaceBoundaryReadFileRequest,
  type WorkspaceBoundaryResult,
  type WorkspaceBoundaryWriteFileRequest,
} from "./workspace-boundary.js";

const DEFAULT_FILE_MODE = 0o600;

export interface LinuxWorkspaceBoundaryOptions {
  readonly capability: WorkspaceBoundaryCapabilityDecision_v1;
  readonly runner?: CommandRunner;
  readonly clock?: () => Date;
  readonly createId?: () => string;
}

type LinuxDirectoryCapability = WorkspaceBoundaryDirectoryCapability;

/** Linux reference backend. Live authority remains in held directory descriptors. */
export class LinuxWorkspaceBoundary implements WorkspaceBoundary {
  readonly capability: WorkspaceBoundaryCapabilityDecision_v1;
  private readonly runner: CommandRunner;
  private readonly clock: () => Date;
  private readonly createId: () => string;

  constructor(options: LinuxWorkspaceBoundaryOptions) {
    this.capability = WorkspaceBoundaryCapabilityDecision_v1.parse(options.capability);
    if (
      this.capability.state !== "ready" ||
      this.capability.backend_kind !== "linux-native" ||
      this.capability.backend.transport !== "in_process"
    ) {
      throw new Error("LinuxWorkspaceBoundary requires a verified ready Linux capability decision");
    }
    this.runner = options.runner ?? new ExecaCommandRunner();
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  acquire(
    request: WorkspaceBoundaryAcquireRequest
  ):
    | Promise<{ readonly ok: true; readonly lease: WorkspaceBoundaryLease }>
    | Promise<{ readonly ok: false; readonly error: WorkspaceBoundaryError_v1 }> {
    const opened: AnchoredDirectory[] = [];
    try {
      if (request.roots.length === 0 || request.roots.length > 16) {
        throw new DirectoryBoundaryError("invalid_path", "A boundary lease requires 1-16 roots");
      }
      const roles = new Set<string>();
      const roots = new Map<string, LinuxDirectoryCapability>();
      const directories = new Map<LinuxDirectoryCapability, AnchoredDirectory>();
      const leaseId = this.createId();
      for (const root of request.roots) {
        if (!root.role || roles.has(root.role)) {
          throw new DirectoryBoundaryError(
            "invalid_path",
            "Boundary root roles must be non-empty and unique"
          );
        }
        roles.add(root.role);
        const captured = captureDirectoryIdentity(root.absolutePath, root.role);
        const directory = reopenDirectoryIdentity(captured, root.role);
        opened.push(directory);
        const capability = linuxCapability(leaseId, directory);
        roots.set(root.role, capability);
        directories.set(capability, directory);
      }
      const acquired = createWorkspaceBoundaryLeaseReceipt({
        schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
        lease_id: leaseId,
        orchestration_lease_id: request.orchestrationLeaseId,
        orchestration_lease_revision: request.orchestrationLeaseRevision,
        owner_id: request.ownerId,
        backend_kind: "linux-native",
        capability_decision_digest: this.capability.decision_digest,
        root_identity_digests: [...roots.values()].map((root) => root.identity.identity_digest),
        phase: "acquired",
        observed_at: this.clock().toISOString(),
      });
      return Promise.resolve({
        ok: true,
        lease: new LinuxWorkspaceBoundaryLease({
          acquired,
          roots,
          directories,
          runner: this.runner,
          clock: this.clock,
        }),
      });
    } catch (error) {
      for (const directory of opened.reverse()) directory.close();
      return Promise.resolve({
        ok: false,
        error: boundaryError(error, request.operationId, "no_effect"),
      });
    }
  }
}

interface LinuxWorkspaceBoundaryLeaseOptions {
  readonly acquired: WorkspaceBoundaryLeaseReceipt_v1;
  readonly roots: ReadonlyMap<string, LinuxDirectoryCapability>;
  readonly directories: ReadonlyMap<LinuxDirectoryCapability, AnchoredDirectory>;
  readonly runner: CommandRunner;
  readonly clock: () => Date;
}

class LinuxWorkspaceBoundaryLease implements WorkspaceBoundaryLease {
  readonly [workspaceBoundaryLeaseBrand] = true as const;
  readonly acquired: WorkspaceBoundaryLeaseReceipt_v1;
  private readonly roots: ReadonlyMap<string, LinuxDirectoryCapability>;
  private readonly runner: CommandRunner;
  private readonly clock: () => Date;
  private readonly directories = new Map<LinuxDirectoryCapability, AnchoredDirectory>();
  private closed = false;
  private terminalReceipt: WorkspaceBoundaryLeaseReceipt_v1 | undefined;

  constructor(options: LinuxWorkspaceBoundaryLeaseOptions) {
    this.acquired = options.acquired;
    this.roots = options.roots;
    this.runner = options.runner;
    this.clock = options.clock;
    for (const [capability, directory] of options.directories) {
      this.directories.set(capability, directory);
    }
  }

  root(role: string): WorkspaceBoundaryDirectoryCapability {
    this.assertOpen();
    const root = this.roots.get(role);
    if (!root) throw new Error(`Boundary lease does not contain root role ${role}`);
    return root;
  }

  async openChild(
    parent: WorkspaceBoundaryDirectoryCapability,
    component: string,
    operationId: string
  ): Promise<WorkspaceBoundaryResult<WorkspaceBoundaryDirectoryCapability>> {
    return this.directoryOperation("open-child", parent, operationId, () =>
      this.register(openChildDirectory(this.requireCapability(parent), component, "boundary child"))
    );
  }

  async tryOpenChild(
    parent: WorkspaceBoundaryDirectoryCapability,
    component: string,
    operationId: string
  ): Promise<WorkspaceBoundaryResult<WorkspaceBoundaryDirectoryCapability | null>> {
    return this.directoryOperation("open-child", parent, operationId, () => {
      const directory = tryOpenChildDirectory(
        this.requireCapability(parent),
        component,
        "boundary child"
      );
      return directory ? this.register(directory) : null;
    });
  }

  async createChild(
    parent: WorkspaceBoundaryDirectoryCapability,
    component: string,
    operationId: string
  ): Promise<WorkspaceBoundaryResult<WorkspaceBoundaryDirectoryCapability>> {
    return this.directoryOperation(
      "create-child",
      parent,
      operationId,
      () =>
        this.register(
          createChildDirectory(this.requireCapability(parent), component, "boundary child")
        ),
      true
    );
  }

  async assertCurrent(
    directories: readonly WorkspaceBoundaryDirectoryCapability[],
    operationId: string
  ): Promise<WorkspaceBoundaryResult<readonly WorkspaceBoundaryDirectoryIdentity_v1[]>> {
    const startedAt = this.clock();
    try {
      this.assertOpen();
      if (directories.length === 0) throw new Error("assertCurrent requires a directory");
      const capabilities = directories.map((directory) => this.requireCapability(directory));
      for (const directory of capabilities) {
        assertAnchoredDirectoryLocation(directory, "boundary directory");
      }
      const identities = capabilities.map((directory) => linuxIdentity(directory));
      return this.success("assert-current", operationId, identities, directories, startedAt);
    } catch (error) {
      return this.failure("assert-current", operationId, directories, error, startedAt, false);
    }
  }

  async readFile(
    request: WorkspaceBoundaryReadFileRequest
  ): Promise<WorkspaceBoundaryResult<Uint8Array>> {
    const startedAt = this.clock();
    try {
      this.assertOpen();
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
        throw new Error("maxBytes must be a positive safe integer");
      }
      const directory = this.requireCapability(request.directory);
      assertAnchoredDirectoryLocation(directory, "owned file parent");
      const handle = await open(
        procChildPath(directory, request.component),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw new Error("Owned file is not a regular file");
        const buffer = Buffer.alloc(request.maxBytes + 1);
        let offset = 0;
        while (offset < buffer.byteLength) {
          const { bytesRead } = await handle.read(
            buffer,
            offset,
            buffer.byteLength - offset,
            offset
          );
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset > request.maxBytes) {
          throw new Error(`Owned file exceeds ${request.maxBytes} bytes`);
        }
        return this.success(
          "read-owned-file",
          request.operationId,
          buffer.subarray(0, offset),
          [request.directory],
          startedAt
        );
      } finally {
        await handle.close();
      }
    } catch (error) {
      return this.failure(
        "read-owned-file",
        request.operationId,
        [request.directory],
        error,
        startedAt,
        false
      );
    }
  }

  async writeFile(
    request: WorkspaceBoundaryWriteFileRequest
  ): Promise<WorkspaceBoundaryResult<void>> {
    const startedAt = this.clock();
    try {
      this.assertOpen();
      const directory = this.requireCapability(request.directory);
      assertAnchoredDirectoryLocation(directory, "owned file parent");
      const flags =
        constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        (request.exclusive ? constants.O_EXCL : constants.O_TRUNC);
      const handle = await open(
        procChildPath(directory, request.component),
        flags,
        request.mode ?? DEFAULT_FILE_MODE
      );
      try {
        await handle.writeFile(request.content);
      } finally {
        await handle.close();
      }
      return this.success(
        "write-owned-file",
        request.operationId,
        undefined,
        [request.directory],
        startedAt,
        "not_requested"
      );
    } catch (error) {
      return this.failure(
        "write-owned-file",
        request.operationId,
        [request.directory],
        error,
        startedAt,
        true
      );
    }
  }

  async runProcess(
    request: WorkspaceBoundaryProcessRequest
  ): Promise<WorkspaceBoundaryResult<CommandResult>> {
    const startedAt = this.clock();
    const temporaryDirectories: AnchoredDirectory[] = [];
    try {
      this.assertOpen();
      const cwd = this.requireCapability(request.cwd);
      const rendered = request.args.map((argument) =>
        this.renderArgument(argument, request.cwd, temporaryDirectories)
      );
      const asserted = [
        ...this.roots.values(),
        request.cwd,
        ...request.args
          .filter(
            (
              argument
            ): argument is Extract<WorkspaceBoundaryProcessArgument, { kind: "directory" }> =>
              argument.kind === "directory"
          )
          .map((argument) => argument.directory),
      ];
      const command: CommandRequest = {
        executable: request.executable,
        args: rendered,
        cwd: cwd.procPath,
        timeoutMs: request.timeoutMs,
        ...(request.env ? { env: request.env } : {}),
        ...(request.extendEnv !== undefined ? { extendEnv: request.extendEnv } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.maxOutputBytes ? { maxOutputBytes: request.maxOutputBytes } : {}),
        preflight: () => {
          for (const capability of asserted) {
            assertAnchoredDirectoryLocation(
              this.requireCapability(capability),
              "process directory"
            );
          }
          for (const directory of temporaryDirectories) {
            assertAnchoredDirectoryLocation(directory, "process directory component");
          }
        },
      };
      const result = await this.runner.run(command);
      return this.success("spawn-process", request.operationId, result, asserted, startedAt);
    } catch (error) {
      return this.failure(
        "spawn-process",
        request.operationId,
        [request.cwd],
        error,
        startedAt,
        false
      );
    } finally {
      for (const directory of temporaryDirectories.reverse()) directory.close();
    }
  }

  async close(
    reason: "completed" | "cancelled" | "expired" | "reconcile"
  ): Promise<WorkspaceBoundaryLeaseReceipt_v1> {
    if (this.terminalReceipt) return this.terminalReceipt;
    this.closed = true;
    for (const directory of [...this.directories.values()].reverse()) directory.close();
    this.directories.clear();
    this.terminalReceipt = createWorkspaceBoundaryLeaseReceipt({
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      lease_id: this.acquired.lease_id,
      orchestration_lease_id: this.acquired.orchestration_lease_id,
      orchestration_lease_revision: this.acquired.orchestration_lease_revision,
      owner_id: this.acquired.owner_id,
      backend_kind: "linux-native",
      capability_decision_digest: this.acquired.capability_decision_digest,
      root_identity_digests: this.acquired.root_identity_digests,
      phase: reason === "expired" ? "expired" : reason === "reconcile" ? "reconciled" : "released",
      observed_at: this.clock().toISOString(),
    });
    return this.terminalReceipt;
  }

  private async directoryOperation<T>(
    operation: "open-child" | "create-child",
    parent: WorkspaceBoundaryDirectoryCapability,
    operationId: string,
    effect: () => T,
    mutation = false
  ): Promise<WorkspaceBoundaryResult<T>> {
    const startedAt = this.clock();
    try {
      this.assertOpen();
      const value = effect();
      const identities =
        value && typeof value === "object" && "identity" in value
          ? [parent, value as unknown as WorkspaceBoundaryDirectoryCapability]
          : [parent];
      return this.success(
        operation,
        operationId,
        value,
        identities,
        startedAt,
        mutation ? "not_requested" : "not_applicable"
      );
    } catch (error) {
      return this.failure(operation, operationId, [parent], error, startedAt, mutation);
    }
  }

  private renderArgument(
    argument: WorkspaceBoundaryProcessArgument,
    cwd: WorkspaceBoundaryDirectoryCapability,
    temporaryDirectories: AnchoredDirectory[]
  ): string {
    if (argument.kind === "literal") return argument.value;
    if (argument.relativeToCwd) {
      if (argument.directory !== cwd || (argument.components?.length ?? 0) > 0) {
        throw new DirectoryBoundaryError(
          "invalid_path",
          "A cwd-relative process argument must reference the exact cwd capability without components"
        );
      }
      this.requireCapability(argument.directory);
      return `${argument.prefix ?? ""}.${argument.suffix ?? ""}`;
    }
    let directory = this.requireCapability(argument.directory);
    for (const component of argument.components ?? []) {
      directory = openChildDirectory(directory, component, "process directory component");
      temporaryDirectories.push(directory);
    }
    return `${argument.prefix ?? ""}${directory.procPath}${argument.suffix ?? ""}`;
  }

  private register(directory: AnchoredDirectory): WorkspaceBoundaryDirectoryCapability {
    const capability = linuxCapability(this.acquired.lease_id, directory);
    this.directories.set(capability, directory);
    return capability;
  }

  private requireCapability(capability: WorkspaceBoundaryDirectoryCapability): AnchoredDirectory {
    this.assertOpen();
    const candidate = capability as LinuxDirectoryCapability;
    const directory = this.directories.get(candidate);
    if (candidate.leaseId !== this.acquired.lease_id || !directory) {
      throw new DirectoryBoundaryError(
        "identity_changed",
        "Directory capability is stale, foreign, or forged"
      );
    }
    return directory;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DirectoryBoundaryError("identity_changed", "Workspace boundary lease is closed");
    }
  }

  private success<T>(
    operation: WorkspaceBoundaryOperationKind,
    operationId: string,
    value: T,
    directories: readonly WorkspaceBoundaryDirectoryCapability[],
    startedAt: Date,
    durability: "not_applicable" | "not_requested" = "not_applicable"
  ): WorkspaceBoundaryResult<T> {
    return {
      ok: true,
      value,
      receipt: this.receipt(operation, operationId, directories, startedAt, {
        outcome: "completed",
        durability,
      }),
    };
  }

  private failure<T>(
    operation: WorkspaceBoundaryOperationKind,
    operationId: string,
    directories: readonly WorkspaceBoundaryDirectoryCapability[],
    error: unknown,
    startedAt: Date,
    mutation: boolean
  ): WorkspaceBoundaryResult<T> {
    const effectState = mutation && !knownNoEffect(error) ? "effect_unknown" : "no_effect";
    const boundary = boundaryError(error, operationId, effectState);
    return {
      ok: false,
      error: boundary,
      receipt: this.receipt(operation, operationId, directories, startedAt, {
        outcome: effectState === "effect_unknown" ? "indeterminate" : "rejected",
        durability: effectState === "effect_unknown" ? "indeterminate" : "not_applicable",
        error: boundary,
      }),
    };
  }

  private receipt(
    operation: WorkspaceBoundaryOperationKind,
    operationId: string,
    directories: readonly WorkspaceBoundaryDirectoryCapability[],
    startedAt: Date,
    result:
      | {
          readonly outcome: "completed";
          readonly durability: "not_applicable" | "not_requested";
        }
      | {
          readonly outcome: "rejected" | "indeterminate";
          readonly durability: "not_applicable" | "indeterminate";
          readonly error: WorkspaceBoundaryError_v1;
        }
  ): WorkspaceBoundaryOperationReceipt_v1 {
    const identities = directories
      .map((directory) => (directory as LinuxDirectoryCapability).identity?.identity_digest)
      .filter((digest): digest is string => Boolean(digest));
    const completedAt = new Date(Math.max(startedAt.getTime(), this.clock().getTime()));
    return createWorkspaceBoundaryOperationReceipt({
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      operation_id: operationId,
      lease_id: this.acquired.lease_id,
      backend_kind: "linux-native",
      operation,
      mutation:
        operation === "create-child" ||
        operation === "write-owned-file" ||
        operation === "rename-owned" ||
        operation === "remove-owned" ||
        operation === "sync-directory",
      outcome: result.outcome,
      durability: result.durability,
      identity_digests: [
        ...new Set(identities.length > 0 ? identities : this.acquired.root_identity_digests),
      ],
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      ...(result.outcome === "completed" ? {} : { error: result.error }),
    });
  }
}

function linuxCapability(leaseId: string, directory: AnchoredDirectory): LinuxDirectoryCapability {
  return {
    leaseId,
    identity: linuxIdentity(directory),
  } as LinuxDirectoryCapability;
}

function linuxIdentity(directory: AnchoredDirectory): WorkspaceBoundaryDirectoryIdentity_v1 {
  const identity = identityOf(directory);
  return createWorkspaceBoundaryDirectoryIdentity({
    schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
    backend_kind: "linux-native",
    canonical_path: identity.path,
    path_comparison: "case-sensitive",
    identity_kind: "linux-device-inode",
    device: identity.device.toString(10),
    inode: identity.inode.toString(10),
  });
}

function boundaryError(
  error: unknown,
  operationId: string,
  effectState: WorkspaceBoundaryError_v1["effect_state"]
): WorkspaceBoundaryError_v1 {
  const nodeCode = isNodeError(error) ? error.code : undefined;
  const code =
    error instanceof DirectoryBoundaryError
      ? error.code === "identity_changed"
        ? "identity_changed"
        : error.code === "unsupported_platform"
          ? "unsupported_filesystem"
          : "invalid_path"
      : nodeCode === "ENOENT"
        ? "invalid_path"
        : nodeCode === "EACCES" || nodeCode === "EPERM"
          ? "sharing_violation"
          : "operation_failed";
  return {
    schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
    code,
    message: boundedMessage(error),
    retryable: false,
    effect_state: effectState,
    operation_id: operationId,
  };
}

function knownNoEffect(error: unknown): boolean {
  if (error instanceof DirectoryBoundaryError) {
    const cause = error.originalCause;
    return isNodeError(cause) && cause.code === "EEXIST";
  }
  return isNodeError(error) && error.code === "EEXIST";
}

function boundedMessage(error: unknown): string {
  const message =
    isNodeError(error) && error.code === "ENOENT"
      ? "Boundary path does not exist"
      : isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")
        ? "Boundary operation was denied by the host"
        : (error instanceof Error ? error.message : String(error)).replace(
            /\/proc\/\d+\/fd\/\d+/gu,
            "<held-directory>"
          );
  return message.length <= 4_096 ? message : message.slice(0, 4_096);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
