import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GateExecutionService,
  GateExecutionServiceError,
} from "../../src/application/gate-execution-service.js";
import type { ExecutionState } from "../../src/executionState.js";
import type { Plan } from "../../src/schema.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("GateExecutionService", () => {
  it("projects only bounded gate evidence and artifact references", async () => {
    const artifactDir = temporaryArtifactDirectory();
    const execute = vi.fn(async (_plan: Plan, state: ExecutionState) => {
      state.updateGateResult("one", {
        gate: "test",
        status: "pass",
        exitCode: 0,
        stdout: "large-log-must-not-enter-summary",
        stderr: "",
        artifacts: ["detailed-report.json"],
        attempts: 1,
      });
    });
    const result = await new GateExecutionService(execute).run({
      plan: plan(["one"], ["test"]),
      artifactDir,
    });
    expect(result.summary).toMatchObject({
      contract: "bounded-ax-v1",
      items: [{ name: "one", status: "pass", gates: [{ name: "test", status: "pass" }] }],
      allGreen: true,
      artifactRefs: [{ kind: "gate-results-directory" }, { kind: "gate-evidence-manifest" }],
    });
    expect(result.summary.artifactRefs[0]?.path).toContain(artifactDir);
    expect(JSON.stringify(result.summary)).not.toContain("large-log");
  });

  it("applies the same item and gate filters used by MCP", async () => {
    const execute = vi.fn(async (_plan: Plan, state: ExecutionState, ...args: unknown[]) => {
      const options = args[5] as { onlyItem?: string; onlyGate?: string };
      expect(options).toMatchObject({ onlyItem: "two", onlyGate: "lint" });
      state.updateGateResult("two", { gate: "lint", status: "pass", attempts: 1 });
    });
    const result = await new GateExecutionService(execute).run({
      plan: plan(["one", "two"]),
      artifactDir: temporaryArtifactDirectory(),
      onlyItem: "two",
      onlyGate: "lint",
    });
    expect(result.summary.items).toEqual([
      { name: "two", status: "skipped", gates: [{ name: "lint", status: "pass" }] },
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects item and gate selections that do not exist", async () => {
    const execute = vi.fn(async () => undefined);
    const service = new GateExecutionService(execute);

    await expect(
      service.run({
        plan: plan(["one"]),
        artifactDir: temporaryArtifactDirectory(),
        onlyItem: "two",
      })
    ).rejects.toMatchObject({ code: "GATE_SELECTION_NOT_FOUND" });
    await expect(
      service.run({
        plan: plan(["one"]),
        artifactDir: temporaryArtifactDirectory(),
        onlyGate: "missing",
      })
    ).rejects.toMatchObject({ code: "GATE_SELECTION_NOT_FOUND" });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 86_400_001, Number.NaN])(
    "rejects invalid operation timeout %s before execution",
    async (timeoutMs) => {
      const execute = vi.fn(async () => undefined);
      await expect(
        new GateExecutionService(execute).run({
          plan: plan(["one"]),
          artifactDir: temporaryArtifactDirectory(),
          timeoutMs,
        })
      ).rejects.toMatchObject({ code: "GATE_TIMEOUT_INVALID" });
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it("maps executor failures and excessive collections to stable bounded codes", async () => {
    const failed = new GateExecutionService(async () => {
      throw new Error("secret command output");
    });
    await expect(
      failed.run({ plan: plan(["one"]), artifactDir: temporaryArtifactDirectory() })
    ).rejects.toMatchObject({ code: "GATE_EXECUTION_FAILED" });

    const oversized = new GateExecutionService(async () => undefined);
    await expect(
      oversized.run({
        plan: plan(Array.from({ length: 257 }, (_, index) => `item-${index}`)),
        artifactDir: temporaryArtifactDirectory(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GateExecutionServiceError>>({
        code: "GATE_RESULT_LIMIT_EXCEEDED",
      })
    );
  });
});

function plan(names: string[], gateNames = ["test", "lint"]): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: names.map((name) => ({
      name,
      deps: [],
      gates: gateNames.map((gateName) => ({
        name: gateName,
        run: 'node -e "process.exit(0)"',
        env: {},
      })),
    })),
  };
}

function temporaryArtifactDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "lexrunner-gates-"));
  temporaryDirectories.push(directory);
  return directory;
}
