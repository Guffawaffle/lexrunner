import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";

import { createDelegationDecisionReceipt } from "../../src/runs/governed-attempt-protocol.js";
import {
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
} from "../../src/runs/governed-attempt-executor.js";
import {
  createGovernedAttemptVerificationContext,
  createGovernedAttemptVerificationReceipt,
} from "../../src/runs/governed-attempt-verification.js";
import {
  GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA,
  GOVERNED_CODE_REVIEW_OPERATOR_PRINCIPAL_ID,
  computeGovernedCodeReviewCorpusScopeHash,
  createGovernedCodeReviewTaskExecutionBinding,
  createGovernedCodeReviewTaskSpec,
} from "../../src/runs/governed-review-task-profile.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import type { GovernedAttemptOperationStore } from "../../src/store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../../src/store/governed-delegation-store.js";
import { InMemoryGovernedAttemptOperationStore } from "../../src/store/inmemory/governed-attempt-operation-store.js";
import { SqliteGovernedAttemptOperationStore } from "../../src/store/sqlite/governed-attempt-operation-store.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T10:00:${String(seconds).padStart(2, "0")}.000Z`;

type OperationStore = GovernedAttemptOperationStore &
  GovernedDelegationStore & { close(): Promise<void> };

describe("generic governed Attempt verification receipt", () => {
  const receiptInput = {
    verification_id: "verification-1",
    verifier_id: "profile-verifier",
    operation_id: "operation-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    capture_id: "capture-1",
    authorization_binding_digest: hash("authorization"),
    verification_context_hash: hash("context"),
    operation_result_hash: hash("result"),
    capture_root: hash("capture-root"),
    capture_verification_hash: hash("capture-verification"),
    decision: "accepted" as const,
    admissibility: "admissible" as const,
    failure_codes: [],
    verified_at: at(5),
  };

  it("accepts a profile-owned terminal outcome without knowing its vocabulary", () => {
    expect(
      createGovernedAttemptVerificationReceipt({
        ...receiptInput,
        task_outcome: "artifact_published",
      })
    ).toMatchObject({ decision: "accepted", task_outcome: "artifact_published" });
  });

  it("rejects an accepted receipt with a profile-neutral non-outcome sentinel", () => {
    expect(() =>
      createGovernedAttemptVerificationReceipt({
        ...receiptInput,
        task_outcome: "not_produced",
      })
    ).toThrow(/produced profile outcome/u);
  });
});

