import path from "node:path";
import { realpath, stat } from "node:fs/promises";

import type { ExecutionEnvelope_v1 } from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import type {
  AttachWorkerSessionInput,
  BindLaunchEnvelopeInput,
  EndWorkerSessionInput,
  HeartbeatWorkerSessionInput,
  WorkerSessionMutationResult,
  WorkerSessionRecord,
  LaunchEnvelopeBindingResult,
  LaunchEnvelopeBindingStore,
  WorkerSessionStore,
  WorkspaceLifecycleStore,
  WorkspaceMutationFailureReason,
} from "../store/workspace-lifecycle-store.js";
import type { AgentWorkRuntime } from "./agent-work-runtime.js";

const MAX_OUTPUT_BYTES = 4_096;

export interface AttachAttemptWorkerInput extends Omit<
  AttachWorkerSessionInput,
  | "packetId"
  | "packetHash"
  | "executionEnvelopeId"
  | "executionEnvelopeHash"
  | "hostId"
  | "workerRuntime"
  | "gitRuntime"
> {
  envelope: ExecutionEnvelope_v1;
}

export interface WorkerSessionStatusResult {
  workerSession: WorkerSessionRecord | null;
}

/** Shared assisted-worker service. Process launch remains owned by the foreground host. */
export class AgentWorkWorkerSessionService {
  constructor(
    private readonly store: WorkspaceLifecycleStore &
      LaunchEnvelopeBindingStore &
      WorkerSessionStore,
    private readonly runtime?: Pick<AgentWorkRuntime, "config" | "observeWorkspace">
  ) {}

  bindLaunchEnvelope(input: BindLaunchEnvelopeInput): Promise<LaunchEnvelopeBindingResult> {
    return this.store.bindLaunchEnvelope(input);
  }

  async attach(input: AttachAttemptWorkerInput): Promise<WorkerSessionMutationResult> {
    if (!this.runtime) throw new Error("Worker attachment requires an explicit runtime binding");
    const attempt = await this.store.getAttempt(input.attemptId);
    const lease = await this.store.getWorkspaceLease(input.workspaceLeaseId);
    if (!attempt || !lease) return failure("not_found", attempt?.revision, lease?.revision);

    const envelope = input.envelope;
    const expected: Array<[string, unknown, unknown]> = [
      ["run_id", input.runId, envelope.run_id],
      ["attempt_id", input.attemptId, envelope.attempt_id],
      ["packet_id", attempt.packetId, envelope.packet_id],
      ["packet_hash", attempt.packetHash, envelope.packet_hash],
      ["workspace_lease_id", lease.leaseId, envelope.workspace_lease_id],
      [
        "workspace_lease_revision",
        input.expectedWorkspaceLeaseRevision,
        envelope.workspace_lease_revision,
      ],
      ["expected_head_sha", attempt.baseSha, envelope.expected_head_sha],
      ["branch", lease.branch, envelope.branch],
      ["runtime.host_id", lease.hostId, envelope.runtime.host_id],
      ["runtime.git_runtime", lease.gitRuntime, envelope.runtime.git_runtime],
      ["paths.worktree_root", lease.worktreePath, envelope.paths.worktree_root],
    ];
    if (expected.some(([, wanted, actual]) => wanted !== actual)) {
      return failure("identity_mismatch", attempt.revision, lease.revision);
    }
    if (
      Date.parse(envelope.created_at) > Date.parse(input.startedAt) ||
      Date.parse(input.startedAt) > Date.parse(input.now) ||
      Date.parse(input.now) >= Date.parse(lease.expiresAt)
    ) {
      return failure("invalid_time", attempt.revision, lease.revision);
    }

    const envelopeJson = canonicalJSONStringify(envelope);
    const envelopeHash = computeCanonicalHash(envelope);
    const binding = await this.store.getLaunchEnvelopeBinding(input.attemptId);
    if (
      !binding ||
      binding.envelopeId !== envelope.envelope_id ||
      binding.envelopeHash !== envelopeHash ||
      binding.envelopeJson !== envelopeJson
    ) {
      return failure("evidence_mismatch", attempt.revision, lease.revision);
    }
    const { envelope: _envelope, ...storeInput } = input;
    const attachInput: AttachWorkerSessionInput = {
      ...storeInput,
      packetId: envelope.packet_id,
      packetHash: envelope.packet_hash,
      executionEnvelopeId: envelope.envelope_id,
      executionEnvelopeHash: envelopeHash,
      hostId: envelope.runtime.host_id,
      workerRuntime: envelope.runtime.worker_runtime,
      gitRuntime: envelope.runtime.git_runtime,
    };
    const existing = await this.store.getWorkerSessionForAttempt(input.attemptId);
    if (existing) return this.store.attachWorkerSession(attachInput);

    await requireDirectoryWithin(envelope.paths.project_root, lease.worktreePath, "project_root");
    await requireDirectoryWithin(
      envelope.paths.execution_root,
      envelope.paths.project_root,
      "execution_root"
    );
    const observation = await this.runtime.observeWorkspace({
      repositoryId: lease.repositoryId,
      hostId: lease.hostId,
      gitRuntime: lease.gitRuntime,
      projectRoot: lease.projectRoot,
      branch: lease.branch,
      worktreePath: lease.worktreePath,
      attemptId: attempt.attemptId,
      baseSha: attempt.baseSha,
    });
    if (
      !observation.ok ||
      !observation.observation.exists ||
      !observation.observation.registered ||
      observation.observation.attemptId !== attempt.attemptId ||
      observation.observation.headSha !== attempt.baseSha ||
      observation.observation.cleanliness !== "clean"
    ) {
      return failure("evidence_mismatch", attempt.revision, lease.revision);
    }

    return this.store.attachWorkerSession(attachInput);
  }

