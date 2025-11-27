/**
 * Artifact Discovery and Listing Tests
 *
 * Tests for the lexrunner.listArtifacts functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import {
	createRunManager,
	listArtifacts,
	getArtifact,
	getArtifactType,
	matchesPattern,
	RunManager,
} from "../../src/runs/index.js";
import type { ListArtifactsInput, ArtifactType } from "../../src/runs/index.js";

describe("Artifact Discovery", () => {
	let testDir: string;
	let manager: RunManager;
	let runId: string;
	let runDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "artifacts-test-"));
		manager = createRunManager(testDir);

		// Create a test run
		const run = await manager.createRun({
			mode: "senior-dev",
			procedure: "merge-weave-main",
			repo: "test/repo",
		});
		runId = run.runId;
		runDir = join(testDir, ".lexrunner", "runs", runId);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("getArtifactType", () => {
		it("should identify plan artifact", () => {
			expect(getArtifactType("plan.json")).toBe("plan");
		});

		it("should identify decision artifact", () => {
			expect(getArtifactType("decisions.ndjson")).toBe("decision");
		});

		it("should identify failure artifact", () => {
			expect(getArtifactType("failures.ndjson")).toBe("failure");
		});

		it("should identify gate report artifact", () => {
			expect(getArtifactType("gates/lint/npm-lint/report.json")).toBe("gate");
			expect(getArtifactType("gates/test/unit/report.json")).toBe("gate");
		});

		it("should identify report artifact", () => {
			expect(getArtifactType("reports/summary.md")).toBe("report");
			expect(getArtifactType("reports/detailed-analysis.md")).toBe("report");
		});

		it("should identify log artifact", () => {
			expect(getArtifactType("logs/execution.log")).toBe("log");
			expect(getArtifactType("logs/debug.log")).toBe("log");
		});

		it("should return null for unknown artifacts", () => {
			expect(getArtifactType("random.txt")).toBeNull();
			expect(getArtifactType("artifacts/custom.zip")).toBeNull();
			expect(getArtifactType("gates/report.json")).toBeNull(); // Missing subdirectory
		});

		it("should handle Windows-style paths", () => {
			expect(getArtifactType("gates\\lint\\npm-lint\\report.json")).toBe("gate");
			expect(getArtifactType("reports\\summary.md")).toBe("report");
		});
	});

	describe("matchesPattern", () => {
		it("should match exact paths", () => {
			expect(matchesPattern("plan.json", "plan.json")).toBe(true);
			expect(matchesPattern("plan.json", "other.json")).toBe(false);
		});

		it("should match single-segment wildcards", () => {
			expect(matchesPattern("reports/summary.md", "reports/*.md")).toBe(true);
			expect(matchesPattern("reports/detailed.md", "reports/*.md")).toBe(true);
			expect(matchesPattern("reports/nested/summary.md", "reports/*.md")).toBe(false);
		});

		it("should match multi-segment wildcards", () => {
			expect(matchesPattern("gates/lint/npm/report.json", "gates/**/report.json")).toBe(true);
			expect(matchesPattern("gates/test/unit/report.json", "gates/**/report.json")).toBe(true);
			// ** matches one or more segments, not zero (gates/report.json requires at least one segment between)
			expect(matchesPattern("gates/x/report.json", "gates/**/report.json")).toBe(true);
		});

		it("should handle complex patterns", () => {
			expect(matchesPattern("gates/lint/npm-lint/report.json", "gates/*/npm-*/report.json")).toBe(true);
			expect(matchesPattern("gates/test/npm-test/report.json", "gates/*/npm-*/report.json")).toBe(true);
			expect(matchesPattern("gates/lint/jest/report.json", "gates/*/npm-*/report.json")).toBe(false);
		});
	});

	describe("listArtifacts", () => {
		beforeEach(async () => {
			// Create various artifact files in the run directory
			await writeFile(join(runDir, "plan.json"), '{"items": []}');
			await writeFile(join(runDir, "decisions.ndjson"), '{"type": "test"}\n');
			await writeFile(join(runDir, "failures.ndjson"), '{"error": "test"}\n');

			// Create gates directory with reports
			const gatesDir = join(runDir, "gates", "lint", "npm-lint");
			await mkdir(gatesDir, { recursive: true });
			await writeFile(join(gatesDir, "report.json"), '{"passed": true}');

			const testGatesDir = join(runDir, "gates", "test", "unit");
			await mkdir(testGatesDir, { recursive: true });
			await writeFile(join(testGatesDir, "report.json"), '{"passed": true}');

			// Create reports directory
			const reportsDir = join(runDir, "reports");
			await mkdir(reportsDir, { recursive: true });
			await writeFile(join(reportsDir, "summary.md"), "# Summary\n\nTest report.");

			// Create logs directory
			const logsDir = join(runDir, "logs");
			await mkdir(logsDir, { recursive: true });
			await writeFile(join(logsDir, "execution.log"), "Log entry 1\nLog entry 2\n");
		});

		it("should list all artifacts in run directory", () => {
			const input: ListArtifactsInput = { runId };
			const result = listArtifacts(input, testDir);

			expect(result.totalCount).toBe(7);
			expect(result.artifacts.length).toBe(7);

			const types = result.artifacts.map((a) => a.type);
			expect(types).toContain("plan");
			expect(types).toContain("decision");
			expect(types).toContain("failure");
			expect(types).toContain("gate");
			expect(types).toContain("report");
			expect(types).toContain("log");
		});

		it("should filter by type", () => {
			const input: ListArtifactsInput = { runId, type: "gate" };
			const result = listArtifacts(input, testDir);

			expect(result.totalCount).toBe(2);
			result.artifacts.forEach((a) => {
				expect(a.type).toBe("gate");
			});
		});

		it("should filter by path pattern", () => {
			const input: ListArtifactsInput = { runId, path: "gates/**/report.json" };
			const result = listArtifacts(input, testDir);

			expect(result.totalCount).toBe(2);
			result.artifacts.forEach((a) => {
				expect(a.path).toMatch(/gates.*report\.json$/);
			});
		});

		it("should return latest only when requested", () => {
			const input: ListArtifactsInput = { runId, latestOnly: true };
			const result = listArtifacts(input, testDir);

			// Should have at most one artifact per type
			const typeCounts = new Map<ArtifactType, number>();
			for (const artifact of result.artifacts) {
				const count = typeCounts.get(artifact.type) ?? 0;
				typeCounts.set(artifact.type, count + 1);
			}

			for (const [, count] of typeCounts) {
				expect(count).toBe(1);
			}
		});

		it("should include content when inline is true and file is small", () => {
			const input: ListArtifactsInput = { runId, inline: true };
			const result = listArtifacts(input, testDir);

			// All our test files are small, so all should have content
			const planArtifact = result.artifacts.find((a) => a.type === "plan");
			expect(planArtifact).toBeDefined();
			expect(planArtifact!.content).toBe('{"items": []}');

			const reportArtifact = result.artifacts.find((a) => a.type === "report");
			expect(reportArtifact).toBeDefined();
			expect(reportArtifact!.content).toBe("# Summary\n\nTest report.");
		});

		it("should not include content when inline is false", () => {
			const input: ListArtifactsInput = { runId, inline: false };
			const result = listArtifacts(input, testDir);

			result.artifacts.forEach((a) => {
				expect(a.content).toBeUndefined();
			});
		});

		it("should return empty array for run with no artifacts", async () => {
			// Create a new run without creating artifacts
			const newRun = await manager.createRun({
				mode: "senior-dev",
				procedure: "pr-review",
				repo: "test/repo",
			});

			const input: ListArtifactsInput = { runId: newRun.runId };
			const result = listArtifacts(input, testDir);

			expect(result.totalCount).toBe(0);
			expect(result.artifacts).toEqual([]);
		});

		it("should include correct metadata for artifacts", () => {
			const input: ListArtifactsInput = { runId };
			const result = listArtifacts(input, testDir);

			const planArtifact = result.artifacts.find((a) => a.type === "plan");
			expect(planArtifact).toBeDefined();
			expect(planArtifact!.path).toBe("plan.json");
			expect(planArtifact!.size).toBeGreaterThan(0);
			expect(planArtifact!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(planArtifact!.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("should sort artifacts by modification time (newest first)", () => {
			const input: ListArtifactsInput = { runId };
			const result = listArtifacts(input, testDir);

			for (let i = 1; i < result.artifacts.length; i++) {
				const prevTime = new Date(result.artifacts[i - 1].modifiedAt).getTime();
				const currTime = new Date(result.artifacts[i].modifiedAt).getTime();
				expect(prevTime).toBeGreaterThanOrEqual(currTime);
			}
		});

		it("should combine type and path filters", () => {
			const input: ListArtifactsInput = {
				runId,
				type: "gate",
				path: "gates/lint/**/report.json",
			};
			const result = listArtifacts(input, testDir);

			expect(result.totalCount).toBe(1);
			expect(result.artifacts[0].path).toBe("gates/lint/npm-lint/report.json");
		});
	});

	describe("getArtifact", () => {
		beforeEach(async () => {
			await writeFile(join(runDir, "plan.json"), '{"items": []}');
		});

		it("should get a single artifact by path", () => {
			const artifact = getArtifact(runId, "plan.json", testDir, true);

			expect(artifact).not.toBeNull();
			expect(artifact!.path).toBe("plan.json");
			expect(artifact!.type).toBe("plan");
			expect(artifact!.content).toBe('{"items": []}');
		});

		it("should return null for non-existent artifact", () => {
			const artifact = getArtifact(runId, "non-existent.json", testDir);

			expect(artifact).toBeNull();
		});

		it("should return null for unknown artifact type", () => {
			// Create a file that doesn't match any artifact pattern
			writeFileSync(join(runDir, "custom.txt"), "custom content");

			const artifact = getArtifact(runId, "custom.txt", testDir);

			expect(artifact).toBeNull();
		});

		it("should respect includeContent parameter", () => {
			const withContent = getArtifact(runId, "plan.json", testDir, true);
			expect(withContent!.content).toBe('{"items": []}');

			const withoutContent = getArtifact(runId, "plan.json", testDir, false);
			expect(withoutContent!.content).toBeUndefined();
		});
	});

	describe("RunManager.listArtifacts", () => {
		beforeEach(async () => {
			await writeFile(join(runDir, "plan.json"), '{"items": []}');
			await writeFile(join(runDir, "decisions.ndjson"), '{"type": "test"}\n');
		});

		it("should list artifacts through RunManager", () => {
			const result = manager.listArtifacts({ runId });

			expect(result.totalCount).toBe(2);
			expect(result.artifacts.length).toBe(2);
		});

		it("should throw RunNotFoundError for invalid runId", () => {
			expect(() => {
				manager.listArtifacts({ runId: "nonexistent-id" });
			}).toThrow("Run not found");
		});
	});

	describe("inline threshold", () => {
		it("should not inline content for large files", async () => {
			// Create a file larger than threshold (10KB by default)
			const largeContent = "x".repeat(15 * 1024); // 15KB
			await writeFile(join(runDir, "plan.json"), largeContent);

			const result = listArtifacts({ runId, inline: true }, testDir);

			const planArtifact = result.artifacts.find((a) => a.type === "plan");
			expect(planArtifact).toBeDefined();
			expect(planArtifact!.size).toBeGreaterThan(10 * 1024);
			expect(planArtifact!.content).toBeUndefined();
		});

		it("should inline content for files under threshold", async () => {
			const smallContent = '{"items": []}';
			await writeFile(join(runDir, "plan.json"), smallContent);

			const result = listArtifacts({ runId, inline: true }, testDir);

			const planArtifact = result.artifacts.find((a) => a.type === "plan");
			expect(planArtifact).toBeDefined();
			expect(planArtifact!.content).toBe(smallContent);
		});

		it("should respect custom threshold", async () => {
			const content = "x".repeat(500); // 500 bytes
			await writeFile(join(runDir, "plan.json"), content);

			// With small threshold, should not inline
			const result1 = listArtifacts({ runId, inline: true }, testDir, 100);
			expect(result1.artifacts.find((a) => a.type === "plan")!.content).toBeUndefined();

			// With large threshold, should inline
			const result2 = listArtifacts({ runId, inline: true }, testDir, 1000);
			expect(result2.artifacts.find((a) => a.type === "plan")!.content).toBe(content);
		});
	});
});
