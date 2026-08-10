import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernedControlId } from "../../src/runs/governed-attempt-executor.js";
import {
  GovernedReviewRuntime,
  type StartSyntheticGovernedReviewInput,
} from "../../src/runs/governed-review-runtime.js";
import {
  computeGovernedRepositoryCorpusHashes,
  contentHash,
  type GovernedRepositoryCorpusFrame,
} from "../../src/runs/governed-review-repository-corpus.js";
import type { QualifiedCodexProviderBridge } from "../../src/runs/qualified-wsl2-codex-executor.js";
import { ExecutionEnvelope_v1, createAgentTaskPacket } from "../../src/schemas/agent-work.js";
import { createNativeExecutionPathMapping } from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";
import { InMemoryGovernedAttemptOperationStore } from "../../src/store/inmemory/governed-attempt-operation-store.js";
import { LocalProtectedEvidenceStore } from "../../src/store/local-protected-evidence-store.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T17:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("GovernedReviewRuntime", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), "lexrunner-review-runtime-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("binds a real durable Attempt while leaving its Delegation offered until the worker accepts", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const bridge = providerBridge();
    const evidenceStore = new LocalProtectedEvidenceStore(root, {
      attestRoot: async () => true,
      syncDirectory: async () => undefined,
      now: () => at(2),
      random: (length) => Buffer.alloc(length, 0x22),
    });
    const ids = ["delegation", "logical-thread", "authorization", "capture"];
    const runtime = new GovernedReviewRuntime({
      store,
      lifecycle: {
        getAttempt: vi.fn(async () => ({
          attemptId: "attempt-1",
          runId: "run-1",
          runRevision: 0,
          workItemId: "work-1",
          workItemRevision: 0,
          packetId: "packet-1",
          packetHash: hash("packet"),
          baseSha: "1".repeat(40),
          revision: 0,
          status: "running" as const,
          workspaceLeaseId: "workspace-1",
          receiptId: null,
          verificationId: null,
          createdAt: at(0),
          updatedAt: at(0),
          completedAt: null,
        })),
      },
      evidenceStore,
      bridge,
      now: () => at(2),
      randomId: () => ids.shift()!,
    });

    const result = await runtime.startSynthetic(startInput());

    expect(result).toMatchObject({
      started: true,
      delegationId: "delegation-delegation",
      captureId: "capture-capture",
    });
    if (!result.started) throw new Error(result.reason);
    expect((await store.getDelegation(result.delegationId))?.status).toBe("offered");
    expect(await store.getAttemptOperation(result.operationId)).toMatchObject({
      attempt_id: "attempt-1",
      status: "running",
      verification_context: { workspace: { corpus_kind: "synthetic" } },
    });
    expect(bridge.launch).toHaveBeenCalledOnce();
    await store.close();
  });

  it("refuses to treat a merely prepared Attempt as launch authority", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const bridge = providerBridge();
    const runtime = new GovernedReviewRuntime({
      store,
      lifecycle: {
        getAttempt: async () => ({
          attemptId: "attempt-1",
          runId: "run-1",
          runRevision: 0,
          workItemId: "work-1",
          workItemRevision: 0,
          packetId: "packet-1",
          packetHash: hash("packet"),
          baseSha: "1".repeat(40),
          revision: 0,
          status: "prepared",
          workspaceLeaseId: null,
          receiptId: null,
          verificationId: null,
          createdAt: at(0),
          updatedAt: at(0),
          completedAt: null,
        }),
      },
      evidenceStore: new LocalProtectedEvidenceStore(root, {
        attestRoot: async () => true,
        syncDirectory: async () => undefined,
        now: () => at(2),
      }),
      bridge,
      now: () => at(2),
    });

    await expect(runtime.startSynthetic(startInput())).resolves.toEqual({
      started: false,
      reason: "attempt_not_running",
    });
    expect(bridge.launch).not.toHaveBeenCalled();
    await store.close();
  });

  it("binds a clean committed repository corpus to the exact durable lifecycle and task input", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const lifecycle = repositoryLifecycleFixture();
    const corpus = repositoryCorpusFixture(lifecycle.packet.packet_hash, lifecycle.envelopeHash);
    const bridge = repositoryProviderBridge(corpus);
    const source = { export: vi.fn(async () => corpus) };
    const runtime = new GovernedReviewRuntime({
      store,
      lifecycle: { getAttempt: async () => lifecycle.attempt },
      repositoryLifecycle: {
        getWorkspaceLease: async () => lifecycle.lease,
        getLaunchEnvelopeBinding: async () => lifecycle.launchBinding,
        getTaskPacketBinding: async () => lifecycle.packetBinding,
      },
      repositoryCorpusSource: source,
      evidenceStore: new LocalProtectedEvidenceStore(root, {
        attestRoot: async () => true,
        syncDirectory: async () => undefined,
        now: () => at(2),
        random: (length) => Buffer.alloc(length, 0x33),
      }),
      bridge,
      now: () => at(2),
      randomId: (() => {
        const ids = ["delegation", "logical-thread", "authorization", "capture"];
        return () => ids.shift()!;
      })(),
    });

    const result = await runtime.startRepository(startInput());

    expect(result).toMatchObject({
      started: true,
      corpus: {
        candidate_object_id: "2".repeat(40),
        source_binding: {
          attempt_id: "attempt-1",
          task_packet_hash: lifecycle.packet.packet_hash,
          launch_envelope_hash: lifecycle.envelopeHash,
        },
      },
    });
    expect(source.export).toHaveBeenCalledWith(
      expect.objectContaining({
        repository_root: "/srv/repository",
        allocation_root: "/srv/worktrees",
        worktree_root: "/srv/worktrees/attempt-1",
        path_mapping_hash: lifecycle.mapping.mapping_digest,
      })
    );
    expect(bridge.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "repository_read_only",
        inputBinding: expect.objectContaining({
          task_offer_hash: expect.stringMatching(/^sha256:/u),
          delegation_offer_hash: expect.stringMatching(/^sha256:/u),
        }),
      })
    );
    if (!result.started) throw new Error(result.reason);
    expect(await store.getAttemptOperation(result.operationId)).toMatchObject({
      verification_context: {
        workspace: { corpus_kind: "repository" },
        repository_corpus: {
          source_binding_hash: corpus.header.source_binding_hash,
          manifest_hash: computeCanonicalHash(corpus.header),
        },
      },
    });
    await store.close();
  });

  it("discards a sealed corpus when lifecycle authority changes before Delegation creation", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const lifecycle = repositoryLifecycleFixture();
    const corpus = repositoryCorpusFixture(lifecycle.packet.packet_hash, lifecycle.envelopeHash);
    const bridge = repositoryProviderBridge(corpus);
    const getAttempt = vi
      .fn()
      .mockResolvedValueOnce(lifecycle.attempt)
      .mockResolvedValueOnce({ ...lifecycle.attempt, status: "cancelled" as const });
    const runtime = new GovernedReviewRuntime({
      store,
      lifecycle: { getAttempt },
      repositoryLifecycle: {
        getWorkspaceLease: async () => lifecycle.lease,
        getLaunchEnvelopeBinding: async () => lifecycle.launchBinding,
        getTaskPacketBinding: async () => lifecycle.packetBinding,
      },
      repositoryCorpusSource: { export: async () => corpus },
      evidenceStore: new LocalProtectedEvidenceStore(root, {
        attestRoot: async () => true,
        syncDirectory: async () => undefined,
        now: () => at(2),
      }),
      bridge,
      now: () => at(2),
    });

    await expect(runtime.startRepository(startInput())).resolves.toEqual({
      started: false,
      reason: "lifecycle_binding_mismatch",
    });
    expect(bridge.discardRepository).toHaveBeenCalledWith("repository-workspace");
    expect(bridge.launch).not.toHaveBeenCalled();
    await store.close();
  });
});

