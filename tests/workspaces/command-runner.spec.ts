import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecaCommandRunner } from "../../src/workspaces/command-runner.js";

describe("ExecaCommandRunner", () => {
  const runner = new ExecaCommandRunner();
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lexrunner-command-runner-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const runNode = (source: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
    runner.run({
      executable: process.execPath,
      args: ["-e", source],
      cwd,
      timeoutMs: options.timeoutMs ?? 2_000,
      signal: options.signal,
    });

  it("returns stdout and stderr for a successful direct process", async () => {
    await expect(
      runNode('process.stdout.write("ready\\n"); process.stderr.write("note\\n")')
    ).resolves.toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: "ready\n",
      stderr: "note\n",
    });
  });

  it("reports a nonzero exit with its bounded evidence", async () => {
    const result = await runNode(
      'process.stdout.write("partial\\n"); process.stderr.write("failed\\n"); process.exit(7)'
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "nonzero_exit",
      exitCode: 7,
      stdout: "partial\n",
      stderr: "failed\n",
    });
  });

  it("reports executable spawn errors without throwing", async () => {
    const result = await runner.run({
      executable: `lexrunner-command-does-not-exist-${process.pid}`,
      args: [],
      cwd,
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "spawn_error",
      exitCode: null,
      stdout: "",
    });
    if (!result.ok) expect(result.message).toMatch(/not found|ENOENT/i);
  });

  it("rejects invalid execution bounds before spawning", async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", 'process.stdout.write("should-not-run")'],
      cwd,
      timeoutMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "invalid_request",
      exitCode: null,
      stdout: "",
    });
  });

  it("fails a synchronous identity preflight without spawning", async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", 'process.stdout.write("should-not-run")'],
      cwd,
      timeoutMs: 2_000,
      preflight: () => {
        throw new Error("anchored directory moved");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "preflight_error",
      exitCode: null,
      stdout: "",
      message: "anchored directory moved",
    });
  });

  it("reports timeouts distinctly", async () => {
    const result = await runNode("setInterval(() => {}, 1_000)", { timeoutMs: 100 });

    expect(result).toMatchObject({ ok: false, kind: "timeout", exitCode: null });
  });

  it("reports an already-aborted request without launching successfully", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runNode('process.stdout.write("should-not-run")', {
      signal: controller.signal,
    });

    expect(result).toMatchObject({ ok: false, kind: "aborted", exitCode: null });
  });

  it("reports cancellation while a process is running", async () => {
    const controller = new AbortController();
    const pending = runNode("setInterval(() => {}, 1_000)", { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    const result = await pending;

    expect(result).toMatchObject({ ok: false, kind: "aborted", exitCode: null });
  });

  it("bounds subprocess output", async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(32_000))'],
      cwd,
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    });

    expect(result).toMatchObject({ ok: false, kind: "output_limit" });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_024);
  });

  it("does not interpret arguments through a shell", async () => {
    const shellSyntax = "$(printf injected) && echo nope";
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", shellSyntax],
      cwd,
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({ ok: true, stdout: shellSyntax });
  });

  it("adds an explicit bounded environment without exposing it as arguments", async () => {
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", 'process.stdout.write(process.env.LEXRUNNER_TEST_BOUNDARY ?? "missing")'],
      cwd,
      env: { LEXRUNNER_TEST_BOUNDARY: "isolated" },
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({ ok: true, stdout: "isolated" });
  });

  it("can replace the parent environment with an explicit allowlist", async () => {
    const inheritedKey = `LEXRUNNER_INHERITED_${process.pid}`;
    process.env[inheritedKey] = "must-not-cross";
    try {
      const result = await runner.run({
        executable: process.execPath,
        args: [
          "-e",
          `process.stdout.write(JSON.stringify({
            explicit: process.env.LEXRUNNER_TEST_BOUNDARY,
            inherited: process.env[${JSON.stringify(inheritedKey)}] ?? null
          }))`,
        ],
        cwd,
        env: { LEXRUNNER_TEST_BOUNDARY: "isolated" },
        extendEnv: false,
        timeoutMs: 2_000,
      });

      expect(result).toMatchObject({
        ok: true,
        stdout: '{"explicit":"isolated","inherited":null}',
      });
    } finally {
      delete process.env[inheritedKey];
    }
  });
});
