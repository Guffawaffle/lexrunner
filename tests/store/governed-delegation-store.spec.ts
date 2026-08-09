import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DelegationInvocationRequest_v1,
  DelegationOffer_v1,
  createDelegationDecisionReceipt,
  createDelegationProtocolState,
} from "../../src/runs/governed-attempt-protocol.js";
import type { GovernedDelegationStore } from "../../src/store/governed-delegation-store.js";
import { InMemoryGovernedDelegationStore } from "../../src/store/inmemory/governed-delegation-store.js";
import { SqliteGovernedDelegationStore } from "../../src/store/sqlite/governed-delegation-store.js";

const HASH = {
  task: `sha256:${"1".repeat(64)}`,
  requirements: `sha256:${"2".repeat(64)}`,
  grant: `sha256:${"3".repeat(64)}`,
  transcript: `sha256:${"4".repeat(64)}`,
  provider: `sha256:${"5".repeat(64)}`,
  environment: `sha256:${"6".repeat(64)}`,
  workspace: `sha256:${"7".repeat(64)}`,
} as const;

interface CloseableDelegationStore extends GovernedDelegationStore {
  close(): Promise<void>;
}

describe.each([
  {
    name: "in-memory",
    create: (_databasePath: string): CloseableDelegationStore =>
      new InMemoryGovernedDelegationStore(),
  },
  {
    name: "SQLite",
    create: (databasePath: string): CloseableDelegationStore =>
      new SqliteGovernedDelegationStore(databasePath),
  },
])("governed Delegation store: $name", ({ create }) => {
  let directory: string;
  let databasePath: string;
  let store: CloseableDelegationStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-governed-delegation-"));
    databasePath = join(directory, "coordination.db");
    store = create(databasePath);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("persists bare NO as a successful terminal result and denies invocation", async () => {
    const created = await createOffer(store);
    if (!created.created) throw new Error("expected offer creation");
    const receipt = decisionReceipt("NO", "decision-no");
    const decision = await store.recordDelegationDecision({
      mutationId: "mutation-decision-no",
      delegationId: "delegation-1",
      expectedRevision: 0,
      receipt,
      now: "2026-08-09T08:00:01Z",
    });
    expect(decision).toMatchObject({
      recorded: true,
      record: {
        revision: 1,
        status: "declined",
        decline_reason_present: false,
      },
      event: { type: "delegation_declined", decline_reason_present: false },
    });
    if (!decision.recorded) throw new Error("expected refusal to record");
    expect(decision.record.state.decline).not.toHaveProperty("reason");

    const authorization = await store.authorizeDelegationInvocation({
      mutationId: "mutation-authorize-after-no",
      delegationId: "delegation-1",
      expectedRevision: 1,
      request: invocation(),
      now: "2026-08-09T08:00:02Z",
    });
    expect(authorization).toMatchObject({
      authorized: false,
      reason: "delegation_declined",
      event: { type: "delegation_invocation_denied" },
    });
    expect((await store.listDelegationEvents("delegation-1")).map((event) => event.type)).toEqual([
      "delegation_offered",
      "delegation_declined",
      "delegation_invocation_denied",
    ]);
  });

  it("authorizes an exact accepted binding and records tampering as denied", async () => {
    await createOffer(store);
    const accepted = await store.recordDelegationDecision({
      mutationId: "mutation-accept",
      delegationId: "delegation-1",
      expectedRevision: 0,
      receipt: decisionReceipt("ACCEPT", "decision-accept"),
      now: "2026-08-09T08:00:01Z",
    });
    if (!accepted.recorded) throw new Error("expected acceptance");
    const authorized = await store.authorizeDelegationInvocation({
      mutationId: "mutation-authorize",
      delegationId: "delegation-1",
      expectedRevision: 1,
      request: invocation(),
      now: "2026-08-09T08:00:02Z",
    });
    expect(authorized).toMatchObject({
      authorized: true,
      event: { type: "delegation_invocation_authorized" },
    });

    const denied = await store.authorizeDelegationInvocation({
      mutationId: "mutation-authorize-altered",
      delegationId: "delegation-1",
      expectedRevision: 1,
      request: DelegationInvocationRequest_v1.parse({
        ...invocation(),
        worker_thread_id: "altered-thread",
      }),
      now: "2026-08-09T08:00:03Z",
    });
    expect(denied).toMatchObject({
      authorized: false,
      reason: "binding_mismatch",
      event: { type: "delegation_invocation_denied", denial_reason: "binding_mismatch" },
    });
  });

  it("latches mid-run refusal after acceptance and blocks every later resume", async () => {
    await createOffer(store);
    const accepted = await store.recordDelegationDecision({
      mutationId: "mutation-accept",
      delegationId: "delegation-1",
      expectedRevision: 0,
      receipt: decisionReceipt("ACCEPT", "decision-accept"),
      now: "2026-08-09T08:00:01Z",
    });
    if (!accepted.recorded) throw new Error("expected acceptance");
    const declined = await store.recordDelegationDecision({
      mutationId: "mutation-midrun-no",
      delegationId: "delegation-1",
      expectedRevision: 1,
      receipt: decisionReceipt(
        { decision: "NO", reason: "I am stopping this Delegation." },
        "decision-midrun"
      ),
      now: "2026-08-09T08:00:02Z",
    });
    expect(declined).toMatchObject({
      recorded: true,
      record: {
        revision: 2,
        status: "declined",
        decline_reason_present: true,
      },
    });
    if (!declined.recorded) throw new Error("expected mid-run refusal");
    expect(JSON.stringify(declined.record)).not.toContain("I am stopping");

    expect(
      await store.authorizeDelegationInvocation({
        mutationId: "mutation-resume-after-no",
        delegationId: "delegation-1",
        expectedRevision: 2,
        request: DelegationInvocationRequest_v1.parse({ ...invocation(), phase: "resume" }),
        now: "2026-08-09T08:00:03Z",
      })
    ).toMatchObject({ authorized: false, reason: "delegation_declined" });
  });

  it("supports exact mutation replay and rejects mutation identity reuse", async () => {
    const first = await createOffer(store);
    const replay = await createOffer(store);
    expect(first).toMatchObject({ created: true, idempotentReplay: false });
    expect(replay).toMatchObject({ created: true, idempotentReplay: true });

    const collision = await store.createDelegation({
      mutationId: "mutation-offer",
      offer: offer({ task_offer_hash: HASH.provider }),
      now: "2026-08-09T08:00:00Z",
    });
    expect(collision).toEqual({ created: false, reason: "mutation_conflict" });
  });

  it("serializes competing decisions so only one can change the Delegation", async () => {
    await createOffer(store);
    const [accept, decline] = await Promise.all([
      store.recordDelegationDecision({
        mutationId: "mutation-race-accept",
        delegationId: "delegation-1",
        expectedRevision: 0,
        receipt: decisionReceipt("ACCEPT", "decision-race-accept"),
        now: "2026-08-09T08:00:01Z",
      }),
      store.recordDelegationDecision({
        mutationId: "mutation-race-decline",
        delegationId: "delegation-1",
        expectedRevision: 0,
        receipt: decisionReceipt("NO", "decision-race-decline"),
        now: "2026-08-09T08:00:01Z",
      }),
    ]);
    expect([accept, decline].filter((result) => result.recorded)).toHaveLength(1);
    expect([accept, decline].filter((result) => !result.recorded)).toEqual([
      { recorded: false, reason: "stale_revision" },
    ]);
  });
});

