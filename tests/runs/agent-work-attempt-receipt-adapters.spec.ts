import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3-multiple-ciphers";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  createNativeWslProjectionRequest,
  nativeWslProjectionId,
} from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { createAttemptLifecycleHandlers } from "../../src/runs/agent-work-adapters.js";
import { createAttemptReceiptHandlers } from "../../src/runs/agent-work-attempt-receipt-adapters.js";
import { createAttemptVerificationHandlers } from "../../src/runs/agent-work-attempt-verification-adapters.js";
import { LocalAttemptVerificationRuntime } from "../../src/runs/agent-work-attempt-verification-runtime.js";
import type {
  AttemptVerificationRuntime,
  VerificationCommandResult,
  VerificationWorkspaceObservation,
} from "../../src/runs/agent-work-attempt-verification-runtime.js";
import { createNativeWslProjectionLifecycleHandlers } from "../../src/runs/agent-work-projection-lifecycle.js";
import { createAttemptWorkerHandlers } from "../../src/runs/agent-work-worker-adapters.js";
import { SqliteWorkspaceLifecycleStore } from "../../src/store/sqlite/workspace-lifecycle-store.js";

const roots: string[] = [];
const STFC_REMOTE_URL = "https://example.invalid/Guffawaffle/stfc-mod.git";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Attempt receipt adapter handlers", () => {
  it("persists a patch-only claim after a real assisted lifecycle and replays it", async () => {
    const root = await sandbox();
    const prepared = await prepare(root);
    const workerHandlers = createAttemptWorkerHandlers();
    const attached = await workerHandlers.attach(attachRequest(prepared));
    if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");

    await writeFile(
      join(prepared.request.attempt.workspace.worktreePath, "project", "result.txt"),
      "uncommitted result\n",
      "utf8"
    );
    const ended = await workerHandlers.end(endRequest(prepared, attached.result));
    if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");

    const handlers = createAttemptReceiptHandlers();
    const request = submitRequest(prepared, ended.result);
    const rejectedRequest = structuredClone(request);
    rejectedRequest.submission.expectedAttemptRevision += 1;
    rejectedRequest.submission.mutation.mutationId = "submit-receipt-stale";
    const rejected = await handlers.submit(rejectedRequest);
    const submitted = await handlers.submit(request);
    const exactReplay = await handlers.submit(request);
    const hashReplayRequest = structuredClone(request);
    hashReplayRequest.submission.mutation.mutationId = "submit-receipt-hash-replay";
    const hashReplay = await handlers.submit(hashReplayRequest);

    expect(rejected).toMatchObject({
      ok: true,
      result: {
        submitted: false,
        reason: "stale_attempt_revision",
        currentAttemptRevision: 4,
      },
    });
    expect(JSON.stringify(rejected)).not.toContain("receiptJson");
    expect(submitted).toMatchObject({
      ok: true,
      result: {
        submitted: true,
        idempotentReplay: false,
        receiptId: "receipt-patch-only",
        receiptHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        attemptId: "attempt-receipt",
        outcome: "completed",
        disposition: "verification_pending",
        attemptRevision: 5,
        attemptStatus: "receipt_submitted",
        event: { type: "attempt_receipt_submitted", sequence: 1 },
      },
    });
    if (!submitted.ok || !submitted.result.submitted)
      throw new Error("expected receipt submission");
    expect(submitted.result).not.toHaveProperty("receipt");
    expect(submitted.result).not.toHaveProperty("attempt");
    expect(JSON.stringify(submitted.result)).not.toContain("receiptJson");
    expect(JSON.stringify(submitted.result)).not.toContain("Worker claims an uncommitted result");
    expect(exactReplay).toMatchObject({
      ok: true,
      result: {
        submitted: true,
        receiptId: "receipt-patch-only",
        attemptRevision: 5,
        attemptStatus: "receipt_submitted",
        event: { type: "attempt_receipt_submitted", sequence: 1 },
        idempotentReplay: true,
      },
    });
    expect(hashReplay).toMatchObject({
      ok: true,
      result: {
        submitted: true,
        receiptId: "receipt-patch-only",
        event: { type: "attempt_receipt_replayed", sequence: 2 },
        idempotentReplay: true,
      },
    });
    expect(JSON.stringify(exactReplay)).not.toContain("receiptJson");
    expect(JSON.stringify(hashReplay)).not.toContain("receiptJson");

    const before = await readFile(prepared.request.runtime.databasePath);
    const status = await handlers.status({
      databasePath: prepared.request.runtime.databasePath,
      runId: "run-receipt",
      attemptId: "attempt-receipt",
    });
    const after = await readFile(prepared.request.runtime.databasePath);
    expect(status).toMatchObject({
      ok: true,
      result: {
        receipt: {
          receiptId: "receipt-patch-only",
          schemaVersion: "2.0.0",
          disposition: "verification_pending",
          outcome: "completed",
          patchHash: `sha256:${"c".repeat(64)}`,
          summary: "Worker claims an uncommitted result without engine verification.",
          counts: { filesTouched: 1, commits: 0, claimedChecks: 1, blockers: 0 },
        },
      },
    });
    expect(after).toEqual(before);
  });

  it("returns the same compact acknowledgement for retained late evidence", async () => {
    const root = await sandbox();
    const prepared = await prepare(root);
    const workerHandlers = createAttemptWorkerHandlers();
    const attached = await workerHandlers.attach(attachRequest(prepared));
    if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
    const ended = await workerHandlers.end(endRequest(prepared, attached.result, "failed"));
    if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");

    const submitted = await createAttemptReceiptHandlers().submit(
      submitRequest(prepared, ended.result, "failed")
    );

    expect(submitted).toMatchObject({
      ok: true,
      result: {
        submitted: true,
        receiptId: "receipt-patch-only",
        receiptHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        attemptId: "attempt-receipt",
        outcome: "failed",
        disposition: "retained_late",
        attemptRevision: 5,
        attemptStatus: "failed",
        event: { type: "attempt_receipt_retained_late", sequence: 1 },
        idempotentReplay: false,
      },
    });
    expect(JSON.stringify(submitted)).not.toContain("receiptJson");
    expect(JSON.stringify(submitted)).not.toContain("Worker claims failed evidence");
  });

  it("verifies and accepts a real patch-only Attempt through the public application surface", async () => {
    const root = await sandbox();
    const prepared = await prepare(root);
    const workerHandlers = createAttemptWorkerHandlers();
    const attached = await workerHandlers.attach(attachRequest(prepared));
    if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
    await writeFile(
      join(prepared.request.attempt.workspace.worktreePath, "project", "result.txt"),
      "engine-observed result\n",
      "utf8"
    );
    const ended = await workerHandlers.end(endRequest(prepared, attached.result));
    if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");

    const receiptRequest = submitRequest(prepared, ended.result);
    const store = new SqliteWorkspaceLifecycleStore(prepared.request.runtime.databasePath, {
      readOnly: true,
    });
    try {
      const lease = await store.getWorkspaceLease(ended.result.workerSession.workspaceLeaseId);
      if (!lease) throw new Error("expected durable workspace lease");
      const observation = await new LocalAttemptVerificationRuntime().observe({
        lease,
        receipt: receiptRequest.submission.receipt,
      });
      receiptRequest.submission.receipt.patch_hash = observation.patchHash;
    } finally {
      await store.close();
    }
    const receipt = await createAttemptReceiptHandlers().submit(receiptRequest);
    if (!receipt.ok || !receipt.result.submitted) throw new Error("expected submitted receipt");

    const clock = times(
      "2026-07-12T12:00:13.000Z",
      "2026-07-12T12:00:14.000Z",
      "2026-07-12T12:00:15.000Z"
    );
    const handlers = createAttemptVerificationHandlers({ now: clock });
    const verification = await handlers.run({
      databasePath: prepared.request.runtime.databasePath,
      verification: {
        runId: receiptRequest.submission.runId,
        expectedRunRevision: receiptRequest.submission.expectedRunRevision,
        controller: receiptRequest.submission.controller,
        verificationId: "verification-patch-only",
        attemptId: receiptRequest.submission.attemptId,
        expectedAttemptRevision: receipt.result.attemptRevision,
        workspaceLeaseId: receiptRequest.submission.workspaceLeaseId,
        expectedWorkspaceLeaseRevision: receiptRequest.submission.expectedWorkspaceLeaseRevision,
        workerSessionId: receiptRequest.submission.workerSessionId,
        expectedWorkerSessionRevision: receiptRequest.submission.expectedWorkerSessionRevision,
        receiptId: receipt.result.receiptId,
        receiptHash: receipt.result.receiptHash,
        beginMutationId: "begin-public-verification",
        completeMutationId: "complete-public-verification",
      },
    });
    expect(verification).toMatchObject({
      ok: true,
      result: {
        recorded: true,
        outcome: "pass",
        attemptRevision: 7,
        attemptStatus: "verified",
        trustGapCount: 0,
        checkCounts: { pass: 1 },
      },
    });
    if (!verification.ok || !verification.result.recorded) {
      throw new Error("expected recorded verification");
    }

    await expect(
      handlers.status({
        databasePath: prepared.request.runtime.databasePath,
        runId: receiptRequest.submission.runId,
        attemptId: receiptRequest.submission.attemptId,
      })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        verification: {
          outcome: "pass",
          trustGapCount: 0,
          checkCounts: { pass: 1 },
        },
      },
    });
    const diagnostic = await handlers.status({
      databasePath: prepared.request.runtime.databasePath,
      runId: receiptRequest.submission.runId,
      attemptId: receiptRequest.submission.attemptId,
      diagnostics: true,
    });
    expect(diagnostic).toMatchObject({
      ok: true,
      result: { verification: { diagnostics: { checks: [{ id: "test", outcome: "pass" }] } } },
    });

    const accepted = await handlers.applyAcceptance({
      databasePath: prepared.request.runtime.databasePath,
      acceptance: {
        runId: receiptRequest.submission.runId,
        expectedRunRevision: receiptRequest.submission.expectedRunRevision,
        controller: receiptRequest.submission.controller,
        verificationId: verification.result.verificationId,
        verificationHash: verification.result.verificationHash,
        attemptId: receiptRequest.submission.attemptId,
        expectedAttemptRevision: verification.result.attemptRevision,
        workspaceLeaseId: receiptRequest.submission.workspaceLeaseId,
        expectedWorkspaceLeaseRevision: receiptRequest.submission.expectedWorkspaceLeaseRevision,
        workerSessionId: receiptRequest.submission.workerSessionId,
        expectedWorkerSessionRevision: receiptRequest.submission.expectedWorkerSessionRevision,
        receiptId: receipt.result.receiptId,
        receiptHash: receipt.result.receiptHash,
        mutationId: "accept-public-verification",
      },
    });
    expect(accepted).toMatchObject({
      ok: true,
      result: {
        applied: true,
        decision: "accepted",
        attemptRevision: 8,
        policyId: "lexrunner.strict-pass",
        reasonCodes: [],
      },
    });
    await expect(
      handlers.acceptanceStatus({
        databasePath: prepared.request.runtime.databasePath,
        runId: receiptRequest.submission.runId,
        attemptId: receiptRequest.submission.attemptId,
      })
    ).resolves.toMatchObject({
      ok: true,
      result: { acceptance: { decision: "accepted", attemptRevision: 8 } },
    });
  });

  it("carries a moved dirty Windows source through projection to fan-in-ready evidence", async () => {
    const root = await sandbox();
    const prepared = await prepareProjected(root);

    expect(prepared.sourceHead).not.toBe(prepared.request.identity.baseSha);
    expect(
      (await execa("git", ["status", "--porcelain=v1"], { cwd: prepared.sourceRoot })).stdout
    ).toContain("source-dirty.txt");
    expect(
      (
        await execa("git", ["rev-parse", "HEAD"], {
          cwd: prepared.request.runtime.repositoryRoot,
        })
      ).stdout.trim()
    ).toBe(prepared.request.identity.baseSha);
    expect(prepared.bundle.packet.repository.base_sha).toBe(prepared.request.identity.baseSha);
    expect(prepared.bundle.envelope.expected_head_sha).toBe(prepared.request.identity.baseSha);
    expect(prepared.bundle.envelope.path_mappings).toEqual([
      expect.objectContaining({
        projection_id: nativeWslProjectionId(prepared.projectionRequest.request_digest),
        repository_id: "owner/repo",
        base_sha: prepared.request.identity.baseSha,
        request_digest: prepared.projectionRequest.request_digest,
        roots: expect.objectContaining({
          windows_source: {
            runtime_id: "windows-git",
            path: "D:\\dev\\stfc-mod",
            verification: "declared",
          },
          wsl_source: expect.objectContaining({
            runtime_id: "wsl-ubuntu-git",
            verification: "git_observed",
            observation_digest: prepared.projectionResult.sourceObservationDigest,
          }),
          native_repository: expect.objectContaining({
            verification: "directory_identity",
          }),
          native_allocation_root: expect.objectContaining({
            verification: "directory_identity",
          }),
          native_worktree: expect.objectContaining({
            verification: "directory_identity",
          }),
        }),
      }),
    ]);
    const serializedProjectionResult = JSON.stringify(prepared.projectionResult);
    expect(serializedProjectionResult).not.toContain(root);
    expect(serializedProjectionResult).not.toContain("D:\\dev\\stfc-mod");

    const workerHandlers = createAttemptWorkerHandlers();
    const attached = await workerHandlers.attach(attachRequest(prepared));
    if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
    await writeFile(
      join(prepared.request.attempt.workspace.worktreePath, "project", "result.txt"),
      "projected worker result\n",
      "utf8"
    );
    const ended = await workerHandlers.end(endRequest(prepared, attached.result));
    if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");

    const receiptRequest = submitRequest(prepared, ended.result);
    const observingStore = new SqliteWorkspaceLifecycleStore(
      prepared.request.runtime.databasePath,
      { readOnly: true }
    );
    try {
      const lease = await observingStore.getWorkspaceLease(
        ended.result.workerSession.workspaceLeaseId
      );
      if (!lease) throw new Error("expected durable workspace lease");
      const observation = await new LocalAttemptVerificationRuntime().observe({
        lease,
        receipt: receiptRequest.submission.receipt,
      });
      receiptRequest.submission.receipt.patch_hash = observation.patchHash;
    } finally {
      await observingStore.close();
    }
    const receipt = await createAttemptReceiptHandlers().submit(receiptRequest);
    if (!receipt.ok || !receipt.result.submitted) throw new Error("expected submitted receipt");

    const verificationHandlers = createAttemptVerificationHandlers({
      now: times(
        "2026-07-12T12:00:13.000Z",
        "2026-07-12T12:00:14.000Z",
        "2026-07-12T12:00:15.000Z"
      ),
    });
    const verification = await verificationHandlers.run({
      databasePath: prepared.request.runtime.databasePath,
      verification: {
        runId: receiptRequest.submission.runId,
        expectedRunRevision: receiptRequest.submission.expectedRunRevision,
        controller: receiptRequest.submission.controller,
        verificationId: "verification-projected",
        attemptId: receiptRequest.submission.attemptId,
        expectedAttemptRevision: receipt.result.attemptRevision,
        workspaceLeaseId: receiptRequest.submission.workspaceLeaseId,
        expectedWorkspaceLeaseRevision: receiptRequest.submission.expectedWorkspaceLeaseRevision,
        workerSessionId: receiptRequest.submission.workerSessionId,
        expectedWorkerSessionRevision: receiptRequest.submission.expectedWorkerSessionRevision,
        receiptId: receipt.result.receiptId,
        receiptHash: receipt.result.receiptHash,
        beginMutationId: "begin-projected-verification",
        completeMutationId: "complete-projected-verification",
      },
    });
    expect(verification).toMatchObject({
      ok: true,
      result: {
        recorded: true,
        outcome: "pass",
        attemptStatus: "verified",
        trustGapCount: 0,
      },
    });
    if (!verification.ok || !verification.result.recorded) {
      throw new Error("expected projected verification");
    }

    const accepted = await verificationHandlers.applyAcceptance({
      databasePath: prepared.request.runtime.databasePath,
      acceptance: {
        runId: receiptRequest.submission.runId,
        expectedRunRevision: receiptRequest.submission.expectedRunRevision,
        controller: receiptRequest.submission.controller,
        verificationId: verification.result.verificationId,
        verificationHash: verification.result.verificationHash,
        attemptId: receiptRequest.submission.attemptId,
        expectedAttemptRevision: verification.result.attemptRevision,
        workspaceLeaseId: receiptRequest.submission.workspaceLeaseId,
        expectedWorkspaceLeaseRevision: receiptRequest.submission.expectedWorkspaceLeaseRevision,
        workerSessionId: receiptRequest.submission.workerSessionId,
        expectedWorkerSessionRevision: receiptRequest.submission.expectedWorkerSessionRevision,
        receiptId: receipt.result.receiptId,
        receiptHash: receipt.result.receiptHash,
        mutationId: "accept-projected-verification",
      },
    });
    expect(accepted).toMatchObject({
      ok: true,
      result: {
        applied: true,
        decision: "accepted",
        reasonCodes: [],
      },
    });

    const evidenceStore = new SqliteWorkspaceLifecycleStore(prepared.request.runtime.databasePath, {
      readOnly: true,
    });
    try {
      const [attempt, persistedReceipt, persistedVerification] = await Promise.all([
        evidenceStore.getAttempt("attempt-receipt"),
        evidenceStore.getAttemptReceiptForAttempt("attempt-receipt"),
        evidenceStore.getAttemptVerificationForAttempt("attempt-receipt"),
      ]);
      expect({
        attemptStatus: attempt?.status,
        receiptId: persistedReceipt?.receiptId,
        receiptHash: persistedReceipt?.receiptHash,
        verificationId: persistedVerification?.verificationId,
        verificationHash: persistedVerification?.verificationHash,
        verificationOutcome: persistedVerification?.outcome,
        trustGapCount: persistedVerification?.trustGapReasons.length,
      }).toEqual({
        attemptStatus: "accepted",
        receiptId: "receipt-patch-only",
        receiptHash: receipt.result.receiptHash,
        verificationId: "verification-projected",
        verificationHash: verification.result.verificationHash,
        verificationOutcome: "pass",
        trustGapCount: 0,
      });
    } finally {
      await evidenceStore.close();
    }

    await expect(
      prepared.projectionHandlers.status({ request: prepared.projectionRequest })
    ).resolves.toMatchObject({
      ok: true,
      result: { state: "ready", activeWorktreeCount: 1 },
    });
    await expect(
      prepared.projectionHandlers.cleanup({
        request: prepared.projectionRequest,
        mutation: { authorized: true, reason: "prove active Attempt containment" },
      })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        outcome: "refused",
        reasonCode: "active_worktrees",
        nextActions: ["remove_active_worktrees", "cleanup_projection"],
      },
    });
  });

  it("independently includes unclaimed untracked files in workspace identity", async () => {
    const root = await sandbox();
    const prepared = await prepare(root);
    const workerHandlers = createAttemptWorkerHandlers();
    const attached = await workerHandlers.attach(attachRequest(prepared));
    if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
    const ended = await workerHandlers.end(endRequest(prepared, attached.result));
    if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");
    const receipt = submitRequest(prepared, ended.result).submission.receipt;
    const store = new SqliteWorkspaceLifecycleStore(prepared.request.runtime.databasePath, {
      readOnly: true,
    });
    try {
      const lease = await store.getWorkspaceLease(ended.result.workerSession.workspaceLeaseId);
      if (!lease) throw new Error("expected durable workspace lease");
      const runtime = new LocalAttemptVerificationRuntime();
      const before = await runtime.observe({ lease, receipt });
      await writeFile(
        join(prepared.request.attempt.workspace.worktreePath, "project", "unclaimed.txt"),
        "must not be hidden by files_touched\n",
        "utf8"
      );
      const after = await runtime.observe({ lease, receipt });

      expect(receipt.files_touched).not.toContain("project/unclaimed.txt");
      expect(after.patchHash).not.toBe(before.patchHash);
      expect(after.observationHash).not.toBe(before.observationHash);
    } finally {
      await store.close();
    }
  });

  it("retries timeout evidence once and leaves the Attempt inconclusive", async () => {
    const fixture = await submitPatchFixture(await sandbox());
    const observation = observed(fixture.prepared.bundle.packet.repository.base_sha);
    const runtime = new ScriptedVerificationRuntime(
      [observation, observation],
      [timedOut(), timedOut()]
    );
    const handlers = createAttemptVerificationHandlers({
      runtime,
      now: times("2026-07-12T12:00:13.000Z", "2026-07-12T12:00:14.000Z"),
    });
    const result = await handlers.run(
      verificationRequest(fixture.prepared, fixture.receiptRequest, fixture.receipt)
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        recorded: true,
        outcome: "infrastructure_error",
        attemptStatus: "inconclusive",
        trustGapCount: 2,
        checkCounts: { infrastructure_error: 1 },
      },
    });
    expect(runtime.runCount).toBe(2);
    await expect(
      handlers.status({
        databasePath: fixture.prepared.request.runtime.databasePath,
        runId: fixture.receiptRequest.submission.runId,
        attemptId: fixture.receiptRequest.submission.attemptId,
        diagnostics: true,
      })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        verification: {
          diagnostics: {
            checks: [{ id: "test", outcome: "infrastructure_error", retry_count: 1 }],
          },
        },
      },
    });
  });

  it("records workspace drift as inconclusive instead of accepting stale evidence", async () => {
    const fixture = await submitPatchFixture(await sandbox());
    const initial = observed(fixture.prepared.bundle.packet.repository.base_sha);
    const drifted = { ...initial, patchHash: `sha256:${"d".repeat(64)}` };
    const runtime = new ScriptedVerificationRuntime([initial, drifted], [passedCheck()]);
    const result = await createAttemptVerificationHandlers({
      runtime,
      now: times("2026-07-12T12:00:13.000Z", "2026-07-12T12:00:14.000Z"),
    }).run(verificationRequest(fixture.prepared, fixture.receiptRequest, fixture.receipt));
    expect(result).toMatchObject({
      ok: true,
      result: {
        recorded: true,
        outcome: "inconclusive",
        attemptStatus: "inconclusive",
        trustGapCount: 2,
      },
    });
  });

  it("carries an observed authority deviation into verification and strict rejection", async () => {
    const fixture = await submitPatchFixture(await sandbox());
    const store = new SqliteWorkspaceLifecycleStore(fixture.prepared.request.runtime.databasePath);
    try {
      const deviation = await store.recordWorkerAuthorityDecision({
        runId: fixture.receiptRequest.submission.runId,
        expectedRunRevision: fixture.receiptRequest.submission.expectedRunRevision,
        controller: fixture.receiptRequest.submission.controller,
        mutationId: "observed-external-runtime-deviation",
        now: "2026-07-12T12:00:12.500Z",
        attemptId: fixture.receiptRequest.submission.attemptId,
        expectedAttemptRevision: fixture.receipt.attemptRevision,
        workspaceLeaseId: fixture.receiptRequest.submission.workspaceLeaseId,
        expectedWorkspaceLeaseRevision:
          fixture.receiptRequest.submission.expectedWorkspaceLeaseRevision,
        workerSessionId: fixture.receiptRequest.submission.workerSessionId,
        expectedWorkerSessionRevision:
          fixture.receiptRequest.submission.expectedWorkerSessionRevision,
        dimension: "external_runtime",
        decision: "deviation",
        enforcement: "unenforced",
        actionClass: "external_runtime",
        actionHash: computeCanonicalHash({
          action_class: "external_runtime",
          executable: "docker",
        }),
        backendId: "lexrunner.argv-authority-broker",
        backendVersion: "1.0.0",
        reason: "observed_after_execution",
      });
      expect(deviation).toMatchObject({ recorded: true, event: { decision: "deviation" } });
    } finally {
      await store.close();
    }

    const observation = observed(fixture.prepared.bundle.packet.repository.base_sha);
    const handlers = createAttemptVerificationHandlers({
      runtime: new ScriptedVerificationRuntime([observation, observation], [passedCheck()]),
      now: times(
        "2026-07-12T12:00:13.000Z",
        "2026-07-12T12:00:14.000Z",
        "2026-07-12T12:00:15.000Z"
      ),
    });
    const verification = await handlers.run(
      verificationRequest(
        fixture.prepared,
        fixture.receiptRequest,
        fixture.receipt,
        "verification-authority-deviation"
      )
    );
    expect(verification).toMatchObject({
      ok: true,
      result: { recorded: true, outcome: "pass", trustGapCount: 1, attemptStatus: "verified" },
    });
    if (!verification.ok || !verification.result.recorded) {
      throw new Error("expected authority-aware verification");
    }
    await expect(
      handlers.status({
        databasePath: fixture.prepared.request.runtime.databasePath,
        runId: fixture.receiptRequest.submission.runId,
        attemptId: fixture.receiptRequest.submission.attemptId,
        diagnostics: true,
      })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        verification: { diagnostics: { trustGapReasons: ["authority_deviation"] } },
      },
    });
    await expect(
      handlers.applyAcceptance({
        databasePath: fixture.prepared.request.runtime.databasePath,
        acceptance: {
          runId: fixture.receiptRequest.submission.runId,
          expectedRunRevision: fixture.receiptRequest.submission.expectedRunRevision,
          controller: fixture.receiptRequest.submission.controller,
          verificationId: verification.result.verificationId,
          verificationHash: verification.result.verificationHash,
          attemptId: fixture.receiptRequest.submission.attemptId,
          expectedAttemptRevision: verification.result.attemptRevision,
          workspaceLeaseId: fixture.receiptRequest.submission.workspaceLeaseId,
          expectedWorkspaceLeaseRevision:
            fixture.receiptRequest.submission.expectedWorkspaceLeaseRevision,
          workerSessionId: fixture.receiptRequest.submission.workerSessionId,
          expectedWorkerSessionRevision:
            fixture.receiptRequest.submission.expectedWorkerSessionRevision,
          receiptId: fixture.receipt.receiptId,
          receiptHash: fixture.receipt.receiptHash,
          mutationId: "reject-authority-deviation",
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: true,
        decision: "rejected",
        reasonCodes: ["trust_gap:authority_deviation"],
      },
    });
  });

  it("authenticates first and persists observation failure without running packet commands", async () => {
    const fixture = await submitPatchFixture(await sandbox());
    const runtime = new ScriptedVerificationRuntime([], []);
    const result = await createAttemptVerificationHandlers({
      runtime,
      now: times("2026-07-12T12:00:13.000Z", "2026-07-12T12:00:14.000Z"),
    }).run(
      verificationRequest(
        fixture.prepared,
        fixture.receiptRequest,
        fixture.receipt,
        "verification-observation-failure"
      )
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        recorded: true,
        outcome: "infrastructure_error",
        attemptStatus: "inconclusive",
      },
    });
    expect(runtime.runCount).toBe(0);
  });

  it("rejects stale fencing before observing or executing the workspace", async () => {
    const fixture = await submitPatchFixture(await sandbox());
    const runtime = new ScriptedVerificationRuntime([], []);
    const request = verificationRequest(
      fixture.prepared,
      fixture.receiptRequest,
      fixture.receipt,
      "verification-stale"
    );
    request.verification.expectedWorkerSessionRevision += 1;
    const result = await createAttemptVerificationHandlers({ runtime }).run(request);
    expect(result).toMatchObject({
      ok: true,
      result: { recorded: false, reason: "stale_session_revision" },
    });
    expect(runtime.observeCount).toBe(0);
    expect(runtime.runCount).toBe(0);
  });

  it("verifies a committed result identity selected by the immutable packet", async () => {
    const root = await sandbox();
    const prepared = await prepare(root, true);
    const workerHandlers = createAttemptWorkerHandlers();
    const attached = await workerHandlers.attach(attachRequest(prepared));
    if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
    const worktreePath = prepared.request.attempt.workspace.worktreePath;
    await writeFile(join(worktreePath, "project", "result.txt"), "committed result\n", "utf8");
    await git(worktreePath, "add", "project/result.txt");
    await git(worktreePath, "commit", "-m", "test committed result");
    const finalHeadSha = (
      await execa("git", ["rev-parse", "HEAD"], { cwd: worktreePath })
    ).stdout.trim();
    const ended = await workerHandlers.end(endRequest(prepared, attached.result));
    if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");
    const receiptRequest = submitRequest(prepared, ended.result, "completed", {
      finalHeadSha,
      patchHash: null,
      commits: [finalHeadSha],
    });
    const receipt = await createAttemptReceiptHandlers().submit(receiptRequest);
    if (!receipt.ok || !receipt.result.submitted) throw new Error("expected submitted receipt");
    const result = await createAttemptVerificationHandlers({
      now: times("2026-07-12T12:00:13.000Z", "2026-07-12T12:00:14.000Z"),
    }).run(verificationRequest(prepared, receiptRequest, receipt.result, "verification-commit"));
    expect(result).toMatchObject({
      ok: true,
      result: {
        recorded: true,
        outcome: "pass",
        attemptStatus: "verified",
        trustGapCount: 0,
      },
    });
  });

  it("redacts bound environment values from diagnostic snippets", async () => {
    const secret = "verification-secret-value";
    const result = await new LocalAttemptVerificationRuntime().runCheck({
      argv: [process.execPath, "-e", "process.stdout.write(process.env.API_TOKEN)"],
      cwd: process.cwd(),
      environment: { API_TOKEN: secret },
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.stdoutSnippet).toContain("***REDACTED***");
    expect(result.stdoutSnippet).not.toContain(secret);
  });

  it("does not create SQLite while reading missing receipt status", async () => {
    const root = await sandbox();
    const databasePath = join(root, "missing.db");

    await expect(
      createAttemptReceiptHandlers().status({
        databasePath,
        runId: "run-missing",
        attemptId: "attempt-missing",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input", issues: [{ path: "databasePath" }] },
    });
    await expect(access(databasePath)).rejects.toThrow();
  });

  it.each(["missing", "noncanonical", "hash-mismatched"] as const)(
    "rejects receipt ingestion when the packet snapshot is %s",
    async (tamper) => {
      const root = await sandbox();
      const prepared = await prepare(root);
      const workerHandlers = createAttemptWorkerHandlers();
      const attached = await workerHandlers.attach(attachRequest(prepared));
      if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
      const ended = await workerHandlers.end(endRequest(prepared, attached.result));
      if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");

      const databasePath = prepared.request.runtime.databasePath;
      const database = new Database(databasePath);
      try {
        if (tamper === "missing") {
          database
            .prepare(`DELETE FROM task_packet_bindings WHERE attemptId = ?`)
            .run("attempt-receipt");
        } else if (tamper === "noncanonical") {
          database
            .prepare(
              `UPDATE task_packet_bindings SET packetJson = packetJson || ' ' WHERE attemptId = ?`
            )
            .run("attempt-receipt");
        } else {
          database
            .prepare(`UPDATE task_packet_bindings SET packetHash = ? WHERE attemptId = ?`)
            .run(`sha256:${"f".repeat(64)}`, "attempt-receipt");
        }
      } finally {
        database.close();
      }

      const readOnly = new SqliteWorkspaceLifecycleStore(databasePath, { readOnly: true });
      try {
        await expect(readOnly.getTaskPacketBinding("attempt-receipt")).resolves.toBeNull();
      } finally {
        await readOnly.close();
      }

      await expect(
        createAttemptReceiptHandlers().submit(submitRequest(prepared, ended.result))
      ).resolves.toMatchObject({
        ok: true,
        result: { submitted: false, reason: "evidence_mismatch" },
      });

      const verification = new Database(databasePath);
      try {
        expect(
          verification.prepare(`SELECT COUNT(*) AS count FROM attempt_receipts`).get()
        ).toEqual({ count: 0 });
        expect(
          verification
            .prepare(`SELECT status FROM attempts WHERE attemptId = ?`)
            .get("attempt-receipt")
        ).toEqual({ status: "running" });
      } finally {
        verification.close();
      }
    }
  );
});

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-receipt-adapter-"));
  roots.push(root);
  return root;
}

