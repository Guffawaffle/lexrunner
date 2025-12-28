import { describe, it, expect } from "vitest";
import { BulkMergeOperation, RetryOperation } from "../src/commands/bulkOps.js";
import { Plan } from "../src/schema.js";

describe("BulkMergeOperation", () => {
  const samplePlan: Plan = {
    schemaVersion: "1.0",
    target: "main",
    items: [
      {
        name: "item-a",
        deps: [],
        gates: [{ name: "lint", run: "echo lint", env: {} }],
      },
      {
        name: "item-b",
        deps: ["item-a"],
        gates: [{ name: "lint", run: "echo lint", env: {} }],
      },
      {
        name: "item-c",
        deps: ["item-b"],
        gates: [{ name: "lint", run: "echo lint", env: {} }],
      },
      {
        name: "feature-x",
        deps: [],
        gates: [{ name: "lint", run: "echo lint", env: {} }],
      },
    ],
  };

  describe("selectItems", () => {
    it("should select all items when no options provided", () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const selected = bulk.selectItems({});

      expect(selected).toHaveLength(4);
      expect(selected).toContain("item-a");
      expect(selected).toContain("item-b");
      expect(selected).toContain("item-c");
      expect(selected).toContain("feature-x");
    });

    it("should select specific items", () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const selected = bulk.selectItems({
        items: ["item-a", "item-b"],
      });

      expect(selected).toHaveLength(2);
      expect(selected).toContain("item-a");
      expect(selected).toContain("item-b");
    });

    it("should select items by level", () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const selected = bulk.selectItems({
        levels: [1],
      });

      expect(selected).toHaveLength(2); // item-a and feature-x
      expect(selected).toContain("item-a");
      expect(selected).toContain("feature-x");
    });

    it("should select items by multiple levels", () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const selected = bulk.selectItems({
        levels: [1, 2],
      });

      expect(selected).toHaveLength(3); // item-a, feature-x, item-b
    });

    it("should select items by filter query", () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const selected = bulk.selectItems({
        filter: "name contains item",
      });

      expect(selected).toHaveLength(3);
      expect(selected).toContain("item-a");
      expect(selected).toContain("item-b");
      expect(selected).toContain("item-c");
    });

    it("should filter out non-existent items", () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const selected = bulk.selectItems({
        items: ["item-a", "non-existent", "item-b"],
      });

      expect(selected).toHaveLength(2);
      expect(selected).not.toContain("non-existent");
    });
  });

  describe("execute", () => {
    it("should return dry-run result", async () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const result = await bulk.execute({
        items: ["item-a", "item-b"],
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.processedItems).toHaveLength(0);
      expect(result.failedItems).toHaveLength(0);
    });

    it("should execute merge operations", async () => {
      const bulk = new BulkMergeOperation(samplePlan);
      const result = await bulk.execute({
        items: ["item-a"],
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.processedItems).toContain("item-a");
    });
  });
});

describe("RetryOperation", () => {
  describe("findFailedGates", () => {
    it("should return empty array when state dir does not exist", () => {
      const retry = new RetryOperation("/non/existent/path");
      const failed = retry.findFailedGates();

      expect(failed).toHaveLength(0);
    });
  });

  describe("retryFailed", () => {
    it("should return dry-run result", async () => {
      const retry = new RetryOperation();
      const result = await retry.retryFailed({
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.processedItems).toBeInstanceOf(Array);
    });

    it("should filter by items", async () => {
      const retry = new RetryOperation();
      const result = await retry.retryFailed({
        items: ["item-a"],
        dryRun: true,
      });

      expect(result.success).toBe(true);
    });

    it("should filter by query", async () => {
      const retry = new RetryOperation();
      const result = await retry.retryFailed({
        filter: "lint",
        dryRun: true,
      });

      expect(result.success).toBe(true);
    });
  });
});
