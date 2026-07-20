import { describe, expect, it, vi } from "vitest";

import {
  GateExecutionService,
  GateExecutionServiceError,
} from "../../src/application/gate-execution-service.js";
import type { ExecutionState } from "../../src/executionState.js";
import type { Plan } from "../../src/schema.js";

describe("GateExecutionService", () => {
  it("projects only bounded gate evidence and artifact references", async () => {
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
      plan: plan(["one"]),
      artifactDir: "/tmp/gate-artifacts",
    });
    expect(result.summary).toEqual({
      contract: "bounded-ax-v1",
      items: [{ name: "one", status: "pass", gates: [{ name: "test", status: "pass" }] }],
      allGreen: true,
      artifactRefs: [{ kind: "gate-results-directory", path: "/tmp/gate-artifacts" }],
    });
    expect(JSON.stringify(result.summary)).not.toContain("large-log");
  });

  it("applies the same item and gate filters used by MCP", async () => {
    const execute = vi.fn(async (_plan: Plan, state: ExecutionState) => {
      for (const item of ["one", "two"]) {
        state.updateGateResult(item, { gate: "test", status: "pass", attempts: 1 });
        state.updateGateResult(item, { gate: "lint", status: "pass", attempts: 1 });
      }
    });
    const result = await new GateExecutionService(execute).run({
      plan: plan(["one", "two"]),
      artifactDir: "artifacts",
      onlyItem: "two",
      onlyGate: "lint",
    });
    expect(result.summary.items).toEqual([
      { name: "two", status: "pass", gates: [{ name: "lint", status: "pass" }] },
    ]);
  });

  it("maps executor failures and excessive collections to stable bounded codes", async () => {
    const failed = new GateExecutionService(async () => {
      throw new Error("secret command output");
    });
    await expect(
      failed.run({ plan: plan(["one"]), artifactDir: "artifacts" })
    ).rejects.toMatchObject({ code: "GATE_EXECUTION_FAILED" });

    const oversized = new GateExecutionService(async () => undefined);
    await expect(
      oversized.run({
        plan: plan(Array.from({ length: 257 }, (_, index) => `item-${index}`)),
        artifactDir: "artifacts",
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GateExecutionServiceError>>({
        code: "GATE_RESULT_LIMIT_EXCEEDED",
      })
    );
  });
});

function plan(names: string[]): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: names.map((name) => ({ name, sha: "a".repeat(40), deps: [], gates: [] })),
  };
}
