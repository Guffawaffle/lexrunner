// Synthetic lifecycle fixture only; no Git, provider, or qualified host execution.
import { createAgentTaskPacket } from "../../src/schemas/agent-work.js";
import { createNativeExecutionPathMapping } from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import type { ControllerLeaseCredential } from "../../src/store/coordination-store.js";
import type { InMemoryWorkerDispatchStore } from "../../src/store/inmemory/worker-dispatch-store.js";
import type { SqliteWorkerDispatchStore } from "../../src/store/sqlite/worker-dispatch-store.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";
type Harness = InMemoryWorkerDispatchStore | SqliteWorkerDispatchStore;
const T0 = "2026-08-12T12:00:00.000Z";
const T1 = "2026-08-12T12:00:01.000Z";
const T2 = "2026-08-12T12:00:02.000Z";
const T3 = "2026-08-12T12:00:03.000Z";
async function createLiveAttempt(store: Harness): Promise<ControllerLeaseCredential> {
  const acquired = await store.acquireControllerLease({
    runId: "run-1",
    controllerId: "controller-1",
    leaseId: "controller-lease-1",
    now: T0,
    ttlMs: 60_000,
    initialState: {},
  });
  if (!acquired.acquired) throw new Error("controller setup failed");
  const controller: ControllerLeaseCredential = acquired.lease;
  const packet = taskPacket();
  const created = await store.createAttempt({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "create-attempt-1",
    now: T0,
    attemptId: "attempt-1",
    workItemId: "work-1",
    workItemRevision: 1,
    packetId: "packet-1",
    packetHash: packet.packet_hash,
    baseSha: "a".repeat(40),
  });
  if (!created.updated) throw new Error(`attempt setup failed: ${created.reason}`);
  return controller;
}

export async function createAttachedWorker(store: Harness): Promise<ControllerLeaseCredential> {
  const controller = await createLiveAttempt(store);
  const packet = taskPacket();
  const identity = {
    repositoryId: "repo-1",
    hostId: "host-1",
    gitRuntime: "wsl-git",
    projectRoot: "/srv/repo",
    branch: "agent/work-1",
    worktreePath: "/srv/worktrees/work-1",
    attemptId: "attempt-1",
  };
  const acquired = await store.acquireWorkspace({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "acquire-workspace-1",
    now: T1,
    workspaceLeaseId: "workspace-lease-1",
    workItemId: "work-1",
    baseSha: "a".repeat(40),
    expectedAttemptRevision: 0,
    ttlMs: 60_000,
    ...identity,
    observation: {
      ...identity,
      exists: true,
      registered: true,
      headSha: "a".repeat(40),
      cleanliness: "clean",
    },
  });
  if (!acquired.updated) throw new Error(`workspace setup failed: ${acquired.reason}`);
  const launching = await store.transitionAttempt({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "launch-attempt-1",
    now: T2,
    attemptId: "attempt-1",
    expectedAttemptRevision: 1,
    status: "launching",
  });
  if (!launching.updated) throw new Error(`launch setup failed: ${launching.reason}`);
  const envelope = {
    schema_version: "1.0.0" as const,
    envelope_id: "envelope-1",
    run_id: "run-1",
    attempt_id: "attempt-1",
    packet_id: packet.packet_id,
    packet_hash: packet.packet_hash,
    workspace_lease_id: "workspace-lease-1",
    workspace_lease_revision: 0,
    expected_head_sha: "a".repeat(40),
    branch: "agent/work-1",
    runtime: {
      host_id: "host-1",
      os: "linux" as const,
      architecture: "x64",
      git_runtime: "wsl-git",
      worker_runtime: "codex-native",
    },
    paths: {
      project_root: "/srv/worktrees/work-1",
      execution_root: "/srv/worktrees/work-1",
      allocation_root: "/srv/worktrees",
      worktree_root: "/srv/worktrees/work-1",
    },
    path_mappings: [
      createNativeExecutionPathMapping({
        schema_version: "1.0.0",
        mapping_kind: "native_linux",
        repository_id: "repo-1",
        base_sha: "a".repeat(40),
        native_host_id: "host-1",
        git_runtime: "wsl-git",
        roots: {
          native_repository: verifiedRoot("/srv/repo", "11"),
          native_allocation_root: verifiedRoot("/srv/worktrees", "12"),
          native_worktree: verifiedRoot("/srv/worktrees/work-1", "13"),
        },
      }),
    ],
    exposed_environment_keys: [],
    created_at: T2,
  };
  const envelopeHash = computeCanonicalHash(envelope);
  const bound = await store.bindLaunchEnvelope({
    runId: "run-1",
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-lease-1",
    expectedRunRevision: 0,
    expectedAttemptRevision: 2,
    expectedWorkspaceLeaseRevision: 0,
    controller,
    authorizationMutationId: "launch-attempt-1",
    envelopeId: "envelope-1",
    envelopeHash,
    envelopeJson: canonicalJSONStringify(envelope),
    packetJson: canonicalJSONStringify(packet),
    createdAt: T2,
  });
  if (!bound.bound) throw new Error(`envelope setup failed: ${bound.reason}`);
  const attached = await store.attachWorkerSession({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "attach-worker-1",
    now: T3,
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-lease-1",
    expectedAttemptRevision: 2,
    expectedWorkspaceLeaseRevision: 0,
    sessionId: "worker-session-1",
    packetId: packet.packet_id,
    packetHash: packet.packet_hash,
    executionEnvelopeId: "envelope-1",
    executionEnvelopeHash: envelopeHash,
    hostId: "host-1",
    workerRuntime: "codex-native",
    gitRuntime: "wsl-git",
    backend: "host-subagent",
    workerId: "native-session-1",
    startedAt: T3,
  });
  if (!attached.updated) throw new Error(`worker setup failed: ${attached.reason}`);
  return controller;
}

export function taskPacket() {
  return createAgentTaskPacket({
    schema_version: "1.0.0",
    packet_id: "packet-1",
    run_id: "run-1",
    work_item: { work_item_id: "work-1", revision: 1 },
    attempt_id: "attempt-1",
    repository: { id: "repo-1", base_sha: "a".repeat(40) },
    objective: "Test a terminal continuation target",
    acceptance_criteria: [{ id: "criterion-1", text: "Target is validated" }],
    instructions: [],
    scope: { read_globs: ["src/**"], write_globs: [], deny_globs: [], cross_repo_allowed: false },
    authority: {
      edit: false,
      git_write: false,
      github_write: false,
      external_runtime: false,
      secrets: false,
      signing: false,
      release: false,
    },
    verification: [],
    budget: {},
    created_at: T0,
  });
}

function verifiedRoot(path: string, inode: string) {
  return {
    runtime_id: "wsl-git",
    path,
    verification: "directory_identity" as const,
    directory_identity: { device: "1", inode },
  };
}
