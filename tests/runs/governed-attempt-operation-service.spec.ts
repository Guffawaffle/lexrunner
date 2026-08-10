import { describe, expect, it } from "vitest";

import {
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
  type AttemptExecutor,
  type AttemptExecutorEvent_v1,
  type AttemptExecutorHandle_v1,
  type ExecutorAttestation_v1,
  type GovernedAttemptResult_v1,
} from "../../src/runs/governed-attempt-executor.js";
import { GovernedAttemptOperationService } from "../../src/runs/governed-attempt-operation-service.js";
import { createGovernedAttemptVerificationContext } from "../../src/runs/governed-attempt-verification.js";
import {
  DelegationInvocationRequest_v1,
  computeDelegationOfferHash,
  createDelegationDecisionReceipt,
} from "../../src/runs/governed-attempt-protocol.js";
import {
  GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA,
  computeGovernedCodeReviewCorpusScopeHash,
  createGovernedCodeReviewTaskExecutionBinding,
  createGovernedCodeReviewTaskSpec,
} from "../../src/runs/governed-review-task-profile.js";
import { createGovernedTaskExecutionBinding } from "../../src/runs/governed-task.js";
import { contentHash } from "../../src/runs/governed-review-repository-corpus.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { InMemoryGovernedAttemptOperationStore } from "../../src/store/inmemory/governed-attempt-operation-store.js";
import type { GovernedAttemptEvidenceCapture } from "../../src/runs/governed-attempt-evidence.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T11:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("GovernedAttemptOperationService", () => {
  it("starts only after the accepted Delegation and exact authorization are bound", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const fixture = authorizationFixture();
    await acceptDelegation(store, fixture.authorization.grant);
    const executor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
    const service = new GovernedAttemptOperationService(store, () => at(5));
    const result = await service.start(executor, {
      operationMutationId: "operation-create",
      authorizationMutationId: "delegation-authorize",
      authorization: fixture.authorization,
      invocation: invocation(fixture.authorization),
      prompt: Buffer.from("synthetic prompt"),
      outputSchema: { type: "object" },
      now: at(3),
    });
    expect(result).toEqual({
      started: true,
      operationId: "operation-1",
      idempotentReplay: false,
    });
    expect(executor.startCount).toBe(1);
    await store.close();
  });

  it("waits on an event stream instead of polling and persists completion", async () => {
    const { store, service, executor } = await runningFixture();
    let settled = false;
    const observation = service.observeToTerminal(executor, "operation-1").then((value) => {
      settled = true;
      return value;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(executor.observeCount).toBe(1);

    executor.emit([event("started", 1), event("executor_event", 2), event("completed", 3)]);
    await expect(observation).resolves.toMatchObject({
      terminal: true,
      operationId: "operation-1",
      status: "completed",
      result: { task_outcome: "pass", admissibility: "admissible" },
    });
    expect(executor.collectCount).toBe(1);
    expect(executor.releaseCount).toBe(1);
    expect((await store.getAttemptOperation("operation-1"))?.result_hash).toMatch(/^sha256:/u);
    await store.close();
  });

  it("latches worker ACCEPT before releasing authorized work", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const fixture = authorizationFixture();
    await createOfferedDelegation(store, fixture.authorization.grant);
    const executor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
    const service = new GovernedAttemptOperationService(store, () => at(9));
    const started = await service.start(executor, {
      operationMutationId: "operation-create",
      authorizationMutationId: "delegation-offer-authorize",
      authorization: fixture.authorization,
      invocation: invocation(fixture.authorization, "offer"),
      prompt: Buffer.from("synthetic prompt"),
      outputSchema: { type: "object" },
      now: at(3),
    });
    expect(started).toMatchObject({ started: true });

    const observation = service.observeToTerminal(executor, "operation-1");
    executor.emit([
      event("started", 1),
      event("accepted", 2),
      event("executor_event", 3),
      event("completed", 4),
    ]);
    await expect(observation).resolves.toMatchObject({ terminal: true, status: "completed" });
    expect(executor.continueCount).toBe(1);
    expect((await store.getDelegation("delegation-1"))?.status).toBe("accepted");
    expect(
      (await store.listAttemptOperationEvents("operation-1")).map((entry) => entry.event.type)
    ).toEqual(["started", "accepted", "executor_event", "completed"]);
    await store.close();
  });

  it("releases accepted task work only after the generic grant and adapter evaluate", async () => {
    const permitted = await governedTaskOfferFixture();
    if (!permitted.started.started) throw new Error(permitted.started.reason);
    const permittedObservation = permitted.service.observeToTerminal(
      permitted.executor,
      "operation-1"
    );
    permitted.executor.emit([
      event("started", 1),
      event("accepted", 2),
      event("executor_event", 3),
      event("completed", 4),
    ]);
    await expect(permittedObservation).resolves.toMatchObject({
      terminal: true,
      status: "completed",
    });
    expect(permitted.executor.continueCount).toBe(1);
    await permitted.store.close();

    const blocked = await governedTaskOfferFixture({ invalidateQualification: true });
    if (!blocked.started.started) throw new Error(blocked.started.reason);
    const blockedObservation = blocked.service.observeToTerminal(blocked.executor, "operation-1");
    blocked.executor.emit([event("started", 1), event("accepted", 2), event("executor_event", 3)]);
    await expect(blockedObservation).resolves.toMatchObject({
      terminal: true,
      status: "cancelled",
    });
    expect(blocked.executor.continueCount).toBe(0);
    expect(blocked.executor.cancelCount).toBe(1);
    await blocked.store.close();

    const direct = await governedTaskOfferFixture({
      invalidateQualification: true,
      acceptedBeforeStart: true,
    });
    expect(direct.started).toEqual({ started: false, reason: "authorization_denied" });
    expect(direct.executor.startCount).toBe(0);
    await direct.store.close();

    const legacyExpansion = await governedTaskOfferFixture({ omitGrantCapabilities: true });
    expect(legacyExpansion.started).toEqual({ started: false, reason: "binding_mismatch" });
    expect(legacyExpansion.executor.startCount).toBe(0);
    await legacyExpansion.store.close();
  });

  it("replays an authorized continuation after a crash following durable ACCEPT", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const fixture = authorizationFixture();
    await createOfferedDelegation(store, fixture.authorization.grant);
    const firstExecutor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
    const service = new GovernedAttemptOperationService(store, () => at(9));
    const started = await service.start(firstExecutor, {
      operationMutationId: "operation-create",
      authorizationMutationId: "delegation-offer-authorize",
      authorization: fixture.authorization,
      invocation: invocation(fixture.authorization, "offer"),
      prompt: Buffer.from("synthetic prompt"),
      outputSchema: { type: "object" },
      now: at(3),
    });
    expect(started).toMatchObject({ started: true });

    const offer = (await store.getDelegation("delegation-1"))!.state.offer;
    await store.recordDelegationDecision({
      mutationId: "operation-1:accept:2",
      delegationId: "delegation-1",
      expectedRevision: 1,
      receipt: createDelegationDecisionReceipt({
        offer,
        decision: "ACCEPT",
        decisionReceiptId: "operation-1:accept:2",
        decidedAt: at(5),
      }),
      now: at(5),
    });
    await store.appendAttemptOperationEvent({
      mutationId: "operation-1:event:1",
      operationId: "operation-1",
      expectedRevision: 0,
      event: event("started", 1),
      now: at(4),
    });
    await store.appendAttemptOperationEvent({
      mutationId: "operation-1:event:2",
      operationId: "operation-1",
      expectedRevision: 1,
      event: event("accepted", 2),
      now: at(5),
    });

    const recoveredExecutor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
    const observation = service.observeToTerminal(recoveredExecutor, "operation-1");
    recoveredExecutor.emit([event("executor_event", 3), event("completed", 4)]);
    await expect(observation).resolves.toMatchObject({ terminal: true, status: "completed" });
    expect(recoveredExecutor.continueCount).toBe(1);
    expect(recoveredExecutor.observeCount).toBe(1);
    await store.close();
  });

  it("latches mid-run NO before cancellation and never consumes a later action", async () => {
    const { store, service, executor } = await runningFixture();
    const observation = service.observeToTerminal(executor, "operation-1");
    executor.emit([event("started", 1), event("declined", 2), event("completed", 3)]);
    await expect(observation).resolves.toEqual({
      terminal: true,
      operationId: "operation-1",
      status: "declined",
    });
    expect(executor.cancelCount).toBe(1);
    expect(executor.releaseCount).toBe(1);
    expect((await store.getDelegation("delegation-1"))?.status).toBe("declined");
    expect(
      (await store.listAttemptOperationEvents("operation-1")).map((entry) => entry.event.type)
    ).toEqual(["started", "declined"]);
    await store.close();
  });

  it("accepts NO as a complete refusal while the Delegation is still offered", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const fixture = authorizationFixture();
    await createOfferedDelegation(store, fixture.authorization.grant);
    const executor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
    const service = new GovernedAttemptOperationService(store, () => at(5));
    const started = await service.start(executor, {
      operationMutationId: "operation-create",
      authorizationMutationId: "delegation-offer-authorize",
      authorization: fixture.authorization,
      invocation: invocation(fixture.authorization, "offer"),
      prompt: Buffer.from("synthetic prompt"),
      outputSchema: { type: "object" },
      now: at(3),
    });
    expect(started).toMatchObject({ started: true });

    const observation = service.observeToTerminal(executor, "operation-1");
    executor.emit([event("started", 1), event("declined", 2), event("completed", 3)]);
    await expect(observation).resolves.toEqual({
      terminal: true,
      operationId: "operation-1",
      status: "declined",
    });
    expect((await store.getDelegation("delegation-1"))?.status).toBe("declined");
    expect(executor.continueCount).toBe(0);
    expect(executor.cancelCount).toBe(1);
    await store.close();
  });

  it("records a provider stream ending without a terminal event as lost", async () => {
    const { store, service, executor } = await runningFixture();
    const observation = service.observeToTerminal(executor, "operation-1");
    executor.emit([event("started", 1)]);
    await expect(observation).resolves.toEqual({
      terminal: true,
      operationId: "operation-1",
      status: "lost",
    });
    expect(executor.cancelCount).toBe(1);
    expect(executor.releaseCount).toBe(1);
    await store.close();
  });

  it("persists evidence reconstruction metadata without persisting the sink token", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const fixture = authorizationFixture();
    await acceptDelegation(store, fixture.authorization.grant);
    const executor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
    const service = new GovernedAttemptOperationService(store, () => at(5));
    const binding = evidenceBinding(fixture.authorization);
    const started = await service.start(executor, {
      operationMutationId: "operation-create",
      authorizationMutationId: "delegation-authorize",
      authorization: fixture.authorization,
      invocation: invocation(fixture.authorization),
      prompt: Buffer.from("synthetic prompt"),
      outputSchema: { type: "object" },
      evidence: binding.capture,
      evidenceReservation: binding.reservation,
      verificationContext: fixture.verificationContext,
      now: at(3),
    });
    expect(started).toMatchObject({ started: true });
    expect(executor.startEvidence).toBe(binding.capture);
    const persisted = await store.getAttemptOperation("operation-1");
    expect(persisted).toMatchObject({
      evidence_reservation: { capture_id: "capture-1" },
      evidence_declaration: { capture_id: "capture-1", status: "open" },
    });
    expect(JSON.stringify(persisted)).not.toContain("reservationToken");
    await store.close();
  });

  it("detaches an aborted observer without cancelling or falsely losing the provider", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const fixture = authorizationFixture();
    await acceptDelegation(store, fixture.authorization.grant);
    const executor = new AbortAwareExecutor(handle(fixture.authorization.binding_digest));
    const service = new GovernedAttemptOperationService(store, () => at(5));
    const started = await service.start(executor, {
      operationMutationId: "operation-create",
      authorizationMutationId: "delegation-authorize",
      authorization: fixture.authorization,
      invocation: invocation(fixture.authorization),
      prompt: Buffer.from("synthetic prompt"),
      outputSchema: { type: "object" },
      now: at(3),
    });
    if (!started.started) throw new Error(`failed to start abort fixture: ${started.reason}`);
    const controller = new AbortController();
    const observation = service.observeToTerminal(executor, "operation-1", controller.signal);
    controller.abort();
    await expect(observation).resolves.toEqual({
      terminal: false,
      operationId: "operation-1",
      reason: "observation_aborted",
    });
    expect(executor.cancelCount).toBe(0);
    expect((await store.getAttemptOperation("operation-1"))?.status).toBe("running");
    await store.close();
  });
});

