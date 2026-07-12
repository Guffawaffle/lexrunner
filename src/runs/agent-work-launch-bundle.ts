import path from "node:path";
import { realpath, stat } from "node:fs/promises";

import {
  AGENT_WORK_CONTRACT_VERSION,
  ExecutionEnvelope_v1,
  createAgentTaskPacket,
  type AgentTaskPacket_v1,
  type ExecutionEnvelope_v1 as ExecutionEnvelope,
  type WorkItem_v1,
} from "../schemas/agent-work.js";
import type {
  AgentWorkLifecycleFailure,
  AgentWorkLifecycleService,
  AgentWorkLifecycleSuccess,
  StartAttemptInput,
} from "./agent-work-lifecycle-service.js";
import type { AgentWorkRuntime } from "./agent-work-runtime.js";

export interface AttemptLaunchPacketPolicy {
  packetId: string;
  instructions: string[];
  scope: {
    read_globs: string[];
    write_globs: string[];
    deny_globs: string[];
    cross_repo_allowed: boolean;
  };
  authority: {
    edit: boolean;
    git_write: boolean;
    github_write: boolean;
    external_runtime: boolean;
    secrets: boolean;
    signing: boolean;
    release: boolean;
  };
  verification: Array<{
    id: string;
    argv: string[];
    cwd_rel?: string;
    expected_exit_codes: number[];
  }>;
  budget: {
    max_tokens?: number;
    max_tool_calls?: number;
    max_elapsed_ms?: number;
  };
  createdAt: string;
}

export interface AttemptLaunchEnvelopePolicy {
  envelopeId: string;
  os: "linux" | "windows" | "darwin" | "other";
  architecture: string;
  workerRuntime: string;
  projectRoot: string;
  executionRoot: string;
  exposedEnvironmentKeys: string[];
  createdAt: string;
}

export interface PrepareAttemptLaunchInput {
  workItem: WorkItem_v1;
  identity: {
    runId: string;
    attemptId: string;
    baseSha: string;
  };
  packet: AttemptLaunchPacketPolicy;
  envelope: AttemptLaunchEnvelopePolicy;
  attempt: Omit<StartAttemptInput, "runId" | "attempt" | "workspace"> & {
    workspace: Omit<
      StartAttemptInput["workspace"],
      "repositoryId" | "hostId" | "gitRuntime" | "projectRoot"
    >;
  };
}

export interface AttemptLaunchBundleSuccess {
  ok: true;
  outcome: "launch_bundle_ready";
  lifecycle: AgentWorkLifecycleSuccess;
  packet: AgentTaskPacket_v1;
  envelope: ExecutionEnvelope;
}

export type AttemptLaunchBundleResult = AttemptLaunchBundleSuccess | AgentWorkLifecycleFailure;

/** Prepare the immutable handoff only after the existing lifecycle authorizes launch. */
export async function prepareAttemptLaunchBundle(
  service: AgentWorkLifecycleService,
  input: PrepareAttemptLaunchInput,
  runtime: Pick<AgentWorkRuntime, "config" | "observeWorkspace">
): Promise<AttemptLaunchBundleResult> {
  const config = runtime.config;
  if (input.workItem.repository.id !== config.repositoryId) {
    throw new TypeError("workItem.repository.id must match runtime.repositoryId");
  }
  const packet = createAgentTaskPacket({
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    packet_id: input.packet.packetId,
    run_id: input.identity.runId,
    work_item: {
      work_item_id: input.workItem.work_item_id,
      revision: input.workItem.revision,
    },
    attempt_id: input.identity.attemptId,
    repository: { ...input.workItem.repository, base_sha: input.identity.baseSha },
    objective: input.workItem.objective,
    acceptance_criteria: input.workItem.acceptance_criteria,
    instructions: input.packet.instructions,
    scope: input.packet.scope,
    authority: input.packet.authority,
    verification: input.packet.verification,
    budget: input.packet.budget,
    created_at: input.packet.createdAt,
  });
  const lifecycle = await service.startAttempt({
    ...input.attempt,
    runId: input.identity.runId,
    attempt: {
      attemptId: input.identity.attemptId,
      workItemId: input.workItem.work_item_id,
      workItemRevision: input.workItem.revision,
      packetId: packet.packet_id,
      packetHash: packet.packet_hash,
      baseSha: input.identity.baseSha,
    },
    workspace: {
      ...input.attempt.workspace,
      repositoryId: config.repositoryId,
      hostId: config.hostId,
      gitRuntime: config.gitRuntime,
      projectRoot: config.repositoryRoot,
    },
  });
  if (!lifecycle.ok) return lifecycle;

  assertAuthorizedBinding(lifecycle, input, config, packet);
  await assertCurrentWorkspace(runtime, lifecycle, input);
  await requireDirectoryWithin(
    input.envelope.projectRoot,
    lifecycle.workspace.worktreePath,
    "envelope.projectRoot"
  );
  await requireDirectoryWithin(
    input.envelope.executionRoot,
    input.envelope.projectRoot,
    "envelope.executionRoot"
  );

  const envelope = ExecutionEnvelope_v1.parse({
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    envelope_id: input.envelope.envelopeId,
    run_id: lifecycle.run.runId,
    attempt_id: lifecycle.attempt.attemptId,
    packet_id: lifecycle.attempt.packetId,
    packet_hash: lifecycle.attempt.packetHash,
    workspace_lease_id: lifecycle.workspace.leaseId,
    workspace_lease_revision: lifecycle.workspace.revision,
    expected_head_sha: lifecycle.workspace.baseSha,
    branch: lifecycle.workspace.branch,
    runtime: {
      host_id: config.hostId,
      os: input.envelope.os,
      architecture: input.envelope.architecture,
      worker_runtime: input.envelope.workerRuntime,
      git_runtime: config.gitRuntime,
    },
    paths: {
      project_root: input.envelope.projectRoot,
      execution_root: input.envelope.executionRoot,
      worktree_root: lifecycle.workspace.worktreePath,
    },
    path_mappings: [],
    exposed_environment_keys: input.envelope.exposedEnvironmentKeys,
    created_at: input.envelope.createdAt,
  });

  return { ok: true, outcome: "launch_bundle_ready", lifecycle, packet, envelope };
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
    throw new Error(`${field} must resolve within its authorized root`);
  }
}

