import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGovernedDelegationHandlers } from "../../src/runs/governed-delegation-adapters.js";

describe("governed Delegation synthetic handlers", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-governed-delegation-handler-"));
    databasePath = join(directory, "coordination.db");
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("runs bare NO end to end as a successful terminal protocol result", async () => {
    const handlers = createGovernedDelegationHandlers({
      now: () => "2026-08-09T08:00:00Z",
    });
    const result = await handlers.synthetic({
      databasePath,
      delegationId: "synthetic-no",
      decision: "NO",
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.delegation.synthetic",
        syntheticOnly: true,
        completed: true,
        delegationId: "synthetic-no",
        status: "declined",
        decision: "decline",
        terminal: true,
        reasonVolunteered: false,
        executorInvocation: {
          attempted: false,
          authorized: false,
          denialReason: "delegation_declined",
        },
        eventCount: 3,
      },
    });
  });

  it("proves ACCEPT authorization without launching an executor", async () => {
    const handlers = createGovernedDelegationHandlers({
      now: () => "2026-08-09T08:00:00Z",
    });
    const result = await handlers.synthetic({
      databasePath,
      delegationId: "synthetic-accept",
      attemptId: "synthetic-attempt-accept",
      decision: "ACCEPT",
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        completed: true,
        status: "accepted",
        decision: "accept",
        terminal: false,
        executorInvocation: { attempted: false, authorized: true },
        evidence: {
          offerHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          decisionReceiptHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          authorizationBindingHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        },
      },
    });
  });

  it("acknowledges but never persists or returns a volunteered reason", async () => {
    const canary = "PRIVATE-VOLUNTEERED-REASON-FOR-PROTECTED-EVIDENCE-ONLY";
    const handlers = createGovernedDelegationHandlers({
      now: () => "2026-08-09T08:00:00Z",
    });
    const result = await handlers.synthetic({
      databasePath,
      delegationId: "synthetic-private-reason",
      decision: "NO",
      reason: canary,
    });
    expect(result).toMatchObject({
      ok: true,
      result: { completed: true, reasonVolunteered: true },
    });
    expect(JSON.stringify(result)).not.toContain(canary);

    const status = await handlers.status({
      databasePath,
      delegationId: "synthetic-private-reason",
    });
    expect(status).toMatchObject({
      ok: true,
      result: {
        record: { status: "declined", decline_reason_present: true },
      },
    });
    expect(JSON.stringify(status)).not.toContain(canary);
    expect((await fs.readFile(databasePath)).includes(Buffer.from(canary, "utf8"))).toBe(false);
  });

  it("is idempotent for an exact rerun and rejects a changed decision", async () => {
    const handlers = createGovernedDelegationHandlers({
      now: () => "2026-08-09T08:00:00Z",
    });
    const input = { databasePath, delegationId: "synthetic-replay", decision: "NO" };
    expect(await handlers.synthetic(input)).toMatchObject({
      ok: true,
      result: { completed: true, status: "declined", eventCount: 3 },
    });
    expect(await handlers.synthetic(input)).toMatchObject({
      ok: true,
      result: { completed: true, status: "declined", eventCount: 3 },
    });
    expect(await handlers.synthetic({ ...input, decision: "ACCEPT" })).toMatchObject({
      ok: true,
      result: { completed: false, reason: "mutation_conflict" },
    });
  });

  it("rejects malformed decisions and reasons as input errors", async () => {
    const handlers = createGovernedDelegationHandlers();
    expect(
      await handlers.synthetic({ databasePath, delegationId: "bad", decision: "MAYBE" })
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await handlers.synthetic({
        databasePath,
        delegationId: "bad-accept-reason",
        decision: "ACCEPT",
        reason: "not valid on acceptance",
      })
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
