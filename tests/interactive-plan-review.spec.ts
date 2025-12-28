/**
 * Tests for interactive plan review functionality
 */

import { describe, it, expect } from "vitest";
import {
  displayPlanSummary,
  displayDependencyGraph,
  displayMergeOrder,
  displayPlanDiff,
} from "../src/interactive/planReview.js";
import { comparePlans, formatPlanDiff, validatePlan } from "../src/interactive/planDiff.js";
import { Plan } from "../src/schema.js";

describe("Interactive Plan Review", () => {
  const samplePlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      { name: "item-a", deps: [], gates: [] },
      { name: "item-b", deps: ["item-a"], gates: [] },
      { name: "item-c", deps: ["item-a"], gates: [] },
      { name: "item-d", deps: ["item-b", "item-c"], gates: [] },
    ],
  };

  describe("Plan Summary Display", () => {
    it("should display plan summary correctly", () => {
      // Just check it doesn't throw
      expect(() => displayPlanSummary(samplePlan)).not.toThrow();
    });

    it("should display empty plan", () => {
      const emptyPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [],
      };
      expect(() => displayPlanSummary(emptyPlan)).not.toThrow();
    });
  });

  describe("Dependency Graph Visualization", () => {
    it("should display dependency graph correctly", () => {
      expect(() => displayDependencyGraph(samplePlan)).not.toThrow();
    });

    it("should handle empty plan", () => {
      const emptyPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [],
      };
      expect(() => displayDependencyGraph(emptyPlan)).not.toThrow();
    });

    it("should show items without dependencies", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "standalone", deps: [], gates: [] }],
      };
      expect(() => displayDependencyGraph(plan)).not.toThrow();
    });
  });

  describe("Merge Order Display", () => {
    it("should display merge order correctly", () => {
      expect(() => displayMergeOrder(samplePlan)).not.toThrow();
    });

    it("should handle empty plan", () => {
      const emptyPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [],
      };
      expect(() => displayMergeOrder(emptyPlan)).not.toThrow();
    });

    it("should handle plan with cycles gracefully", () => {
      const cyclicPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "item-a", deps: ["item-b"], gates: [] },
          { name: "item-b", deps: ["item-a"], gates: [] },
        ],
      };
      expect(() => displayMergeOrder(cyclicPlan)).not.toThrow();
    });
  });

  describe("Plan Diff Display", () => {
    it("should display diff between plans", () => {
      const modifiedPlan: Plan = {
        ...samplePlan,
        items: [...samplePlan.items, { name: "item-e", deps: ["item-d"], gates: [] }],
      };
      expect(() => displayPlanDiff(samplePlan, modifiedPlan)).not.toThrow();
    });

    it("should show no changes when plans are identical", () => {
      expect(() => displayPlanDiff(samplePlan, samplePlan)).not.toThrow();
    });

    it("should show target branch change", () => {
      const modifiedPlan: Plan = {
        ...samplePlan,
        target: "develop",
      };
      expect(() => displayPlanDiff(samplePlan, modifiedPlan)).not.toThrow();
    });
  });
});

describe("Plan Comparison and Diff", () => {
  const originalPlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      { name: "item-a", deps: [], gates: [] },
      { name: "item-b", deps: ["item-a"], gates: [] },
    ],
  };

  describe("comparePlans", () => {
    it("should detect no changes for identical plans", () => {
      const diff = comparePlans(originalPlan, originalPlan);
      expect(diff.hasChanges).toBe(false);
      expect(diff.addedItems).toHaveLength(0);
      expect(diff.removedItems).toHaveLength(0);
      expect(diff.modifiedItems).toHaveLength(0);
    });

    it("should detect added items", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        items: [...originalPlan.items, { name: "item-c", deps: ["item-b"], gates: [] }],
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      expect(diff.hasChanges).toBe(true);
      expect(diff.addedItems).toHaveLength(1);
      expect(diff.addedItems[0].name).toBe("item-c");
    });

    it("should detect removed items", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        items: [originalPlan.items[0]],
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      expect(diff.hasChanges).toBe(true);
      expect(diff.removedItems).toHaveLength(1);
      expect(diff.removedItems[0].name).toBe("item-b");
    });

    it("should detect modified dependencies", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        items: [originalPlan.items[0], { ...originalPlan.items[1], deps: [] }],
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedItems).toHaveLength(1);
      expect(diff.modifiedItems[0].name).toBe("item-b");
      expect(diff.modifiedItems[0].originalDeps).toEqual(["item-a"]);
      expect(diff.modifiedItems[0].modifiedDeps).toEqual([]);
    });

    it("should detect target branch change", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        target: "develop",
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      expect(diff.hasChanges).toBe(true);
      expect(diff.targetChanged).toBe(true);
      expect(diff.originalTarget).toBe("main");
      expect(diff.modifiedTarget).toBe("develop");
    });
  });

  describe("formatPlanDiff", () => {
    it("should format no changes message", () => {
      const diff = comparePlans(originalPlan, originalPlan);
      const formatted = formatPlanDiff(diff);
      expect(formatted).toBe("No changes detected");
    });

    it("should format added items", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        items: [...originalPlan.items, { name: "item-c", deps: ["item-b"], gates: [] }],
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      const formatted = formatPlanDiff(diff);
      expect(formatted).toContain("Added Items:");
      expect(formatted).toContain("+ item-c");
      expect(formatted).toContain("deps: item-b");
    });

    it("should format removed items", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        items: [originalPlan.items[0]],
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      const formatted = formatPlanDiff(diff);
      expect(formatted).toContain("Removed Items:");
      expect(formatted).toContain("- item-b");
    });

    it("should format modified items", () => {
      const modifiedPlan: Plan = {
        ...originalPlan,
        items: [originalPlan.items[0], { ...originalPlan.items[1], deps: [] }],
      };
      const diff = comparePlans(originalPlan, modifiedPlan);
      const formatted = formatPlanDiff(diff);
      expect(formatted).toContain("Modified Items:");
      expect(formatted).toContain("~ item-b");
      expect(formatted).toContain("deps: [item-a] → []");
    });
  });

  describe("validatePlan", () => {
    it("should validate correct plan", () => {
      const result = validatePlan(originalPlan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect duplicate item names", () => {
      const invalidPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "item-a", deps: [], gates: [] },
          { name: "item-a", deps: [], gates: [] },
        ],
      };
      const result = validatePlan(invalidPlan);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Duplicate item names");
    });

    it("should detect unknown dependencies", () => {
      const invalidPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "item-a", deps: ["unknown"], gates: [] }],
      };
      const result = validatePlan(invalidPlan);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("unknown dependency");
    });

    it("should detect self-dependencies", () => {
      const invalidPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "item-a", deps: ["item-a"], gates: [] }],
      };
      const result = validatePlan(invalidPlan);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("cannot depend on itself");
    });

    it("should detect multiple errors", () => {
      const invalidPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "item-a", deps: ["item-a"], gates: [] },
          { name: "item-a", deps: ["unknown"], gates: [] },
        ],
      };
      const result = validatePlan(invalidPlan);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