async function submitPatchFixture(root: string) {
  const prepared = await prepare(root);
  const workerHandlers = createAttemptWorkerHandlers();
  const attached = await workerHandlers.attach(attachRequest(prepared));
  if (!attached.ok || !attached.result.updated) throw new Error("expected attached worker");
  await writeFile(
    join(prepared.request.attempt.workspace.worktreePath, "project", "result.txt"),
    "fixture result\n",
    "utf8"
  );
  const ended = await workerHandlers.end(endRequest(prepared, attached.result));
  if (!ended.ok || !ended.result.updated) throw new Error("expected ended worker");
  const receiptRequest = submitRequest(prepared, ended.result);
  const submitted = await createAttemptReceiptHandlers().submit(receiptRequest);
  if (!submitted.ok || !submitted.result.submitted) throw new Error("expected submitted receipt");
  return { prepared, receiptRequest, receipt: submitted.result };
}

function verificationRequest(
  prepared: Awaited<ReturnType<typeof prepare>>,
  receiptRequest: ReturnType<typeof submitRequest>,
  receipt: { receiptId: string; receiptHash: string; attemptRevision: number },
  verificationId = "verification-public"
) {
  return {
    databasePath: prepared.request.runtime.databasePath,
    verification: {
      runId: receiptRequest.submission.runId,
      expectedRunRevision: receiptRequest.submission.expectedRunRevision,
      controller: receiptRequest.submission.controller,
      verificationId,
      attemptId: receiptRequest.submission.attemptId,
      expectedAttemptRevision: receipt.attemptRevision,
      workspaceLeaseId: receiptRequest.submission.workspaceLeaseId,
      expectedWorkspaceLeaseRevision: receiptRequest.submission.expectedWorkspaceLeaseRevision,
      workerSessionId: receiptRequest.submission.workerSessionId,
      expectedWorkerSessionRevision: receiptRequest.submission.expectedWorkerSessionRevision,
      receiptId: receipt.receiptId,
      receiptHash: receipt.receiptHash,
      beginMutationId: `begin-${verificationId}`,
      completeMutationId: `complete-${verificationId}`,
    },
  };
}

