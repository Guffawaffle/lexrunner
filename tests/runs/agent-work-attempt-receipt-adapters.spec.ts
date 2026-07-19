import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3-multiple-ciphers";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { createAttemptLifecycleHandlers } from "../../src/runs/agent-work-adapters.js";
import { createAttemptReceiptHandlers } from "../../src/runs/agent-work-attempt-receipt-adapters.js";
import { createAttemptWorkerHandlers } from "../../src/runs/agent-work-worker-adapters.js";
import { SqliteWorkspaceLifecycleStore } from "../../src/store/sqlite/workspace-lifecycle-store.js";

const roots: string[] = [];

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

async function prepare(root: string) {
  const request = await prepareRequest(root);
  const response = await createAttemptLifecycleHandlers().prepare(request);
  if (!response.ok || !response.result.ok) throw new Error("expected prepared Attempt");
  return { request, bundle: response.result };
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
  outcome: "completed" | "failed" = "completed"
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
        patch_hash: `sha256:${"c".repeat(64)}`,
        outcome,
        exit_reason: outcome === "completed" ? "work_complete" : "worker_failed",
        summary:
          outcome === "completed"
            ? "Worker claims an uncommitted result without engine verification."
            : "Worker claims failed evidence without engine verification.",
        files_touched: ["project/result.txt"],
        commits: [],
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

async function prepareRequest(root: string) {
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
        git_write: false,
        github_write: false,
        external_runtime: false,
        secrets: false,
        signing: false,
        release: false,
      },
      verification: [{ id: "test", argv: ["npm", "test"], expected_exit_codes: [0] }],
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
