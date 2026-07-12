import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAttemptCommand } from "../../src/commands/attempt.js";
import type { AttemptLifecycleHandlers } from "../../src/runs/agent-work-adapters.js";

describe("attempt commands", () => {
  let directory: string;
  let program: Command;
  let handlers: AttemptLifecycleHandlers;
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
        result: { run: null, attempt: null, workspace: null },
      })),
    };
    process.exitCode = undefined;
    registerAttemptCommand(program, {
      handlers,
      jsonModeActive: () => Boolean(program.opts().json),
      writeJson: (value) => outputs.push(value),
    });
  });

  afterEach(async () => {
    process.exitCode = undefined;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("registers start and status beneath attempt", () => {
    const attempt = program.commands.find((command) => command.name() === "attempt");
    expect(attempt?.commands.map((command) => command.name())).toEqual(["start", "status"]);
    expect(attempt?.commands[0].options.map((option) => option.long)).toEqual([
      "--input",
      "--json",
    ]);
    expect(attempt?.commands[1].options.map((option) => option.long)).toEqual([
      "--database-path",
      "--run-id",
      "--attempt-id",
      "--json",
    ]);
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
    expect(outputs).toEqual([{ ok: true, result: { run: null, attempt: null, workspace: null } }]);
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
});
