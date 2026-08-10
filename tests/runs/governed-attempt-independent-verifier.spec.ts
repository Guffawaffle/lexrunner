import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
} from "../../src/runs/governed-attempt-executor.js";
import { GovernedAttemptIndependentVerifier } from "../../src/runs/governed-attempt-independent-verifier.js";
import { computeDelegationOfferHash } from "../../src/runs/governed-attempt-protocol.js";
import {
  createGovernedAttemptVerificationContext,
  type IndependentlyReadEvidenceFrame,
} from "../../src/runs/governed-attempt-verification.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { createAgentTaskPacket, ExecutionEnvelope_v1 } from "../../src/schemas/agent-work.js";
import { createNativeExecutionPathMapping } from "../../src/schemas/agent-work-projection.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";
import {
  GovernedAttemptOperationEvent_v1,
  GovernedAttemptOperationRecord_v1,
} from "../../src/store/governed-attempt-operation-store.js";
import { GovernedDelegationRecord_v1 } from "../../src/store/governed-delegation-store.js";
import {
  computeProtectedEvidenceFrameHash,
  initialProtectedEvidenceChainHead,
} from "../../src/store/local-protected-evidence-store.js";
import { ProtectedEvidenceReference_v1 } from "../../src/store/protected-evidence-store.js";
import {
  GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA,
  computeGovernedCodeReviewCorpusScopeHash,
  createGovernedCodeReviewTaskSpec,
} from "../../src/runs/governed-review-task-profile.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T11:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("GovernedAttemptIndependentVerifier", () => {
  it("independently admits a bound same-thread ACCEPT and schema-valid verdict", () => {
    const fixture = verificationFixture();
    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-1",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt).toMatchObject({
      decision: "accepted",
      task_outcome: "block",
      admissibility: "admissible",
      failure_codes: [],
    });
    expect(receipt.receipt_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects a tool action before ACCEPT even when the provider claims completion", () => {
    const fixture = verificationFixture();
    const toolFrame = fixture.evidence.frames[2]!;
    toolFrame.bytes = bytes({
      type: "item.completed",
      item: { type: "command_execution", command: "true" },
    });

    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-2",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toContain("protocol_violation");
  });

  it("rejects authorized work before the host's durable ACCEPT receipt", () => {
    const fixture = verificationFixture();
    const acceptReceipt = fixture.evidence.frames[4]!;
    const command = fixture.evidence.frames[6]!;
    [acceptReceipt.frameClass, command.frameClass] = [command.frameClass, acceptReceipt.frameClass];
    [acceptReceipt.bytes, command.bytes] = [command.bytes, acceptReceipt.bytes];
    rebindEvidenceEvents(fixture);

    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-pre-receipt-command",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toContain("protocol_violation");
  });

  it("rejects an ACCEPT receipt that is not bound to the observed Codex thread", () => {
    const fixture = verificationFixture();
    fixture.evidence.frames[4]!.bytes = bytes({
      decision: "ACCEPT",
      thread_binding_hash: contentHash("another-thread"),
    });

    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-thread-binding",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toContain("protocol_violation");
  });

  it("rejects provider self-elevation and a verdict that disagrees with raw evidence", () => {
    const fixture = verificationFixture();
    fixture.operation.result = {
      ...fixture.operation.result!,
      task_outcome: "pass",
      admissibility: "admissible",
    };
    fixture.operation.result_hash = computeCanonicalHash(fixture.operation.result);

    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-3",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toEqual(
      expect.arrayContaining(["outcome_mismatch", "provider_claim_elevated"])
    );
  });

  it("rejects a durable Delegation whose task offer differs from the protected launch binding", () => {
    const fixture = verificationFixture();
    fixture.delegation.state.offer.task_offer_hash = hash("different-task");

    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-task-input",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toContain("task_input_binding_mismatch");
  });

  it("independently verifies the protected generic code-review task profile", () => {
    const fixture = verificationFixture({ governedTask: true });
    const admitted = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-governed-task",
      verifierId: "lexrunner.windows-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });
    expect(admitted).toMatchObject({ decision: "accepted", failure_codes: [] });

    fixture.context.governed_task!.input_binding_hash = hash("tampered-task-input");
    const rejected = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-governed-task-tampered",
      verifierId: "lexrunner.windows-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });
    expect(rejected.decision).toBe("rejected");
    expect(rejected.failure_codes).toContain("task_input_binding_mismatch");
  });

  it("independently admits a repository corpus only with the exact durable lifecycle", () => {
    const fixture = verificationFixture({ repository: true });
    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-repository",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt).toMatchObject({
      decision: "accepted",
      task_outcome: "block",
      failure_codes: [],
    });
  });

  it("rejects a repository result when the independent lifecycle read is unavailable", () => {
    const fixture = verificationFixture({ repository: true });
    const { repositoryLifecycle: _repositoryLifecycle, ...withoutLifecycle } = fixture;
    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-repository-missing-lifecycle",
      verifierId: "lexrunner-host-verifier",
      ...withoutLifecycle,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toContain("lifecycle_binding_mismatch");
  });

  it("rejects a repository result after its bound workspace lease is released", () => {
    const fixture = verificationFixture({ repository: true });
    fixture.repositoryLifecycle!.lease!.status = "released";
    const receipt = new GovernedAttemptIndependentVerifier().verify({
      verificationId: "verification-repository-released-lease",
      verifierId: "lexrunner-host-verifier",
      ...fixture,
      verifiedAt: at(15),
    });

    expect(receipt.decision).toBe("rejected");
    expect(receipt.failure_codes).toContain("lifecycle_binding_mismatch");
  });
});