describe.each([
  {
    name: "in-memory",
    create: (_databasePath: string): OperationStore => new InMemoryGovernedAttemptOperationStore(),
  },
  {
    name: "SQLite",
    create: (databasePath: string): OperationStore =>
      new SqliteGovernedAttemptOperationStore(databasePath),
  },
])("governed Attempt operation store: $name", ({ create }) => {
  let directory: string;
  let store: OperationStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-governed-operation-"));
    store = create(join(directory, "coordination.db"));
    await acceptedDelegation(store);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("persists ordered executor events and latches terminal completion", async () => {
    const created = await createOperation(store);
    expect(created).toMatchObject({ created: true, idempotentReplay: false });

    const started = await append(store, 0, event("started", 1), "event-started");
    expect(started).toMatchObject({
      appended: true,
      record: { revision: 1, status: "running", last_event_sequence: 1 },
    });
    const completed = await append(store, 1, event("completed", 2), "event-completed");
    expect(completed).toMatchObject({
      appended: true,
      record: { revision: 2, status: "completed", terminal_at: at(3) },
    });

    expect(await append(store, 2, event("executor_event", 3), "event-late")).toEqual({
      appended: false,
      reason: "terminal_latched",
    });
    expect(
      (await store.listAttemptOperationEvents("operation-1")).map((entry) => entry.event.type)
    ).toEqual(["started", "completed"]);
  });

  it("makes decline terminal and refuses every later executor action", async () => {
    await createOperation(store);
    const declined = await append(store, 0, event("declined", 1), "event-declined");
    expect(declined).toMatchObject({
      appended: true,
      record: { status: "declined", terminal_at: at(3) },
    });
    expect(await append(store, 1, event("completed", 2), "event-after-decline")).toEqual({
      appended: false,
      reason: "terminal_latched",
    });
  });

  it("rejects gaps, stale revisions, and mutation identity reuse", async () => {
    await createOperation(store);
    expect(await append(store, 0, event("started", 2), "event-gap")).toEqual({
      appended: false,
      reason: "sequence_mismatch",
    });
    const first = await append(store, 0, event("started", 1), "event-first");
    expect(first).toMatchObject({ appended: true, idempotentReplay: false });
    expect(await append(store, 0, event("started", 1), "event-first")).toMatchObject({
      appended: true,
      idempotentReplay: true,
    });
    expect(await append(store, 0, event("failed", 1), "event-first")).toEqual({
      appended: false,
      reason: "mutation_conflict",
    });
    expect(await append(store, 0, event("completed", 2), "event-stale")).toEqual({
      appended: false,
      reason: "stale_revision",
    });
  });

  it("persists an orthogonal result only after a terminal event", async () => {
    await createOperation(store);
    const result = attemptResult();
    expect(
      await store.recordAttemptOperationResult({
        mutationId: "result-early",
        operationId: "operation-1",
        expectedRevision: 0,
        result,
        now: at(3),
      })
    ).toEqual({ recorded: false, reason: "result_conflict" });

    await append(store, 0, event("completed", 1), "event-completed");
    const recorded = await store.recordAttemptOperationResult({
      mutationId: "result-final",
      operationId: "operation-1",
      expectedRevision: 1,
      result,
      now: at(4),
    });
    expect(recorded).toMatchObject({
      recorded: true,
      record: { revision: 2, result_hash: computeCanonicalHash(result) },
      idempotentReplay: false,
    });
  });

  it("supports exact create replay and rejects create mutation collisions", async () => {
    const first = await createOperation(store);
    const replay = await createOperation(store);
    expect(first).toMatchObject({ created: true, idempotentReplay: false });
    expect(replay).toMatchObject({ created: true, idempotentReplay: true });
    expect(
      await store.createAttemptOperation({
        mutationId: "operation-create",
        handle: { ...handle(), operation_id: "operation-2", provider_handle: "provider-2" },
        authorization: authorization(),
        now: at(2),
      })
    ).toEqual({ created: false, reason: "mutation_conflict" });
  });

  it("lists running and result-pending completion as restart-recoverable", async () => {
    await createOperation(store);
    expect(
      (await store.listRecoverableAttemptOperations()).map((record) => record.operation_id)
    ).toEqual(["operation-1"]);
    await append(store, 0, event("completed", 1), "event-completed");
    expect(
      (await store.listRecoverableAttemptOperations()).map((record) => record.operation_id)
    ).toEqual(["operation-1"]);
    await store.recordAttemptOperationResult({
      mutationId: "result-final",
      operationId: "operation-1",
      expectedRevision: 1,
      result: attemptResult(),
      now: at(4),
    });
    expect(await store.listRecoverableAttemptOperations()).toEqual([]);
  });

  it("persists restart-safe evidence bindings without a reservation token or raw bytes", async () => {
    const boundAuthorization = authorization();
    const reservation = evidenceReservation(boundAuthorization);
    const declaration = evidenceDeclaration(boundAuthorization);
    const created = await store.createAttemptOperation({
      mutationId: "operation-create",
      handle: handle(),
      authorization: boundAuthorization,
      evidenceReservation: reservation,
      evidenceDeclaration: declaration,
      now: at(2),
    });
    expect(created).toMatchObject({
      created: true,
      record: {
        evidence_reservation: { capture_id: "capture-1" },
        evidence_declaration: { status: "open", capture_id: "capture-1" },
      },
    });
    const encoded = JSON.stringify(await store.getAttemptOperation("operation-1"));
    expect(encoded).not.toContain("reservationToken");
    expect(encoded).not.toContain("raw evidence");
  });

  it("persists an independently bound verification receipt without rewriting the provider claim", async () => {
    const fixture = verificationBoundFixture();
    const created = await store.createAttemptOperation({
      mutationId: "operation-create",
      handle: fixture.handle,
      authorization: fixture.authorization,
      evidenceReservation: fixture.reservation,
      evidenceDeclaration: fixture.declaration,
      verificationContext: fixture.context,
      now: at(2),
    });
    expect(created).toMatchObject({ created: true });
    await append(store, 0, event("completed", 1), "event-completed");
    const providerResult = {
      ...attemptResult(),
      authorization_binding_digest: fixture.authorization.binding_digest,
      admissibility: "inadmissible" as const,
    };
    const result = await store.recordAttemptOperationResult({
      mutationId: "result-final",
      operationId: "operation-1",
      expectedRevision: 1,
      result: providerResult,
      now: at(4),
    });
    if (!result.recorded) throw new Error(`result fixture failed: ${result.reason}`);
    const receipt = createGovernedAttemptVerificationReceipt({
      verification_id: "verification-1",
      verifier_id: "lexrunner-host-verifier",
      operation_id: "operation-1",
      attempt_id: "attempt-1",
      delegation_id: "delegation-1",
      capture_id: "capture-1",
      authorization_binding_digest: fixture.authorization.binding_digest,
      verification_context_hash: fixture.context.context_hash,
      operation_result_hash: result.record.result_hash!,
      capture_root: hash("capture-root"),
      capture_verification_hash: hash("capture-verification"),
      decision: "accepted",
      task_outcome: "pass",
      admissibility: "admissible",
      failure_codes: [],
      verified_at: at(5),
    });
    const recorded = await store.recordAttemptOperationVerification({
      mutationId: "verification-final",
      operationId: "operation-1",
      expectedRevision: result.record.revision,
      verification: receipt,
      now: at(5),
    });
    expect(recorded).toMatchObject({
      recorded: true,
      idempotentReplay: false,
      record: {
        revision: 3,
        result: { admissibility: "inadmissible" },
        verification: { decision: "accepted", admissibility: "admissible" },
      },
    });
    await expect(
      store.recordAttemptOperationVerification({
        mutationId: "verification-final",
        operationId: "operation-1",
        expectedRevision: result.record.revision,
        verification: receipt,
        now: at(5),
      })
    ).resolves.toMatchObject({ recorded: true, idempotentReplay: true });
  });
});

