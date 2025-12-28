/**
 * Tests for Maximal Independent Set (MIS) computation
 */

import { describe, it, expect } from "vitest";
import { computeMIS, computeAllMISBatches } from "../src/orchestration/mis.js";
import type { ConflictGraph } from "../src/orchestration/types.js";

describe("MIS Computation", () => {
  describe("computeMIS", () => {
    it("should return all nodes when no conflicts exist", () => {
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3"],
        edges: [],
      };

      const mis = computeMIS(graph);

      expect(mis).toEqual(["1", "2", "3"]);
    });

    it("should exclude conflicting nodes", () => {
      const graph: ConflictGraph = {
        nodes: ["166", "167", "168"],
        edges: [
          { from: "166", to: "167", sharedFiles: ["src/cli.ts"] },
          { from: "167", to: "168", sharedFiles: ["src/gates.ts"] },
        ],
      };

      const mis = computeMIS(graph);

      // 166 and 168 don't conflict with each other, only with 167
      expect(mis).toEqual(["166", "168"]);
    });

    it("should use greedy algorithm with degree-based ordering", () => {
      // Graph: 1--2--3
      //         \ | /
      //          \|/
      //           4
      // Node 4 has highest degree (3), nodes 1,2,3 have degree 2 or 1
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3", "4"],
        edges: [
          { from: "1", to: "2", sharedFiles: ["a.ts"] },
          { from: "1", to: "4", sharedFiles: ["b.ts"] },
          { from: "2", to: "3", sharedFiles: ["c.ts"] },
          { from: "2", to: "4", sharedFiles: ["d.ts"] },
          { from: "3", to: "4", sharedFiles: ["e.ts"] },
        ],
      };

      const mis = computeMIS(graph);

      // Greedy picks lowest degree first
      // Node 1 has degree 2, node 3 has degree 2, node 2 has degree 3, node 4 has degree 3
      // Should pick 1 or 3 first, then the other
      expect(mis.length).toBe(2);
      expect(mis).toContain("1");
      expect(mis).toContain("3");
    });

    it("should be deterministic with same inputs", () => {
      const graph: ConflictGraph = {
        nodes: ["100", "101", "102", "103"],
        edges: [
          { from: "100", to: "101", sharedFiles: ["x.ts"] },
          { from: "102", to: "103", sharedFiles: ["y.ts"] },
        ],
      };

      const mis1 = computeMIS(graph);
      const mis2 = computeMIS(graph);

      expect(mis1).toEqual(mis2);
    });

    it("should handle fully connected graph (clique)", () => {
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3"],
        edges: [
          { from: "1", to: "2", sharedFiles: ["a.ts"] },
          { from: "1", to: "3", sharedFiles: ["b.ts"] },
          { from: "2", to: "3", sharedFiles: ["c.ts"] },
        ],
      };

      const mis = computeMIS(graph);

      // In a clique, MIS size is 1 (pick lowest PR number)
      expect(mis).toEqual(["1"]);
    });

    it("should handle star graph (one central node)", () => {
      // Central node 5 connected to all others
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3", "5"],
        edges: [
          { from: "1", to: "5", sharedFiles: ["a.ts"] },
          { from: "2", to: "5", sharedFiles: ["b.ts"] },
          { from: "3", to: "5", sharedFiles: ["c.ts"] },
        ],
      };

      const mis = computeMIS(graph);

      // Should pick all leaf nodes, excluding center
      expect(mis).toEqual(["1", "2", "3"]);
    });

    it("should handle linear chain", () => {
      // 1--2--3--4--5
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3", "4", "5"],
        edges: [
          { from: "1", to: "2", sharedFiles: ["a.ts"] },
          { from: "2", to: "3", sharedFiles: ["b.ts"] },
          { from: "3", to: "4", sharedFiles: ["c.ts"] },
          { from: "4", to: "5", sharedFiles: ["d.ts"] },
        ],
      };

      const mis = computeMIS(graph);

      // Should pick alternating nodes: 1, 3, 5 or similar
      expect(mis.length).toBeGreaterThanOrEqual(2);
      // Verify independence
      for (let i = 0; i < mis.length; i++) {
        for (let j = i + 1; j < mis.length; j++) {
          const hasEdge = graph.edges.some(
            (e) => (e.from === mis[i] && e.to === mis[j]) || (e.from === mis[j] && e.to === mis[i])
          );
          expect(hasEdge).toBe(false);
        }
      }
    });
  });

  describe("computeAllMISBatches", () => {
    it("should return single batch when no conflicts", () => {
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3"],
        edges: [],
      };

      const batches = computeAllMISBatches(graph);

      expect(batches).toHaveLength(1);
      expect(batches[0].prs).toEqual(["1", "2", "3"]);
      expect(batches[0].id).toBe("mis-1");
    });

    it("should return multiple batches for conflicting PRs", () => {
      const graph: ConflictGraph = {
        nodes: ["166", "167", "168"],
        edges: [
          { from: "166", to: "167", sharedFiles: ["src/cli.ts"] },
          { from: "167", to: "168", sharedFiles: ["src/gates.ts"] },
        ],
      };

      const batches = computeAllMISBatches(graph);

      expect(batches).toHaveLength(2);
      expect(batches[0].prs).toEqual(["166", "168"]);
      expect(batches[1].prs).toEqual(["167"]);
    });

    it("should generate batch IDs sequentially", () => {
      const graph: ConflictGraph = {
        nodes: ["1", "2", "3"],
        edges: [
          { from: "1", to: "2", sharedFiles: ["a.ts"] },
          { from: "2", to: "3", sharedFiles: ["b.ts"] },
        ],
      };

      const batches = computeAllMISBatches(graph);

      expect(batches[0].id).toBe("mis-1");
      if (batches.length > 1) {
        expect(batches[1].id).toBe("mis-2");
      }
    });

    it("should include helpful reasons in batches", () => {
      const graph: ConflictGraph = {
        nodes: ["1", "2"],
        edges: [{ from: "1", to: "2", sharedFiles: ["shared.ts"] }],
      };

      const batches = computeAllMISBatches(graph);

      // Each batch should have a reason
      batches.forEach((batch) => {
        expect(batch.reason).toBeDefined();
        expect(batch.reason.length).toBeGreaterThan(0);
      });
    });
  });
});
