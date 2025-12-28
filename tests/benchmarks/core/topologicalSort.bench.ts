/**
 * Topological Sort Performance Benchmarks
 * Measures performance of Kahn's algorithm implementation across various graph sizes and patterns
 */

import { describe, bench } from "vitest";
import { computeMergeOrder } from "../../../src/mergeOrder.js";
import { generateGraph } from "../utils/graphGenerator.js";

describe("Topological Sort Performance", () => {
  // Small graphs (10 nodes)
  describe("10 nodes", () => {
    bench("linear dependency chain", () => {
      const graph = generateGraph({ nodes: 10, pattern: "linear" });
      computeMergeOrder(graph);
    });

    bench("diamond pattern", () => {
      const graph = generateGraph({ nodes: 10, pattern: "diamond" });
      computeMergeOrder(graph);
    });

    bench("fully parallel", () => {
      const graph = generateGraph({ nodes: 10, pattern: "parallel" });
      computeMergeOrder(graph);
    });

    bench("complex mixed", () => {
      const graph = generateGraph({ nodes: 10, pattern: "complex" });
      computeMergeOrder(graph);
    });
  });

  // Medium graphs (50 nodes)
  describe("50 nodes", () => {
    bench("linear dependency chain", () => {
      const graph = generateGraph({ nodes: 50, pattern: "linear" });
      computeMergeOrder(graph);
    });

    bench("diamond pattern", () => {
      const graph = generateGraph({ nodes: 50, pattern: "diamond" });
      computeMergeOrder(graph);
    });

    bench("fully parallel", () => {
      const graph = generateGraph({ nodes: 50, pattern: "parallel" });
      computeMergeOrder(graph);
    });

    bench("complex mixed", () => {
      const graph = generateGraph({ nodes: 50, pattern: "complex" });
      computeMergeOrder(graph);
    });
  });

  // Large graphs (100 nodes)
  describe("100 nodes", () => {
    bench("linear dependency chain", () => {
      const graph = generateGraph({ nodes: 100, pattern: "linear" });
      computeMergeOrder(graph);
    });

    bench("diamond pattern", () => {
      const graph = generateGraph({ nodes: 100, pattern: "diamond" });
      computeMergeOrder(graph);
    });

    bench("fully parallel", () => {
      const graph = generateGraph({ nodes: 100, pattern: "parallel" });
      computeMergeOrder(graph);
    });

    bench("complex mixed", () => {
      const graph = generateGraph({ nodes: 100, pattern: "complex" });
      computeMergeOrder(graph);
    });
  });

  // Very large graphs (500 nodes)
  describe("500 nodes", () => {
    bench("linear dependency chain", () => {
      const graph = generateGraph({ nodes: 500, pattern: "linear" });
      computeMergeOrder(graph);
    });

    bench("diamond pattern", () => {
      const graph = generateGraph({ nodes: 500, pattern: "diamond" });
      computeMergeOrder(graph);
    });

    bench("fully parallel", () => {
      const graph = generateGraph({ nodes: 500, pattern: "parallel" });
      computeMergeOrder(graph);
    });

    bench("complex mixed", () => {
      const graph = generateGraph({ nodes: 500, pattern: "complex" });
      computeMergeOrder(graph);
    });
  });
});
