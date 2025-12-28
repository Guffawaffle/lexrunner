import { describe, it, expect } from "vitest";
import { MergeEligibilityEvaluator, MergeDecision } from "../src/mergeEligibility.js";
import { ExecutionState } from "../src/executionState.js";
import { Plan, GateResult } from "../src/schema.js";

describe("MergeEligibilityEvaluator", () => {
  const simplePlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    policy: {
      requiredGates: ["test"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {},
      overrides: {
        adminGreen: {
          allowedUsers: ["admin"],
          requireReason: true,
        },
      },
      blockOn: [],
      mergeRule: { type: "strict-required" },
    },
    items: [
      {
        name: "A",
        deps: [],
        gates: [{ name: "test", run: "echo test", runtime: "local" }],
      },
      {
        name: "B",
        deps: ["A"],
        gates: [{ name: "test", run: "echo test", runtime: "local" }],
      },
    ],
  };

  it("evaluates nodes as not eligible when gates not run", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

    const decision = evaluator.evaluateNode("A");

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain("not eligible for merge");
  });

  it("evaluates nodes as eligible when required gates pass", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

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

    const decision = evaluator.evaluateNode("A");

    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe("All required gates passed");
  });

  it("evaluates nodes as not eligible when gates fail", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

    const failGate: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      duration: 100,
      stdout: "",
      stderr: "error",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", failGate);

    const decision = evaluator.evaluateNode("A");

    expect(decision.eligible).toBe(false);
    expect(decision.requiresOverride).toBe(true);
    expect(decision.reason).toContain("Failed required gates");
  });

  it("handles blocked nodes correctly", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

    // Make A fail, which should block B
    const failGate: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      duration: 100,
      stdout: "",
      stderr: "error",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", failGate);
    state.propagateBlockedStatus();

    const decisionB = evaluator.evaluateNode("B");

    expect(decisionB.eligible).toBe(false);
    expect(decisionB.requiresOverride).toBe(true);
    expect(decisionB.reason).toBe("Blocked by failed dependencies");
    expect(decisionB.blockedBy).toContain("A");
  });

  it("allows admin overrides with proper authorization", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

    // Make A fail first
    const failGate: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      duration: 100,
      stdout: "",
      stderr: "error",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", failGate);

    // Request override
    const overrideSuccess = evaluator.requestOverride("A", "admin", "Emergency hotfix");
    expect(overrideSuccess).toBe(true);

    // Now A should be eligible due to override
    const decision = evaluator.evaluateNode("A");
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toContain("Manual override by admin");
  });

  it("rejects unauthorized override requests", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

    const overrideSuccess = evaluator.requestOverride("A", "user", "Please");
    expect(overrideSuccess).toBe(false);
  });

  it("generates comprehensive merge summaries", () => {
    const state = new ExecutionState(simplePlan);
    const evaluator = new MergeEligibilityEvaluator(simplePlan, state);

    // A passes, B fails
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

    const failGate: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      duration: 100,
      stdout: "",
      stderr: "error",
      artifacts: [],
      attempts: 1,
      lastAttempt: "2023-01-01T00:00:00Z",
    };

    state.updateGateResult("A", passGate);
    state.updateGateResult("B", failGate);

    const summary = evaluator.getMergeSummary();

    expect(summary.eligible).toContain("A");
    expect(summary.failed).toContain("B");
    expect(summary.eligible).toHaveLength(1);
    expect(summary.failed).toHaveLength(1);
  });
});