class ScriptedVerificationRuntime implements AttemptVerificationRuntime {
  runCount = 0;
  observeCount = 0;

  constructor(
    private readonly observations: VerificationWorkspaceObservation[],
    private readonly results: VerificationCommandResult[]
  ) {}

  resolveEnvironment(): Readonly<Record<string, string>> {
    return {};
  }

  async resolveCheckCwd(worktreePath: string): Promise<string> {
    return worktreePath;
  }

  async observe(): Promise<VerificationWorkspaceObservation> {
    this.observeCount += 1;
    const observation = this.observations.shift();
    if (!observation) throw new Error("missing scripted observation");
    return observation;
  }

  async runCheck(): Promise<VerificationCommandResult> {
    this.runCount += 1;
    const result = this.results.shift();
    if (!result) throw new Error("missing scripted command result");
    return result;
  }
}

function observed(headSha: string): VerificationWorkspaceObservation {
  return {
    headSha,
    patchHash: `sha256:${"c".repeat(64)}`,
    observationHash: `sha256:${"e".repeat(64)}`,
  };
}

function timedOut(): VerificationCommandResult {
  return {
    ok: false,
    failureKind: "timeout",
    durationMs: 60_000,
    stdoutHash: `sha256:${"1".repeat(64)}`,
    stderrHash: `sha256:${"2".repeat(64)}`,
  };
}

