/**
 * Executor Lifecycle Integration Tests
 *
 * Tests the full executor lifecycle: load → prep → stochastic → receipt → emit
 *
 * NOTE: These tests are currently skipped because they depend on:
 * - PR #404: Executor Canonicalization
 * - PR #412: Executor Registry & Loader
 * - PR #411: Guardrail Enforcement Runtime
 *
 * Remove .skip() once dependencies are merged.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutorRegistry } from "../fixtures/executors/registry.js";
import {
  MockExecutor,
  mockModelCall,
  mockHighTokenModelCall,
} from "../fixtures/executors/mock-executor.js";
import type {
  ExecutorContext,
  ExecutorResult,
  Receipt,
  Artifact,
} from "../fixtures/executors/types.js";

describe.skip("Executor Lifecycle Integration", () => {
  let registry: ExecutorRegistry;
  let mockExecutor: MockExecutor;

  beforeEach(() => {
    registry = new ExecutorRegistry();
    mockExecutor = new MockExecutor();
    mockExecutor.reset(); // Reset to default configuration
    registry.register(mockExecutor);
  });

  describe("Happy Path", () => {
    it("should complete full lifecycle: load → prep → stochastic → receipt → emit", async () => {
      // 1. Load executor from registry
      const executor = await registry.load("mock-executor");
      expect(executor).toBeDefined();
      expect(executor.id).toBe("mock-executor");
      expect(executor.name).toBe("Mock Executor");

      // 2. Prep phase - load context
      const context: ExecutorContext = await executor.prep({ taskId: "TEST-001" });
      expect(context).toBeDefined();
      expect(context.taskId).toBe("TEST-001");
      expect(context.budget).toBeDefined();
      expect(context.budget.maxTokens).toBeGreaterThan(0);
      expect(context.frames).toBeDefined();
      expect(context.frames.length).toBeGreaterThan(0);

      // 3. Stochastic phase - execute with mocked model
      const result: ExecutorResult = await executor.stochastic(context, mockModelCall);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.tokensUsed).toBeLessThanOrEqual(context.budget.maxTokens);

      // 4. Receipt phase - generate receipt
      const receipt: Receipt = await executor.receipt(result);
      expect(receipt).toBeDefined();
      expect(receipt.executorId).toBe("mock-executor");
      expect(receipt.status).toBe("completed");
      expect(receipt.timestamp).toBeDefined();
      expect(receipt.result).toEqual(result);

      // 5. Emit phase - publish artifacts
      const artifacts: Artifact[] = await executor.emit(receipt);
      expect(artifacts).toBeDefined();
      expect(artifacts.length).toBeGreaterThanOrEqual(1);

      // Verify receipt artifact
      const receiptArtifact = artifacts.find((a) => a.type === "receipt");
      expect(receiptArtifact).toBeDefined();
      expect(receiptArtifact?.path).toContain("receipts/");
      expect(receiptArtifact?.content).toContain(receipt.executorId);
    });

    it("should handle multiple executor instances independently", async () => {
      const executor1 = await registry.load("mock-executor");
      const executor2 = await registry.load("mock-executor");

      const context1 = await executor1.prep({ taskId: "TEST-001" });
      const context2 = await executor2.prep({ taskId: "TEST-002" });

      expect(context1.taskId).toBe("TEST-001");
      expect(context2.taskId).toBe("TEST-002");
    });
  });

  describe("Error Paths", () => {
    it("should fail when budget exceeded", async () => {
      // Configure mock to use high token usage
      mockExecutor.configure({ budgetLimit: 100, failOnBudget: false });
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-BUDGET" });

      // Use high token model call that exceeds budget
      const result = await executor.stochastic(context, mockHighTokenModelCall);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Budget exceeded");
      expect(result.tokensUsed).toBeGreaterThan(context.budget.maxTokens);
    });

    it("should fail when guardrail violated", async () => {
      // Configure mock to simulate guardrail violation
      mockExecutor.configure({ failOnGuardrail: true });
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-GUARDRAIL" });

      const result = await executor.stochastic(context, mockModelCall);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Guardrail violation");
      expect(result.guardrailViolations).toBeDefined();
      expect(result.guardrailViolations?.length).toBeGreaterThan(0);
    });

    it("should fail when required frame missing", async () => {
      // Configure mock to check for missing frames
      mockExecutor.configure({ failOnMissingFrame: true });
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-FRAME" });

      // Remove frames to simulate missing frame scenario
      context.frames = [];

      const result = await executor.stochastic(context, mockModelCall);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Required frame missing");
    });

    it("should generate failure receipt on error", async () => {
      // Configure mock to fail on guardrail
      mockExecutor.configure({ failOnGuardrail: true });
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-FAILURE-RECEIPT" });
      const result = await executor.stochastic(context, mockModelCall);

      expect(result.success).toBe(false);

      // Generate receipt for failed execution
      const receipt = await executor.receipt(result);

      expect(receipt).toBeDefined();
      expect(receipt.status).toBe("failed");
      expect(receipt.result.success).toBe(false);
      expect(receipt.result.error).toBeDefined();

      // Emit should still work for failures
      const artifacts = await executor.emit(receipt);
      expect(artifacts).toBeDefined();
      expect(artifacts.length).toBeGreaterThanOrEqual(1);

      // Verify receipt artifact exists even on failure
      const receiptArtifact = artifacts.find((a) => a.type === "receipt");
      expect(receiptArtifact).toBeDefined();
    });

    it("should handle missing taskId in prep phase", async () => {
      const executor = await registry.load("mock-executor");

      // Attempt to prep without taskId
      await expect(executor.prep({})).rejects.toThrow("Missing required field: taskId");
    });

    it("should handle executor not found in registry", async () => {
      await expect(registry.load("non-existent-executor")).rejects.toThrow(
        "Executor not found: non-existent-executor"
      );
    });
  });

  describe("Mock Executor", () => {
    it("should use mock executor for testing", async () => {
      const executor = await registry.load("mock-executor");

      expect(executor.id).toBe("mock-executor");
      expect(executor.name).toBe("Mock Executor");

      // Verify it's actually the mock
      expect(executor).toBeInstanceOf(MockExecutor);
    });

    it("should allow configuration of mock behavior", async () => {
      const customBudget = 500;
      mockExecutor.configure({ budgetLimit: customBudget });
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-CONFIG" });

      expect(context.budget.maxTokens).toBe(customBudget);
    });

    it("should reset mock configuration", async () => {
      mockExecutor.configure({ budgetLimit: 100, failOnBudget: true });
      mockExecutor.reset();
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-RESET" });

      // Should be back to default budget
      expect(context.budget.maxTokens).toBe(1000);
    });
  });

  describe("Registry Operations", () => {
    it("should list all registered executors", () => {
      const executorIds = registry.list();

      expect(executorIds).toContain("mock-executor");
      expect(executorIds.length).toBeGreaterThan(0);
    });

    it("should allow registering multiple executors", () => {
      const anotherExecutor = new MockExecutor();
      anotherExecutor.id = "another-mock-executor";
      registry.register(anotherExecutor);

      const executorIds = registry.list();
      expect(executorIds).toContain("mock-executor");
      expect(executorIds).toContain("another-mock-executor");
      expect(executorIds.length).toBe(2);
    });

    it("should clear all executors", async () => {
      registry.clear();

      const executorIds = registry.list();
      expect(executorIds.length).toBe(0);

      await expect(registry.load("mock-executor")).rejects.toThrow("Executor not found");
    });
  });

  describe("Artifact Generation", () => {
    it("should generate valid JSON in receipt artifact", async () => {
      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-ARTIFACT" });
      const result = await executor.stochastic(context, mockModelCall);
      const receipt = await executor.receipt(result);
      const artifacts = await executor.emit(receipt);

      const receiptArtifact = artifacts.find((a) => a.type === "receipt");
      expect(receiptArtifact).toBeDefined();

      // Type guard ensures receiptArtifact is defined
      if (!receiptArtifact) {
        throw new Error("Receipt artifact should be defined");
      }

      // Verify content is valid JSON
      expect(() => JSON.parse(receiptArtifact.content)).not.toThrow();

      const parsed = JSON.parse(receiptArtifact.content);
      expect(parsed.executorId).toBe("mock-executor");
      expect(parsed.status).toBe("completed");
    });

    it("should include output artifact on success", async () => {
      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-OUTPUT" });
      const result = await executor.stochastic(context, mockModelCall);
      const receipt = await executor.receipt(result);
      const artifacts = await executor.emit(receipt);

      const outputArtifact = artifacts.find((a) => a.type === "output");
      expect(outputArtifact).toBeDefined();
      expect(outputArtifact?.content).toContain("Mock response");
    });

    it("should not include output artifact on failure", async () => {
      mockExecutor.configure({ failOnGuardrail: true });
      registry.clear();
      registry.register(mockExecutor);

      const executor = await registry.load("mock-executor");
      const context = await executor.prep({ taskId: "TEST-NO-OUTPUT" });
      const result = await executor.stochastic(context, mockModelCall);
      const receipt = await executor.receipt(result);
      const artifacts = await executor.emit(receipt);

      const outputArtifact = artifacts.find((a) => a.type === "output");
      expect(outputArtifact).toBeUndefined();
    });
  });
});