describe("SQLite governed Delegation privacy", () => {
  it("never writes volunteered refusal text into the coordination database", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-governed-delegation-privacy-"));
    const databasePath = join(directory, "coordination.db");
    const store = new SqliteGovernedDelegationStore(databasePath);
    const canary = "VOLUNTEERED-REFUSAL-REASON-MUST-NOT-BE-IN-SQLITE";
    try {
      await createOffer(store);
      const result = await store.recordDelegationDecision({
        mutationId: "mutation-private-reason",
        delegationId: "delegation-1",
        expectedRevision: 0,
        receipt: decisionReceipt({ decision: "NO", reason: canary }, "decision-private"),
        now: "2026-08-09T08:00:01Z",
      });
      expect(result).toMatchObject({ recorded: true });
    } finally {
      await store.close();
    }
    try {
      const bytes = await fs.readFile(databasePath);
      expect(bytes.includes(Buffer.from(canary, "utf8"))).toBe(false);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

function offer(overrides: Record<string, unknown> = {}) {
  return DelegationOffer_v1.parse({
    schema_version: "1.0.0",
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    worker: {
      provider_id: "synthetic-provider",
      worker_id: "worker-1",
      thread_id: "thread-1",
    },
    task_offer_hash: HASH.task,
    requirements_hash: HASH.requirements,
    authority_grant_hash: HASH.grant,
    transcript_start_hash: HASH.transcript,
    offered_at: "2026-08-09T08:00:00Z",
    ...overrides,
  });
}

async function createOffer(store: GovernedDelegationStore) {
  return store.createDelegation({
    mutationId: "mutation-offer",
    offer: offer(),
    now: "2026-08-09T08:00:00Z",
  });
}

function decisionReceipt(decision: unknown, id: string) {
  return createDelegationDecisionReceipt({
    offer: offer(),
    decision,
    decisionReceiptId: id,
    decidedAt: "2026-08-09T08:00:01Z",
  });
}

function invocation() {
  return DelegationInvocationRequest_v1.parse({
    schema_version: "1.0.0",
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    offer_hash: createDelegationProtocolState(offer()).offer_hash,
    authority_grant_hash: HASH.grant,
    worker_thread_id: "thread-1",
    transcript_start_hash: HASH.transcript,
    provider_attestation_hash: HASH.provider,
    environment_attestation_hash: HASH.environment,
    workspace_attestation_hash: HASH.workspace,
    phase: "authorized_work",
  });
}