function passedCheck(): VerificationCommandResult {
  return {
    ok: true,
    exitCode: 0,
    durationMs: 10,
    stdoutHash: `sha256:${"1".repeat(64)}`,
    stderrHash: `sha256:${"2".repeat(64)}`,
  };
}

async function prepare(root: string, gitWrite = false) {
  const request = await prepareRequest(root, gitWrite);
  const response = await createAttemptLifecycleHandlers().prepare(request);
  if (!response.ok || !response.result.ok) {
    throw new Error(`expected prepared Attempt: ${JSON.stringify(response)}`);
  }
  return { request, bundle: response.result };
}

async function prepareProjected(root: string) {
  const request = await prepareRequest(root);
  const sourceRoot = request.runtime.repositoryRoot;
  const projectionRoot = join(root, "native-projections");
  const nativeWorktreeRoot = join(root, "native-worktrees");
  await Promise.all([mkdir(projectionRoot), mkdir(nativeWorktreeRoot)]);
  await git(sourceRoot, "remote", "add", "origin", STFC_REMOTE_URL);
  const projectionRequest = createNativeWslProjectionRequest({
    schema_version: "1.0.0",
    request_id: "stfc-wl-006-e2e",
    repository: {
      id: request.runtime.repositoryId,
      expected_remote_hash: computeCanonicalHash(STFC_REMOTE_URL),
    },
    source: {
      windows_runtime: "windows-git",
      windows_repository_path: "D:\\dev\\stfc-mod",
      wsl_distribution: "Ubuntu",
      wsl_git_runtime: "wsl-ubuntu-git",
      wsl_repository_path: sourceRoot,
      head_policy: "observe",
      dirty_policy: "committed_base_only",
    },
    native: {
      host_id: "wsl-ubuntu-host",
      git_runtime: "wsl-ubuntu-git",
      projection_root: projectionRoot,
      worktree_root: nativeWorktreeRoot,
    },
    base_sha: request.identity.baseSha,
  });

  await writeFile(join(sourceRoot, "tracked.txt"), "source moved after base selection\n", "utf8");
  await git(sourceRoot, "add", "tracked.txt");
  await git(sourceRoot, "commit", "-m", "move source head");
  const sourceHead = (await execa("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })).stdout.trim();
  await writeFile(join(sourceRoot, "source-dirty.txt"), "uncommitted source state\n", "utf8");

  const projectionHandlers = createNativeWslProjectionLifecycleHandlers();
  const projection = await projectionHandlers.prepare({
    request: projectionRequest,
    mutation: { authorized: true, reason: "WL-006 public end-to-end proof" },
  });
  if (
    !projection.ok ||
    projection.result.state !== "ready" ||
    projection.result.selectionDigest === undefined
  ) {
    throw new Error("expected prepared native WSL projection");
  }

  const projectionId = nativeWslProjectionId(projectionRequest.request_digest);
  request.runtime.repositoryRoot = join(projectionRoot, projectionId);
  request.runtime.worktreeRoot = join(nativeWorktreeRoot, projectionId);
  request.runtime.hostId = projectionRequest.native.host_id;
  request.runtime.gitRuntime = projectionRequest.native.git_runtime;
  request.attempt.workspace.worktreePath = join(
    request.runtime.worktreeRoot,
    request.identity.attemptId
  );
  request.envelope.projectRoot = join(request.attempt.workspace.worktreePath, "project");
  request.envelope.executionRoot = request.envelope.projectRoot;
  request.envelope.projection = { selectionDigest: projection.result.selectionDigest };

  const response = await createAttemptLifecycleHandlers().prepare(request);
  if (!response.ok || !response.result.ok) {
    throw new Error(`expected projected Attempt: ${JSON.stringify(response)}`);
  }
  return {
    request,
    bundle: response.result,
    projectionHandlers,
    projectionRequest,
    projectionResult: projection.result,
    sourceRoot,
    sourceHead,
  };
}

function authority(prepared: Awaited<ReturnType<typeof prepare>>) {
  const lease = prepared.bundle.lifecycle.controllerLease;
  return {
    runId: lease.runId,
    controllerId: lease.controllerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
  };
}

function attachRequest(prepared: Awaited<ReturnType<typeof prepare>>) {
  const { bundle, request } = prepared;
  return {
    runtime: request.runtime,
    attach: {
      runId: bundle.lifecycle.run.runId,
      expectedRunRevision: bundle.lifecycle.run.revision,
      controller: authority(prepared),
      attemptId: bundle.lifecycle.attempt.attemptId,
      expectedAttemptRevision: bundle.lifecycle.attempt.revision,
      workspaceLeaseId: bundle.lifecycle.workspace.leaseId,
      expectedWorkspaceLeaseRevision: bundle.lifecycle.workspace.revision,
      workerSessionId: "native-receipt-session",
      envelope: structuredClone(bundle.envelope),
      worker: {
        backend: "host-subagent" as const,
        workerId: "native-receipt-agent",
        model: "gpt-5-codex",
        startedAt: "2026-07-12T12:00:08.000Z",
      },
      adapter: {
        schema_version: "1.0.0" as const,
        adapter_id: "lexrunner.host-assisted",
        adapter_version: "1.0.0",
        mode: "assisted_attach" as const,
        accepted_trust_gaps: [
          "filesystem_read",
          "filesystem_write",
          ...(request.packet.authority.git_write ? (["git_write"] as const) : []),
        ],
      },
      mutation: { mutationId: "attach-receipt-worker", now: "2026-07-12T12:00:09.000Z" },
    },
  };
}

function endRequest(
  prepared: Awaited<ReturnType<typeof prepare>>,
  attached: Extract<
    Awaited<ReturnType<ReturnType<typeof createAttemptWorkerHandlers>["attach"]>>,
    { ok: true }
  >["result"] & { updated: true },
  status: "completed" | "failed" = "completed"
) {
  return {
    databasePath: prepared.request.runtime.databasePath,
    end: {
      runId: attached.attempt.runId,
      expectedRunRevision: prepared.bundle.lifecycle.run.revision,
      controller: authority(prepared),
      attemptId: attached.attempt.attemptId,
      expectedAttemptRevision: attached.attempt.revision,
      workspaceLeaseId: attached.workerSession.workspaceLeaseId,
      expectedWorkspaceLeaseRevision: prepared.bundle.lifecycle.workspace.revision,
      workerSessionId: attached.workerSession.sessionId,
      expectedWorkerSessionRevision: attached.workerSession.revision,
      status,
      exit: {
        code: status === "completed" ? 0 : 1,
        summary: "Worker emitted a receipt claim",
      },
      mutation: { mutationId: "end-receipt-worker", now: "2026-07-12T12:00:10.000Z" },
    },
  };
}

function submitRequest(
  prepared: Awaited<ReturnType<typeof prepare>>,
  ended: Extract<
    Awaited<ReturnType<ReturnType<typeof createAttemptWorkerHandlers>["end"]>>,
    { ok: true }
  >["result"] & { updated: true },
  outcome: "completed" | "failed" = "completed",
  resultIdentity: {
    finalHeadSha?: string;
    patchHash?: string | null;
    commits?: string[];
  } = {}
) {
  const packet = prepared.bundle.packet;
  const session = ended.workerSession;
  return {
    databasePath: prepared.request.runtime.databasePath,
    submission: {
      runId: ended.attempt.runId,
      expectedRunRevision: prepared.bundle.lifecycle.run.revision,
      controller: authority(prepared),
      attemptId: ended.attempt.attemptId,
      expectedAttemptRevision: ended.attempt.revision,
      workspaceLeaseId: session.workspaceLeaseId,
      expectedWorkspaceLeaseRevision: prepared.bundle.lifecycle.workspace.revision,
      workerSessionId: session.sessionId,
      expectedWorkerSessionRevision: session.revision,
      receipt: {
        schema_version: "2.0.0" as const,
        receipt_id: "receipt-patch-only",
        run_id: packet.run_id,
        work_item_id: packet.work_item.work_item_id,
        work_item_revision: packet.work_item.revision,
        attempt_id: packet.attempt_id,
        packet_id: packet.packet_id,
        packet_hash: packet.packet_hash,
        workspace_lease_id: session.workspaceLeaseId,
        workspace_lease_revision: session.workspaceLeaseRevision,
        worker_runtime: session.workerRuntime,
        worker_session_id: session.sessionId,
        observed_base_sha: packet.repository.base_sha,
        ...(resultIdentity.finalHeadSha ? { final_head_sha: resultIdentity.finalHeadSha } : {}),
        ...(resultIdentity.patchHash === null
          ? {}
          : { patch_hash: resultIdentity.patchHash ?? `sha256:${"c".repeat(64)}` }),
        outcome,
        exit_reason: outcome === "completed" ? "work_complete" : "worker_failed",
        summary:
          outcome === "completed"
            ? "Worker claims an uncommitted result without engine verification."
            : "Worker claims failed evidence without engine verification.",
        files_touched: ["project/result.txt"],
        commits: resultIdentity.commits ?? [],
        acceptance_criteria_addressed: ["ac-1"],
        claimed_checks: [
          { id: "test", outcome: "pass" as const, output_snippet: "not independently run" },
        ],
        assumptions: [],
        blockers: [],
        human_action_request_ids: [],
        cost: { tool_calls: 5, elapsed_ms: 2_000 },
        worker_started_at: "2026-07-12T12:00:08.000Z",
        worker_completed_at: "2026-07-12T12:00:09.500Z",
        submitted_at: "2026-07-12T12:00:11.000Z",
      },
      mutation: { mutationId: "submit-receipt", now: "2026-07-12T12:00:12.000Z" },
    },
  };
}

async function prepareRequest(root: string, gitWrite = false) {
  const repositoryRoot = join(root, "repository");
  const worktreeRoot = join(root, "worktrees");
  await mkdir(repositoryRoot);
  await mkdir(worktreeRoot);
  await git(repositoryRoot, "init", "-b", "main");
  await git(repositoryRoot, "config", "user.name", "LexRunner Test");
  await git(repositoryRoot, "config", "user.email", "test@example.invalid");
  await git(repositoryRoot, "config", "commit.gpgsign", "false");
  await mkdir(join(repositoryRoot, "project"));
  await writeFile(join(repositoryRoot, "tracked.txt"), "base\n", "utf8");
  await writeFile(join(repositoryRoot, "project", "app.txt"), "app\n", "utf8");
  await git(repositoryRoot, "add", ".");
  await git(repositoryRoot, "commit", "-m", "initial");
  const baseSha = (
    await execa("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  const at = (second: number) => `2026-07-12T12:00:${String(second).padStart(2, "0")}.000Z`;
  const worktreePath = join(worktreeRoot, "attempt-receipt");
  return {
    runtime: {
      databasePath: join(root, "lifecycle.db"),
      repositoryId: "owner/repo",
      repositoryRoot,
      worktreeRoot,
      hostId: "host-receipt",
      gitRuntime: "git-test",
      pathComparison: "case-sensitive" as const,
    },
    workItem: {
      schema_version: "1.0.0" as const,
      work_item_id: "work-receipt",
      revision: 2,
      source: {
        kind: "github" as const,
        external_id: "759",
        revision: "issue-759-v1",
        url: "https://github.com/Guffawaffle/lexrunner/issues/759",
        captured_at: at(0),
      },
      repository: { id: "owner/repo", default_branch: "main" },
      title: "Persist an Attempt receipt",
      objective: "Durably ingest one worker claim",
      description: "Exercise receipt transport without verification.",
      acceptance_criteria: [{ id: "ac-1", text: "Receipt is durably bound" }],
      constraints: ["Do not verify worker claims"],
      labels: ["agent-work"],
      dependencies: [],
    },
    identity: { runId: "run-receipt", attemptId: "attempt-receipt", baseSha },
    packet: {
      packetId: "packet-receipt",
      instructions: ["Return a bounded receipt claim"],
      scope: {
        read_globs: ["src/**", "tests/**"],
        write_globs: ["project/**"],
        deny_globs: [".env"],
        cross_repo_allowed: false,
      },
      authority: {
        edit: true,
        git_write: gitWrite,
        github_write: false,
        external_runtime: false,
        secrets: false,
        signing: false,
        release: false,
      },
      verification: [
        { id: "test", argv: ["node", "-e", "process.exit(0)"], expected_exit_codes: [0] },
      ],
      budget: { max_tokens: 20_000, max_tool_calls: 100, max_elapsed_ms: 3_600_000 },
      createdAt: at(0),
    },
    envelope: {
      envelopeId: "envelope-receipt",
      os: "linux" as const,
      architecture: "x64",
      workerRuntime: "codex-native",
      projectRoot: join(worktreePath, "project"),
      executionRoot: join(worktreePath, "project"),
      exposedEnvironmentKeys: ["PATH"],
      createdAt: at(7),
    },
    attempt: {
      initialRunState: {
        runId: "run-receipt",
        mode: "agent",
        procedure: "agent-work",
        repo: "owner/repo",
        state: "planning",
        createdAt: at(0),
        updatedAt: at(0),
        completedSteps: [],
        currentStep: null,
        params: {},
        metadata: {},
      },
      controller: {
        controllerId: "controller-receipt",
        leaseId: "controller-lease-receipt",
        now: at(0),
        ttlMs: 60_000,
      },
      workspace: {
        workspaceLeaseId: "workspace-lease-receipt",
        branch: "lexrunner/attempt-receipt",
        worktreePath,
        ttlMs: 60_000,
      },
      mutations: {
        createAttempt: { mutationId: "create-receipt", now: at(1) },
        reserveWorkspace: { mutationId: "reserve-receipt", now: at(2) },
        activateWorkspace: { mutationId: "activate-receipt", now: at(3) },
        resumeWorkspace: { mutationId: "resume-receipt", now: at(4) },
        quarantineWorkspace: { mutationId: "quarantine-receipt", now: at(5) },
        authorizeLaunch: { mutationId: "authorize-receipt", now: at(6) },
      },
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}

function times(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}