describe("SQLite governed Attempt repository lifecycle guard", () => {
  it("rejects operation creation after the bound workspace lease is released", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-governed-operation-guard-"));
    const databasePath = join(directory, "coordination.db");
    const store = new SqliteGovernedAttemptOperationStore(databasePath);
    try {
      const fixture = verificationBoundFixture(true);
      await acceptedDelegation(store, {
        providerId: fixture.context.governed_task!.authorized_model_provider,
        taskOfferHash: fixture.context.governed_task!.task_spec_hash,
        authorityGrantHash: fixture.context.task_execution!.authority_grant_hash,
        requirementsHash: computeCanonicalHash(fixture.context.requirements),
      });
      seedRepositoryLifecycle(databasePath, "released");
      await expect(
        store.createAttemptOperation({
          mutationId: "operation-create-guarded",
          handle: fixture.handle,
          authorization: fixture.authorization,
          evidenceReservation: fixture.reservation,
          evidenceDeclaration: fixture.declaration,
          verificationContext: fixture.context,
          now: at(2),
        })
      ).resolves.toEqual({ created: false, reason: "binding_mismatch" });
    } finally {
      await store.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

async function acceptedDelegation(
  store: GovernedDelegationStore,
  binding: {
    providerId: string;
    taskOfferHash: string;
    authorityGrantHash: string;
    requirementsHash: string;
  } = {
    providerId: "synthetic-provider",
    taskOfferHash: hash("task"),
    authorityGrantHash: hash("grant"),
    requirementsHash: hash("requirements"),
  }
): Promise<void> {
  const offer = {
    schema_version: "1.0.0" as const,
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    worker: {
      provider_id: binding.providerId,
      worker_id: "worker-1",
      thread_id: "thread-1",
    },
    task_offer_hash: binding.taskOfferHash,
    requirements_hash: binding.requirementsHash,
    authority_grant_hash: binding.authorityGrantHash,
    transcript_start_hash: hash("transcript"),
    offered_at: at(0),
  };
  const created = await store.createDelegation({
    mutationId: "delegation-create",
    offer,
    now: at(0),
  });
  if (!created.created) throw new Error("failed to create Delegation fixture");
  const accepted = await store.recordDelegationDecision({
    mutationId: "delegation-accept",
    delegationId: "delegation-1",
    expectedRevision: 0,
    receipt: createDelegationDecisionReceipt({
      offer,
      decision: "ACCEPT",
      decisionReceiptId: "acceptance-1",
      decidedAt: at(1),
    }),
    now: at(1),
  });
  if (!accepted.recorded) throw new Error("failed to accept Delegation fixture");
}

function handle() {
  return {
    schema_version: "1.0.0" as const,
    operation_id: "operation-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: authorization().binding_digest,
    executor_id: "synthetic-executor",
    provider_handle: "provider-1",
    started_at: at(2),
  };
}

function createOperation(store: GovernedAttemptOperationStore) {
  return store.createAttemptOperation({
    mutationId: "operation-create",
    handle: handle(),
    authorization: authorization(),
    now: at(2),
  });
}

function event(
  type: "started" | "executor_event" | "declined" | "completed" | "failed",
  sequence: number
) {
  const common = {
    schema_version: "1.0.0" as const,
    type,
    sequence,
    observed_at: at(3),
    evidence_ref: hash(`${type}:${sequence}`),
  };
  return type === "executor_event"
    ? { ...common, type, executor_event_type: "item.completed" }
    : type === "declined"
      ? { ...common, type, reason_present: false }
      : common;
}

function append(
  store: GovernedAttemptOperationStore,
  revision: number,
  executorEvent: ReturnType<typeof event>,
  mutationId: string
) {
  return store.appendAttemptOperationEvent({
    mutationId,
    operationId: "operation-1",
    expectedRevision: revision,
    event: executorEvent,
    now: at(3),
  });
}

function attemptResult() {
  return {
    schema_version: "1.0.0" as const,
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: authorization().binding_digest,
    worker_outcome: "completed" as const,
    task_outcome: "pass" as const,
    authorization_outcome: "valid" as const,
    evidence_outcome: "sufficient" as const,
    admissibility: "admissible" as const,
    evidence_refs: [hash("evidence")],
  };
}

function authorization() {
  const controls = [
    "corpus_read_scope",
    "filesystem_write_denied",
    "tool_network_denied",
    "local_ipc_denied",
    "credential_read_denied",
    "descendant_reaping",
    "evidence_sink_protected",
    "degraded_launch_denied",
  ].map((control) => ({ control, minimum_strength: "host_enforced_indirect" as const }));
  const body = {
    schema_version: "1.0.0" as const,
    authorization_id: "authorization-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    requirements_hash: hash("requirements"),
    executor_attestation_hash: hash("executor"),
    environment_attestation_hash: hash("environment"),
    workspace_attestation_hash: hash("workspace"),
    grant: {
      schema_version: "1.0.0" as const,
      attempt_id: "attempt-1",
      delegation_id: "delegation-1",
      repository_id: "synthetic-repository",
      base_object_id: "1".repeat(40),
      candidate_object_id: "2".repeat(40),
      authorized_model_provider: "openai",
      source_disclosure_allowed: true as const,
      controls,
      tools: ["read_only_shell" as const],
      max_duration_ms: 60_000,
      max_output_bytes: 1_000_000,
    },
    authorized_at: at(1),
    expires_at: at(59),
  };
  return { ...body, binding_digest: computeCanonicalHash(body) };
}

function evidenceReservation(boundAuthorization: ReturnType<typeof authorization>) {
  return {
    capture_id: "capture-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: boundAuthorization.binding_digest,
    executor_binding_digest: boundAuthorization.executor_attestation_hash,
    environment_binding_digest: boundAuthorization.environment_attestation_hash,
    workspace_binding_digest: boundAuthorization.workspace_attestation_hash,
    reserved_bytes: 1_000_000,
    reserved_frames: 10,
    reserved_events: 10,
    max_duration_ms: 60_000,
  };
}

function evidenceDeclaration(boundAuthorization: ReturnType<typeof authorization>) {
  return {
    schema_version: "1.0.0" as const,
    profile_id: "lexrunner.local-protected-evidence@1.0.0" as const,
    store_key: "pe:0123456789abcdef0123456789abcdef",
    capture_id: "capture-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: boundAuthorization.binding_digest,
    executor_binding_digest: boundAuthorization.executor_attestation_hash,
    environment_binding_digest: boundAuthorization.environment_attestation_hash,
    workspace_binding_digest: boundAuthorization.workspace_attestation_hash,
    status: "open" as const,
    retention_class: "synthetic_complete" as const,
    frame_count: 0,
    event_count: 0,
    total_bytes: 0,
    stdout_bytes: 0,
    stderr_bytes: 0,
    provider_control_bytes: 0,
    declared_at: at(0),
    opened_at: at(1),
    retention_expires_at: "2026-08-12T10:00:00.000Z",
  };
}

function verificationBoundFixture(repository = false) {
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
    authorized_operator_principal_id: GOVERNED_CODE_REVIEW_OPERATOR_PRINCIPAL_ID,
    source_disclosure_allowed: true,
    controls,
    max_duration_ms: 60_000,
    max_output_bytes: 1_000_000,
  });
  const grant = GovernedCapabilityGrant_v1.parse({
    schema_version: "1.0.0",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
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
  const observed = { observed_at: at(0), expires_at: at(59) };
  const executor = {
    schema_version: "1.0.0" as const,
    executor_id: "synthetic-executor",
    executor_version: "1.0.0",
    executable_hash: hash("executable"),
    protocol: "jsonl-stdin" as const,
    configuration_hash: hash("configuration"),
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
  const workspace = {
    schema_version: "1.0.0" as const,
    workspace_id: "workspace-1",
    repository_id: requirements.repository_id,
    base_object_id: requirements.base_object_id,
    candidate_object_id: requirements.candidate_object_id,
    corpus_hash: hash("corpus"),
    selection_hash: hash("selection"),
    corpus_kind: repository ? ("repository" as const) : ("synthetic" as const),
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
    expiresAt: at(58),
  });
  if (!decision.authorized) throw new Error(`verification fixture failed: ${decision.reason}`);
  const outputSchema = repository ? GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA : { type: "object" };
  const promptHash = hash("prompt");
  const governedTask = repository
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
  const taskExecution = governedTask
    ? createGovernedCodeReviewTaskExecutionBinding({
        task: governedTask,
        authorizedAt: at(1),
        expiresAt: at(58),
        executorAttestationHash: computeCanonicalHash(executor),
        environmentAttestationHash: computeCanonicalHash(environment),
        workspaceAttestationHash: computeCanonicalHash(workspace),
      })
    : undefined;
  const context = createGovernedAttemptVerificationContext({
    requirements,
    executor,
    environment,
    workspace,
    output_schema: outputSchema,
    ...(repository
      ? {
          input_binding: {
            prompt_hash: promptHash,
            output_schema_hash: computeCanonicalHash(outputSchema),
            task_offer_hash: governedTask!.task_spec_hash,
            delegation_offer_hash: hash("delegation-offer"),
          },
          governed_task: governedTask,
          task_execution: taskExecution,
          repository_corpus: {
            manifest_hash: hash("manifest"),
            source_binding_hash: hash("source-binding"),
            workspace_lease_id: "workspace-1",
            workspace_lease_revision: 1,
            task_packet_hash: hash("packet"),
            launch_envelope_hash: hash("envelope"),
            path_mapping_hash: hash("path-mapping"),
            candidate_tree_hash: hash("candidate-tree"),
            patch_hash: hash("patch"),
          },
        }
      : {}),
  });
  return {
    authorization: decision.authorization,
    context,
    handle: {
      ...handle(),
      authorization_binding_digest: decision.authorization.binding_digest,
    },
    reservation: evidenceReservation(decision.authorization),
    declaration: evidenceDeclaration(decision.authorization),
  };
}

function seedRepositoryLifecycle(databasePath: string, status: "active" | "released"): void {
  const database = new Database(databasePath);
  try {
    database.pragma("foreign_keys = OFF");
    database
      .prepare(
        `INSERT INTO attempts(
          attemptId,runId,runRevision,workItemId,workItemRevision,packetId,packetHash,baseSha,
          revision,status,workspaceLeaseId,createdAt,updatedAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        "attempt-1",
        "run-1",
        0,
        "work-1",
        0,
        "packet-1",
        hash("packet"),
        "1".repeat(40),
        4,
        "running",
        "workspace-1",
        at(0),
        at(0)
      );
    database
      .prepare(
        `INSERT INTO workspace_leases(
          leaseId,runId,runRevision,workItemId,workItemRevision,packetId,packetHash,attemptId,
          revision,controllerId,controllerLeaseId,fencingToken,repositoryId,hostId,gitRuntime,
          projectRoot,branch,worktreePath,baseSha,status,acquiredAt,heartbeatAt,expiresAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        "workspace-1",
        "run-1",
        0,
        "work-1",
        0,
        "packet-1",
        hash("packet"),
        "attempt-1",
        status === "active" ? 1 : 2,
        "controller-1",
        "controller-lease-1",
        1,
        "synthetic-repository",
        "host-1",
        "git-1",
        "/srv/repository",
        "agent/attempt-1",
        "/srv/worktrees/attempt-1",
        "1".repeat(40),
        status,
        at(0),
        at(1),
        at(59)
      );
    database
      .prepare(
        `INSERT INTO launch_envelope_bindings(
          attemptId,runId,workspaceLeaseId,attemptRevision,workspaceLeaseRevision,
          authorizationMutationId,envelopeId,envelopeHash,envelopeJson,controllerId,
          controllerLeaseId,fencingToken,createdAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        "attempt-1",
        "run-1",
        "workspace-1",
        3,
        1,
        "launch-authorization-1",
        "envelope-1",
        hash("envelope"),
        "{}",
        "controller-1",
        "controller-lease-1",
        1,
        at(0)
      );
    database
      .prepare(
        `INSERT INTO task_packet_bindings(
          attemptId,runId,workItemId,workItemRevision,packetId,packetHash,packetJson,createdAt
        ) VALUES(?,?,?,?,?,?,?,?)`
      )
      .run("attempt-1", "run-1", "work-1", 0, "packet-1", hash("packet"), "{}", at(0));
  } finally {
    database.close();
  }
}
