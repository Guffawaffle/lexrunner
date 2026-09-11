import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentTaskPacket,
  ExecutionEnvelope_v1,
  type AgentTaskReceipt_v2,
} from "../../src/schemas/agent-work.js";
import { createAttemptExecutionPathMapping } from "../../src/runs/agent-work-path-mapping.js";
import { resolveWorkspaceBoundary } from "../../src/workspaces/workspace-boundary-resolver.js";
import { codexReceiptRequest } from "../../src/runs/codex-receipt-contract.js";
import { WorkerReceiptDeliveryService } from "../../src/runs/worker-receipt-delivery.js";
import { AgentWorkAttemptVerificationService } from "../../src/runs/agent-work-attempt-verification-service.js";
import { LocalAttemptVerificationRuntime } from "../../src/runs/agent-work-attempt-verification-runtime.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { InMemoryWorkerObservationStore } from "../../src/store/inmemory/worker-observation-store.js";
import { SqliteWorkerObservationStore } from "../../src/store/sqlite/worker-observation-store.js";
import { createAttachedWorker, taskPacket } from "../store/worker-dispatch-fixture.js";

const roots: string[] = [];
const stores: Array<InMemoryWorkerObservationStore | SqliteWorkerObservationStore> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup(kind: string, result = "mostly birds\n") {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-real-receipt-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository"),
    allocationRoot = join(root, "worktrees");
  const worktreePath = join(allocationRoot, "work-1");
  await mkdir(repositoryRoot);
  await mkdir(allocationRoot);
  const git = (args: string[]) =>
    execa("git", ["-c", "commit.gpgsign=false", ...args], {
      cwd: repositoryRoot,
      timeout: 10_000,
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Receipt integration fixture"]);
  await git(["config", "user.email", "receipt-fixture@example.invalid"]);
  await git(["config", "commit.gpgsign", "false"]);
  await writeFile(join(repositoryRoot, "result.txt"), "mostly birds\n");
  await git(["add", "result.txt"]);
  await git(["commit", "-m", "fixture base"]);
  const baseSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await git(["worktree", "add", "-b", "agent/work-1", worktreePath, baseSha]);
  const { packet_hash: _, ...template } = taskPacket();
  const packet = createAgentTaskPacket({
    ...template,
    repository: { id: "repo-1", base_sha: baseSha },
    scope: { ...template.scope, read_globs: ["result.txt"] },
    verification: [
      {
        id: "check-result",
        argv: [
          process.execPath,
          "-e",
          "const fs=require('node:fs');const text=fs.readFileSync('result.txt','utf8');console.log(text.trim());process.exit(text==='mostly birds\\n'?0:3)",
        ],
        expected_exit_codes: [0],
      },
    ],
  });
  const store =
    kind === "sqlite"
      ? new SqliteWorkerObservationStore(join(root, "store.db"))
      : new InMemoryWorkerObservationStore();
  stores.push(store);
  const pathMapping = createAttemptExecutionPathMapping({
    repositoryId: "repo-1",
    baseSha,
    hostId: "host-1",
    gitRuntime: "linux-git",
    repositoryRoot,
    allocationRoot,
    worktreePath,
  });
  const controller = await createAttachedWorker(store, "worker-session-1", {
    packet,
    workspace: {
      repositoryRoot,
      allocationRoot,
      worktreePath,
      pathMapping,
      gitRuntime: "linux-git",
    },
  });
  const envelope = ExecutionEnvelope_v1.parse(
    JSON.parse((await store.getLaunchEnvelopeBinding("attempt-1"))!.envelopeJson)
  );
  const request = codexReceiptRequest(packet, envelope, "native-session-1", "worker-session-1");
  const binding = {
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    attemptId: "attempt-1",
    expectedAttemptRevision: 3,
    workspaceLeaseId: "workspace-lease-1",
    expectedWorkspaceLeaseRevision: 0,
    sessionId: "worker-session-1",
    expectedSessionRevision: 0,
  };
  const claim = {
    ...binding,
    claimId: "claim-real-1",
    requestHash: computeCanonicalHash(request),
    packetHash: packet.packet_hash,
    now: "2026-08-12T12:00:04.000Z",
  };
  expect(await store.claimWorkerDispatch(claim)).toMatchObject({ recorded: true });
  expect(await store.acknowledgeWorkerDispatch({ ...claim, turnId: "turn-1" })).toMatchObject({
    recorded: true,
  });
  await writeFile(join(worktreePath, "result.txt"), result);
  const receipt: AgentTaskReceipt_v2 = {
    schema_version: "2.0.0",
    receipt_id: "receipt-real-1",
    run_id: "run-1",
    work_item_id: "work-1",
    work_item_revision: 1,
    attempt_id: "attempt-1",
    packet_id: "packet-1",
    packet_hash: packet.packet_hash,
    workspace_lease_id: "workspace-lease-1",
    workspace_lease_revision: 0,
    worker_runtime: "codex-native",
    worker_session_id: "worker-session-1",
    observed_base_sha: baseSha,
    final_head_sha: baseSha,
    outcome: "completed",
    exit_reason: "fixture_completed",
    summary: "Controlled worker claims success; engine must check actual result",
    files_touched: ["result.txt"],
    commits: [],
    acceptance_criteria_addressed: ["criterion-1"],
    claimed_checks: [{ id: "check-result", outcome: "pass", exit_code: 0 }],
    assumptions: [],
    blockers: [],
    human_action_request_ids: [],
    cost: {},
    worker_started_at: "2026-08-12T12:00:04.000Z",
    worker_completed_at: "2026-08-12T12:00:05.000Z",
    submitted_at: "2026-08-12T12:00:05.000Z",
  };
  const runtime = new LocalAttemptVerificationRuntime();
  receipt.patch_hash = (
    await runtime.observe({
      lease: (await store.getWorkspaceLease(binding.workspaceLeaseId))!,
      receipt,
    })
  ).patchHash;
  const wire = {
    ...receipt,
    cost: { input_tokens: null, output_tokens: null, tool_calls: null, elapsed_ms: null },
    claimed_checks: [{ ...receipt.claimed_checks[0], output_snippet: null }],
  };
  const source = {
    sessionId: binding.sessionId,
    claimId: claim.claimId,
    requestHash: claim.requestHash,
    workerId: "native-session-1",
    observationId: "source-1",
    observerId: "controlled-worker",
    observedAt: "2026-08-12T12:00:06.000Z",
    notificationJson: JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "native-session-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "item-1",
          phase: "final_answer",
          text: JSON.stringify(wire),
        },
      },
    }),
  };
  expect(await store.recordWorkerReceiptEvidence(source, source.observedAt)).toMatchObject({
    recorded: true,
  });
  expect(
    await store.recordWorkerTurnEvidence(
      {
        ...source,
        observationId: "terminal-1",
        observedAt: "2026-08-12T12:00:07.000Z",
        notificationJson: JSON.stringify({
          method: "turn/completed",
          params: { threadId: "native-session-1", turn: { id: "turn-1", status: "completed" } },
        }),
      },
      "2026-08-12T12:00:07.000Z"
    )
  ).toMatchObject({ recorded: true });
  const input = { ...binding, captureDisposition: "drained" as const };
  // No injected session or receipt adapters: execute the real application path checks.
  const delivery = new WorkerReceiptDeliveryService(store, () => "2026-08-12T12:00:08.000Z");
  const verifier = new AgentWorkAttemptVerificationService(
    store,
    runtime,
    () => "2026-08-12T12:00:09.000Z"
  );
  const verification = {
    runId: binding.runId,
    controller,
    expectedRunRevision: 0,
    verificationId: "verification-real-1",
    attemptId: binding.attemptId,
    expectedAttemptRevision: 4,
    workspaceLeaseId: binding.workspaceLeaseId,
    expectedWorkspaceLeaseRevision: 0,
    workerSessionId: binding.sessionId,
    expectedWorkerSessionRevision: 1,
    receiptId: receipt.receipt_id,
    receiptHash: computeCanonicalHash(receipt),
    beginMutationId: "verify-begin-real",
    completeMutationId: "verify-complete-real",
  };
  return { store, worktreePath, delivery, verifier, runtime, input, verification, receipt };
}