function startInput(): StartSyntheticGovernedReviewInput {
  return {
    runId: "run-1",
    attemptId: "attempt-1",
    environmentId: "environment-1",
    objective: "Review the retry bound",
    prompt: Buffer.from("Return BLOCK if the bounded retry was removed.", "utf8"),
  };
}

function providerBridge(): QualifiedCodexProviderBridge & {
  launch: ReturnType<typeof vi.fn>;
} {
  const observed = { observed_at: at(1), expires_at: at(59) };
  const attestations = {
    executor: {
      schema_version: "1.0.0" as const,
      executor_id: "qualified-codex",
      executor_version: "0.145.0",
      executable_hash: hash("executor"),
      protocol: "jsonl-stdin" as const,
      configuration_hash: hash("configuration"),
      tool_surface_hash: hash("tools"),
      ...observed,
    },
    environment: {
      schema_version: "1.0.0" as const,
      provider_id: "lexrunner.wsl2-bwrap",
      environment_id: "environment-1",
      topology_hash: hash("topology"),
      controls: GovernedControlId.options.map((control) => ({
        control,
        status: "enforced" as const,
        strength: "independently_enforced_verified" as const,
        evidence_refs: [hash(`control:${control}`)],
        enforcement_owner: "host-verifier",
      })),
      ...observed,
    },
    workspace: {
      schema_version: "1.0.0" as const,
      workspace_id: "synthetic-workspace",
      repository_id: "lexrunner-synthetic-retry-window",
      base_object_id: "1".repeat(40),
      candidate_object_id: "2".repeat(40),
      corpus_hash: hash("corpus"),
      selection_hash: hash("selection"),
      corpus_kind: "synthetic" as const,
      ...observed,
    },
  };
  const launch = vi.fn(async () => ({
    operationId: "operation-1",
    providerHandle: "provider-1",
    startedAt: at(3),
  }));
  return {
    inspect: async () => attestations.executor,
    prepareSynthetic: async () => attestations,
    attest: async () => attestations,
    launch,
    observe: async function* () {},
    continueAfterAcceptance: async () => undefined,
    cancel: async () => undefined,
    collect: async () => ({ taskOutcome: "block" }),
    release: async () => undefined,
  };
}

