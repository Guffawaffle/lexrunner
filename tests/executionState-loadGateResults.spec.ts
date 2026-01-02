/**
 * Tests for ExecutionState gate result loading functionality
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionState } from "../src/executionState.js";
import { Plan } from "../src/schema.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ExecutionState - Load Gate Results", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "execution-state-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should load gate results from directory", () => {
    // Create a simple plan
    const plan: Plan = {
      schemaVersion: "1.0.0",
      items: [
        { name: "pr-10", gates: [{ name: "build", run: "npm run build" }], deps: [] },
        { name: "pr-11", gates: [{ name: "test", run: "npm test" }], deps: [] },
      ],
      policy: {
        requiredGates: ["build", "test"],
        optionalGates: [],
        maxWorkers: 2,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
    };

    const executionState = new ExecutionState(plan);

    // Create gate result files
    const gateResultsDir = path.join(tempDir, "gate-results");
    fs.mkdirSync(gateResultsDir, { recursive: true });

    const gateReport1 = {
      schemaVersion: "1.0.0",
      item: "pr-10",
      gate: "build",
      status: "pass",
      duration_ms: 1000,
      started_at: new Date().toISOString(),
    };

    const gateReport2 = {
      schemaVersion: "1.0.0",
      item: "pr-11",
      gate: "test",
      status: "pass",
      duration_ms: 2000,
      started_at: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(gateResultsDir, "pr-10-build.json"),
      JSON.stringify(gateReport1, null, 2)
    );
    fs.writeFileSync(
      path.join(gateResultsDir, "pr-11-test.json"),
      JSON.stringify(gateReport2, null, 2)
    );

    // Load gate results
    const loadedCount = executionState.loadGateResultsFromDirectory(gateResultsDir);

    expect(loadedCount).toBe(2);

    // Check that results were loaded
    const pr10Result = executionState.getNodeResult("pr-10");
    expect(pr10Result).toBeDefined();
    expect(pr10Result?.gates.length).toBe(1);
    expect(pr10Result?.gates[0].gate).toBe("build");
    expect(pr10Result?.gates[0].status).toBe("pass");

    const pr11Result = executionState.getNodeResult("pr-11");
    expect(pr11Result).toBeDefined();
    expect(pr11Result?.gates.length).toBe(1);
    expect(pr11Result?.gates[0].gate).toBe("test");
    expect(pr11Result?.gates[0].status).toBe("pass");
  });

  it("should update node status after loading gate results", () => {
    const plan: Plan = {
      schemaVersion: "1.0.0",
      items: [
        {
          name: "pr-20",
          gates: [
            { name: "build", run: "npm run build" },
            { name: "test", run: "npm test" },
          ],
          deps: [],
        },
      ],
      policy: {
        requiredGates: ["build", "test"],
        optionalGates: [],
        maxWorkers: 1,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
    };

    const executionState = new ExecutionState(plan);

    // Create gate result files
    const gateResultsDir = path.join(tempDir, "gate-results");
    fs.mkdirSync(gateResultsDir, { recursive: true });

    const buildReport = {
      schemaVersion: "1.0.0",
      item: "pr-20",
      gate: "build",
      status: "pass",
      duration_ms: 1000,
      started_at: new Date().toISOString(),
    };

    const testReport = {
      schemaVersion: "1.0.0",
      item: "pr-20",
      gate: "test",
      status: "pass",
      duration_ms: 1500,
      started_at: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(gateResultsDir, "pr-20-build.json"),
      JSON.stringify(buildReport, null, 2)
    );
    fs.writeFileSync(
      path.join(gateResultsDir, "pr-20-test.json"),
      JSON.stringify(testReport, null, 2)
    );

    // Load gate results
    executionState.loadGateResultsFromDirectory(gateResultsDir);

    // Check that node status was updated
    const nodeResult = executionState.getNodeResult("pr-20");
    expect(nodeResult).toBeDefined();
    expect(nodeResult?.status).toBe("pass");
    expect(nodeResult?.eligibleForMerge).toBe(true);
  });

  it("should handle failed gate results", () => {
    const plan: Plan = {
      schemaVersion: "1.0.0",
      items: [{ name: "pr-30", gates: [{ name: "lint", run: "npm run lint" }], deps: [] }],
      policy: {
        requiredGates: ["lint"],
        optionalGates: [],
        maxWorkers: 1,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
    };

    const executionState = new ExecutionState(plan);

    const gateResultsDir = path.join(tempDir, "gate-results");
    fs.mkdirSync(gateResultsDir, { recursive: true });

    const lintReport = {
      schemaVersion: "1.0.0",
      item: "pr-30",
      gate: "lint",
      status: "fail",
      duration_ms: 500,
      started_at: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(gateResultsDir, "pr-30-lint.json"),
      JSON.stringify(lintReport, null, 2)
    );

    executionState.loadGateResultsFromDirectory(gateResultsDir);

    const nodeResult = executionState.getNodeResult("pr-30");
    expect(nodeResult).toBeDefined();
    expect(nodeResult?.status).toBe("fail");
    expect(nodeResult?.eligibleForMerge).toBe(false);
  });

  it("should skip unknown items", () => {
    const plan: Plan = {
      schemaVersion: "1.0.0",
      items: [{ name: "pr-40", gates: [{ name: "build", run: "npm run build" }], deps: [] }],
      policy: {
        requiredGates: ["build"],
        optionalGates: [],
        maxWorkers: 1,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
    };

    const executionState = new ExecutionState(plan);

    const gateResultsDir = path.join(tempDir, "gate-results");
    fs.mkdirSync(gateResultsDir, { recursive: true });

    // Create a gate result for an item not in the plan
    const unknownReport = {
      schemaVersion: "1.0.0",
      item: "pr-999",
      gate: "unknown",
      status: "pass",
      duration_ms: 100,
      started_at: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(gateResultsDir, "pr-999-unknown.json"),
      JSON.stringify(unknownReport, null, 2)
    );

    // Should not throw, but should skip the unknown item
    const loadedCount = executionState.loadGateResultsFromDirectory(gateResultsDir);
    expect(loadedCount).toBe(0);
  });

  it("should throw error for non-existent directory", () => {
    const plan: Plan = {
      schemaVersion: "1.0.0",
      items: [],
      policy: {
        requiredGates: [],
        optionalGates: [],
        maxWorkers: 1,
        retries: {},
        overrides: {},
        blockOn: [],
        mergeRule: { type: "strict-required" },
      },
    };

    const executionState = new ExecutionState(plan);
    const nonExistentDir = path.join(tempDir, "does-not-exist");

    expect(() => {
      executionState.loadGateResultsFromDirectory(nonExistentDir);
    }).toThrow("does not exist");
  });
});