describe.skipIf(process.platform !== "linux")("real Linux receipt application integration", () => {
  for (const kind of ["memory", "sqlite"]) {
    it.each([true, false])(
      `${kind}: executes the declared check and preserves a %s success claim honestly`,
      async (succeeds) => {
        const f = await setup(kind, succeeds ? "mostly birds\n" : "not the expected result\n");
        const execute = vi.spyOn(f.runtime, "runCheck"); // Call-through only; real Node process runs.
        expect(await f.delivery.deliver(f.input)).toMatchObject({
          state: "submitted",
          disposition: "verification_pending",
        });
        expect(await f.store.getAttemptVerificationForAttempt(f.input.attemptId)).toBeNull();
        const result = await f.delivery.verify(f.input, f.verification, f.verifier);
        expect(result).toMatchObject({ recorded: true, outcome: succeeds ? "pass" : "fail" });
        expect(execute).toHaveBeenCalledTimes(1);
        const stored = (await f.store.getAttemptVerificationForAttempt(f.input.attemptId))!;
        const evidence = JSON.parse(stored.verificationJson);
        expect(evidence.checks[0]).toMatchObject({
          id: "check-result",
          source: "packet",
          exit_code: succeeds ? 0 : 3,
        });
        expect(evidence.checks[0].stdout_hash).toMatch(/^sha256:/);
        expect(stored.trustGapReasons).toEqual(
          succeeds ? [] : ["claimed_check_disagrees", "worker_outcome_disagrees"]
        );
        expect((await f.store.getAttempt(f.input.attemptId))!.status).not.toBe("accepted");
        expect(await f.delivery.verify(f.input, f.verification, f.verifier)).toMatchObject({
          recorded: true,
          idempotentReplay: true,
        });
        expect(execute).toHaveBeenCalledTimes(1);
      }
    );
    it(`${kind}: rejects replacement of the identity-bound worktree before delivery`, async () => {
      const f = await setup(kind);
      await rename(f.worktreePath, f.worktreePath + "-original");
      await mkdir(f.worktreePath);
      expect(await f.delivery.deliver(f.input)).toMatchObject({
        state: "blocked",
        reason: "evidence_mismatch",
      });
      expect(await f.store.getAttemptReceiptForAttempt(f.input.attemptId)).toBeNull();
      expect((await f.store.getWorkerSession(f.input.sessionId))!.status).toBe("running");
    });
    it(`${kind}: revalidates paths before verification and preserves the historical receipt`, async () => {
      const f = await setup(kind);
      await f.delivery.deliver(f.input);
      await rename(f.worktreePath, f.worktreePath + "-original");
      await mkdir(f.worktreePath);
      const execute = vi.spyOn(f.runtime, "runCheck");
      expect(await f.delivery.verify(f.input, f.verification, f.verifier)).toMatchObject({
        recorded: false,
        reason: "evidence_mismatch",
      });
      expect(execute).not.toHaveBeenCalled();
      expect(await f.store.getAttemptReceiptForAttempt(f.input.attemptId)).not.toBeNull();
      expect(await f.store.getAttemptVerificationForAttempt(f.input.attemptId)).toBeNull();
    });
  }
});

it.skipIf(process.platform !== "win32")(
  "reports native Windows qualification unavailable rather than running the Linux fixture",
  () => {
    expect(resolveWorkspaceBoundary({ mode: "native" })).toMatchObject({
      ok: false,
      decision: {
        state: "unavailable",
        reason_code: "helper_missing",
        backend_kind: "windows-native",
      },
    });
  }
);
