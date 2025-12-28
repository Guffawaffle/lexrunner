/**
 * Tests for conflict clustering - file+symbol groups with rename/whitespace awareness
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  extractSymbols,
  normalizeSignature,
  normalizeWhitespace,
  detectRename,
  findAffectedSymbols,
  clusterConflicts,
  generateClusteredReport,
  writeConflictsJson,
} from "../src/orchestration/conflictClustering.js";
import type { Symbol } from "../src/orchestration/types.js";

describe("Conflict Clustering", () => {
  describe("extractSymbols", () => {
    it("should extract function declarations", () => {
      const code = `
export function myFunction() {
	return 42;
}

async function asyncFunc() {
	return Promise.resolve();
}
`;
      const symbols = extractSymbols(code);

      const funcNames = symbols.filter((s) => s.type === "function").map((s) => s.name);
      expect(funcNames).toContain("myFunction");
      expect(funcNames).toContain("asyncFunc");
    });

    it("should extract arrow functions", () => {
      const code = `
const arrowFunc = () => 42;
export const asyncArrow = async () => Promise.resolve();
let varArrow = (x) => x * 2;
`;
      const symbols = extractSymbols(code);

      const names = symbols.map((s) => s.name);
      expect(names).toContain("arrowFunc");
      expect(names).toContain("asyncArrow");
      expect(names).toContain("varArrow");
    });

    it("should extract class declarations", () => {
      const code = `
export class MyClass {
	constructor() {}
}

abstract class AbstractClass {
	abstract method(): void;
}
`;
      const symbols = extractSymbols(code);

      const classNames = symbols.filter((s) => s.type === "class").map((s) => s.name);
      expect(classNames).toContain("MyClass");
      expect(classNames).toContain("AbstractClass");
    });

    it("should extract interface declarations", () => {
      const code = `
export interface MyInterface {
	prop: string;
}

interface InternalInterface {
	value: number;
}
`;
      const symbols = extractSymbols(code);

      const interfaceNames = symbols.filter((s) => s.type === "interface").map((s) => s.name);
      expect(interfaceNames).toContain("MyInterface");
      expect(interfaceNames).toContain("InternalInterface");
    });

    it("should extract type declarations", () => {
      const code = `
export type MyType = string | number;
type InternalType = { x: number };
`;
      const symbols = extractSymbols(code);

      const typeNames = symbols.filter((s) => s.type === "type").map((s) => s.name);
      expect(typeNames).toContain("MyType");
      expect(typeNames).toContain("InternalType");
    });

    it("should extract import statements", () => {
      const code = `
import * as fs from "fs";
import { readFile, writeFile } from "fs/promises";
`;
      const symbols = extractSymbols(code);

      const importNames = symbols.filter((s) => s.type === "import").map((s) => s.name);
      expect(importNames).toContain("fs");
      expect(importNames.some((n) => n.includes("readFile"))).toBe(true);
    });

    it("should include line numbers", () => {
      const code = `line 1
function test() {}
class MyClass {}
`;
      const symbols = extractSymbols(code);

      expect(symbols[0].line).toBe(2);
      expect(symbols[1].line).toBe(3);
    });

    it("should include normalized signatures", () => {
      const code = `
export function  myFunc (  x : number  )  {  return x; }
`;
      const symbols = extractSymbols(code);

      const func = symbols.find((s) => s.name === "myFunc");
      expect(func?.signature).toBeDefined();
      // Signature is normalized to lowercase
      expect(func?.signature).toContain("myfunc");
    });
  });

  describe("normalizeSignature", () => {
    it("should collapse multiple spaces", () => {
      const sig = "function   test(   a,    b   )";
      const normalized = normalizeSignature(sig);
      expect(normalized).not.toContain("  ");
    });

    it("should remove spaces around punctuation", () => {
      const sig = "function test ( a : number , b : string )";
      const normalized = normalizeSignature(sig);
      expect(normalized).toBe("function test(a:number,b:string)");
    });

    it("should be case-insensitive", () => {
      const sig1 = "Function Test()";
      const sig2 = "function test()";
      expect(normalizeSignature(sig1)).toBe(normalizeSignature(sig2));
    });

    it("should trim whitespace", () => {
      const sig = "  function test()  ";
      const normalized = normalizeSignature(sig);
      expect(normalized).toBe("function test()");
    });
  });

  describe("normalizeWhitespace", () => {
    it("should normalize line endings", () => {
      const code = "line1\r\nline2\r\nline3";
      const normalized = normalizeWhitespace(code);
      expect(normalized).toBe("line1\nline2\nline3");
    });

    it("should convert tabs to spaces", () => {
      const code = "\tindented\n\t\tdouble indent";
      const normalized = normalizeWhitespace(code);
      expect(normalized).not.toContain("\t");
    });

    it("should trim trailing whitespace", () => {
      const code = "line1   \nline2  \nline3";
      const normalized = normalizeWhitespace(code);
      const lines = normalized.split("\n");
      expect(lines[0]).toBe("line1");
      expect(lines[1]).toBe("line2");
    });

    it("should remove whitespace-only lines", () => {
      const code = "line1\n   \nline2\n\t\nline3";
      const normalized = normalizeWhitespace(code);
      // Whitespace-only lines are replaced with empty strings
      expect(normalized).toBe("line1\nline2\nline3");
    });
  });

  describe("detectRename", () => {
    it("should detect renamed functions with same signature", () => {
      const symbol1: Symbol = {
        name: "oldFunction",
        type: "function",
        line: 10,
        signature: "function oldfunction(x:number):number",
      };

      const symbol2: Symbol = {
        name: "newFunction",
        type: "function",
        line: 10,
        signature: "function newfunction(x:number):number",
      };

      expect(detectRename(symbol1, symbol2)).toBe(true);
    });

    it("should not detect rename if types differ", () => {
      const symbol1: Symbol = {
        name: "myFunc",
        type: "function",
        line: 10,
        signature: "function myfunc()",
      };

      const symbol2: Symbol = {
        name: "myVar",
        type: "const",
        line: 10,
        signature: "const myvar=()",
      };

      expect(detectRename(symbol1, symbol2)).toBe(false);
    });

    it("should not detect rename if names are same", () => {
      const symbol1: Symbol = {
        name: "sameFunc",
        type: "function",
        line: 10,
        signature: "function samefunc()",
      };

      const symbol2: Symbol = {
        name: "sameFunc",
        type: "function",
        line: 20,
        signature: "function samefunc()",
      };

      expect(detectRename(symbol1, symbol2)).toBe(false);
    });

    it("should not detect rename if signatures differ", () => {
      const symbol1: Symbol = {
        name: "funcA",
        type: "function",
        line: 10,
        signature: "function funca(x:number)",
      };

      const symbol2: Symbol = {
        name: "funcB",
        type: "function",
        line: 10,
        signature: "function funcb(x:string)",
      };

      expect(detectRename(symbol1, symbol2)).toBe(false);
    });

    it("should handle missing signatures gracefully", () => {
      const symbol1: Symbol = {
        name: "func1",
        type: "function",
        line: 10,
      };

      const symbol2: Symbol = {
        name: "func2",
        type: "function",
        line: 10,
      };

      expect(detectRename(symbol1, symbol2)).toBe(false);
    });
  });

  describe("findAffectedSymbols", () => {
    const symbols: Symbol[] = [
      { name: "funcA", type: "function", line: 10 },
      { name: "funcB", type: "function", line: 25 },
      { name: "funcC", type: "function", line: 50 },
      { name: "ClassD", type: "class", line: 75 },
    ];

    it("should find symbols in conflict range", () => {
      const affected = findAffectedSymbols(symbols, "20-30");
      expect(affected.map((s) => s.name)).toContain("funcB");
    });

    it("should include symbols near conflict range (buffer)", () => {
      const affected = findAffectedSymbols(symbols, "15-20");
      // funcB at line 25 should be included due to buffer
      expect(affected.map((s) => s.name)).toContain("funcB");
    });

    it("should handle single line conflicts", () => {
      const affected = findAffectedSymbols(symbols, "50");
      expect(affected.map((s) => s.name)).toContain("funcC");
    });

    it("should handle invalid line ranges", () => {
      const affected = findAffectedSymbols(symbols, "unknown");
      // Should not throw and return some symbols
      expect(Array.isArray(affected)).toBe(true);
    });
  });

  describe("clusterConflicts", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conflict-test-"));
    });

    it("should cluster conflicts by file", async () => {
      // Create a test file
      const testFile = path.join(tempDir, "test.ts");
      fs.writeFileSync(
        testFile,
        `
export function funcA() {}
export function funcB() {}
`
      );

      const conflicts = [
        { file: path.relative(tempDir, testFile), lines: "2-2", type: "both-modified" },
        { file: path.relative(tempDir, testFile), lines: "3-3", type: "both-modified" },
      ];

      const clusters = await clusterConflicts(conflicts, tempDir);

      expect(clusters.length).toBe(2);
      expect(clusters[0].file).toBe(path.relative(tempDir, testFile));
    });

    it("should identify affected symbols", async () => {
      const testFile = path.join(tempDir, "test.ts");
      fs.writeFileSync(
        testFile,
        `
function myFunction() {
	return 42;
}
`
      );

      const conflicts = [
        { file: path.relative(tempDir, testFile), lines: "2-4", type: "both-modified" },
      ];

      const clusters = await clusterConflicts(conflicts, tempDir);

      expect(clusters[0].symbols).toContain("myFunction");
    });

    it("should detect rename conflicts", async () => {
      const testFile = path.join(tempDir, "test.ts");
      fs.writeFileSync(
        testFile,
        `
function oldName(x: number) { return x; }
function newName(x: number) { return x; }
`
      );

      const conflicts = [
        { file: path.relative(tempDir, testFile), lines: "2-3", type: "both-modified" },
      ];

      const clusters = await clusterConflicts(conflicts, tempDir);

      // Should detect this as a potential rename
      expect(clusters[0].conflictType).toBe("rename");
    });

    it("should handle missing files gracefully", async () => {
      const conflicts = [{ file: "nonexistent.ts", lines: "1-10", type: "both-modified" }];

      const clusters = await clusterConflicts(conflicts, tempDir);

      expect(clusters.length).toBe(1);
      expect(clusters[0].symbols).toEqual([]);
    });

    it("should produce deterministic ordering", async () => {
      const conflicts = [
        { file: "c.ts", lines: "10-20", type: "both-modified" },
        { file: "a.ts", lines: "5-15", type: "both-modified" },
        { file: "b.ts", lines: "1-5", type: "both-modified" },
      ];

      const clusters = await clusterConflicts(conflicts, tempDir);

      // Should be sorted by file name
      expect(clusters[0].file).toBe("a.ts");
      expect(clusters[1].file).toBe("b.ts");
      expect(clusters[2].file).toBe("c.ts");
    });
  });

  describe("generateClusteredReport", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conflict-report-"));
    });

    it("should generate complete report structure", async () => {
      const conflicts = [{ file: "test.ts", lines: "10-20", type: "both-modified" }];

      const report = await generateClusteredReport(conflicts, "main", tempDir);

      expect(report.analyzedAt).toBeDefined();
      expect(report.baseBranch).toBe("main");
      expect(report.clusters).toBeDefined();
      expect(report.summary).toBeDefined();
    });

    it("should calculate correct summary", async () => {
      const testFile1 = path.join(tempDir, "file1.ts");
      const testFile2 = path.join(tempDir, "file2.ts");

      fs.writeFileSync(testFile1, "function test1() {}");
      fs.writeFileSync(testFile2, "function test2() {}");

      const conflicts = [
        { file: path.relative(tempDir, testFile1), lines: "1-1", type: "both-modified" },
        { file: path.relative(tempDir, testFile2), lines: "1-1", type: "both-modified" },
      ];

      const report = await generateClusteredReport(conflicts, "main", tempDir);

      expect(report.summary.totalClusters).toBe(2);
      expect(report.summary.fileCount).toBe(2);
      expect(report.summary.conflictTypes["both-modified"]).toBe(2);
    });

    it("should count unique symbols", async () => {
      const testFile = path.join(tempDir, "test.ts");
      fs.writeFileSync(
        testFile,
        `
function funcA() {}
function funcB() {}
function funcC() {}
`
      );

      const conflicts = [
        { file: path.relative(tempDir, testFile), lines: "2-4", type: "both-modified" },
      ];

      const report = await generateClusteredReport(conflicts, "main", tempDir);

      expect(report.summary.symbolCount).toBeGreaterThan(0);
    });
  });

  describe("writeConflictsJson", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-"));
    });

    it("should create .weave directory if not exists", async () => {
      const outputDir = path.join(tempDir, ".weave");

      const report = {
        analyzedAt: new Date().toISOString(),
        baseBranch: "main",
        clusters: [],
        summary: {
          totalClusters: 0,
          fileCount: 0,
          symbolCount: 0,
          conflictTypes: {},
        },
      };

      await writeConflictsJson(report, outputDir);

      expect(fs.existsSync(outputDir)).toBe(true);
    });

    it("should write conflicts.json with correct structure", async () => {
      const outputDir = path.join(tempDir, ".weave");

      const report = {
        analyzedAt: "2025-01-01T00:00:00.000Z",
        baseBranch: "main",
        clusters: [
          {
            file: "test.ts",
            symbols: ["funcA"],
            conflictType: "both-modified" as const,
            details: {
              lineRange: "10-20",
              affectedSymbols: [],
            },
          },
        ],
        summary: {
          totalClusters: 1,
          fileCount: 1,
          symbolCount: 1,
          conflictTypes: { "both-modified": 1 },
        },
      };

      const outputPath = await writeConflictsJson(report, outputDir);

      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.baseBranch).toBe("main");
      expect(parsed.clusters).toHaveLength(1);
      expect(parsed.summary.totalClusters).toBe(1);
    });

    it("should produce valid JSON", async () => {
      const outputDir = path.join(tempDir, ".weave");

      const report = {
        analyzedAt: new Date().toISOString(),
        baseBranch: "main",
        clusters: [],
        summary: {
          totalClusters: 0,
          fileCount: 0,
          symbolCount: 0,
          conflictTypes: {},
        },
      };

      const outputPath = await writeConflictsJson(report, outputDir);
      const content = fs.readFileSync(outputPath, "utf-8");

      // Should not throw
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });
});
