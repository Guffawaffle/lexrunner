import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { createAttemptLifecycleHandlers } from "../../src/runs/agent-work-adapters.js";
import { createAttemptWorkerHandlers } from "../../src/runs/agent-work-worker-adapters.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Attempt worker adapter handlers", () => {
  it("attaches a host subagent and persists its lifecycle with idempotent replays", async () => {
    const prepared = await prepare(await sandbox());
    const handlers = createAttemptWorkerHandlers();
    const attach = attachRequest(prepared);

    const attached = await handlers.attach(attach);
    await writeFile(
      join(prepared.request.attempt.workspace.worktreePath, "worker-output.txt"),
      "native work began after attachment\n",
      "utf8"
    );
    const attachReplay = await handlers.attach(attach);

    expect(attached).toMatchObject({
      ok: true,
      result: {
        updated: true,
        idempotentReplay: false,
        attempt: { attemptId: "attempt-worker", status: "running" },
        workerSession: {
          sessionId: "codex-task:/root/worker_session_adapter_tests",
          revision: 0,
          backend: "host-subagent",
          workerId: "/root/worker_session_adapter_tests",
          workerRuntime: "codex-native",
          status: "running",
        },
        event: { type: "worker_session_attached", sequence: 1 },
      },
    });
    expect(attachReplay).toMatchObject({
      ok: true,
      result: { updated: true, idempotentReplay: true },
    });
    if (!attached.ok || !attached.result.updated) throw new Error("expected worker attachment");

    const databaseBeforeStatus = await readFile(prepared.request.runtime.databasePath);
    const status = await handlers.status({
      databasePath: prepared.request.runtime.databasePath,
      runId: prepared.bundle.lifecycle.run.runId,
      attemptId: prepared.bundle.lifecycle.attempt.attemptId,
    });
    const databaseAfterStatus = await readFile(prepared.request.runtime.databasePath);
    expect(status).toMatchObject({
      ok: true,
      result: {
        workerSession: {
          sessionId: "codex-task:/root/worker_session_adapter_tests",
          revision: 0,
          status: "running",
          packetId: prepared.bundle.packet.packet_id,
          packetHash: prepared.bundle.packet.packet_hash,
          executionEnvelopeId: prepared.bundle.envelope.envelope_id,
        },
      },
    });
    expect(databaseAfterStatus).toEqual(databaseBeforeStatus);

    const heartbeat = mutationRequest(prepared, attached.result, "heartbeat");
    const heartbeated = await handlers.heartbeat(heartbeat);
    const heartbeatReplay = await handlers.heartbeat(heartbeat);
    expect(heartbeated).toMatchObject({
      ok: true,
      result: {
        updated: true,
        idempotentReplay: false,
        workerSession: { revision: 1, status: "awaiting_human" },
        event: { type: "worker_session_heartbeat", sequence: 2 },
      },
    });
    expect(heartbeatReplay).toMatchObject({
      ok: true,
      result: { updated: true, idempotentReplay: true },
    });
    if (!heartbeated.ok || !heartbeated.result.updated) throw new Error("expected heartbeat");

    const end = mutationRequest(prepared, heartbeated.result, "end");
    const ended = await handlers.end(end);
    const endReplay = await handlers.end(end);
    expect(ended).toMatchObject({
      ok: true,
      result: {
        updated: true,
        idempotentReplay: false,
        workerSession: {
          revision: 2,
          status: "completed",
          exitReason: "completed",
          exitCode: 0,
          exitSummary: "Native subagent completed the assigned slice",
        },
        event: { type: "worker_session_ended", sequence: 3 },
      },
    });
    expect(endReplay).toMatchObject({
      ok: true,
      result: { updated: true, idempotentReplay: true },
    });
  });

  it("rejects a mismatched binding without consuming the Attempt's one worker session", async () => {
    const prepared = await prepare(await sandbox());
    const handlers = createAttemptWorkerHandlers();
    const mismatched = attachRequest(prepared);
    mismatched.attach.envelope.packet_hash = `sha256:${"f".repeat(64)}`;

    await expect(handlers.attach(mismatched)).resolves.toMatchObject({
      ok: true,
      result: { updated: false, reason: "identity_mismatch" },
    });

    const valid = attachRequest(prepared);
    const attached = await handlers.attach(valid);
    if (attached.ok && !attached.result.updated) {
      throw new Error(`unexpected valid attachment rejection: ${attached.result.reason}`);
    }
    expect(attached).toMatchObject({ ok: true, result: { updated: true } });
    if (!attached.ok || !attached.result.updated) throw new Error("expected worker attachment");

    const second = attachRequest(prepared);
    second.attach.workerSessionId = "worker-session-2";
    second.attach.worker.workerId = "native-agent-2";
    second.attach.mutation.mutationId = "attach-worker-2";
    second.attach.expectedAttemptRevision = attached.result.attempt.revision;
    await expect(handlers.attach(second)).resolves.toMatchObject({
      ok: true,
      result: { updated: false, reason: "worker_session_conflict" },
    });
  });

  it("refuses attachment when the prepared worktree becomes dirty", async () => {
    const prepared = await prepare(await sandbox());
    await writeFile(
      join(prepared.request.attempt.workspace.worktreePath, "uncommitted.txt"),
      "dirty\n",
      "utf8"
    );

    const result = await createAttemptWorkerHandlers().attach(attachRequest(prepared));

    expect(result).toMatchObject({
      ok: true,
      result: { updated: false, reason: "evidence_mismatch" },
    });
    await expect(
      createAttemptWorkerHandlers().status({
        databasePath: prepared.request.runtime.databasePath,
        runId: "run-worker",
        attemptId: "attempt-worker",
      })
    ).resolves.toMatchObject({ ok: true, result: { workerSession: null } });
  });

  it("does not create SQLite while reading status from a missing database", async () => {
    const root = await sandbox();
    const databasePath = join(root, "missing.db");

    await expect(
      createAttemptWorkerHandlers().status({
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
});

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-worker-adapter-"));
  roots.push(root);
  return root;
}

async function prepare(root: string) {
  const request = await prepareRequest(root);
  const response = await createAttemptLifecycleHandlers().prepare(request);
  if (!response.ok || !response.result.ok) {
    throw new Error(`expected prepared launch bundle: ${JSON.stringify(response)}`);
  }
  return { request, bundle: response.result };
}

function attachRequest(prepared: Awaited<ReturnType<typeof prepare>>) {
  const { request, bundle } = prepared;
  const lease = bundle.lifecycle.controllerLease;
  return {
    runtime: request.runtime,
    attach: {
      runId: bundle.lifecycle.run.runId,
      expectedRunRevision: bundle.lifecycle.run.revision,
      controller: {
        runId: lease.runId,
        controllerId: lease.controllerId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
      },
      attemptId: bundle.lifecycle.attempt.attemptId,
      expectedAttemptRevision: bundle.lifecycle.attempt.revision,
      workspaceLeaseId: bundle.lifecycle.workspace.leaseId,
      expectedWorkspaceLeaseRevision: bundle.lifecycle.workspace.revision,
      workerSessionId: "codex-task:/root/worker_session_adapter_tests",
      envelope: structuredClone(bundle.envelope),
      worker: {
        backend: "host-subagent" as const,
        workerId: "/root/worker_session_adapter_tests",
        model: "gpt-5-codex",
        startedAt: "2026-07-12T12:00:08.000Z",
      },
      mutation: { mutationId: "attach-worker", now: "2026-07-12T12:00:09.000Z" },
    },
  };
}

function mutationRequest(
  prepared: Awaited<ReturnType<typeof prepare>>,
  result: Extract<
    Awaited<ReturnType<ReturnType<typeof createAttemptWorkerHandlers>["attach"]>>,
    { ok: true }
  >["result"] & { updated: true },
  operation: "heartbeat" | "end"
) {
  const lease = prepared.bundle.lifecycle.controllerLease;
  const common = {
    runId: result.attempt.runId,
    expectedRunRevision: prepared.bundle.lifecycle.run.revision,
    controller: {
      runId: lease.runId,
      controllerId: lease.controllerId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
    },
    attemptId: result.attempt.attemptId,
    expectedAttemptRevision: result.attempt.revision,
    workspaceLeaseId: result.workerSession.workspaceLeaseId,
    expectedWorkspaceLeaseRevision: prepared.bundle.lifecycle.workspace.revision,
    workerSessionId: result.workerSession.sessionId,
    expectedWorkerSessionRevision: result.workerSession.revision,
  };
  if (operation === "heartbeat") {
    return {
      databasePath: prepared.request.runtime.databasePath,
      heartbeat: {
        ...common,
        status: "awaiting_human" as const,
        mutation: { mutationId: "heartbeat-worker", now: "2026-07-12T12:00:10.000Z" },
      },
    };
  }
  return {
    databasePath: prepared.request.runtime.databasePath,
    end: {
      ...common,
      status: "completed" as const,
      exit: { code: 0, summary: "Native subagent completed the assigned slice" },
      mutation: { mutationId: "end-worker", now: "2026-07-12T12:00:11.000Z" },
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
  const worktreePath = join(worktreeRoot, "attempt-worker");
  return {
    runtime: {
      databasePath: join(root, "lifecycle.db"),
      repositoryId: "owner/repo",
      repositoryRoot,
      worktreeRoot,
      hostId: "host-worker",
      gitRuntime: "git-test",
      pathComparison: "case-sensitive" as const,
    },
    workItem: {
      schema_version: "1.0.0" as const,
      work_item_id: "work-worker",
      revision: 1,
      source: {
        kind: "github" as const,
        external_id: "755",
        revision: "issue-755-v1",
        url: "https://github.com/Guffawaffle/lexrunner/issues/755",
        captured_at: at(0),
      },
      repository: { id: "owner/repo", default_branch: "main" },
      title: "Attach an assisted worker",
      objective: "Persist one native background worker identity",
      description: "Exercise the foreground-controller assisted-worker seam.",
      acceptance_criteria: [{ id: "ac-1", text: "Worker lifecycle is durable" }],
      constraints: ["Foreground controller retains authority"],
      labels: ["agent-work"],
      dependencies: [],
    },
    identity: { runId: "run-worker", attemptId: "attempt-worker", baseSha },
    packet: {
      packetId: "packet-worker",
      instructions: ["Implement only the assigned bounded slice"],
      scope: {
        read_globs: ["src/**", "tests/**"],
        write_globs: ["tests/**"],
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
      envelopeId: "envelope-worker",
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
        runId: "run-worker",
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
        controllerId: "controller-worker",
        leaseId: "controller-lease-worker",
        now: at(0),
        ttlMs: 60_000,
      },
      workspace: {
        workspaceLeaseId: "workspace-lease-worker",
        branch: "lexrunner/attempt-worker",
        worktreePath,
        ttlMs: 60_000,
      },
      mutations: {
        createAttempt: { mutationId: "create-worker", now: at(1) },
        reserveWorkspace: { mutationId: "reserve-worker", now: at(2) },
        activateWorkspace: { mutationId: "activate-worker", now: at(3) },
        resumeWorkspace: { mutationId: "resume-worker", now: at(4) },
        quarantineWorkspace: { mutationId: "quarantine-worker", now: at(5) },
        authorizeLaunch: { mutationId: "authorize-worker", now: at(6) },
      },
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}
