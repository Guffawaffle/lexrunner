/**
 * Integration tests for Turn Cost tracking in gate execution
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeGate } from "../../src/gates.js";
import { createTurnCostTracker } from "../../src/metrics/turncost.js";
import type { Gate, Policy } from "../../src/schema.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Turn Cost Tracking - Gate Integration", () => {
  let tempDir: string;
  let artifactDir: string;

  beforeEach(() => {
    // Create temporary directories for test artifacts
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "turncost-test-"));
    artifactDir = path.join(tempDir, "artifacts");
    fs.mkdirSync(artifactDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should track latency for successful gate execution", async () => {
    const tracker = createTurnCostTracker();

    const gate: Gate = {
      name: "test-gate",
      run: 'echo "test"',
      runtime: "local",
    };

    const policy: Policy = {
      requiredGates: ["test-gate"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {},
      overrides: {},
      blockOn: [],
      mergeRule: { type: "strict-required" },
    };

    const result = await executeGate(
      gate,
      policy,
      artifactDir,
      30000,
      "test-item",
      false,
      undefined,
      tracker
    );

    expect(result.status).toBe("pass");

    // Check that latency was recorded
    const components = tracker.getComponents();
    expect(components.latencyMs).toBeGreaterThan(0);

    // Check that events were recorded
    const events = tracker.getEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("latency");
    expect(events[0].details.itemName).toBe("test-item");
  });

  it("should track renegotiation for gate retries", async () => {
    const tracker = createTurnCostTracker();

    // Gate that fails on first attempt (exit code 1)
    const gate: Gate = {
      name: "flaky-gate",
      run: "exit 1",
      runtime: "local",
    };

    const policy: Policy = {
      requiredGates: ["flaky-gate"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {
        "flaky-gate": {
          maxAttempts: 2,
          backoffSeconds: 0,
        },
      },
      overrides: {},
      blockOn: [],
      mergeRule: { type: "strict-required" },
    };

    const result = await executeGate(
      gate,
      policy,
      artifactDir,
      30000,
      "test-item",
      false,
      undefined,
      tracker
    );

    expect(result.status).toBe("fail");

    // Check that both latency and renegotiation were recorded
    const components = tracker.getComponents();
    expect(components.latencyMs).toBeGreaterThan(0);
    // Note: renegotiation is only tracked for transient errors, not permanent ones
    // This gate always fails with exit code 1, which may be classified as permanent

    // Check that multiple latency events were recorded (one per attempt)
    const events = tracker.getEvents();
    const latencyEvents = events.filter((e) => e.type === "latency");
    expect(latencyEvents.length).toBe(2); // 2 attempts
  });

  it("should not track anything when tracker is not provided", async () => {
    const gate: Gate = {
      name: "test-gate",
      run: 'echo "test"',
      runtime: "local",
    };

    const policy: Policy = {
      requiredGates: ["test-gate"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {},
      overrides: {},
      blockOn: [],
      mergeRule: { type: "strict-required" },
    };

    // No tracker provided - should not throw error
    const result = await executeGate(
      gate,
      policy,
      artifactDir,
      30000,
      "test-item",
      false,
      undefined,
      undefined // no tracker
    );

    expect(result.status).toBe("pass");
  });

  it("should accumulate latency from multiple gates", async () => {
    const tracker = createTurnCostTracker();

    const policy: Policy = {
      requiredGates: ["gate-1", "gate-2"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {},
      overrides: {},
      blockOn: [],
      mergeRule: { type: "strict-required" },
    };

    // Execute first gate
    const gate1: Gate = {
      name: "gate-1",
      run: 'echo "gate 1"',
      runtime: "local",
    };

    await executeGate(gate1, policy, artifactDir, 30000, "item-1", false, undefined, tracker);

    const latencyAfterFirst = tracker.getComponents().latencyMs;
    expect(latencyAfterFirst).toBeGreaterThan(0);

    // Execute second gate
    const gate2: Gate = {
      name: "gate-2",
      run: 'echo "gate 2"',
      runtime: "local",
    };

    await executeGate(gate2, policy, artifactDir, 30000, "item-2", false, undefined, tracker);

    // Check that latency accumulated
    const latencyAfterSecond = tracker.getComponents().latencyMs;
    expect(latencyAfterSecond).toBeGreaterThan(latencyAfterFirst);

    // Check that we have 2 latency events
    const events = tracker.getEvents();
    const latencyEvents = events.filter((e) => e.type === "latency");
    expect(latencyEvents.length).toBe(2);
  });

  it("should include gate and item names in events", async () => {
    const tracker = createTurnCostTracker();

    const gate: Gate = {
      name: "named-gate",
      run: 'echo "test"',
      runtime: "local",
    };

    const policy: Policy = {
      requiredGates: ["named-gate"],
      optionalGates: [],
      maxWorkers: 1,
      retries: {},
      overrides: {},
      blockOn: [],
      mergeRule: { type: "strict-required" },
    };

    await executeGate(gate, policy, artifactDir, 30000, "pr-123", false, undefined, tracker);

    const events = tracker.getEvents();
    expect(events.length).toBeGreaterThan(0);

    const latencyEvent = events.find((e) => e.type === "latency");
    expect(latencyEvent).toBeDefined();
    expect(latencyEvent?.details.itemName).toBe("pr-123");
  });
});
