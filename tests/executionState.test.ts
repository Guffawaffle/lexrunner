import { describe, it, expect } from "vitest";
import { ExecutionState } from "../src/executionState.js";
import { Plan, GateResult } from "../src/schema.js";

describe("ExecutionState", () => {
  const simplePlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      { name: "A", deps: [] },
      { name: "B", deps: ["A"] },
      { name: "C", deps: ["B"] },
    ],
  };

  it("initializes with correct node results", () => {
    const state = new ExecutionState(simplePlan);
    const results = state.getResults();

    expect(results.size).toBe(3);
    expect(results.get("A")?.name).toBe("A");
    expect(results.get("A")?.status).toBe("skipped");
    expect(results.get("A")?.eligibleForMerge).toBe(false);
  });

  it("updates gate results correctly", () => {
    const state = new ExecutionState(simplePlan);

    const gateResult: GateResult = {
      gate: "test-gate",
      status: "pass",
      exitCode: 0,
      duration: 1000,
      stdout: "success",
      stderr: "",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", gateResult);

    const nodeResult = state.getNodeResult("A");
    expect(nodeResult?.gates).toHaveLength(1);
    expect(nodeResult?.gates[0].gate).toBe("test-gate");
    expect(nodeResult?.gates[0].status).toBe("pass");
  });

  it("propagates blocked status to dependents", () => {
    const planWithGates: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      policy: {
        requiredGates: ["test-gate"],
        optionalGates: [],
        maxWorkers: 1,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
      items: [
        {
          name: "A",
          deps: [],
          gates: [{ name: "test-gate", run: "echo test", runtime: "local" }],
        },
        {
          name: "B",
          deps: ["A"],
          gates: [{ name: "test-gate", run: "echo test", runtime: "local" }],
        },
      ],
    };

    const state = new ExecutionState(planWithGates);

    // Simulate A failing
    const failedGate: GateResult = {
      gate: "test-gate",
      status: "fail",
      exitCode: 1,
      duration: 1000,
      stdout: "",
      stderr: "failed",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", failedGate);
    state.propagateBlockedStatus();

    const nodeA = state.getNodeResult("A");
    const nodeB = state.getNodeResult("B");

    expect(nodeA?.status).toBe("fail");
    expect(nodeB?.status).toBe("blocked");
    expect(nodeB?.blockedBy).toContain("A");
  });

  it("tracks execution completion correctly", () => {
    const state = new ExecutionState(simplePlan);

    expect(state.isExecutionComplete()).toBe(false);

    // Mark all as passed
    for (const item of simplePlan.items) {
      const passGate: GateResult = {
        gate: "test",
        status: "pass",
        exitCode: 0,
        duration: 100,
        stdout: "",
        stderr: "",
        artifacts: [],
        attempts: 1,
        lastAttempt: "2023-01-01T00:00:00Z",
      };
      state.updateGateResult(item.name, passGate);
    }

    expect(state.isExecutionComplete()).toBe(true);
  });

  it("identifies eligible nodes correctly", () => {
    const planWithPolicy: Plan = {
      schemaVersion: "1.0.0",
      target: "main",
      policy: {
        requiredGates: ["test"],
        optionalGates: [],
        maxWorkers: 1,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
      items: [
        {
          name: "A",
          deps: [],
          gates: [{ name: "test", run: "echo test", runtime: "local" }],
        },
      ],
    };

    const state = new ExecutionState(planWithPolicy);

    // Initially not eligible
    expect(state.getEligibleNodes()).toHaveLength(0);

    // After passing gate, should be eligible
    const passGate: GateResult = {
      gate: "test",
      status: "pass",
      exitCode: 0,
      duration: 100,
      stdout: "",
      stderr: "",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", passGate);
    expect(state.getEligibleNodes()).toContain("A");
  });
});