function verificationFixture(options: { repository?: boolean; governedTask?: boolean } = {}) {
  const controls = GovernedControlId.options.map((control) => ({
    control,
    minimum_strength: "host_enforced_indirect" as const,
  }));
  const requirements = GovernedReviewRequirements_v1.parse({
    schema_version: "1.0.0",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    repository_id: "synthetic-repository",
    base_object_id: "1".repeat(40),
    candidate_object_id: "2".repeat(40),
    objective_hash: hash("objective"),
    authorized_model_provider: "openai",
    source_disclosure_allowed: true,
    controls,
    max_duration_ms: 600_000,
    max_output_bytes: 1_000_000,
  });
  const grant = GovernedCapabilityGrant_v1.parse({
    schema_version: "1.0.0",
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
    repository_id: requirements.repository_id,
    base_object_id: requirements.base_object_id,
    candidate_object_id: requirements.candidate_object_id,
    authorized_model_provider: requirements.authorized_model_provider,
    source_disclosure_allowed: true,
    controls,
    tools: ["read_only_shell"],
    max_duration_ms: requirements.max_duration_ms,
    max_output_bytes: requirements.max_output_bytes,
  });
  const observed = { observed_at: at(0), expires_at: at(20) };
  const executor = {
    schema_version: "1.0.0" as const,
    executor_id: "synthetic-executor",
    executor_version: "1.0.0",
    executable_hash: hash("executor"),
    protocol: "jsonl-stdin" as const,
    configuration_hash: hash("config"),
    tool_surface_hash: hash("tools"),
    ...observed,
  };
  const environment = {
    schema_version: "1.0.0" as const,
    provider_id: "synthetic-provider",
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
  };
  const repositoryState = options.repository
    ? repositoryVerificationLifecycle({
        attemptId: requirements.attempt_id,
        repositoryId: requirements.repository_id,
        baseObjectId: requirements.base_object_id,
      })
    : undefined;
  const workspace = {
    schema_version: "1.0.0" as const,
    workspace_id: "workspace-1",
    repository_id: requirements.repository_id,
    base_object_id: requirements.base_object_id,
    candidate_object_id: requirements.candidate_object_id,
    corpus_hash: hash("corpus"),
    selection_hash: hash("selection"),
    corpus_kind: repositoryState ? ("repository" as const) : ("synthetic" as const),
    ...observed,
  };
  const decision = authorizeGovernedReview({
    authorizationId: "authorization-1",
    requirements,
    grant,
    executor,
    environment,
    workspace,
    authorizedAt: at(1),
    expiresAt: at(18),
  });
  if (!decision.authorized) throw new Error(`authorization fixture failed: ${decision.reason}`);

  const outputSchema = options.governedTask
    ? GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA
    : {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        required: ["verdict", "findings"],
        properties: {
          verdict: { type: "string", enum: ["PASS", "BLOCK"] },
          findings: { type: "array", maxItems: 16 },
        },
      };
  const promptHash = hash("prompt");
  const governedTask = options.governedTask
    ? createGovernedCodeReviewTaskSpec({
        attemptId: requirements.attempt_id,
        delegationId: requirements.delegation_id,
        objectiveHash: requirements.objective_hash,
        authorizedModelProvider: requirements.authorized_model_provider,
        promptHash,
        corpusScopeHash: computeGovernedCodeReviewCorpusScopeHash({
          repositoryId: workspace.repository_id,
          baseObjectId: workspace.base_object_id,
          candidateObjectId: workspace.candidate_object_id,
          corpusHash: workspace.corpus_hash,
          selectionHash: workspace.selection_hash,
        }),
        maxDurationMs: requirements.max_duration_ms,
        maxOutputBytes: requirements.max_output_bytes,
      })
    : undefined;
  const inputBindingBase = {
    prompt_hash: promptHash,
    output_schema_hash: computeCanonicalHash(outputSchema),
    task_offer_hash: governedTask?.task_spec_hash ?? hash("task-offer"),
  };
  const offer = {
    schema_version: "1.0.0" as const,
    delegation_id: requirements.delegation_id,
    attempt_id: requirements.attempt_id,
    worker: {
      provider_id: governedTask?.authorized_model_provider ?? "openai-codex",
      worker_id: executor.executor_id,
      thread_id: "logical-thread-1",
    },
    task_offer_hash: inputBindingBase.task_offer_hash,
    requirements_hash: computeCanonicalHash(requirements),
    authority_grant_hash: computeCanonicalHash(grant),
    transcript_start_hash: hash("transcript"),
    offered_at: at(1),
  };
  const offerHash = computeDelegationOfferHash(offer);
  const inputBinding = { ...inputBindingBase, delegation_offer_hash: offerHash };
  const context = createGovernedAttemptVerificationContext({
    requirements,
    executor,
    environment,
    workspace,
    output_schema: outputSchema,
    input_binding: inputBinding,
    ...(governedTask ? { governed_task: governedTask } : {}),
    ...(repositoryState ? { repository_corpus: repositoryState.binding } : {}),
  });
  const raw = [
    bytes({
      operation_id: "operation-1",
      provider_handle: "provider-handle-1",
      authorization_binding_digest: decision.authorization.binding_digest,
      input_binding: inputBinding,
      ...(repositoryState
        ? { repository_corpus: providerRepositoryCorpusBinding(repositoryState.binding) }
        : {}),
    }),
    bytes({ type: "thread.started", thread_id: "thread-1" }),
    bytes({ type: "turn.started" }),
    bytes({ type: "item.completed", item: { type: "agent_message", text: "ACCEPT" } }),
    bytes({ decision: "ACCEPT", thread_binding_hash: contentHash("thread-1") }),
    bytes({ type: "thread.started", thread_id: "thread-1" }),
    bytes({
      type: "item.completed",
      item: { type: "command_execution", aggregated_output: "read-only output" },
    }),
    bytes({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ verdict: "BLOCK", findings: [] }),
      },
    }),
    bytes({ task_outcome: "block", structured_result_present: true }),
  ];
  const classes = [
    "provider_receipt",
    "executor_stdout",
    "executor_stdout",
    "executor_stdout",
    "provider_receipt",
    "executor_stdout",
    "executor_stdout",
    "executor_stdout",
    "provider_receipt",
  ] as const;
  let chainHead = initialProtectedEvidenceChainHead();
  const frames: IndependentlyReadEvidenceFrame[] = raw.map((payload, index) => {
    const sequence = index + 1;
    const observedAt = at(sequence + 2);
    const evidenceRef = computeProtectedEvidenceFrameHash({
      captureId: "capture-1",
      sequence,
      frameClass: classes[index]!,
      observedAt,
      bytes: payload,
      previousFrameHash: chainHead,
    });
    chainHead = evidenceRef;
    return {
      sequence,
      frameClass: classes[index]!,
      observedAt,
      evidenceRef,
      bytes: payload,
    };
  });
  const reference = ProtectedEvidenceReference_v1.parse({
    schema_version: "1.0.0",
    profile_id: "lexrunner.local-protected-evidence@1.0.0",
    store_key: "pe:0123456789abcdef0123456789abcdef",
    capture_id: "capture-1",
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
    authorization_binding_digest: decision.authorization.binding_digest,
    executor_binding_digest: decision.authorization.executor_attestation_hash,
    environment_binding_digest: decision.authorization.environment_attestation_hash,
    workspace_binding_digest: decision.authorization.workspace_attestation_hash,
    status: "complete",
    retention_class: "synthetic_complete",
    capture_root: hash("capture-root"),
    verification_hash: hash("capture-verification"),
    frame_count: frames.length,
    event_count: 0,
    total_bytes: raw.reduce((sum, value) => sum + value.byteLength, 0),
    stdout_bytes: raw.slice(1, -1).reduce((sum, value) => sum + value.byteLength, 0),
    stderr_bytes: 0,
    provider_control_bytes: raw[0]!.byteLength + raw[raw.length - 1]!.byteLength,
    declared_at: at(0),
    opened_at: at(1),
    sealed_at: at(11),
    indexed_at: at(12),
    retention_expires_at: "2026-08-12T11:00:00.000Z",
  });
  const result = {
    schema_version: "1.0.0" as const,
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
    authorization_binding_digest: decision.authorization.binding_digest,
    worker_outcome: "completed" as const,
    task_outcome: "block" as const,
    authorization_outcome: "valid" as const,
    evidence_outcome: "sufficient" as const,
    admissibility: "inadmissible" as const,
    evidence_refs: [reference.capture_root!, reference.verification_hash!],
  };
  const operation = GovernedAttemptOperationRecord_v1.parse({
    schema_version: "1.0.0",
    operation_id: "operation-1",
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
    revision: frames.length + 1,
    status: "completed",
    handle: {
      schema_version: "1.0.0",
      operation_id: "operation-1",
      attempt_id: requirements.attempt_id,
      delegation_id: requirements.delegation_id,
      authorization_binding_digest: decision.authorization.binding_digest,
      executor_id: executor.executor_id,
      provider_handle: "provider-handle-1",
      started_at: at(3),
    },
    authorization: decision.authorization,
    verification_context: context,
    evidence_reservation: {
      capture_id: reference.capture_id,
      attempt_id: reference.attempt_id,
      delegation_id: reference.delegation_id,
      authorization_binding_digest: reference.authorization_binding_digest,
      executor_binding_digest: reference.executor_binding_digest,
      environment_binding_digest: reference.environment_binding_digest,
      workspace_binding_digest: reference.workspace_binding_digest,
      reserved_bytes: 1_000_000,
      reserved_frames: 100,
      reserved_events: 100,
      max_duration_ms: 600_000,
    },
    evidence_declaration: {
      ...reference,
      status: "open",
      frame_count: 0,
      event_count: 0,
      total_bytes: 0,
      stdout_bytes: 0,
      stderr_bytes: 0,
      provider_control_bytes: 0,
      capture_root: undefined,
      verification_hash: undefined,
      sealed_at: undefined,
      indexed_at: undefined,
    },
    last_event_sequence: frames.length,
    result,
    result_hash: computeCanonicalHash(result),
    created_at: at(3),
    updated_at: at(12),
    terminal_at: at(10),
  });
  const events = frames.map((frame, index) =>
    GovernedAttemptOperationEvent_v1.parse({
      schema_version: "1.0.0",
      operation_id: operation.operation_id,
      attempt_id: operation.attempt_id,
      delegation_id: operation.delegation_id,
      operation_revision: index + 1,
      mutation_id: `operation-1:event:${index + 1}`,
      mutation_fingerprint: hash(`event:${index + 1}`),
      event: {
        schema_version: "1.0.0",
        type:
          index === 0
            ? "started"
            : index === frames.length - 1
              ? "completed"
              : frame.frameClass === "provider_receipt"
                ? "accepted"
                : "executor_event",
        sequence: index + 1,
        observed_at: frame.observedAt,
        evidence_ref: frame.evidenceRef,
        ...(index > 0 && index < frames.length - 1 && frame.frameClass !== "provider_receipt"
          ? {
              executor_event_type: String(
                (JSON.parse(Buffer.from(frame.bytes).toString("utf8")) as { type?: string }).type ??
                  "codex.invalid_json"
              ),
            }
          : {}),
      },
      created_at: frame.observedAt,
    })
  );
  const delegation = GovernedDelegationRecord_v1.parse({
    schema_version: "1.0.0",
    delegation_id: offer.delegation_id,
    attempt_id: offer.attempt_id,
    revision: 0,
    status: "offered",
    state: {
      schema_version: "1.0.0",
      offer,
      offer_hash: offerHash,
      status: "offered",
    },
    offer_hash: offerHash,
    created_at: at(1),
    updated_at: at(1),
  });
  return {
    operation,
    events,
    context,
    evidence: { reference, frames },
    delegation,
    ...(repositoryState ? { repositoryLifecycle: repositoryState.lifecycle } : {}),
  };
}

