import { describe, it, expect } from "vitest";
import { validatePlan, formatValidationResult } from "../src/planner/validation.js";
import { Plan } from "../src/schema.js";

describe("Plan Validation", () => {
  describe("Cycle Detection", () => {
    it("detects simple cycle (A→B→A)", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe("cycle");
      expect(result.errors[0].details.cyclePath).toBeDefined();
      expect(result.errors[0].details.cyclePath).toContain("feat-a");
      expect(result.errors[0].details.cyclePath).toContain("feat-b");
      expect(result.errors[0].message).toContain("Dependency cycle detected");
      expect(result.errors[0].message).toContain("feat-a");
      expect(result.errors[0].message).toContain("feat-b");
      expect(result.errors[0].suggestion.toLowerCase()).toContain("remov");
    });

    it("detects complex cycle (A→B→C→D→B)", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: ["feat-c"], gates: [] },
          { name: "feat-c", deps: ["feat-d"], gates: [] },
          { name: "feat-d", deps: ["feat-b"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const cycleError = result.errors.find((e) => e.type === "cycle");
      expect(cycleError).toBeDefined();
      expect(cycleError!.details.cyclePath).toBeDefined();

      const cyclePath = cycleError!.details.cyclePath!;
      expect(cyclePath.length).toBeGreaterThan(2);
      expect(cycleError!.message).toContain("Dependency cycle detected");
      expect(cycleError!.suggestion.toLowerCase()).toContain("remov");
    });

    it("detects self-dependency", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "feat-a", deps: ["feat-a"], gates: [] }],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);

      const selfDepError = result.errors.find((e) => e.type === "self-dependency");
      expect(selfDepError).toBeDefined();
      expect(selfDepError!.details.itemName).toBe("feat-a");
      expect(selfDepError!.message).toContain("depends on itself");
      expect(selfDepError!.suggestion.toLowerCase()).toContain("remov");
    });

    it("handles multiple cycles", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
          { name: "feat-c", deps: ["feat-d"], gates: [] },
          { name: "feat-d", deps: ["feat-c"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      const cycleErrors = result.errors.filter((e) => e.type === "cycle");
      expect(cycleErrors.length).toBeGreaterThan(0);
    });
  });

  describe("Invalid Reference Detection", () => {
    it("detects unknown dependency", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "feat-a", deps: ["feat-missing"], gates: [] }],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe("invalid-ref");
      expect(result.errors[0].details.invalidRef).toBe("feat-missing");
      expect(result.errors[0].message).toContain("unknown dependency");
      expect(result.errors[0].suggestion).toBeDefined();
    });

    it("detects multiple unknown dependencies", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "feat-a", deps: ["feat-missing1", "feat-missing2"], gates: [] }],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      const invalidRefErrors = result.errors.filter((e) => e.type === "invalid-ref");
      expect(invalidRefErrors).toHaveLength(2);
    });
  });

  describe("Orphan Detection", () => {
    it("detects single orphan PR", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "orphan", deps: [], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true); // Orphans are warnings, not errors
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe("orphan");
      expect(result.warnings[0].affectedPRs).toContain("orphan");
      expect(result.warnings[0].message).toContain("orphan");
      expect(result.warnings[0].suggestion).toBeDefined();
    });

    it("detects multiple orphan PRs", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "orphan-1", deps: [], gates: [] },
          { name: "orphan-2", deps: [], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe("orphan");
      expect(result.warnings[0].affectedPRs).toHaveLength(2);
      expect(result.warnings[0].affectedPRs).toContain("orphan-1");
      expect(result.warnings[0].affectedPRs).toContain("orphan-2");
    });

    it("does not flag items with dependencies as orphans", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.diagnostics.orphans).toHaveLength(0);
    });

    it("does not flag items with dependents as orphans", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "feat-c", deps: ["feat-b"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.diagnostics.orphans).toHaveLength(0);
    });
  });

  describe("Valid Plans", () => {
    it("validates plan with no dependencies", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // Note: All items with no deps and no dependents are orphans
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].type).toBe("orphan");
    });

    it("validates plan with simple linear dependencies", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
          { name: "feat-c", deps: ["feat-b"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("validates plan with parallel dependencies", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "feat-c", deps: ["feat-a", "feat-b"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("validates empty plan", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.diagnostics.nodes).toBe(0);
      expect(result.diagnostics.edges).toBe(0);
    });
  });

  describe("Diagnostics", () => {
    it("computes correct node and edge counts", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
          { name: "feat-c", deps: ["feat-a", "feat-b"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.diagnostics.nodes).toBe(3);
      expect(result.diagnostics.edges).toBe(3); // b->a, c->a, c->b
    });

    it("computes correct topological layers", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "feat-c", deps: ["feat-a"], gates: [] },
          { name: "feat-d", deps: ["feat-b"], gates: [] },
          { name: "feat-e", deps: ["feat-c", "feat-d"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.diagnostics.layers).toHaveLength(3);
      expect(result.diagnostics.layers[0].level).toBe(0);
      expect(result.diagnostics.layers[0].prs).toEqual(["feat-a", "feat-b"]);
      expect(result.diagnostics.layers[1].level).toBe(1);
      expect(result.diagnostics.layers[1].prs).toEqual(["feat-c", "feat-d"]);
      expect(result.diagnostics.layers[2].level).toBe(2);
      expect(result.diagnostics.layers[2].prs).toEqual(["feat-e"]);
    });

    it("does not compute layers when cycles exist", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.diagnostics.layers).toHaveLength(0);
    });

    it("warns about large layers", () => {
      const items = [];
      // Create a layer with 15 items
      for (let i = 0; i < 15; i++) {
        items.push({ name: `feat-${i}`, deps: [], gates: [] });
      }

      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items,
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      const largeLayerWarnings = result.warnings.filter((w) => w.type === "large-layer");
      expect(largeLayerWarnings.length).toBeGreaterThan(0);
      expect(largeLayerWarnings[0].message).toContain("15 items");
    });
  });

  describe("Format Validation Result", () => {
    it("formats valid plan result", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
        ],
      };

      const result = validatePlan(plan);
      const formatted = formatValidationResult(result);

      expect(formatted).toContain("✅");
      expect(formatted).toContain("valid");
    });

    it("formats cycle error result", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
        ],
      };

      const result = validatePlan(plan);
      const formatted = formatValidationResult(result);

      expect(formatted).toContain("❌");
      expect(formatted).toContain("Errors");
      expect(formatted).toContain("Dependency cycle detected");
      expect(formatted).toContain("Suggestion");
    });

    it("formats orphan warning result", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-b"], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "orphan", deps: [], gates: [] },
        ],
      };

      const result = validatePlan(plan);
      const formatted = formatValidationResult(result);

      expect(formatted).toContain("⚠️");
      expect(formatted).toContain("Warnings");
      expect(formatted).toContain("orphan");
    });

    it("includes verbose diagnostics when requested", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: ["feat-a"], gates: [] },
        ],
      };

      const result = validatePlan(plan);
      const formatted = formatValidationResult(result, true);

      expect(formatted).toContain("Plan Validation Report");
      expect(formatted).toContain("Nodes:");
      expect(formatted).toContain("Edges:");
      expect(formatted).toContain("Layers");
      expect(formatted).toContain("Layer 0:");
      expect(formatted).toContain("Layer 1:");
    });
  });

  describe("Edge Cases", () => {
    it("handles plan with single item", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "solo", deps: [], gates: [] }],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.diagnostics.nodes).toBe(1);
      expect(result.diagnostics.layers).toHaveLength(1);
    });

    it("handles complex DAG without errors", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: [], gates: [] },
          { name: "feat-b", deps: [], gates: [] },
          { name: "feat-c", deps: ["feat-a"], gates: [] },
          { name: "feat-d", deps: ["feat-a", "feat-b"], gates: [] },
          { name: "feat-e", deps: ["feat-c", "feat-d"], gates: [] },
          { name: "feat-f", deps: ["feat-d"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.diagnostics.nodes).toBe(6);
      expect(result.diagnostics.layers.length).toBeGreaterThan(0);
    });

    it("combines multiple error types", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feat-a", deps: ["feat-a", "feat-missing"], gates: [] },
          { name: "feat-b", deps: ["feat-c"], gates: [] },
          { name: "feat-c", deps: ["feat-b"], gates: [] },
        ],
      };

      const result = validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);

      const errorTypes = result.errors.map((e) => e.type);
      expect(errorTypes).toContain("self-dependency");
      expect(errorTypes).toContain("invalid-ref");
      expect(errorTypes).toContain("cycle");
    });
  });
});
