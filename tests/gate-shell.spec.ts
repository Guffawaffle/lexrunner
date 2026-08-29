import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Ajv from "ajv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { executeGate, resolveLocalGateShell } from "../src/gates.js";
import {
  MAX_GATE_RECEIPT_OUTPUT_BYTES,
  type LocalGateExecutionReceipt,
} from "../src/gates/execution-receipt.js";
import type { Gate, Policy } from "../src/schema.js";
import { resetCommandValidator } from "../src/security/commandValidator.js";

const policy: Policy = {
  requiredGates: [],
  optionalGates: [],
  maxWorkers: 1,
  retries: {},
  overrides: {},
  blockOn: [],
  mergeRule: { type: "strict-required" },
};
const receiptSchema = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../schemas/gate-execution-receipt.schema.json"),
    "utf8"
  )
);
const validateReceipt = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
  receiptSchema
);

describe("local gate shell routing", () => {
  it("uses PowerShell 7 without profiles for Windows-native gates", () => {
    expect(resolveLocalGateShell("npm test", "win32")).toEqual({
      command: "pwsh",
      arguments: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "npm test"],
    });
  });

  it("preserves the POSIX bash contract outside Windows", () => {
    expect(resolveLocalGateShell("npm test", "linux")).toEqual({
      command: "bash",
      arguments: ["-c", "npm test"],
    });
  });
});