function providerRepositoryCorpusBinding<T extends { workspace_lease_revision: number }>(
  binding: T
): Omit<T, "workspace_lease_revision"> {
  const { workspace_lease_revision: _hostLifecycleRevision, ...providerBinding } = binding;
  return providerBinding;
}

function repositoryVerificationLifecycle(input: {
  attemptId: string;
  repositoryId: string;
  baseObjectId: string;
}) {
  const packet = createAgentTaskPacket({
    schema_version: "1.0.0",
    packet_id: "packet-1",
    run_id: "run-1",
    work_item: { work_item_id: "work-1", revision: 0 },
    attempt_id: input.attemptId,
    repository: { id: input.repositoryId, base_sha: input.baseObjectId },
    objective: "Review the committed candidate",
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
    repository_id: input.repositoryId,
    base_sha: input.baseObjectId,
    native_host_id: "host-1",
    git_runtime: "wsl-git",
    roots: {
      native_repository: {
        runtime_id: "wsl-git",
        path: "/srv/repository",
        verification: "directory_identity",
        directory_identity: { device: "1", inode: "2" },
      },
      native_allocation_root: {
        runtime_id: "wsl-git",
        path: "/srv/worktrees",
        verification: "directory_identity",
        directory_identity: { device: "1", inode: "3" },
      },
      native_worktree: {
        runtime_id: "wsl-git",
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
    attempt_id: input.attemptId,
    packet_id: packet.packet_id,
    packet_hash: packet.packet_hash,
    workspace_lease_id: "workspace-1",
    workspace_lease_revision: 1,
    expected_head_sha: input.baseObjectId,
    branch: "agent/attempt-1",
    runtime: {
      host_id: "host-1",
      os: "linux",
      architecture: "x64",
      worker_runtime: "codex",
      git_runtime: "wsl-git",
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
  const source = {
    attempt_id: input.attemptId,
    workspace_lease_id: "workspace-1",
    task_packet_hash: packet.packet_hash,
    launch_envelope_hash: envelopeHash,
    path_mapping_hash: mapping.mapping_digest,
  };
  const attempt = {
    attemptId: input.attemptId,
    runId: "run-1",
    runRevision: 0,
    workItemId: "work-1",
    workItemRevision: 0,
    packetId: packet.packet_id,
    packetHash: packet.packet_hash,
    baseSha: input.baseObjectId,
    revision: 2,
    status: "running" as const,
    workspaceLeaseId: "workspace-1",
    receiptId: null,
    verificationId: null,
    createdAt: at(0),
    updatedAt: at(1),
    completedAt: null,
  };
  const lease = {
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
    repositoryId: input.repositoryId,
    hostId: "host-1",
    gitRuntime: "wsl-git",
    projectRoot: "/srv/repository",
    branch: "agent/attempt-1",
    worktreePath: "/srv/worktrees/attempt-1",
    attemptId: input.attemptId,
    baseSha: input.baseObjectId,
    status: "active" as const,
    acquiredAt: at(0),
    heartbeatAt: at(1),
    expiresAt: at(59),
  };
  return {
    binding: {
      manifest_hash: hash("manifest"),
      source_binding_hash: computeCanonicalHash(source),
      workspace_lease_id: source.workspace_lease_id,
      workspace_lease_revision: 1,
      task_packet_hash: source.task_packet_hash,
      launch_envelope_hash: source.launch_envelope_hash,
      path_mapping_hash: source.path_mapping_hash,
      candidate_tree_hash: hash("candidate-tree"),
      patch_hash: hash("patch"),
    },
    lifecycle: {
      attempt,
      lease,
      launchBinding: {
        runId: attempt.runId,
        attemptId: attempt.attemptId,
        workspaceLeaseId: lease.leaseId,
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
        runId: attempt.runId,
        attemptId: attempt.attemptId,
        workItemId: attempt.workItemId,
        workItemRevision: attempt.workItemRevision,
        packetId: packet.packet_id,
        packetHash: packet.packet_hash,
        packetJson: canonicalJSONStringify(packet),
        createdAt: at(0),
      },
    },
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function rebindEvidenceEvents(fixture: ReturnType<typeof verificationFixture>): void {
  let chainHead = initialProtectedEvidenceChainHead();
  fixture.evidence.frames.forEach((frame, index) => {
    frame.evidenceRef = computeProtectedEvidenceFrameHash({
      captureId: fixture.evidence.reference.capture_id,
      sequence: frame.sequence,
      frameClass: frame.frameClass,
      observedAt: frame.observedAt,
      bytes: frame.bytes,
      previousFrameHash: chainHead,
    });
    chainHead = frame.evidenceRef;
    const terminal = index === fixture.evidence.frames.length - 1;
    const accepted =
      frame.frameClass === "provider_receipt" &&
      (JSON.parse(Buffer.from(frame.bytes).toString("utf8")) as { decision?: string }).decision ===
        "ACCEPT";
    fixture.events[index] = GovernedAttemptOperationEvent_v1.parse({
      ...fixture.events[index],
      event: {
        schema_version: "1.0.0",
        type:
          index === 0
            ? "started"
            : terminal
              ? "completed"
              : accepted
                ? "accepted"
                : "executor_event",
        sequence: index + 1,
        observed_at: frame.observedAt,
        evidence_ref: frame.evidenceRef,
        ...(!terminal && index > 0 && !accepted
          ? {
              executor_event_type:
                frame.frameClass === "executor_stdout"
                  ? String(
                      (JSON.parse(Buffer.from(frame.bytes).toString("utf8")) as { type?: string })
                        .type ?? "codex.invalid_json"
                    )
                  : "codex.stderr",
            }
          : {}),
      },
    });
  });
}