function repositoryLifecycleFixture() {
  const packet = createAgentTaskPacket({
    schema_version: "1.0.0",
    packet_id: "packet-1",
    run_id: "run-1",
    work_item: { work_item_id: "work-1", revision: 0 },
    attempt_id: "attempt-1",
    repository: { id: "repository-1", base_sha: "1".repeat(40) },
    objective: "Implement the candidate",
    acceptance_criteria: [],
    instructions: [],
    scope: {
      read_globs: ["**"],
      write_globs: ["**"],
      deny_globs: [],
      cross_repo_allowed: false,
    },
    authority: {
      edit: true,
      git_write: false,
      github_write: false,
      external_runtime: false,
      secrets: false,
      signing: false,
      release: false,
    },
    verification: [],
    budget: {},
    created_at: at(0),
  });
  const mapping = createNativeExecutionPathMapping({
    schema_version: "1.0.0",
    mapping_kind: "native_linux",
    repository_id: "repository-1",
    base_sha: "1".repeat(40),
    native_host_id: "host-1",
    git_runtime: "wsl-ubuntu-git",
    roots: {
      native_repository: {
        runtime_id: "wsl-ubuntu-git",
        path: "/srv/repository",
        verification: "directory_identity",
        directory_identity: { device: "1", inode: "2" },
      },
      native_allocation_root: {
        runtime_id: "wsl-ubuntu-git",
        path: "/srv/worktrees",
        verification: "directory_identity",
        directory_identity: { device: "1", inode: "3" },
      },
      native_worktree: {
        runtime_id: "wsl-ubuntu-git",
        path: "/srv/worktrees/attempt-1",
        verification: "directory_identity",
        directory_identity: { device: "1", inode: "4" },
      },
    },
  });
  const envelope = ExecutionEnvelope_v1.parse({
    schema_version: "1.0.0",
    envelope_id: "envelope-1",
    run_id: "run-1",
    attempt_id: "attempt-1",
    packet_id: packet.packet_id,
    packet_hash: packet.packet_hash,
    workspace_lease_id: "workspace-1",
    workspace_lease_revision: 1,
    expected_head_sha: "1".repeat(40),
    branch: "agent/attempt-1",
    runtime: {
      host_id: "host-1",
      os: "linux",
      architecture: "x64",
      worker_runtime: "codex",
      git_runtime: "wsl-ubuntu-git",
    },
    paths: {
      project_root: "/srv/worktrees/attempt-1",
      execution_root: "/srv/worktrees/attempt-1",
      allocation_root: "/srv/worktrees",
      worktree_root: "/srv/worktrees/attempt-1",
    },
    path_mappings: [mapping],
    exposed_environment_keys: [],
    created_at: at(0),
  });
  const envelopeHash = computeCanonicalHash(envelope);
  return {
    packet,
    mapping,
    envelope,
    envelopeHash,
    attempt: {
      attemptId: "attempt-1",
      runId: "run-1",
      runRevision: 0,
      workItemId: "work-1",
      workItemRevision: 0,
      packetId: packet.packet_id,
      packetHash: packet.packet_hash,
      baseSha: "1".repeat(40),
      revision: 2,
      status: "running" as const,
      workspaceLeaseId: "workspace-1",
      receiptId: null,
      verificationId: null,
      createdAt: at(0),
      updatedAt: at(1),
      completedAt: null,
    },
    lease: {
      leaseId: "workspace-1",
      runId: "run-1",
      runRevision: 0,
      workItemId: "work-1",
      workItemRevision: 0,
      packetId: packet.packet_id,
      packetHash: packet.packet_hash,
      revision: 2,
      controllerId: "controller-1",
      controllerLeaseId: "controller-lease-1",
      fencingToken: 1,
      repositoryId: "repository-1",
      hostId: "host-1",
      gitRuntime: "wsl-ubuntu-git",
      projectRoot: "/srv/repository",
      branch: "agent/attempt-1",
      worktreePath: "/srv/worktrees/attempt-1",
      attemptId: "attempt-1",
      baseSha: "1".repeat(40),
      status: "active" as const,
      acquiredAt: at(0),
      heartbeatAt: at(1),
      expiresAt: at(59),
    },
    launchBinding: {
      runId: "run-1",
      attemptId: "attempt-1",
      workspaceLeaseId: "workspace-1",
      attemptRevision: 1,
      workspaceLeaseRevision: 1,
      authorizationMutationId: "authorize-1",
      envelopeId: envelope.envelope_id,
      envelopeHash,
      envelopeJson: canonicalJSONStringify(envelope),
      controllerId: "controller-1",
      controllerLeaseId: "controller-lease-1",
      fencingToken: 1,
      createdAt: at(0),
    },
    packetBinding: {
      runId: "run-1",
      attemptId: "attempt-1",
      workItemId: "work-1",
      workItemRevision: 0,
      packetId: packet.packet_id,
      packetHash: packet.packet_hash,
      packetJson: canonicalJSONStringify(packet),
      createdAt: at(0),
    },
  };
}