async function assertCurrentWorkspace(
  runtime: Pick<AgentWorkRuntime, "config" | "observeWorkspace">,
  lifecycle: AgentWorkLifecycleSuccess,
  input: PrepareAttemptLaunchInput
): Promise<void> {
  const observation = await runtime.observeWorkspace(
    {
      repositoryId: runtime.config.repositoryId,
      hostId: runtime.config.hostId,
      gitRuntime: runtime.config.gitRuntime,
      projectRoot: runtime.config.repositoryRoot,
      branch: lifecycle.workspace.branch,
      worktreePath: lifecycle.workspace.worktreePath,
      attemptId: lifecycle.attempt.attemptId,
      baseSha: lifecycle.attempt.baseSha,
    },
    input.attempt.broker
  );
  if (!observation.ok) {
    throw new Error(`Launch workspace observation failed: ${observation.reason}`);
  }
  const actual = observation.observation;
  const safe =
    actual.exists &&
    actual.registered &&
    actual.repositoryId === runtime.config.repositoryId &&
    actual.hostId === runtime.config.hostId &&
    actual.gitRuntime === runtime.config.gitRuntime &&
    actual.projectRoot === runtime.config.repositoryRoot &&
    actual.branch === lifecycle.workspace.branch &&
    actual.worktreePath === lifecycle.workspace.worktreePath &&
    actual.attemptId === lifecycle.attempt.attemptId &&
    actual.headSha === lifecycle.attempt.baseSha &&
    actual.cleanliness === "clean";
  if (!safe) throw new Error("Launch workspace observation is not safe for handoff");
}

function assertAuthorizedBinding(
  lifecycle: AgentWorkLifecycleSuccess,
  input: PrepareAttemptLaunchInput,
  runtime: { repositoryId: string; hostId: string; gitRuntime: string },
  packet: AgentTaskPacket_v1
): void {
  const expected: Array<[string, unknown, unknown]> = [
    ["run.runId", input.identity.runId, lifecycle.run.runId],
    ["attempt.attemptId", input.identity.attemptId, lifecycle.attempt.attemptId],
    ["attempt.workItemId", input.workItem.work_item_id, lifecycle.attempt.workItemId],
    ["attempt.workItemRevision", input.workItem.revision, lifecycle.attempt.workItemRevision],
    ["attempt.packetId", packet.packet_id, lifecycle.attempt.packetId],
    ["attempt.packetHash", packet.packet_hash, lifecycle.attempt.packetHash],
    ["attempt.baseSha", input.identity.baseSha, lifecycle.attempt.baseSha],
    ["attempt.status", "launching", lifecycle.attempt.status],
    ["workspace.leaseId", input.attempt.workspace.workspaceLeaseId, lifecycle.workspace.leaseId],
    ["workspace.repositoryId", runtime.repositoryId, lifecycle.workspace.repositoryId],
    ["workspace.hostId", runtime.hostId, lifecycle.workspace.hostId],
    ["workspace.gitRuntime", runtime.gitRuntime, lifecycle.workspace.gitRuntime],
    ["workspace.branch", input.attempt.workspace.branch, lifecycle.workspace.branch],
    [
      "workspace.worktreePath",
      input.attempt.workspace.worktreePath,
      lifecycle.workspace.worktreePath,
    ],
    ["workspace.baseSha", input.identity.baseSha, lifecycle.workspace.baseSha],
    ["workspace.status", "active", lifecycle.workspace.status],
  ];
  const mismatch = expected.find(([, wanted, actual]) => wanted !== actual);
  if (mismatch) {
    throw new Error(
      `Authorized launch binding mismatch at ${mismatch[0]}: expected=${String(mismatch[1])}, actual=${String(mismatch[2])}`
    );
  }
  const envelopeAt = Date.parse(input.envelope.createdAt);
  if (
    envelopeAt >= Date.parse(lifecycle.workspace.expiresAt) ||
    envelopeAt >= Date.parse(lifecycle.controllerLease.expiresAt)
  ) {
    throw new Error("Execution envelope must be created before controller and workspace expiry");
  }
}