class AbortAwareExecutor implements AttemptExecutor {
  cancelCount = 0;

  constructor(private readonly executorHandle: AttemptExecutorHandle_v1) {}

  inspect(): Promise<ExecutorAttestation_v1> {
    throw new Error("not used");
  }

  async start(): Promise<AttemptExecutorHandle_v1> {
    return structuredClone(this.executorHandle);
  }

  async *observe(
    _handle: AttemptExecutorHandle_v1,
    options?: { afterSequence?: number; signal?: AbortSignal }
  ): AsyncIterable<AttemptExecutorEvent_v1> {
    await new Promise<void>((resolve) => {
      if (options?.signal?.aborted) resolve();
      else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }

  collect(): Promise<GovernedAttemptResult_v1> {
    throw new Error("not used");
  }

  async release(): Promise<void> {}
}

class DeferredExecutor implements AttemptExecutor {
  startCount = 0;
  observeCount = 0;
  cancelCount = 0;
  collectCount = 0;
  releaseCount = 0;
  continueCount = 0;
  startEvidence?: GovernedAttemptEvidenceCapture;
  private resolveEvents!: (events: AttemptExecutorEvent_v1[]) => void;
  private readonly events = new Promise<AttemptExecutorEvent_v1[]>((resolve) => {
    this.resolveEvents = resolve;
  });

  constructor(private readonly executorHandle: AttemptExecutorHandle_v1) {}

  inspect(): Promise<ExecutorAttestation_v1> {
    throw new Error("not used in this service fixture");
  }

  async start(input: Parameters<AttemptExecutor["start"]>[0]): Promise<AttemptExecutorHandle_v1> {
    this.startCount += 1;
    this.startEvidence = input.evidence;
    return structuredClone(this.executorHandle);
  }

  async *observe(): AsyncIterable<AttemptExecutorEvent_v1> {
    this.observeCount += 1;
    for (const value of await this.events) yield structuredClone(value);
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }

  async continueAfterAcceptance(): Promise<void> {
    this.continueCount += 1;
  }

  async collect(): Promise<GovernedAttemptResult_v1> {
    this.collectCount += 1;
    return result(this.executorHandle.authorization_binding_digest);
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
  }

  emit(events: AttemptExecutorEvent_v1[]): void {
    this.resolveEvents(events);
  }
}

async function runningFixture() {
  const store = new InMemoryGovernedAttemptOperationStore();
  const fixture = authorizationFixture();
  await acceptDelegation(store, fixture.authorization.grant);
  const executor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
  const service = new GovernedAttemptOperationService(store, () => at(5));
  const started = await service.start(executor, {
    operationMutationId: "operation-create",
    authorizationMutationId: "delegation-authorize",
    authorization: fixture.authorization,
    invocation: invocation(fixture.authorization),
    prompt: Buffer.from("synthetic prompt"),
    outputSchema: { type: "object" },
    now: at(3),
  });
  if (!started.started) throw new Error(`failed to start fixture: ${started.reason}`);
  return { store, service, executor };
}

async function governedTaskOfferFixture(
  options: {
    invalidateQualification?: boolean;
    acceptedBeforeStart?: boolean;
    omitGrantCapabilities?: boolean;
  } = {}
) {
  const store = new InMemoryGovernedAttemptOperationStore();
  const fixture = authorizationFixture();
  const prompt = Buffer.from("synthetic prompt");
  const context = fixture.verificationContext;
  const task = createGovernedCodeReviewTaskSpec({
    attemptId: fixture.authorization.attempt_id,
    delegationId: fixture.authorization.delegation_id,
    objectiveHash: context.requirements.objective_hash,
    authorizedModelProvider: context.requirements.authorized_model_provider,
    promptHash: contentHash(prompt),
    corpusScopeHash: computeGovernedCodeReviewCorpusScopeHash({
      repositoryId: context.workspace.repository_id,
      baseObjectId: context.workspace.base_object_id,
      candidateObjectId: context.workspace.candidate_object_id,
      corpusHash: context.workspace.corpus_hash,
      selectionHash: context.workspace.selection_hash,
    }),
    maxDurationMs: context.requirements.max_duration_ms,
    maxOutputBytes: context.requirements.max_output_bytes,
  });
  let taskExecution = createGovernedCodeReviewTaskExecutionBinding({
    task,
    authorizedAt: at(1),
    expiresAt: at(10),
    executorAttestationHash: fixture.authorization.executor_attestation_hash,
    environmentAttestationHash: fixture.authorization.environment_attestation_hash,
    workspaceAttestationHash: fixture.authorization.workspace_attestation_hash,
  });
  if (options.invalidateQualification) {
    const { execution_binding_hash: _executionBindingHash, ...body } = taskExecution;
    taskExecution = createGovernedTaskExecutionBinding({
      ...body,
      adapter_resolution: {
        ...body.adapter_resolution,
        manifest: {
          ...body.adapter_resolution.manifest,
          authority: {
            ...body.adapter_resolution.manifest.authority,
            filesystem_read: "unsupported",
          },
        },
      },
    });
  }
  if (options.omitGrantCapabilities) {
    const { execution_binding_hash: _executionBindingHash, ...body } = taskExecution;
    const authorityGrant = { ...body.authority_grant, capabilities: [] };
    taskExecution = createGovernedTaskExecutionBinding({
      ...body,
      authority_grant: authorityGrant,
      authority_grant_hash: computeCanonicalHash(authorityGrant),
    });
  }
  const offer = {
    schema_version: "1.0.0" as const,
    delegation_id: fixture.authorization.delegation_id,
    attempt_id: fixture.authorization.attempt_id,
    worker: {
      provider_id: task.authorized_model_provider,
      worker_id: "worker-1",
      thread_id: "thread-1",
    },
    task_offer_hash: task.task_spec_hash,
    requirements_hash: computeCanonicalHash(context.requirements),
    authority_grant_hash: taskExecution.authority_grant_hash,
    transcript_start_hash: hash("transcript"),
    offered_at: at(0),
  };
  const created = await store.createDelegation({
    mutationId: "delegation-create",
    offer,
    now: at(0),
  });
  if (!created.created) throw new Error(`failed to create task Delegation: ${created.reason}`);
  if (options.acceptedBeforeStart) {
    const accepted = await store.recordDelegationDecision({
      mutationId: "delegation-accept",
      delegationId: offer.delegation_id,
      expectedRevision: created.record.revision,
      receipt: createDelegationDecisionReceipt({
        offer,
        decision: "ACCEPT",
        decisionReceiptId: "acceptance-1",
        decidedAt: at(1),
      }),
      now: at(1),
    });
    if (!accepted.recorded) {
      throw new Error(`failed to accept task Delegation: ${accepted.reason}`);
    }
  }
  const verificationContext = createGovernedAttemptVerificationContext({
    requirements: context.requirements,
    executor: context.executor,
    environment: context.environment,
    workspace: context.workspace,
    output_schema: GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA,
    input_binding: {
      prompt_hash: contentHash(prompt),
      output_schema_hash: computeCanonicalHash(GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA),
      task_offer_hash: task.task_spec_hash,
      delegation_offer_hash: computeDelegationOfferHash(offer),
    },
    governed_task: task,
    task_execution: taskExecution,
  });
  const evidence = evidenceBinding(fixture.authorization);
  const executor = new DeferredExecutor(handle(fixture.authorization.binding_digest));
  const service = new GovernedAttemptOperationService(store, () => at(9));
  const started = await service.start(executor, {
    operationMutationId: "operation-create",
    authorizationMutationId: "delegation-offer-authorize",
    authorization: fixture.authorization,
    invocation: DelegationInvocationRequest_v1.parse({
      schema_version: "1.0.0",
      delegation_id: offer.delegation_id,
      attempt_id: offer.attempt_id,
      offer_hash: computeDelegationOfferHash(offer),
      authority_grant_hash: offer.authority_grant_hash,
      worker_thread_id: offer.worker.thread_id,
      transcript_start_hash: offer.transcript_start_hash,
      provider_attestation_hash: fixture.authorization.executor_attestation_hash,
      environment_attestation_hash: fixture.authorization.environment_attestation_hash,
      workspace_attestation_hash: fixture.authorization.workspace_attestation_hash,
      phase: options.acceptedBeforeStart ? "authorized_work" : "offer",
    }),
    prompt,
    outputSchema: GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA,
    evidence: evidence.capture,
    evidenceReservation: evidence.reservation,
    verificationContext,
    now: at(3),
  });
  return { store, service, executor, started };
}

function authorizationFixture() {
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
  const observed = {
    observed_at: at(0),
    expires_at: at(20),
  };
  const decision = authorizeGovernedReview({
    authorizationId: "authorization-1",
    requirements,
    grant,
    executor: {
      schema_version: "1.0.0",
      executor_id: "synthetic-executor",
      executor_version: "1.0.0",
      executable_hash: hash("executor"),
      protocol: "synthetic",
      configuration_hash: hash("config"),
      tool_surface_hash: hash("tools"),
      ...observed,
    },
    environment: {
      schema_version: "1.0.0",
      provider_id: "synthetic-provider",
      environment_id: "environment-1",
      topology_hash: hash("topology"),
      controls: GovernedControlId.options.map((control) => ({
        control,
        status: "enforced" as const,
        strength: "independently_enforced_verified" as const,
        evidence_refs: [hash(`control:${control}`)],
        enforcement_owner: "synthetic-provider",
      })),
      ...observed,
    },
    workspace: {
      schema_version: "1.0.0",
      workspace_id: "workspace-1",
      repository_id: requirements.repository_id,
      base_object_id: requirements.base_object_id,
      candidate_object_id: requirements.candidate_object_id,
      corpus_hash: hash("corpus"),
      selection_hash: hash("selection"),
      corpus_kind: "synthetic",
      ...observed,
    },
    authorizedAt: at(1),
    expiresAt: at(10),
  });
  if (!decision.authorized) throw new Error(`authorization fixture failed: ${decision.reason}`);
  return {
    ...decision,
    verificationContext: createGovernedAttemptVerificationContext({
      requirements,
      executor: {
        schema_version: "1.0.0",
        executor_id: "synthetic-executor",
        executor_version: "1.0.0",
        executable_hash: hash("executor"),
        protocol: "synthetic",
        configuration_hash: hash("config"),
        tool_surface_hash: hash("tools"),
        ...observed,
      },
      environment: {
        schema_version: "1.0.0",
        provider_id: "synthetic-provider",
        environment_id: "environment-1",
        topology_hash: hash("topology"),
        controls: GovernedControlId.options.map((control) => ({
          control,
          status: "enforced" as const,
          strength: "independently_enforced_verified" as const,
          evidence_refs: [hash(`control:${control}`)],
          enforcement_owner: "synthetic-provider",
        })),
        ...observed,
      },
      workspace: {
        schema_version: "1.0.0",
        workspace_id: "workspace-1",
        repository_id: requirements.repository_id,
        base_object_id: requirements.base_object_id,
        candidate_object_id: requirements.candidate_object_id,
        corpus_hash: hash("corpus"),
        selection_hash: hash("selection"),
        corpus_kind: "synthetic",
        ...observed,
      },
      output_schema: { type: "object" },
    }),
  };
}

async function acceptDelegation(
  store: InMemoryGovernedAttemptOperationStore,
  grant: GovernedCapabilityGrant_v1
): Promise<void> {
  const offer = {
    schema_version: "1.0.0" as const,
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    worker: {
      provider_id: "synthetic-provider",
      worker_id: "worker-1",
      thread_id: "thread-1",
    },
    task_offer_hash: hash("task"),
    requirements_hash: hash("requirements"),
    authority_grant_hash: computeCanonicalHash(grant),
    transcript_start_hash: hash("transcript"),
    offered_at: at(0),
  };
  await store.createDelegation({ mutationId: "delegation-create", offer, now: at(0) });
  await store.recordDelegationDecision({
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
}

async function createOfferedDelegation(
  store: InMemoryGovernedAttemptOperationStore,
  grant: GovernedCapabilityGrant_v1
): Promise<void> {
  const offer = {
    schema_version: "1.0.0" as const,
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    worker: {
      provider_id: "synthetic-provider",
      worker_id: "worker-1",
      thread_id: "thread-1",
    },
    task_offer_hash: hash("task"),
    requirements_hash: hash("requirements"),
    authority_grant_hash: computeCanonicalHash(grant),
    transcript_start_hash: hash("transcript"),
    offered_at: at(0),
  };
  const created = await store.createDelegation({
    mutationId: "delegation-create",
    offer,
    now: at(0),
  });
  if (!created.created) throw new Error(`failed to create offered Delegation: ${created.reason}`);
}

function invocation(
  authorization: ReturnType<typeof authorizationFixture>["authorization"],
  phase: "offer" | "authorized_work" = "authorized_work"
) {
  return DelegationInvocationRequest_v1.parse({
    schema_version: "1.0.0",
    delegation_id: authorization.delegation_id,
    attempt_id: authorization.attempt_id,
    offer_hash: computeCanonicalHash({
      schema_version: "1.0.0",
      delegation_id: "delegation-1",
      attempt_id: "attempt-1",
      worker: {
        provider_id: "synthetic-provider",
        worker_id: "worker-1",
        thread_id: "thread-1",
      },
      task_offer_hash: hash("task"),
      requirements_hash: hash("requirements"),
      authority_grant_hash: computeCanonicalHash(authorization.grant),
      transcript_start_hash: hash("transcript"),
      offered_at: at(0),
    }),
    authority_grant_hash: computeCanonicalHash(authorization.grant),
    worker_thread_id: "thread-1",
    transcript_start_hash: hash("transcript"),
    provider_attestation_hash: authorization.executor_attestation_hash,
    environment_attestation_hash: authorization.environment_attestation_hash,
    workspace_attestation_hash: authorization.workspace_attestation_hash,
    phase,
  });
}

function handle(binding: string): AttemptExecutorHandle_v1 {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: binding,
    executor_id: "synthetic-executor",
    provider_handle: "provider-handle-1",
    started_at: at(3),
  };
}

function event(
  type: "started" | "accepted" | "executor_event" | "declined" | "completed",
  sequence: number
): AttemptExecutorEvent_v1 {
  const common = {
    schema_version: "1.0.0" as const,
    type,
    sequence,
    observed_at: at(3 + sequence),
    evidence_ref: hash(`${type}:${sequence}`),
  };
  if (type === "executor_event") return { ...common, type, executor_event_type: "item.completed" };
  if (type === "declined") return { ...common, type, reason_present: false };
  return common;
}

function result(binding: string): GovernedAttemptResult_v1 {
  return {
    schema_version: "1.0.0",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: binding,
    worker_outcome: "completed",
    task_outcome: "pass",
    authorization_outcome: "valid",
    evidence_outcome: "sufficient",
    admissibility: "admissible",
    evidence_refs: [hash("evidence")],
  };
}

function evidenceBinding(authorization: ReturnType<typeof authorizationFixture>["authorization"]) {
  const reservation = {
    capture_id: "capture-1",
    attempt_id: authorization.attempt_id,
    delegation_id: authorization.delegation_id,
    authorization_binding_digest: authorization.binding_digest,
    executor_binding_digest: authorization.executor_attestation_hash,
    environment_binding_digest: authorization.environment_attestation_hash,
    workspace_binding_digest: authorization.workspace_attestation_hash,
    reserved_bytes: 8 * 1_024 * 1_024,
    reserved_frames: 10,
    reserved_events: 10,
    max_duration_ms: 600_000,
    max_tool_calls: 100,
  };
  const reference = {
    schema_version: "1.0.0" as const,
    profile_id: "lexrunner.local-protected-evidence@1.0.0" as const,
    store_key: "pe:0123456789abcdef0123456789abcdef",
    capture_id: "capture-1",
    attempt_id: authorization.attempt_id,
    delegation_id: authorization.delegation_id,
    authorization_binding_digest: authorization.binding_digest,
    executor_binding_digest: authorization.executor_attestation_hash,
    environment_binding_digest: authorization.environment_attestation_hash,
    workspace_binding_digest: authorization.workspace_attestation_hash,
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
    retention_expires_at: "2026-08-12T11:00:00.000Z",
  };
  const capture: GovernedAttemptEvidenceCapture = {
    captureId: reference.capture_id,
    getReference: () => structuredClone(reference),
    append: async () => {
      throw new Error("not used");
    },
    sealAndVerify: async () => {
      throw new Error("not used");
    },
    markIncomplete: async () => {
      throw new Error("not used");
    },
  };
  return { reservation, capture };
}
