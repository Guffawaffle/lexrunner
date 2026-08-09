import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGovernedAttemptOperationHandlers } from "../../src/runs/governed-attempt-operation-adapters.js";
import { GovernedControlId } from "../../src/runs/governed-attempt-executor.js";
import { createDelegationDecisionReceipt } from "../../src/runs/governed-attempt-protocol.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { SqliteGovernedAttemptOperationStore } from "../../src/store/sqlite/governed-attempt-operation-store.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T17:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("governed review operation status handlers", () => {
  let root: string;
  let databasePath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lexrunner-review-status-"));
    databasePath = path.join(root, "coordination.db");
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("returns bounded coordination status for result-pending completion", async () => {
    const store = new SqliteGovernedAttemptOperationStore(databasePath);
    await acceptedDelegation(store);
    const boundAuthorization = authorization();
    await store.createAttemptOperation({
      mutationId: "operation-create",
      handle: handle(boundAuthorization.binding_digest),
      authorization: boundAuthorization,
      now: at(2),
    });
    await store.appendAttemptOperationEvent({
      mutationId: "operation-1:event:1",
      operationId: "operation-1",
      expectedRevision: 0,
      event: {
        schema_version: "1.0.0",
        type: "completed",
        sequence: 1,
        observed_at: at(3),
        evidence_ref: hash("completed"),
      },
      now: at(3),
    });
    await store.close();

    const status = await createGovernedAttemptOperationHandlers().status({
      databasePath,
      operationId: "operation-1",
    });
    expect(status).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.review.status",
        found: true,
        operationId: "operation-1",
        status: "completed",
        terminal: true,
        resultPending: true,
        eventCount: 1,
        executor: { executorId: "synthetic-executor", providerHandle: "provider-1" },
      },
    });
    expect(JSON.stringify(status)).not.toContain("authorization_id");
    expect(JSON.stringify(status)).not.toContain("reservationToken");
  });

  it("distinguishes an unknown operation from an input failure", async () => {
    const store = new SqliteGovernedAttemptOperationStore(databasePath);
    await store.close();
    const handlers = createGovernedAttemptOperationHandlers();
    await expect(
      handlers.status({ databasePath, operationId: "missing-operation" })
    ).resolves.toEqual({
      ok: true,
      result: {
        operation: "agent-work.review.status",
        found: false,
        operationId: "missing-operation",
      },
    });
    await expect(
      handlers.status({ databasePath: "relative.db", operationId: "x" })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

async function acceptedDelegation(store: SqliteGovernedAttemptOperationStore): Promise<void> {
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
    authority_grant_hash: computeCanonicalHash(authorization().grant),
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

function handle(binding: string) {
  return {
    schema_version: "1.0.0" as const,
    operation_id: "operation-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    authorization_binding_digest: binding,
    executor_id: "synthetic-executor",
    provider_handle: "provider-1",
    started_at: at(2),
  };
}

function authorization() {
  const controls = GovernedControlId.options.map((control) => ({
    control,
    minimum_strength: "host_enforced_indirect" as const,
  }));
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
    expires_at: at(50),
  };
  return { ...body, binding_digest: computeCanonicalHash(body) };
}
