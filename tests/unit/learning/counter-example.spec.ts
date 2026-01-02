/**
 * Tests for Counter-Example Capture - LR-TSF-003
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  buildCounterExample,
  createCounterExampleFromGate,
  type FailureInfo,
  type ExecutionContext,
  type CounterExampleClassification,
  type CounterExample,
} from "../../../src/learning/counter-example.js";
import type { GateResult } from "../../../src/schema.js";

describe("Counter-Example Capture", () => {
  describe("buildCounterExample", () => {
    it("should build a valid counter-example", () => {
      const failure: FailureInfo = {
        type: "gate",
        target: "test-gate",
        error: "Test execution failed",
        exitCode: 1,
      };

      const context: ExecutionContext = {
        planPath: "/path/to/plan.json",
        runId: "run-123",
        activeConstraints: ["test-coverage", "linting"],
        scope: ["src/**"],
      };

      const classification: CounterExampleClassification = {
        type: "gap",
        description: "Missing test coverage",
        suggestedAction: "Add unit tests",
      };

      const counterExample = buildCounterExample(failure, context, classification);

      expect(counterExample).toBeDefined();
      expect(counterExample.id).toBeDefined();
      expect(counterExample.timestamp).toBeDefined();
      expect(counterExample.failure.type).toBe("gate");
      expect(counterExample.failure.target).toBe("test-gate");
      expect(counterExample.context.runId).toBe("run-123");
      expect(counterExample.classification.type).toBe("gap");
      expect(counterExample.shouldLearn).toBe(true);
    });

    it("should mark transient failures as not learning", () => {
      const failure: FailureInfo = {
        type: "gate",
        target: "flaky-test",
        error: "Network timeout",
        exitCode: 1,
      };

      const context: ExecutionContext = {
        planPath: "/path/to/plan.json",
        runId: "run-123",
        activeConstraints: [],
        scope: [],
      };

      const classification: CounterExampleClassification = {
        type: "transient",
        description: "Network flakiness",
      };

      const counterExample = buildCounterExample(failure, context, classification);

      expect(counterExample.shouldLearn).toBe(false);
    });

    it("should infer related constraints from gate name", () => {
      const failure: FailureInfo = {
        type: "gate",
        target: "test-coverage",
        error: "Coverage below threshold",
        exitCode: 1,
      };

      const context: ExecutionContext = {
        planPath: "/path/to/plan.json",
        runId: "run-123",
        activeConstraints: ["test-coverage-required", "linting-strict", "build-clean"],
        scope: [],
      };

      const classification: CounterExampleClassification = {
        type: "gap",
        description: "Coverage issue",
      };

      const counterExample = buildCounterExample(failure, context, classification);

      expect(counterExample.relatedConstraints).toContain("test-coverage-required");
    });
  });

  describe("createCounterExampleFromGate", () => {
    it("should create counter-example from gate result", () => {
      const gateResult: GateResult = {
        gate: "lint",
        status: "fail",
        exitCode: 1,
        duration: 1500,
        stdout: "",
        stderr: "Linting errors found",
        artifacts: [],
        attempts: 1,
      };

      const classification: CounterExampleClassification = {
        type: "false-positive",
        description: "Linter rule too strict",
        suggestedAction: "Adjust linter config",
      };

      const counterExample = createCounterExampleFromGate(
        gateResult,
        "/path/to/plan.json",
        "run-456",
        classification,
        ["linting-strict"],
        ["src/**"]
      );

      expect(counterExample.failure.type).toBe("gate");
      expect(counterExample.failure.target).toBe("lint");
      expect(counterExample.failure.error).toBe("Linting errors found");
      expect(counterExample.failure.exitCode).toBe(1);
      expect(counterExample.context.plan).toBe("/path/to/plan.json");
      expect(counterExample.context.runId).toBe("run-456");
      expect(counterExample.classification.type).toBe("false-positive");
      expect(counterExample.shouldLearn).toBe(true);
    });

    it("should handle gate result without stderr", () => {
      const gateResult: GateResult = {
        gate: "build",
        status: "fail",
        exitCode: 1,
        duration: 3000,
        stdout: "",
        artifacts: [],
        attempts: 1,
      };

      const classification: CounterExampleClassification = {
        type: "unknown",
        description: "Unknown build failure",
      };

      const counterExample = createCounterExampleFromGate(
        gateResult,
        "/path/to/plan.json",
        "run-789",
        classification
      );

      expect(counterExample.failure.error).toBe("Gate execution failed");
    });
  });
});
