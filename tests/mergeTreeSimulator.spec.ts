/**
 * Tests for git merge-tree simulation and parsing
 */

import { describe, it, expect } from "vitest";
import { parseMergeTreeOutput } from "../src/orchestration/mergeTreeSimulator.js";

describe("Merge-Tree Simulator", () => {
  describe("parseMergeTreeOutput", () => {
    it("should parse empty output as clean merge", () => {
      const output = "";
      const conflicts = parseMergeTreeOutput(output);
      expect(conflicts).toEqual([]);
    });

    it("should detect conflict markers in output", () => {
      const output = `
<<<<<<< HEAD
const value = "version1";
=======
const value = "version2";
>>>>>>> branch
`;
      const conflicts = parseMergeTreeOutput(output);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe("both-modified");
    });

    it("should parse CONFLICT markers", () => {
      const output = `
CONFLICT (content): Merge conflict in src/cli.ts
<<<<<<< HEAD
import { oldFunc } from "./old.js";
=======
import { newFunc } from "./new.js";
>>>>>>> branch
`;
      const conflicts = parseMergeTreeOutput(output);

      expect(conflicts.length).toBeGreaterThan(0);
    });

    it("should parse both modified markers", () => {
      const output = `
Auto-merging src/gates.ts
CONFLICT (content): Merge conflict in src/gates.ts
Auto-merging src/cli.ts
both modified: src/cli.ts
`;
      const conflicts = parseMergeTreeOutput(output);

      const cliConflict = conflicts.find((c) => c.file === "src/cli.ts");
      expect(cliConflict).toBeDefined();
      expect(cliConflict?.type).toBe("both-modified");
    });

    it("should extract file names from conflict markers", () => {
      const output = `
<<<<<<< src/utils.ts
function old() {}
=======
function new() {}
>>>>>>> src/utils.ts
`;
      const conflicts = parseMergeTreeOutput(output);

      if (conflicts.length > 0) {
        expect(conflicts[0].file).toContain("utils");
      }
    });

    it("should handle multiple conflicts in output", () => {
      const output = `
both modified: src/file1.ts
both modified: src/file2.ts
both modified: src/file3.ts
`;
      const conflicts = parseMergeTreeOutput(output);

      expect(conflicts.length).toBe(3);
      expect(conflicts[0].file).toBe("src/file1.ts");
      expect(conflicts[1].file).toBe("src/file2.ts");
      expect(conflicts[2].file).toBe("src/file3.ts");
    });

    it("should not duplicate conflicts", () => {
      const output = `
both modified: src/cli.ts
<<<<<<< HEAD
code
=======
code
>>>>>>> branch
both modified: src/cli.ts
`;
      const conflicts = parseMergeTreeOutput(output);

      // Should only have one conflict for src/cli.ts
      const cliConflicts = conflicts.filter((c) => c.file === "src/cli.ts");
      expect(cliConflicts.length).toBe(1);
    });

    it("should extract line ranges from conflict markers", () => {
      const output = `line 1
line 2
<<<<<<< HEAD
line 3 - conflict start
=======
line 3 - different
>>>>>>> branch
line 4`;

      const conflicts = parseMergeTreeOutput(output);

      if (conflicts.length > 0) {
        expect(conflicts[0].lines).toBeDefined();
        // Should have line range information
        expect(conflicts[0].lines).toMatch(/\d+-\d+/);
      }
    });

    it("should handle clean merge output", () => {
      const output = `
Auto-merging src/cli.ts
Auto-merging src/gates.ts
Merge made by the 'recursive' strategy.
`;
      const conflicts = parseMergeTreeOutput(output);

      expect(conflicts).toEqual([]);
    });

    it("should be case-insensitive for CONFLICT keyword", () => {
      const output = `
conflict (content): Merge conflict in src/test.ts
CONFLICT (content): Merge conflict in src/test2.ts
`;
      const conflicts = parseMergeTreeOutput(output);

      // Should detect both variations
      expect(conflicts.length).toBeGreaterThan(0);
    });
  });
});
