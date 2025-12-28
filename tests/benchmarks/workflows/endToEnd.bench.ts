/**
 * End-to-End Workflow Performance Benchmarks
 * Measures performance of complete workflows
 */

import { describe, bench } from "vitest";
import { generatePlan } from "../../../src/core/plan.js";
import { validatePlan } from "../../../src/planner/validation.js";
import { computeMergeOrder } from "../../../src/mergeOrder.js";
import type { InputConfig } from "../../../src/core/inputs.js";
import { generateGraph } from "../utils/graphGenerator.js";

/**
 * Create index map from plan items for efficient dependency lookup
 */
function createIndexMap(items: Array<{ name: string }>): Map<string, number> {
  const map = new Map<string, number>();
  items.forEach((item, idx) => map.set(item.name, idx));
  return map;
}

describe("End-to-End Workflow Performance", () => {
  describe("Complete plan generation workflow", () => {
    const smallGraph = generateGraph({ nodes: 10, pattern: "complex" });
    const mediumGraph = generateGraph({ nodes: 30, pattern: "complex" });
    const largeGraph = generateGraph({ nodes: 75, pattern: "complex" });

    // Small workflow
    bench("small workflow (10 items): input → plan → validate → topo sort", () => {
      const indexMap = createIndexMap(smallGraph.items);
      const input: InputConfig = {
        target: "main",
        items: smallGraph.items.map((item, idx) => ({
          id: `pr-${idx}`,
          branch: item.name,
          deps: item.deps.map((dep) => `pr-${indexMap.get(dep)}`),
          gates: [
            { name: "lint", run: "npm run lint", env: {} },
            { name: "test", run: "npm test", env: {} },
          ],
        })),
      };

      const plan = generatePlan(input);
      validatePlan(plan);
      computeMergeOrder(plan);
    });

    // Medium workflow
    bench("medium workflow (30 items): input → plan → validate → topo sort", () => {
      const indexMap = createIndexMap(mediumGraph.items);
      const input: InputConfig = {
        target: "main",
        items: mediumGraph.items.map((item, idx) => ({
          id: `pr-${idx}`,
          branch: item.name,
          deps: item.deps.map((dep) => `pr-${indexMap.get(dep)}`),
          gates: [
            { name: "lint", run: "npm run lint", env: {} },
            { name: "test", run: "npm test", env: {} },
          ],
        })),
      };

      const plan = generatePlan(input);
      validatePlan(plan);
      computeMergeOrder(plan);
    });

    // Large workflow
    bench("large workflow (75 items): input → plan → validate → topo sort", () => {
      const indexMap = createIndexMap(largeGraph.items);
      const input: InputConfig = {
        target: "main",
        items: largeGraph.items.map((item, idx) => ({
          id: `pr-${idx}`,
          branch: item.name,
          deps: item.deps.map((dep) => `pr-${indexMap.get(dep)}`),
          gates: [
            { name: "lint", run: "npm run lint", env: {} },
            { name: "test", run: "npm test", env: {} },
            { name: "build", run: "npm run build", env: {} },
          ],
        })),
      };

      const plan = generatePlan(input);
      validatePlan(plan);
      computeMergeOrder(plan);
    });
  });

  describe("Plan processing with different patterns", () => {
    bench("linear chain (50 items)", () => {
      const graph = generateGraph({ nodes: 50, pattern: "linear" });
      validatePlan(graph);
      computeMergeOrder(graph);
    });

    bench("diamond pattern (50 items)", () => {
      const graph = generateGraph({ nodes: 50, pattern: "diamond" });
      validatePlan(graph);
      computeMergeOrder(graph);
    });

    bench("parallel pattern (50 items)", () => {
      const graph = generateGraph({ nodes: 50, pattern: "parallel" });
      validatePlan(graph);
      computeMergeOrder(graph);
    });

    bench("complex mixed (50 items)", () => {
      const graph = generateGraph({ nodes: 50, pattern: "complex" });
      validatePlan(graph);
      computeMergeOrder(graph);
    });
  });

  describe("Cached vs uncached performance", () => {
    const cachedGraph = generateGraph({ nodes: 100, pattern: "complex" });

    bench("first run (cache miss)", () => {
      validatePlan(cachedGraph);
      computeMergeOrder(cachedGraph);
    });

    bench("second run (cache hit)", () => {
      validatePlan(cachedGraph);
      computeMergeOrder(cachedGraph);
    });
  });
});
