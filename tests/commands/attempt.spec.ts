import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAttemptCommand } from "../../src/commands/attempt.js";
import type { AgentWorkContainmentPreflightHandler } from "../../src/runs/agent-work-containment-preflight.js";
import type { NativeWslProjectionLifecycleHandlers } from "../../src/runs/agent-work-projection-lifecycle.js";
import type {
  AttemptLifecycleHandlers,
  AttemptPreparationHandler,
} from "../../src/runs/agent-work-adapters.js";
import type { AttemptWorkerHandlers } from "../../src/runs/agent-work-worker-adapters.js";
import type { AttemptReceiptHandlers } from "../../src/runs/agent-work-attempt-receipt-adapters.js";
import type { AttemptVerificationHandlers } from "../../src/runs/agent-work-attempt-verification-adapters.js";
import type { GovernedDelegationHandlers } from "../../src/runs/governed-delegation-adapters.js";
import type { GovernedAttemptOperationHandlers } from "../../src/runs/governed-attempt-operation-adapters.js";
import type { GovernedAttemptVerificationHandlers } from "../../src/runs/governed-attempt-verification-adapters.js";
import type { GovernedReviewRuntimeHandlers } from "../../src/runs/governed-review-runtime-adapters.js";

describe("attempt commands", () => {
  let directory: string;
  let program: Command;
  let containmentHandler: AgentWorkContainmentPreflightHandler;
  let projectionHandlers: NativeWslProjectionLifecycleHandlers;
  let handlers: AttemptLifecycleHandlers;
  let preparationHandler: AttemptPreparationHandler;
  let workerHandlers: AttemptWorkerHandlers;
  let receiptHandlers: AttemptReceiptHandlers;
  let verificationHandlers: AttemptVerificationHandlers;
  let delegationHandlers: GovernedDelegationHandlers;
  let governedReviewHandlers: GovernedAttemptOperationHandlers;
  let governedReviewVerificationHandlers: GovernedAttemptVerificationHandlers;
  let governedReviewRuntimeHandlers: GovernedReviewRuntimeHandlers;
  let outputs: unknown[];

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-attempt-cli-"));
    program = new Command();
    program.exitOverride();
    program.option("--json");
    outputs = [];
    containmentHandler = {
      preflight: vi.fn(async () => ({
        ok: true,
        result: {
          state: "native_ready",
          physicalContainmentAvailable: true,
        } as never,
      })),
    };
    projectionHandlers = {
      prepare: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.projection.prepare",
          state: "ready",
        } as never,
      })),
      status: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.projection.status",
          state: "ready",
        } as never,
      })),
      cleanup: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.projection.cleanup",
          outcome: "cleaned",
        } as never,
      })),
      quarantine: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.projection.quarantine.inspect",
        } as never,
      })),
    };
    handlers = {
      start: vi.fn(async () => ({ ok: true, result: { outcome: "launch_authorized" } as never })),
      status: vi.fn(async () => ({
        ok: true,
        result: { run: null, attempt: null, workspace: null, launch: null },
      })),
    };
    preparationHandler = {
      prepare: vi.fn(async () => ({
        ok: true,
        result: { ok: true, outcome: "launch_bundle_ready" } as never,
      })),
    };
    workerHandlers = {
      attach: vi.fn(async () => ({ ok: true, result: { updated: true } as never })),
      heartbeat: vi.fn(async () => ({ ok: true, result: { updated: true } as never })),
      end: vi.fn(async () => ({ ok: true, result: { updated: true } as never })),
      status: vi.fn(async () => ({ ok: true, result: { workerSession: null } })),
    };
    receiptHandlers = {
      submit: vi.fn(async () => ({
        ok: true,
        result: {
          submitted: true,
          receiptId: "receipt-1",
          receiptHash: `sha256:${"b".repeat(64)}`,
          attemptId: "attempt-1",
          outcome: "completed",
          disposition: "verification_pending",
          attemptRevision: 5,
          attemptStatus: "receipt_submitted",
          event: {
            type: "attempt_receipt_submitted",
            sequence: 1,
            createdAt: "2026-07-14T12:00:00.000Z",
          },
          idempotentReplay: false,
        },
      })),
      status: vi.fn(async () => ({ ok: true, result: { receipt: null } })),
    };
    verificationHandlers = {
      run: vi.fn(async () => ({ ok: true, result: { recorded: true } as never })),
      status: vi.fn(async () => ({ ok: true, result: { verification: null } })),
      applyAcceptance: vi.fn(async () => ({ ok: true, result: { applied: true } as never })),
      acceptanceStatus: vi.fn(async () => ({ ok: true, result: { acceptance: null } })),
    };
    delegationHandlers = {
      synthetic: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.delegation.synthetic",
          syntheticOnly: true,
          completed: true,
          delegationId: "delegation-1",
          attemptId: "attempt-1",
          status: "declined",
          decision: "decline",
          terminal: true,
          reasonVolunteered: false,
          executorInvocation: {
            attempted: false,
            authorized: false,
            denialReason: "delegation_declined",
          },
          evidence: {
            offerHash: `sha256:${"c".repeat(64)}`,
            decisionReceiptHash: `sha256:${"d".repeat(64)}`,
          },
          eventCount: 3,
        },
      })),
      status: vi.fn(async () => ({ ok: true, result: { record: null, events: [] } })),
    };
    governedReviewHandlers = {
      status: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.review.status",
          found: true,
          operationId: "operation-1",
          status: "running",
        },
      })),
    };
    governedReviewVerificationHandlers = {
      verify: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.review.verify",
          operationId: "operation-1",
          verificationId: "verification-1",
          verified: true,
          decision: "accepted",
          taskOutcome: "block",
          admissibility: "admissible",
          failureCodes: [],
          receiptHash: `sha256:${"e".repeat(64)}`,
        },
      })),
    };
    governedReviewRuntimeHandlers = {
      start: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.review.start",
          started: true,
          operationId: "operation-1",
          delegationId: "delegation-1",
          captureId: "capture-1",
          supervisionStarted: true,
        },
      })),
      supervise: vi.fn(async () => ({
        ok: true,
        result: {
          operation: "agent-work.review.supervise",
          operationId: "operation-1",
          supervised: true,
          status: "completed",
          verificationDecision: "accepted",
        },
      })),
    };
    process.exitCode = undefined;
    registerAttemptCommand(program, {
      containmentHandler,
      projectionHandlers,
      handlers,
      preparationHandler,
      workerHandlers,
      receiptHandlers,
      verificationHandlers,
      delegationHandlers,
      governedReviewHandlers,
      governedReviewVerificationHandlers,
      governedReviewRuntimeHandlers,
      jsonModeActive: () => Boolean(program.opts().json),
      writeJson: (value) => outputs.push(value),
    });
  });

  it("forwards verification and acceptance inputs through their shared public handlers", async () => {
    const verificationRequest = { verification: { verificationId: "verification-1" } };
    const acceptanceRequest = { acceptance: { verificationId: "verification-1" } };
    const verificationPath = join(directory, "verification-run.json");
    const acceptancePath = join(directory, "acceptance-apply.json");
    await fs.writeFile(verificationPath, JSON.stringify(verificationRequest));
    await fs.writeFile(acceptancePath, JSON.stringify(acceptanceRequest));

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "verification",
      "run",
      "--input",
      verificationPath,
      "--json",
    ]);
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "verification",
      "status",
      "--database-path",
      "/tmp/lifecycle.db",
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--diagnostics",
      "--json",
    ]);
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "acceptance",
      "apply",
      "--input",
      acceptancePath,
      "--json",
    ]);
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "acceptance",
      "status",
      "--database-path",
      "/tmp/lifecycle.db",
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--json",
    ]);

    expect(verificationHandlers.run).toHaveBeenCalledWith(verificationRequest);
    expect(verificationHandlers.status).toHaveBeenCalledWith({
      databasePath: "/tmp/lifecycle.db",
      runId: "run-1",
      attemptId: "attempt-1",
      diagnostics: true,
    });
    expect(verificationHandlers.applyAcceptance).toHaveBeenCalledWith(acceptanceRequest);
    expect(verificationHandlers.acceptanceStatus).toHaveBeenCalledWith({
      databasePath: "/tmp/lifecycle.db",
      runId: "run-1",
      attemptId: "attempt-1",
    });
    expect(outputs).toEqual([
      { ok: true, result: { recorded: true } },
      { ok: true, result: { verification: null } },
      { ok: true, result: { applied: true } },
      { ok: true, result: { acceptance: null } },
    ]);
  });

  afterEach(async () => {
    process.exitCode = undefined;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("registers projection and Attempt lifecycle commands beneath one machine-facing surface", () => {
    const attempt = program.commands.find((command) => command.name() === "attempt");
    expect(attempt?.commands.map((command) => command.name())).toEqual([
      "preflight",
      "projection",
      "worker",
      "receipt",
      "verification",
      "acceptance",
      "prepare",
      "start",
      "status",
      "delegation",
      "review",
    ]);
    expect(attempt?.commands[0].options.map((option) => option.long)).toEqual([
      "--input",
      "--json",
    ]);
    expect(attempt?.commands[1].commands.map((command) => command.name())).toEqual([
      "prepare",
      "status",
      "cleanup",
      "quarantine",
    ]);
    expect(attempt?.commands[2].commands.map((command) => command.name())).toEqual([
      "attach",
      "heartbeat",
      "end",
      "status",
    ]);
    expect(attempt?.commands[3].commands.map((command) => command.name())).toEqual([
      "submit",
      "status",
    ]);
    expect(attempt?.commands[4].commands.map((command) => command.name())).toEqual([
      "run",
      "status",
    ]);
    expect(attempt?.commands[4].commands[1].options.map((option) => option.long)).toContain(
      "--diagnostics"
    );
    expect(attempt?.commands[5].commands.map((command) => command.name())).toEqual([
      "apply",
      "status",
    ]);
    expect(attempt?.commands[6].options.map((option) => option.long)).toEqual([
      "--input",
      "--json",
    ]);
    expect(attempt?.commands[7].options.map((option) => option.long)).toEqual([
      "--input",
      "--json",
    ]);
    expect(attempt?.commands[8].options.map((option) => option.long)).toEqual([
      "--database-path",
      "--run-id",
      "--attempt-id",
      "--json",
    ]);
    expect(attempt?.commands[9].commands.map((command) => command.name())).toEqual([
      "synthetic",
      "status",
    ]);
    expect(attempt?.commands[10].commands.map((command) => command.name())).toEqual([
      "status",
      "verify",
      "start",
      "supervise",
    ]);
  });

  it("reads asynchronous governed review status without raw evidence access", async () => {
    const databasePath = join(directory, "operations.db");
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "review",
      "status",
      "--database-path",
      databasePath,
      "--operation-id",
      "operation-1",
      "--json",
    ]);
    expect(governedReviewHandlers.status).toHaveBeenCalledWith({
      databasePath,
      operationId: "operation-1",
    });
    expect(outputs.at(-1)).toMatchObject({
      ok: true,
      result: { operation: "agent-work.review.status", status: "running" },
    });
  });

  it("forwards independent governed review verification without exposing an evidence path", async () => {
    const databasePath = join(directory, "operations.db");
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "review",
      "verify",
      "--database-path",
      databasePath,
      "--operation-id",
      "operation-1",
      "--verification-id",
      "verification-1",
      "--json",
    ]);
    expect(governedReviewVerificationHandlers.verify).toHaveBeenCalledWith({
      databasePath,
      operationId: "operation-1",
      verificationId: "verification-1",
    });
    expect(outputs.at(-1)).toMatchObject({
      ok: true,
      result: { operation: "agent-work.review.verify", admissibility: "admissible" },
    });
  });

  it("forwards a bounded prompt into the durable governed review start path", async () => {
    const databasePath = join(directory, "operations.db");
    const promptPath = join(directory, "review-prompt.txt");
    await fs.writeFile(promptPath, "You may answer ACCEPT or NO.", "utf8");
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "review",
      "start",
      "--database-path",
      databasePath,
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--distribution",
      "lexrunner-attempt-01234567",
      "--environment-id",
      "environment-1",
      "--objective",
      "Review the synthetic retry-window corpus",
      "--prompt",
      promptPath,
      "--json",
    ]);
    expect(governedReviewRuntimeHandlers.start).toHaveBeenCalledWith({
      databasePath,
      runId: "run-1",
      attemptId: "attempt-1",
      distribution: "lexrunner-attempt-01234567",
      environmentId: "environment-1",
      objective: "Review the synthetic retry-window corpus",
      corpusKind: "synthetic",
      prompt: Buffer.from("You may answer ACCEPT or NO."),
    });
    expect(outputs.at(-1)).toMatchObject({
      ok: true,
      result: { operation: "agent-work.review.start", supervisionStarted: true },
    });
  });

  it("selects the sealed repository corpus only when explicitly requested", async () => {
    const databasePath = join(directory, "operations.db");
    const promptPath = join(directory, "repository-review-prompt.txt");
    await fs.writeFile(promptPath, "Review the exact committed candidate.", "utf8");
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "review",
      "start",
      "--database-path",
      databasePath,
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--distribution",
      "lexrunner-attempt-01234567",
      "--environment-id",
      "environment-1",
      "--objective",
      "Review the candidate",
      "--prompt",
      promptPath,
      "--repository",
      "--json",
    ]);
    expect(governedReviewRuntimeHandlers.start).toHaveBeenCalledWith(
      expect.objectContaining({ corpusKind: "repository" })
    );
  });

  it("forwards detached governed review supervision without prompt or evidence access", async () => {
    const databasePath = join(directory, "operations.db");
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "review",
      "supervise",
      "--database-path",
      databasePath,
      "--operation-id",
      "operation-1",
      "--distribution",
      "lexrunner-attempt-01234567",
      "--json",
    ]);
    expect(governedReviewRuntimeHandlers.supervise).toHaveBeenCalledWith({
      databasePath,
      operationId: "operation-1",
      distribution: "lexrunner-attempt-01234567",
    });
    expect(outputs.at(-1)).toMatchObject({
      ok: true,
      result: { operation: "agent-work.review.supervise", verificationDecision: "accepted" },
    });
  });

  it("treats synthetic NO as a successful terminal protocol result", async () => {
    const databasePath = join(directory, "delegations.db");
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "delegation",
      "synthetic",
      "--database-path",
      databasePath,
      "--delegation-id",
      "delegation-1",
      "--decision",
      "NO",
      "--json",
    ]);

    expect(delegationHandlers.synthetic).toHaveBeenCalledWith({
      databasePath,
      delegationId: "delegation-1",
      decision: "NO",
    });
    expect(process.exitCode).toBeUndefined();
    expect(outputs.at(-1)).toMatchObject({
      ok: true,
      result: {
        completed: true,
        status: "declined",
        executorInvocation: { attempted: false, authorized: false },
      },
    });
  });

  it("maps an incomplete synthetic protocol operation to exit one", async () => {
    vi.mocked(delegationHandlers.synthetic).mockResolvedValueOnce({
      ok: true,
      result: {
        operation: "agent-work.delegation.synthetic",
        syntheticOnly: true,
        completed: false,
        delegationId: "delegation-1",
        attemptId: "attempt-1",
        reason: "mutation_conflict",
      },
    });
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "delegation",
      "synthetic",
      "--database-path",
      join(directory, "delegations.db"),
      "--delegation-id",
      "delegation-1",
      "--decision",
      "NO",
      "--json",
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("forwards every projection operation through the shared lifecycle handler", async () => {
    const requests = {
      prepare: { request: { request_id: "projection" }, mutation: { authorized: true } },
      status: { request: { request_id: "projection" } },
      cleanup: { request: { request_id: "projection" }, mutation: { authorized: true } },
      quarantine: { request: { request_id: "projection" } },
    };
    for (const [operation, request] of Object.entries(requests)) {
      const input = join(directory, `projection-${operation}.json`);
      await fs.writeFile(input, JSON.stringify(request));
      await program.parseAsync([
        "node",
        "lex-pr",
        "attempt",
        "projection",
        operation,
        "--input",
        input,
        "--json",
      ]);
    }

    expect(projectionHandlers.prepare).toHaveBeenCalledWith(requests.prepare);
    expect(projectionHandlers.status).toHaveBeenCalledWith(requests.status);
    expect(projectionHandlers.cleanup).toHaveBeenCalledWith(requests.cleanup);
    expect(projectionHandlers.quarantine).toHaveBeenCalledWith(requests.quarantine);
  });

  it("forwards containment preflight input and maps broker-required capability to exit one", async () => {
    const request = {
      runtime: {
        repositoryId: "repo-1",
        repositoryRoot: "D:\\dev\\stfc-mod",
        worktreeRoot: "D:\\dev\\worktrees",
        gitRuntime: "windows",
        pathComparison: "case-insensitive",
      },
    };
    const inputPath = join(directory, "containment-preflight.json");
    await fs.writeFile(inputPath, JSON.stringify(request));
    vi.mocked(containmentHandler.preflight).mockResolvedValueOnce({
      ok: true,
      result: {
        state: "broker_required",
        reasonCode: "windows_requires_native_wsl_broker",
      } as never,
    });

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "preflight",
      "--input",
      inputPath,
      "--json",
    ]);

    expect(containmentHandler.preflight).toHaveBeenCalledWith(request);
    expect(outputs).toEqual([
      {
        ok: true,
        result: {
          state: "broker_required",
          reasonCode: "windows_requires_native_wsl_broker",
        },
      },
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("forwards Attempt receipt submit and status input unchanged", async () => {
    const request = { submission: { receipt: { receipt_id: "receipt-1" } } };
    const path = join(directory, "receipt-submit.json");
    await fs.writeFile(path, JSON.stringify(request));

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "receipt",
      "submit",
      "--input",
      path,
      "--json",
    ]);
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "receipt",
      "status",
      "--database-path",
      "/tmp/lifecycle.db",
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--json",
    ]);

    expect(receiptHandlers.submit).toHaveBeenCalledWith(request);
    expect(receiptHandlers.status).toHaveBeenCalledWith({
      databasePath: "/tmp/lifecycle.db",
      runId: "run-1",
      attemptId: "attempt-1",
    });
    expect(outputs).toEqual([
      {
        ok: true,
        result: {
          submitted: true,
          receiptId: "receipt-1",
          receiptHash: `sha256:${"b".repeat(64)}`,
          attemptId: "attempt-1",
          outcome: "completed",
          disposition: "verification_pending",
          attemptRevision: 5,
          attemptStatus: "receipt_submitted",
          event: {
            type: "attempt_receipt_submitted",
            sequence: 1,
            createdAt: "2026-07-14T12:00:00.000Z",
          },
          idempotentReplay: false,
        },
      },
      { ok: true, result: { receipt: null } },
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it("maps rejected and invalid Attempt receipt submissions to exit codes one and two", async () => {
    const path = join(directory, "receipt-submit.json");
    await fs.writeFile(path, "{}");
    vi.mocked(receiptHandlers.submit).mockResolvedValueOnce({
      ok: true,
      result: { submitted: false, reason: "receipt_conflict" },
    });

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "receipt",
      "submit",
      "--input",
      path,
      "--json",
    ]);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    vi.mocked(receiptHandlers.submit).mockResolvedValueOnce({
      ok: false,
      error: { code: "invalid_input", message: "Invalid receipt", issues: [] },
    });
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "receipt",
      "submit",
      "--input",
      path,
      "--json",
    ]);
    expect(process.exitCode).toBe(2);
  });

  it("forwards native worker attachment input unchanged", async () => {
    const request = { attach: { workerSessionId: "native-session-1" } };
    const path = join(directory, "worker-attach.json");
    await fs.writeFile(path, JSON.stringify(request));

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "worker",
      "attach",
      "--input",
      path,
      "--json",
    ]);

    expect(workerHandlers.attach).toHaveBeenCalledWith(request);
    expect(outputs).toEqual([{ ok: true, result: { updated: true } }]);
  });

  it("forwards exact worker status identity", async () => {
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "worker",
      "status",
      "--database-path",
      "/tmp/lifecycle.db",
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--json",
    ]);

    expect(workerHandlers.status).toHaveBeenCalledWith({
      databasePath: "/tmp/lifecycle.db",
      runId: "run-1",
      attemptId: "attempt-1",
    });
  });

  it("maps a rejected worker mutation to exit code one", async () => {
    vi.mocked(workerHandlers.attach).mockResolvedValue({
      ok: true,
      result: { updated: false, reason: "worker_session_conflict" },
    });
    const path = join(directory, "worker-attach.json");
    await fs.writeFile(path, "{}");

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "worker",
      "attach",
      "--input",
      path,
      "--json",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("forwards an assisted preparation request unchanged", async () => {
    const request = { workItem: { work_item_id: "work-1" }, identity: { runId: "run-1" } };
    const path = join(directory, "prepare.json");
    await fs.writeFile(path, JSON.stringify(request));

    await program.parseAsync(["node", "lex-pr", "attempt", "prepare", "--input", path, "--json"]);

    expect(preparationHandler.prepare).toHaveBeenCalledWith(request);
    expect(outputs).toEqual([{ ok: true, result: { ok: true, outcome: "launch_bundle_ready" } }]);
  });

  it("parses a bounded JSON file and forwards it unchanged", async () => {
    const request = { runtime: { repositoryRoot: "/repo" }, operation: { runId: "run-1" } };
    const path = join(directory, "start.json");
    await fs.writeFile(path, JSON.stringify(request));

    await program.parseAsync(["node", "lex-pr", "attempt", "start", "--input", path, "--json"]);

    expect(handlers.start).toHaveBeenCalledWith(request);
    expect(outputs).toEqual([{ ok: true, result: { outcome: "launch_authorized" } }]);
  });

  it("accepts global JSON mode", async () => {
    const path = join(directory, "start.json");
    await fs.writeFile(path, "{}");

    await program.parseAsync(["node", "lex-pr", "--json", "attempt", "start", "--input", path]);

    expect(handlers.start).toHaveBeenCalledWith({});
  });

  it("writes only canonical JSON to stdout in machine mode", async () => {
    const path = join(directory, "start.json");
    await fs.writeFile(path, "{}");
    const isolated = new Command();
    isolated.exitOverride();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    registerAttemptCommand(isolated, { handlers, jsonModeActive: () => true });

    await isolated.parseAsync(["node", "lex-pr", "attempt", "start", "--input", path, "--json"]);

    const written = stdout.mock.calls.map(([value]) => String(value)).join("");
    expect(JSON.parse(written)).toEqual({ ok: true, result: { outcome: "launch_authorized" } });
    expect(written.endsWith("\n")).toBe(true);
    stdout.mockRestore();
  });

  it("forwards exact status identity", async () => {
    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "status",
      "--database-path",
      "/tmp/lifecycle.db",
      "--run-id",
      "run-1",
      "--attempt-id",
      "attempt-1",
      "--json",
    ]);

    expect(handlers.status).toHaveBeenCalledWith({
      databasePath: "/tmp/lifecycle.db",
      runId: "run-1",
      attemptId: "attempt-1",
    });
    expect(outputs).toEqual([
      { ok: true, result: { run: null, attempt: null, workspace: null, launch: null } },
    ]);
  });

  it("rejects malformed JSON without calling the handler", async () => {
    const path = join(directory, "start.json");
    await fs.writeFile(path, "not-json");

    await expect(
      program.parseAsync(["node", "lex-pr", "attempt", "start", "--input", path, "--json"])
    ).rejects.toMatchObject({ exitCode: 2, message: "Attempt input must be valid JSON" });
    expect(handlers.start).not.toHaveBeenCalled();
    expect(outputs).toEqual([]);
  });

  it("rejects oversized input before parsing or dispatch", async () => {
    const path = join(directory, "start.json");
    await fs.writeFile(path, JSON.stringify({ value: "large" }));
    const isolated = new Command();
    isolated.exitOverride();
    registerAttemptCommand(isolated, {
      handlers,
      jsonModeActive: () => true,
      maxInputBytes: 4,
      writeJson: (value) => outputs.push(value),
    });

    await expect(
      isolated.parseAsync(["node", "lex-pr", "attempt", "start", "--input", path, "--json"])
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(handlers.start).not.toHaveBeenCalled();
  });

  it("requires explicit machine output mode", async () => {
    await expect(
      program.parseAsync([
        "node",
        "lex-pr",
        "attempt",
        "status",
        "--database-path",
        "/tmp/lifecycle.db",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
      ])
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(handlers.status).not.toHaveBeenCalled();
  });

  it("maps a shared input failure to exit code two after emitting it", async () => {
    vi.mocked(handlers.status).mockResolvedValue({
      ok: false,
      error: { code: "invalid_input", message: "Invalid input", issues: [] },
    });

    await program.parseAsync([
      "node",
      "lex-pr",
      "attempt",
      "status",
      "--database-path",
      "/tmp/lifecycle.db",
      "--run-id",
      "missing-run",
      "--attempt-id",
      "missing-attempt",
      "--json",
    ]);

    expect(outputs).toEqual([
      { ok: false, error: { code: "invalid_input", message: "Invalid input", issues: [] } },
    ]);
    expect(process.exitCode).toBe(2);
  });

  it("maps a domain lifecycle failure to exit code one", async () => {
    vi.mocked(handlers.start).mockResolvedValue({
      ok: true,
      result: {
        ok: false,
        phase: "controller",
        reason: "controller_held",
        reconciliationRequired: false,
      },
    });
    const path = join(directory, "start.json");
    await fs.writeFile(path, "{}");

    await program.parseAsync(["node", "lex-pr", "attempt", "start", "--input", path, "--json"]);

    expect(process.exitCode).toBe(1);
  });

  it("maps a preparation lifecycle failure to exit code one", async () => {
    vi.mocked(preparationHandler.prepare).mockResolvedValue({
      ok: true,
      result: {
        ok: false,
        phase: "workspace_allocate",
        reason: "workspace_rejected",
        reconciliationRequired: true,
      },
    });
    const path = join(directory, "prepare.json");
    await fs.writeFile(path, "{}");

    await program.parseAsync(["node", "lex-pr", "attempt", "prepare", "--input", path, "--json"]);

    expect(process.exitCode).toBe(1);
  });
});