  heartbeat(input: HeartbeatWorkerSessionInput): Promise<WorkerSessionMutationResult> {
    return this.store.heartbeatWorkerSession(input);
  }

  end(input: EndWorkerSessionInput): Promise<WorkerSessionMutationResult> {
    return this.store.endWorkerSession(input);
  }

  async status(input: { runId: string; attemptId: string }): Promise<WorkerSessionStatusResult> {
    const session = await this.store.getWorkerSessionForAttempt(input.attemptId);
    return {
      workerSession: session?.runId === input.runId ? boundedSession(session) : null,
    };
  }
}

async function requireDirectoryWithin(
  directory: string,
  root: string,
  field: string
): Promise<void> {
  const entry = await stat(directory);
  if (!entry.isDirectory()) throw new Error(`${field} must identify an existing directory`);
  const [resolvedDirectory, resolvedRoot] = await Promise.all([
    realpath(directory),
    realpath(root),
  ]);
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${field} must resolve within the authorized worktree`);
  }
}

function boundedSession(session: WorkerSessionRecord): WorkerSessionRecord {
  return {
    ...session,
    sessionId: bounded(session.sessionId),
    runId: bounded(session.runId),
    attemptId: bounded(session.attemptId),
    packetId: bounded(session.packetId),
    packetHash: bounded(session.packetHash),
    workspaceLeaseId: bounded(session.workspaceLeaseId),
    executionEnvelopeId: bounded(session.executionEnvelopeId),
    hostId: bounded(session.hostId),
    workerRuntime: bounded(session.workerRuntime),
    gitRuntime: bounded(session.gitRuntime),
    workerId: bounded(session.workerId),
    ...(session.model ? { model: bounded(session.model) } : {}),
    ...(session.exitReason ? { exitReason: bounded(session.exitReason) } : {}),
    ...(session.exitSummary ? { exitSummary: bounded(session.exitSummary) } : {}),
  };
}

function bounded(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return value;
  let end = MAX_OUTPUT_BYTES - 3;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return Buffer.concat([bytes.subarray(0, end), Buffer.from("…")]).toString("utf8");
}

function failure(
  reason: WorkspaceMutationFailureReason,
  attemptRevision?: number,
  workspaceRevision?: number
): WorkerSessionMutationResult {
  return {
    updated: false,
    reason,
    ...(attemptRevision !== undefined ? { currentAttemptRevision: attemptRevision } : {}),
    ...(workspaceRevision !== undefined
      ? { currentWorkspaceLeaseRevision: workspaceRevision }
      : {}),
  };
}