describe.skipIf(process.platform !== "win32")("Windows local gate shell execution", () => {
  let artifactDir: string;

  beforeEach(() => {
    artifactDir = mkdtempSync(`${tmpdir()}\\lexrunner-windows-gate-shell-`);
    resetCommandValidator();
  });

  afterEach(() => {
    rmSync(artifactDir, { recursive: true, force: true });
    resetCommandValidator();
  });

  async function run(run: string, options: Partial<Gate> = {}, timeoutMs = 5_000) {
    const gate: Gate = {
      name: "windows-shell-contract",
      run,
      runtime: "local",
      artifacts: [],
      ...options,
    };
    return executeGate(gate, policy, artifactDir, timeoutMs);
  }

  function receiptFor(result: Awaited<ReturnType<typeof run>>): LocalGateExecutionReceipt {
    const receiptPath = result.artifacts?.find((candidate) =>
      candidate.endsWith("gate-execution-receipt.attempt-1.json")
    );
    expect(receiptPath).toBeDefined();
    const receipt = JSON.parse(readFileSync(receiptPath!, "utf8")) as LocalGateExecutionReceipt;
    expect(validateReceipt(receipt), JSON.stringify(validateReceipt.errors)).toBe(true);
    return receipt;
  }

  it("executes in the declared working directory", async () => {
    const workingDirectory = mkdtempSync(`${tmpdir()}\\lexrunner-windows-gate-cwd-`);
    try {
      const result = await run("[Console]::Out.Write((Get-Location).Path)", {
        cwd: workingDirectory,
      });

      expect(result).toMatchObject({ status: "pass", exitCode: 0 });
      expect(resolve(result.stdout).toLowerCase()).toBe(resolve(workingDirectory).toLowerCase());
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("forwards gate environment values without reparsing them", async () => {
    const value = `spaces "double" 'single'; $literal & tail`;
    const result = await run("[Console]::Out.Write($env:LEXRUNNER_GATE_TEST_VALUE)", {
      env: { LEXRUNNER_GATE_TEST_VALUE: value },
    });

    expect(result).toMatchObject({ status: "pass", exitCode: 0, stdout: value });
  });

  it("preserves PowerShell quoting in the frozen command", async () => {
    const result = await run(
      `[Console]::Out.Write('spaces "double" and ''single''; $literal & tail')`
    );

    expect(result).toMatchObject({
      status: "pass",
      exitCode: 0,
      stdout: `spaces "double" and 'single'; $literal & tail`,
    });
  });

  it("preserves a nonzero PowerShell exit and stderr", async () => {
    const result = await run("[Console]::Error.Write('native failure'); exit 23");

    expect(result).toMatchObject({
      status: "fail",
      exitCode: 23,
      failureKind: "nonzero_exit",
      stderr: "native failure",
    });
    const receipt = receiptFor(result);
    expect(receipt).toMatchObject({
      schemaVersion: "lexrunner-gate-execution-receipt/v2",
      attempt: 1,
      declaredGate: {
        name: "windows-shell-contract",
        run: "[Console]::Error.Write('native failure'); exit 23",
        cwd: null,
        runtime: "local",
        artifacts: [],
      },
      execution: {
        cwd: resolve(process.cwd()),
        shell: {
          command: "pwsh",
          argv: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::Error.Write('native failure'); exit 23",
          ],
          spawned: true,
          unchanged: true,
        },
      },
      outcome: {
        status: "fail",
        exitCode: 23,
        failureKind: "nonzero_exit",
        evidenceComplete: true,
      },
      output: { stderr: { content: "native failure", truncated: false } },
      artifacts: [],
    });
    expect(receipt.execution.shell.executable?.realPath.toLowerCase()).toMatch(/pwsh\.exe$/u);
    expect(receipt.execution.shell.executable?.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("retains and hashes only a fresh declared artifact", async () => {
    const declaredArtifact = join(artifactDir, "declared proof.json");
    const command =
      "[IO.File]::WriteAllText($env:LEXRUNNER_GATE_ARTIFACT, 'fresh proof', [Text.UTF8Encoding]::new($false)); [Console]::Out.Write('created')";
    const result = await run(command, {
      env: { LEXRUNNER_GATE_ARTIFACT: declaredArtifact },
      artifacts: [declaredArtifact],
    });

    expect(result).toMatchObject({ status: "pass", exitCode: 0, stdout: "created" });
    expect(result.artifacts).toHaveLength(2);
    const receipt = receiptFor(result);
    expect(receipt.outcome.evidenceComplete).toBe(true);
    expect(receipt.artifacts).toHaveLength(1);
    expect(receipt.artifacts[0]).toMatchObject({
      declaredPath: declaredArtifact,
      resolvedPath: declaredArtifact,
      status: "collected",
      before: null,
    });
    expect(receipt.artifacts[0]?.source?.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt.artifacts[0]?.retained?.sha256).toBe(receipt.artifacts[0]?.source?.sha256);
    expect(readFileSync(receipt.artifacts[0]!.retainedPath!, "utf8")).toBe("fresh proof");
  });

  it("fails closed instead of collecting an unchanged declared artifact", async () => {
    const declaredArtifact = join(artifactDir, "stale-proof.json");
    writeFileSync(declaredArtifact, '{"passed":true}\n', "utf8");
    const result = await run("[Console]::Out.Write('did not refresh')", {
      artifacts: [declaredArtifact],
    });

    expect(result).toMatchObject({
      status: "fail",
      exitCode: 1,
      failureKind: "evidence_error",
      stdout: "did not refresh",
    });
    expect(result.stderr).toContain("GATE_EVIDENCE_INVALID");
    expect(result.artifacts).toHaveLength(1);
    const receipt = receiptFor(result);
    expect(receipt.outcome).toMatchObject({
      status: "fail",
      exitCode: 1,
      failureKind: "evidence_error",
      evidenceComplete: false,
    });
    expect(receipt.artifacts).toMatchObject([{ status: "stale" }]);
    expect(receipt.artifacts[0]?.before?.sha256).toBe(receipt.artifacts[0]?.source?.sha256);
  });

  it("hashes complete output while retaining only bounded content", async () => {
    const result = await run("[Console]::Out.Write('x' * 70000)");
    const stdout = receiptFor(result).output.stdout;

    expect(stdout).toMatchObject({ bytes: 70_000, truncated: true });
    expect(stdout.sha256).toBe(
      `sha256:${createHash("sha256").update("x".repeat(70_000), "utf8").digest("hex")}`
    );
    expect(Buffer.byteLength(stdout.content, "utf8")).toBe(MAX_GATE_RECEIPT_OUTPUT_BYTES);
  });

  it("terminates a timed-out PowerShell gate", async () => {
    const result = await run("Start-Sleep -Seconds 10", {}, 250);

    expect(result).toMatchObject({
      status: "fail",
      exitCode: 124,
      failureKind: "timeout",
      timeoutCleanup: {
        method: "taskkill",
        forceKilled: true,
        descendantsReaped: true,
      },
    });
    expect(result.stderr).toContain("GATE_TIMEOUT");
    expect(result.duration).toBeLessThan(5_000);
    expect(receiptFor(result)).toMatchObject({
      outcome: { status: "fail", exitCode: 124, failureKind: "timeout" },
      execution: { shell: { command: "pwsh", spawned: true, unchanged: true } },
    });
  }, 10_000);
});
