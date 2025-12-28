import { describe, it, expect } from "vitest";
import { PlanQueryEngine } from "../src/commands/query.js";
import { Plan } from "../src/schema.js";

describe("PlanQueryEngine", () => {
  const samplePlan: Plan = {
    schemaVersion: "1.0",
    target: "main",
    items: [
      {
        name: "feature-a",
        deps: [],
        gates: [
          { name: "lint", run: "echo lint", env: {} },
          { name: "test", run: "echo test", env: {} },
        ],
      },
      {
        name: "feature-b",
        deps: ["feature-a"],
        gates: [{ name: "lint", run: "echo lint", env: {} }],
      },
      {
        name: "feature-c",
        deps: ["feature-a", "feature-b"],
        gates: [
          { name: "lint", run: "echo lint", env: {} },
          { name: "test", run: "echo test", env: {} },
          { name: "e2e", run: "echo e2e", env: {} },
        ],
      },
      {
        name: "integration-feature",
        deps: ["feature-c"],
        gates: [],
      },
    ],
  };

  describe("query", () => {
    it("should filter by level", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("level eq 1");

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("feature-a");
    });

    it("should filter by name contains", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("name contains feature");

      expect(result.count).toBe(4);
    });

    it("should filter by dependency count", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("depsCount gt 1");

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("feature-c");
    });

    it("should filter by gate count", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("gatesCount eq 0");

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("integration-feature");
    });

    it("should support AND operator", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("level eq 2 AND gatesCount eq 1");

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("feature-b");
    });

    it("should filter by name contains", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("name contains feature");

      expect(result.count).toBe(4);
      expect(result.items.every((item) => item.name.includes("feature"))).toBe(true);
    });
  });

  describe("byLevel", () => {
    it("should return items at specific level", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.byLevel(1);

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("feature-a");
    });

    it("should return items at level 3", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.byLevel(3);

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("feature-c");
    });

    it("should return empty for non-existent level", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.byLevel(10);

      expect(result.count).toBe(0);
    });
  });

  describe("roots", () => {
    it("should return items with no dependencies", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.roots();

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("feature-a");
      expect(result.items[0].deps).toHaveLength(0);
    });
  });

  describe("leaves", () => {
    it("should return items with no dependents", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.leaves();

      expect(result.count).toBe(1);
      expect(result.items[0].name).toBe("integration-feature");
    });
  });

  describe("stats", () => {
    it("should calculate plan statistics", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const stats = engine.stats();

      expect(stats.totalItems).toBe(4);
      expect(stats.totalLevels).toBe(4);
      expect(stats.rootNodes).toBe(1);
      expect(stats.leafNodes).toBe(1);
      expect(stats.avgDepsPerItem).toBe((0 + 1 + 2 + 1) / 4);
      expect(stats.avgGatesPerItem).toBe((2 + 1 + 3 + 0) / 4);
    });
  });

  describe("enriched items", () => {
    it("should include computed fields", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("level gt 0");

      expect(result.items[0]).toHaveProperty("level");
      expect(result.items[0]).toHaveProperty("dependents");
      expect(result.items[0]).toHaveProperty("depsCount");
      expect(result.items[0]).toHaveProperty("gatesCount");
      expect(result.items[0]).toHaveProperty("dependentsCount");
    });

    it("should calculate dependents correctly", () => {
      const engine = new PlanQueryEngine(samplePlan);
      const result = engine.query("name eq feature-a");

      expect(result.items[0].dependents).toContain("feature-b");
      expect(result.items[0].dependents).toContain("feature-c");
      expect(result.items[0].dependentsCount).toBe(2);
    });
  });
});
