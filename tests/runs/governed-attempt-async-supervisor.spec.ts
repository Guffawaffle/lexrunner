import { describe, expect, it } from "vitest";

import { GovernedAttemptAsyncSupervisor } from "../../src/runs/governed-attempt-async-supervisor.js";
import type {
  AttemptExecutor,
  AttemptExecutorEvent_v1,
  AttemptExecutorHandle_v1,
  ExecutorAttestation_v1,
  GovernedAttemptResult_v1,
} from "../../src/runs/governed-attempt-executor.js";
import { createDelegationDecisionReceipt } from "../../src/runs/governed-attempt-protocol.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { InMemoryGovernedAttemptOperationStore } from "../../src/store/inmemory/governed-attempt-operation-store.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T14:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("GovernedAttemptAsyncSupervisor", () => {
  it("recovers once, then wakes on provider completion without polling", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    await acceptedDelegation(store);
    await store.createAttemptOperation({
      mutationId: "operation-create",
      handle: handle(),
      authorization: authorization(),
      now: at(2),
    });
    const executor = new DeferredExecutor();
    let resolveCount = 0;
    let noticeCount = 0;
    let wake!: (value: unknown) => void;
    const terminal = new Promise((resolve) => {
      wake = resolve;
    });
    const supervisor = new GovernedAttemptAsyncSupervisor(
      store,
      async (candidate) => {
        resolveCount += 1;
        return candidate.handle.provider_handle === "provider-1" ? executor : null;
      },
      {
        onNotice: (notice) => {
          noticeCount += 1;
          wake(notice);
        },
      }
    );

    await expect(supervisor.recover()).resolves.toEqual({
      attached: ["operation-1"],
      unavailable: [],
    });
    expect(resolveCount).toBe(1);
    expect(executor.observeCount).toBe(1);
    expect(noticeCount).toBe(0);
    await Promise.resolve();
    expect(resolveCount).toBe(1);

    executor.emit([event("started", 1), event("completed", 2)]);
    await expect(terminal).resolves.toMatchObject({
      operationId: "operation-1",
      result: { terminal: true, status: "completed" },
    });
    await supervisor.wait("operation-1");
    expect((await store.getAttemptOperation("operation-1"))?.status).toBe("completed");
    expect(executor.collectCount).toBe(1);
    expect(executor.releaseCount).toBe(1);
    expect(resolveCount).toBe(1);
    await store.close();
  });

  it("leaves an unavailable provider recoverable instead of declaring false loss", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    await acceptedDelegation(store);
    await store.createAttemptOperation({
      mutationId: "operation-create",
      handle: handle(),
      authorization: authorization(),
      now: at(2),
    });
    const notices: unknown[] = [];
    const supervisor = new GovernedAttemptAsyncSupervisor(store, async () => null, {
      onNotice: (notice) => {
        notices.push(notice);
      },
    });
    await expect(supervisor.recover()).resolves.toEqual({
      attached: [],
      unavailable: ["operation-1"],
    });
    expect(notices).toEqual([{ operationId: "operation-1", errorCode: "executor_unavailable" }]);
    expect((await store.getAttemptOperation("operation-1"))?.status).toBe("running");
    await store.close();
  });

  it("recovers a completed event whose result was not collected before restart", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    await acceptedDelegation(store);
    await store.createAttemptOperation({
      mutationId: "operation-create",
      handle: handle(),
      authorization: authorization(),
      now: at(2),
    });
    await store.appendAttemptOperationEvent({
      mutationId: "operation-1:event:1",
      operationId: "operation-1",
      expectedRevision: 0,
      event: event("completed", 1),
      now: at(3),
    });
    const executor = new DeferredExecutor();
    let notice!: (value: unknown) => void;
    const terminal = new Promise((resolve) => {
      notice = resolve;
    });
    const supervisor = new GovernedAttemptAsyncSupervisor(store, async () => executor, {
      onNotice: notice,
    });
    await expect(supervisor.recover()).resolves.toEqual({
      attached: ["operation-1"],
      unavailable: [],
    });
    await expect(terminal).resolves.toMatchObject({
      result: { terminal: true, status: "completed", result: { task_outcome: "pass" } },
    });
    expect(executor.observeCount).toBe(0);
    expect(executor.collectCount).toBe(1);
    expect(executor.releaseCount).toBe(1);
    expect((await store.getAttemptOperation("operation-1"))?.result).toBeDefined();
    await store.close();
  });
});

class DeferredExecutor implements AttemptExecutor {
  observeCount = 0;
  collectCount = 0;
  releaseCount = 0;
  private releaseEvents!: (events: AttemptExecutorEvent_v1[]) => void;
  private readonly events = new Promise<AttemptExecutorEvent_v1[]>((resolve) => {
    this.releaseEvents = resolve;
  });

  inspect(): Promise<ExecutorAttestation_v1> {
    throw new Error("not used");
  }

  async start(): Promise<AttemptExecutorHandle_v1> {
    return handle();
  }

  async *observe(): AsyncIterable<AttemptExecutorEvent_v1> {
    this.observeCount += 1;
    for (const event of await this.events) yield event;
  }

  async cancel(): Promise<void> {}

  async collect(): Promise<GovernedAttemptResult_v1> {
    this.collectCount += 1;
    return {
      schema_version: "1.0.0",
      attempt_id: "attempt-1",
      delegation_id: "delegation-1",
      authorization_binding_digest: authorization().binding_digest,
      worker_outcome: "completed",
      task_outcome: "pass",
      authorization_outcome: "valid",
      evidence_outcome: "sufficient",
      admissibility: "admissible",
      evidence_refs: [hash("evidence")],
    };
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
  }

  emit(events: AttemptExecutorEvent_v1[]): void {
    this.releaseEvents(events);
  }
}

async function acceptedDelegation(store: InMemoryGovernedAttemptOperationStore): Promise<void> {
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
    authority_grant_hash: hash("grant"),
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

function handle(): AttemptExecutorHandle_v1 {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: authorization().binding_digest,
    executor_id: "synthetic-executor",
    provider_handle: "provider-1",
    started_at: at(2),
  };
}

function event(type: "started" | "completed", sequence: number): AttemptExecutorEvent_v1 {
  return {
    schema_version: "1.0.0",
    type,
    sequence,
    observed_at: at(2 + sequence),
    evidence_ref: hash(`${type}:${sequence}`),
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
