/**
 * Tests for conflict graph construction
 */

import { describe, it, expect } from "vitest";
import { buildConflictGraph } from "../src/orchestration/conflictGraph.js";
import type { PRWithFiles } from "../src/orchestration/types.js";

describe("Conflict Graph", () => {
  describe("buildConflictGraph", () => {
    it("should build empty graph for PRs with no shared files", () => {
      const prs: PRWithFiles[] = [
        { number: 166, files: ["src/cli.ts", "src/util.ts"] },
        { number: 167, files: ["src/gates.ts", "src/schema.ts"] },
        { number: 168, files: ["README.md", "docs/guide.md"] },
      ];

      const graph = buildConflictGraph(prs);

      expect(graph.nodes).toEqual(["166", "167", "168"]);
      expect(graph.edges).toHaveLength(0);
    });

    it("should detect shared files between PRs", () => {
      const prs: PRWithFiles[] = [
        { number: 166, files: ["src/cli.ts", "src/util.ts"] },
        { number: 167, files: ["src/cli.ts", "src/gates.ts"] },
        { number: 168, files: ["src/gates.ts", "README.md"] },
      ];

      const graph = buildConflictGraph(prs);

      expect(graph.nodes).toEqual(["166", "167", "168"]);
      expect(graph.edges).toHaveLength(2);

      // Check edges are properly ordered
      expect(graph.edges[0]).toEqual({
        from: "166",
        to: "167",
        sharedFiles: ["src/cli.ts"],
      });

      expect(graph.edges[1]).toEqual({
        from: "167",
        to: "168",
        sharedFiles: ["src/gates.ts"],
      });
    });

    it("should handle multiple shared files between PRs", () => {
      const prs: PRWithFiles[] = [
        { number: 100, files: ["a.ts", "b.ts", "c.ts"] },
        { number: 101, files: ["b.ts", "c.ts", "d.ts"] },
      ];

      const graph = buildConflictGraph(prs);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].sharedFiles).toEqual(["b.ts", "c.ts"]);
    });

    it("should maintain deterministic ordering of nodes", () => {
      const prs: PRWithFiles[] = [
        { number: 200, files: ["x.ts"] },
        { number: 100, files: ["y.ts"] },
        { number: 150, files: ["z.ts"] },
      ];

      const graph = buildConflictGraph(prs);

      expect(graph.nodes).toEqual(["100", "150", "200"]);
    });

    it("should maintain deterministic ordering of edges", () => {
      const prs: PRWithFiles[] = [
        { number: 200, files: ["common.ts"] },
        { number: 100, files: ["common.ts"] },
        { number: 150, files: ["common.ts"] },
      ];

      const graph = buildConflictGraph(prs);

      // All PRs share common.ts, so we should have 3 edges
      expect(graph.edges).toHaveLength(3);

      // Check deterministic ordering (lower PR first)
      expect(graph.edges[0].from).toBe("100");
      expect(graph.edges[0].to).toBe("150");

      expect(graph.edges[1].from).toBe("100");
      expect(graph.edges[1].to).toBe("200");

      expect(graph.edges[2].from).toBe("150");
      expect(graph.edges[2].to).toBe("200");
    });

    it("should sort shared files deterministically", () => {
      const prs: PRWithFiles[] = [
        { number: 1, files: ["z.ts", "a.ts", "m.ts"] },
        { number: 2, files: ["m.ts", "z.ts", "a.ts"] },
      ];

      const graph = buildConflictGraph(prs);

      expect(graph.edges[0].sharedFiles).toEqual(["a.ts", "m.ts", "z.ts"]);
    });

    it("should handle single PR", () => {
      const prs: PRWithFiles[] = [{ number: 42, files: ["src/index.ts"] }];

      const graph = buildConflictGraph(prs);

      expect(graph.nodes).toEqual(["42"]);
      expect(graph.edges).toHaveLength(0);
    });

    it("should handle empty PR list", () => {
      const prs: PRWithFiles[] = [];

      const graph = buildConflictGraph(prs);

      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });
  });
});
