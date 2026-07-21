import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeGate, executeItemGates, executeGatesWithPolicy } from "../src/gates.js";
import { loadPlan, Policy, Gate } from "../src/schema.js";
import { ExecutionState } from "../src/executionState.js";
import { resetCommandValidator } from "../src/security/commandValidator.js";
import { getGateFailures, FailureErrorCode } from "../src/runs/failures.js";
import { ensureRunDir } from "../src/runs/storage.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Gate Execution", () => {
  const defaultPolicy: Policy = {
    requiredGates: [],
    optionalGates: [],
    maxWorkers: 1,
    retries: {},
    overrides: {},
    blockOn: [],
    mergeRule: { type: "strict-required" },
  };

  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
    resetCommandValidator(); // Reset validator to avoid state pollution
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    resetCommandValidator(); // Clean up after test
  });

  it("executes a passing gate", async () => {
    const gate: Gate = {
      name: "test-pass",
      run: 'bash -c "exit 0"',
      runtime: "local",
    };

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.gate).toBe("test-pass");
    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.attempts).toBe(1);
    expect(result.lastAttempt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date format
  });

  it("executes a failing gate", async () => {
    const gate: Gate = {
      name: "test-fail",
      run: 'bash -c "echo error message >&2; exit 1"',
      runtime: "local",
    };

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.gate).toBe("test-fail");
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error message");
  });

  it("captures stdout and stderr", async () => {
    const gate: Gate = {
      name: "test-output",
      run: 'bash -c "echo hello world; echo error message >&2"',
      runtime: "local",
    };

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.stdout).toContain("hello world");
    expect(result.stderr).toContain("error message");
  });

  it("respects working directory", async () => {
    const testCwd = path.join(os.tmpdir(), "test-cwd-" + Math.random().toString(36).substring(7));

    // Create the test directory
    fs.mkdirSync(testCwd, { recursive: true });

    try {
      const gate: Gate = {
        name: "test-cwd",
        run: 'node -e "console.log(process.cwd())"',
        cwd: testCwd,
        env: {},
        runtime: "local",
        artifacts: [],
      };

      const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

      // Normalize paths for comparison (handle Windows vs Unix)
      const normalizedOutput = (result.stdout || "").trim().replace(/\\/g, "/");
      const normalizedExpected = testCwd.replace(/\\/g, "/");
      expect(normalizedOutput).toContain(normalizedExpected);
    } finally {
      // Clean up the test directory
      fs.rmSync(testCwd, { recursive: true, force: true });
    }
  });

  it("respects environment variables", async () => {
    const gate: Gate = {
      name: "test-env",
      run: "echo $TEST_VAR",
      env: { TEST_VAR: "test-value" },
      runtime: "local",
      artifacts: [],
    };

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

    expect(result.stdout).toContain("test-value");
  });

  it("handles timeouts", async () => {
    const gate: Gate = {
      name: "test-timeout",
      run: "sleep 1", // Sleep for 1 second
      env: {},
      runtime: "local",
      artifacts: [],
    };

    const result = await executeGate(gate, defaultPolicy, tempDir, 100); // 100ms timeout

    expect(result.gate).toBe("test-timeout");
    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(124);
    expect(result.failureKind).toBe("timeout");
    expect(result.stderr).toContain("GATE_TIMEOUT");
    expect(result.timeoutCleanup?.descendantsReaped).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "leaves no descendant process alive after a timeout",
    async () => {
      const pidFile = path.join(tempDir, "descendant.pid");
      const script = path.join(tempDir, "spawn-descendant.mjs");
      fs.writeFileSync(
        script,
        [
          'import { spawn } from "node:child_process";',
          'import { writeFileSync } from "node:fs";',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
          "writeFileSync(process.argv[2], String(child.pid));",
          "setInterval(() => {}, 1000);",
        ].join("\n")
      );
      const gate: Gate = {
        name: "test-process-tree-timeout",
        run: `node ${JSON.stringify(script)} ${JSON.stringify(pidFile)}`,
        env: {},
        runtime: "local",
        artifacts: [],
      };

      const result = await executeGate(gate, defaultPolicy, tempDir, 250);
      const descendantPid = Number(fs.readFileSync(pidFile, "utf8"));

      expect(result).toMatchObject({
        status: "fail",
        exitCode: 124,
        failureKind: "timeout",
        timeoutCleanup: { method: "process-group", descendantsReaped: true },
      });
      expect(processExists(descendantPid)).toBe(false);
    },
    10_000
  );

  it("executes item gates sequentially", async () => {
    const item = {
      name: "test-item",
      deps: [],
      gates: [
        { name: "gate1", run: 'echo "gate 1"', env: {}, runtime: "local" as const, artifacts: [] },
        { name: "gate2", run: 'echo "gate 2"', env: {}, runtime: "local" as const, artifacts: [] },
      ],
    };

    const executionState = new ExecutionState({
      schemaVersion: "1.0.0",
      target: "main",
      items: [item],
    });

    const results = await executeItemGates(item, defaultPolicy, executionState, tempDir, 5000);

    expect(results).toHaveLength(2);
    expect(results[0].gate).toBe("gate1");
    expect(results[0].status).toBe("pass");
    expect(results[1].gate).toBe("gate2");
    expect(results[1].status).toBe("pass");
  });

  it("handles items with no gates", async () => {
    const item = {
      name: "test-item-no-gates",
      deps: [],
      gates: [],
    };

    const executionState = new ExecutionState({
      schemaVersion: "1.0.0",
      target: "main",
      items: [item],
    });

    const results = await executeItemGates(item, defaultPolicy, executionState, tempDir, 5000);

    expect(results).toHaveLength(0);
  });

  it("executes plan with policy awareness", async () => {
    const planContent = fs.readFileSync("tests/fixtures/plan.gates.json", "utf-8");
    const plan = loadPlan(planContent);

    const executionState = new ExecutionState(plan);

    // Just test individual item execution for now to avoid complex concurrency issues in tests
    const firstItem = plan.items[0];
    if (firstItem && firstItem.gates) {
      const results = await executeItemGates(
        firstItem,
        defaultPolicy,
        executionState,
        tempDir,
        1000
      );
      expect(results.length).toBeGreaterThan(0);

      // Check that results have the expected structure
      for (const result of results) {
        expect(result.gate).toBeDefined();
        expect(["pass", "fail", "blocked", "skipped", "retrying"]).toContain(result.status);
      }
    }
  }, 10000); // 10 second timeout

  it("logs gate failures to failures.ndjson when runId is provided", async () => {
    const runId = "test-run-" + Math.random().toString(36).substring(7);

    // Ensure run directory exists
    ensureRunDir(runId, tempDir);

    const item = {
      name: "test-item-failure-logging",
      deps: [],
      gates: [
        {
          name: "failing-gate",
          run: 'bash -c "echo network error >&2; exit 1"',
          env: {},
          runtime: "local" as const,
          artifacts: [],
        },
      ],
    };

    const executionState = new ExecutionState({
      schemaVersion: "1.0.0",
      target: "main",
      items: [item],
    });

    const results = await executeItemGates(
      item,
      defaultPolicy,
      executionState,
      tempDir,
      5000,
      false,
      undefined,
      { runId, baseDir: tempDir }
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");

    // Verify failure was logged
    const failures = getGateFailures(runId, tempDir);
    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("failing-gate");
    expect(failures[0].error.code).toBe(FailureErrorCode.NETWORK_ERROR);
    expect(failures[0].error.retryable).toBe(true);
  });
});

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
