/**
 * Integration tests for Conflict Predictor
 */

import { describe, it, expect } from "vitest";
import { predictConflicts } from "../src/orchestration/conflictPredictor.js";
import type { PRWithFiles } from "../src/orchestration/types.js";

describe("Conflict Predictor Integration", () => {
	it("should predict no conflicts for PRs with no shared files", async () => {
		const prs: PRWithFiles[] = [
			{ number: 166, files: ["src/cli.ts"] },
			{ number: 167, files: ["src/gates.ts"] },
			{ number: 168, files: ["README.md"] }
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		expect(report.conflictGraph.edges).toHaveLength(0);
		expect(report.misBatches).toHaveLength(1);
		expect(report.misBatches[0].prs).toEqual(["166", "167", "168"]);
		expect(report.recommendations.safeBatch).toEqual(["166", "167", "168"]);
		expect(report.recommendations.sequential).toEqual([]);
	});

	it("should identify conflicts and recommend batches", async () => {
		const prs: PRWithFiles[] = [
			{ number: 166, files: ["src/cli.ts", "src/util.ts"] },
			{ number: 167, files: ["src/cli.ts", "src/gates.ts"] },
			{ number: 168, files: ["src/gates.ts", "README.md"] }
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		// Should have conflict edges
		expect(report.conflictGraph.edges.length).toBeGreaterThan(0);
		
		// Should have multiple batches
		expect(report.misBatches.length).toBeGreaterThan(1);
		
		// First batch should contain non-conflicting PRs
		const firstBatch = report.misBatches[0];
		expect(firstBatch.prs.length).toBeGreaterThan(0);
		
		// Verify no conflicts within first batch
		const firstBatchSet = new Set(firstBatch.prs);
		const hasInternalConflict = report.conflictGraph.edges.some(edge =>
			firstBatchSet.has(edge.from) && firstBatchSet.has(edge.to)
		);
		expect(hasInternalConflict).toBe(false);
	});

	it("should generate complete report structure", async () => {
		const prs: PRWithFiles[] = [
			{ number: 100, files: ["a.ts", "b.ts"] },
			{ number: 101, files: ["b.ts", "c.ts"] }
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		// Check report structure
		expect(report.analyzedAt).toBeDefined();
		expect(report.baseBranch).toBe("main");
		expect(report.conflictGraph).toBeDefined();
		expect(report.misBatches).toBeDefined();
		expect(report.mergeTreeSimulation).toBeDefined();
		expect(report.recommendations).toBeDefined();
		expect(report.recommendations.safeBatch).toBeDefined();
		expect(report.recommendations.sequential).toBeDefined();
	});

	it("should handle single PR", async () => {
		const prs: PRWithFiles[] = [
			{ number: 42, files: ["src/index.ts"] }
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		expect(report.conflictGraph.nodes).toEqual(["42"]);
		expect(report.conflictGraph.edges).toHaveLength(0);
		expect(report.misBatches[0].prs).toEqual(["42"]);
	});

	it("should produce deterministic output", async () => {
		const prs: PRWithFiles[] = [
			{ number: 200, files: ["x.ts"] },
			{ number: 100, files: ["x.ts"] },
			{ number: 150, files: ["y.ts"] }
		];

		const report1 = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		const report2 = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		// Conflict graphs should be identical
		expect(report1.conflictGraph).toEqual(report2.conflictGraph);
		
		// MIS batches should be identical
		expect(report1.misBatches).toEqual(report2.misBatches);
		
		// Recommendations should be identical
		expect(report1.recommendations).toEqual(report2.recommendations);
	});

	it("should support conflict clustering when enabled", async () => {
		const prs: PRWithFiles[] = [
			{ number: 100, files: ["a.ts"], head: "head-100" },
			{ number: 101, files: ["a.ts"], head: "head-101" }
		];

		const prHeads = new Map([
			["100", "head-100"],
			["101", "head-101"]
		]);

		// Mock merge conflicts by not actually running git merge-tree
		// In real usage, this would detect actual conflicts
		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			prHeads,
			skipMergeTreeSimulation: true, // Skip for test
			enableClustering: true
		});

		// Clustering should be available even without merge-tree
		// (but may be empty if no conflicts detected)
		expect(report).toBeDefined();
	});

	it("should handle batch 1 scenario from issue (PRs 166, 167, 168)", async () => {
		// Simulating the Batch 1 scenario mentioned in the issue
		const prs: PRWithFiles[] = [
			{ 
				number: 166, 
				files: ["src/cli.ts", "src/mergeOrder.ts"],
				head: "pr-166-head"
			},
			{ 
				number: 167, 
				files: ["src/cli.ts", "src/gates.ts"],
				head: "pr-167-head"
			},
			{ 
				number: 168, 
				files: ["src/gates.ts", "tests/gates.spec.ts"],
				head: "pr-168-head"
			}
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		// Verify conflict graph structure
		expect(report.conflictGraph.nodes).toEqual(["166", "167", "168"]);
		
		// Should have conflicts: 166-167 (cli.ts), 167-168 (gates.ts)
		expect(report.conflictGraph.edges).toContainEqual({
			from: "166",
			to: "167",
			sharedFiles: ["src/cli.ts"]
		});
		
		expect(report.conflictGraph.edges).toContainEqual({
			from: "167",
			to: "168",
			sharedFiles: ["src/gates.ts"]
		});

		// 166 and 168 should be in safe batch (no shared files)
		const firstBatch = report.misBatches[0];
		expect(firstBatch.prs).toContain("166");
		expect(firstBatch.prs).toContain("168");
		
		// 167 should be sequential
		const has167Sequential = report.misBatches.some((batch, idx) => 
			idx > 0 && batch.prs.includes("167")
		);
		expect(has167Sequential).toBe(true);
	});

	it("should handle fully connected graph", async () => {
		const prs: PRWithFiles[] = [
			{ number: 1, files: ["common.ts"] },
			{ number: 2, files: ["common.ts"] },
			{ number: 3, files: ["common.ts"] }
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		// All PRs conflict with each other
		expect(report.conflictGraph.edges).toHaveLength(3);
		
		// Should recommend sequential merges
		expect(report.misBatches.length).toBeGreaterThan(1);
	});

	it("should include timestamp in report", async () => {
		const prs: PRWithFiles[] = [
			{ number: 1, files: ["a.ts"] }
		];

		const report = await predictConflicts({
			prs,
			baseBranch: "main",
			skipMergeTreeSimulation: true
		});

		expect(report.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});
});
