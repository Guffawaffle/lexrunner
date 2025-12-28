/**
 * End-to-end tests for conflict clustering workflow
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  clusterConflicts,
  generateClusteredReport,
  writeConflictsJson,
  extractSymbols,
} from "../src/orchestration/conflictClustering.js";

describe("Conflict Clustering E2E", () => {
  let tempDir: string;
  let weaveDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-e2e-"));
    weaveDir = path.join(tempDir, ".weave");
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should handle complete workflow: extract → cluster → write", async () => {
    // 1. Create a sample TypeScript file with conflicts
    const srcFile = path.join(tempDir, "src/example.ts");
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });

    const code = `
import { helper } from "./utils";

export function calculateTotal(items: Item[]): number {
	let total = 0;
	for (const item of items) {
		total += item.price;
	}
	return total;
}

export class ShoppingCart {
	private items: Item[] = [];

	addItem(item: Item): void {
		this.items.push(item);
	}

	getTotal(): number {
		return calculateTotal(this.items);
	}
}

interface Item {
	name: string;
	price: number;
}
`;
    fs.writeFileSync(srcFile, code);

    // 2. Simulate conflicts in the file
    const conflicts = [
      {
        file: "src/example.ts",
        lines: "4-10",
        type: "both-modified",
      },
      {
        file: "src/example.ts",
        lines: "12-22",
        type: "both-modified",
      },
    ];

    // 3. Extract symbols
    const symbols = extractSymbols(code);
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.some((s) => s.name === "calculateTotal")).toBe(true);
    expect(symbols.some((s) => s.name === "ShoppingCart")).toBe(true);

    // 4. Cluster conflicts
    const clusters = await clusterConflicts(conflicts, tempDir);
    expect(clusters.length).toBe(2);
    expect(clusters[0].file).toBe("src/example.ts");

    // Check that symbols are identified
    const allSymbols = clusters.flatMap((c) => c.symbols);
    expect(allSymbols).toContain("calculateTotal");
    expect(allSymbols).toContain("ShoppingCart");

    // 5. Generate full report
    const report = await generateClusteredReport(conflicts, "main", tempDir);
    expect(report.baseBranch).toBe("main");
    expect(report.summary.totalClusters).toBe(2);
    expect(report.summary.fileCount).toBe(1);

    // 6. Write to .weave/conflicts.json
    const outputPath = await writeConflictsJson(report, weaveDir);
    expect(fs.existsSync(outputPath)).toBe(true);

    // 7. Verify JSON structure
    const content = fs.readFileSync(outputPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.baseBranch).toBe("main");
    expect(parsed.clusters).toHaveLength(2);
    expect(parsed.summary.totalClusters).toBe(2);
  });

  it("should handle multi-file conflicts", async () => {
    // Create multiple files
    const files = [
      { path: "src/utils.ts", code: "export function helper() { return 42; }" },
      { path: "src/index.ts", code: "export function main() { console.log('Hello'); }" },
      { path: "tests/test.spec.ts", code: "describe('test', () => { it('works', () => {}); });" },
    ];

    for (const file of files) {
      const filePath = path.join(tempDir, file.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.code);
    }

    // Conflicts in multiple files
    const conflicts = [
      { file: "src/utils.ts", lines: "1-1", type: "both-modified" },
      { file: "src/index.ts", lines: "1-1", type: "both-modified" },
    ];

    const report = await generateClusteredReport(conflicts, "main", tempDir);

    expect(report.summary.fileCount).toBe(2);
    expect(report.summary.totalClusters).toBe(2);

    // Check that file names are in the report
    const fileNames = report.clusters.map((c) => c.file);
    expect(fileNames).toContain("src/utils.ts");
    expect(fileNames).toContain("src/index.ts");
  });

  it("should handle rename conflicts", async () => {
    const srcFile = path.join(tempDir, "src/rename.ts");
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });

    // Code with two similar functions (potential rename)
    const code = `
export function oldCalculate(x: number): number {
	return x * 2;
}

export function newCalculate(x: number): number {
	return x * 2;
}
`;
    fs.writeFileSync(srcFile, code);

    const conflicts = [{ file: "src/rename.ts", lines: "2-7", type: "both-modified" }];

    const clusters = await clusterConflicts(conflicts, tempDir);

    // Should detect this as a rename conflict
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].conflictType).toBe("rename");
  });

  it("should handle missing files gracefully", async () => {
    const conflicts = [{ file: "nonexistent/file.ts", lines: "1-10", type: "both-modified" }];

    // Should not throw
    const report = await generateClusteredReport(conflicts, "main", tempDir);

    expect(report.clusters.length).toBe(1);
    expect(report.clusters[0].symbols).toEqual([]);
  });

  it("should produce deterministic JSON output", async () => {
    const srcFile = path.join(tempDir, "src/test.ts");
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, "function test() {}");

    const conflicts = [{ file: "src/test.ts", lines: "1-1", type: "both-modified" }];

    // Generate report twice
    const report1 = await generateClusteredReport(conflicts, "main", tempDir);
    const report2 = await generateClusteredReport(conflicts, "main", tempDir);

    // Remove timestamps for comparison
    const r1 = { ...report1, analyzedAt: "" };
    const r2 = { ...report2, analyzedAt: "" };

    expect(r1).toEqual(r2);
  });

  it("should handle complex TypeScript constructs", async () => {
    const srcFile = path.join(tempDir, "src/complex.ts");
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });

    const code = `
import type { Config } from "./types";
import * as utils from "./utils";

export interface User {
	id: number;
	name: string;
}

export type UserOrGuest = User | { anonymous: true };

export const DEFAULT_USER: User = {
	id: 0,
	name: "guest"
};

export class UserManager {
	constructor(private config: Config) {}
	
	async fetchUser(id: number): Promise<User> {
		return { id, name: "User" };
	}
}

export const validateUser = (user: User): boolean => {
	return user.id > 0;
};
`;
    fs.writeFileSync(srcFile, code);

    const symbols = extractSymbols(code);

    // Should extract various symbol types
    const types = new Set(symbols.map((s) => s.type));
    expect(types.has("interface")).toBe(true);
    expect(types.has("type")).toBe(true);
    expect(types.has("const")).toBe(true);
    expect(types.has("class")).toBe(true);
    expect(types.has("import")).toBe(true);

    // Check specific symbols
    const symbolNames = symbols.map((s) => s.name);
    expect(symbolNames).toContain("User");
    expect(symbolNames).toContain("UserManager");
    expect(symbolNames).toContain("validateUser");
  });

  it("should aggregate conflict statistics correctly", async () => {
    // Create multiple files with conflicts
    const files = [
      { path: "src/a.ts", code: "export function funcA() {}" },
      { path: "src/b.ts", code: "export function funcB() {}" },
      { path: "src/c.ts", code: "export function funcC() {}" },
    ];

    for (const file of files) {
      const filePath = path.join(tempDir, file.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.code);
    }

    const conflicts = [
      { file: "src/a.ts", lines: "1-1", type: "both-modified" },
      { file: "src/b.ts", lines: "1-1", type: "both-modified" },
      { file: "src/c.ts", lines: "1-1", type: "both-modified" },
    ];

    const report = await generateClusteredReport(conflicts, "main", tempDir);

    expect(report.summary.totalClusters).toBe(3);
    expect(report.summary.fileCount).toBe(3);
    expect(report.summary.symbolCount).toBe(3);
    expect(report.summary.conflictTypes["both-modified"]).toBe(3);
  });
});