function repositoryCorpusFixture(
  taskPacketHash: string,
  launchEnvelopeHash: string
): GovernedRepositoryCorpusFrame {
  const file = Buffer.from("candidate\n");
  const patch = Buffer.from("diff --git a/a.txt b/a.txt\n");
  const sourceBinding = {
    attempt_id: "attempt-1",
    workspace_lease_id: "workspace-1",
    task_packet_hash: taskPacketHash,
    launch_envelope_hash: launchEnvelopeHash,
    path_mapping_hash: repositoryLifecycleFixture().mapping.mapping_digest,
  };
  const entries = [
    {
      path: "a.txt",
      byte_length: file.byteLength,
      content_hash: contentHash(file),
      executable: false,
    },
  ];
  const hashes = computeGovernedRepositoryCorpusHashes({
    repositoryId: "repository-1",
    baseObjectId: "1".repeat(40),
    candidateObjectId: "2".repeat(40),
    sourceBinding,
    entries,
    patchHash: contentHash(patch),
  });
  const header = {
    schema_version: "1.0.0" as const,
    environment_id: "environment-1",
    repository_id: "repository-1",
    base_object_id: "1".repeat(40),
    candidate_object_id: "2".repeat(40),
    source_binding: sourceBinding,
    entries,
    candidate_tree_bytes: file.byteLength,
    patch_bytes: patch.byteLength,
    patch_hash: contentHash(patch),
    ...hashes,
  };
  const encoded = Buffer.from(canonicalJSONStringify(header));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(encoded.byteLength);
  return {
    header,
    files: [file],
    patch,
    bytes: Buffer.concat([prefix, encoded, file, patch]),
  };
}

function repositoryProviderBridge(corpus: GovernedRepositoryCorpusFrame) {
  const synthetic = providerBridge();
  const repositoryAttestations = {
    executor: {
      schema_version: "1.0.0" as const,
      executor_id: "qualified-codex",
      executor_version: "0.145.0",
      executable_hash: hash("executor"),
      protocol: "jsonl-stdin" as const,
      configuration_hash: hash("configuration"),
      tool_surface_hash: hash("tools"),
      observed_at: at(1),
      expires_at: at(59),
    },
    environment: {
      schema_version: "1.0.0" as const,
      provider_id: "lexrunner.wsl2-bwrap",
      environment_id: "environment-1",
      topology_hash: hash("topology"),
      controls: GovernedControlId.options.map((control) => ({
        control,
        status: "enforced" as const,
        strength: "independently_enforced_verified" as const,
        evidence_refs: [hash(`control:${control}`)],
        enforcement_owner: "host-verifier",
      })),
      observed_at: at(1),
      expires_at: at(59),
    },
    workspace: {
      schema_version: "1.0.0" as const,
      workspace_id: "repository-workspace",
      repository_id: corpus.header.repository_id,
      base_object_id: corpus.header.base_object_id,
      candidate_object_id: corpus.header.candidate_object_id,
      corpus_hash: corpus.header.corpus_hash,
      selection_hash: corpus.header.selection_hash,
      corpus_kind: "repository" as const,
      observed_at: at(1),
      expires_at: at(59),
    },
  };
  return {
    ...synthetic,
    prepareRepository: vi.fn(async () => repositoryAttestations),
    discardRepository: vi.fn(async () => undefined),
    attest: vi.fn(async () => repositoryAttestations),
  };
}
