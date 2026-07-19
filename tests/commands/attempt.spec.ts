import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAttemptCommand } from "../../src/commands/attempt.js";
import type {
  AttemptLifecycleHandlers,
  AttemptPreparationHandler,
} from "../../src/runs/agent-work-adapters.js";
import type { AttemptWorkerHandlers } from "../../src/runs/agent-work-worker-adapters.js";
import type { AttemptReceiptHandlers } from "../../src/runs/agent-work-attempt-receipt-adapters.js";
import type { AttemptVerificationHandlers } from "../../src/runs/agent-work-attempt-verification-adapters.js";

describe("attempt commands", () => {
  let directory: string;
  let program: Command;
  let handlers: AttemptLifecycleHandlers;
  let preparationHandler: AttemptPreparationHandler;
  let workerHandlers: AttemptWorkerHandlers;
  let receiptHandlers: AttemptReceiptHandlers;
  let verificationHandlers: AttemptVerificationHandlers;
  let outputs: unknown[];

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "lexrunner-attempt-cli-"));
    program = new Command();
    program.exitOverride();
    program.option("--json");
    outputs = [];
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
    process.exitCode = undefined;
    registerAttemptCommand(program, {
      handlers,
      preparationHandler,
      workerHandlers,
      receiptHandlers,
      verificationHandlers,
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

  it("registers worker, receipt, verification, acceptance, prepare, start, and status beneath attempt", () => {
    const attempt = program.commands.find((command) => command.name() === "attempt");
    expect(attempt?.commands.map((command) => command.name())).toEqual([
      "worker",
      "receipt",
      "verification",
      "acceptance",
      "prepare",
      "start",
      "status",
    ]);
    expect(attempt?.commands[0].commands.map((command) => command.name())).toEqual([
      "attach",
      "heartbeat",
      "end",
      "status",
    ]);
    expect(attempt?.commands[1].commands.map((command) => command.name())).toEqual([
      "submit",
      "status",
    ]);
    expect(attempt?.commands[2].commands.map((command) => command.name())).toEqual([
      "run",
      "status",
    ]);
    expect(attempt?.commands[2].commands[1].options.map((option) => option.long)).toContain(
      "--diagnostics"
    );
    expect(attempt?.commands[3].commands.map((command) => command.name())).toEqual([
      "apply",
      "status",
    ]);
    expect(attempt?.commands[4].options.map((option) => option.long)).toEqual([
      "--input",
      "--json",
    ]);
    expect(attempt?.commands[5].options.map((option) => option.long)).toEqual([
      "--input",
      "--json",
    ]);
    expect(attempt?.commands[6].options.map((option) => option.long)).toEqual([
      "--database-path",
      "--run-id",
      "--attempt-id",
      "--json",
    ]);
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
