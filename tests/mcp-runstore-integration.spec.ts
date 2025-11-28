/**
 * MCP Server - RunStore Integration Tests
 *
 * Tests the integration between the MCP server and RunStore for
 * run lifecycle persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type McpServerOptions } from "../src/mcp/server.js";
import { InMemoryRunStore } from "../src/store/inmemory/index.js";
import type { RunStore, RunRecord } from "../src/store/run-store.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("MCP Server - RunStore Integration", () => {
	let testDir: string;
	let runStore: InMemoryRunStore;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Save original environment
		originalEnv = { ...process.env };

		// Create isolated test directory
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-runstore-test-"));

		// Create a fresh InMemoryRunStore for each test
		runStore = new InMemoryRunStore();
	});

	afterEach(async () => {
		// Restore environment
		process.env = originalEnv;

		// Close the store
		await runStore.close();

		// Cleanup test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe("createServer with RunStore injection", () => {
		it("should accept RunStore via options", () => {
			const server = createServer({ runStore });
			expect(server).toBeDefined();
		});

		it("should create server without RunStore option (uses default)", () => {
			// This will create a SqliteRunStore by default
			// We just verify it doesn't throw
			expect(() => createServer()).not.toThrow();
		});
	});

	describe("RunStore factory", () => {
		it("should export createRunStore factory from store module", async () => {
			const { createRunStore } = await import("../src/store/index.js");
			expect(createRunStore).toBeDefined();
			expect(typeof createRunStore).toBe("function");
		});

		it("should create SqliteRunStore with baseDir option", async () => {
			const { createRunStore } = await import(
				"../src/store/index.js"
			);

			// Default uses .smartergpt/runner/.lexrunner/runs.db relative to baseDir
			const store = createRunStore({ baseDir: testDir });
			expect(store).toBeDefined();

			const expectedPath = path.join(testDir, ".smartergpt/runner/.lexrunner/runs.db");
			expect(fs.existsSync(expectedPath)).toBe(true);

			await store.close();
		});

		it("should create store with custom path", async () => {
			const { createRunStore } = await import("../src/store/index.js");
			const customPath = path.join(testDir, "custom-runs.db");

			const store = createRunStore({ dbPath: customPath });
			expect(store).toBeDefined();

			// Verify the database file was created
			expect(fs.existsSync(customPath)).toBe(true);

			await store.close();
		});
	});

	describe("InMemoryRunStore for test isolation", () => {
		it("should allow pre-populating runs", async () => {
			const runs: RunRecord[] = [
				{
					runId: "run-1",
					planHash: "sha256:abc",
					state: "pending",
					startedAt: new Date().toISOString(),
				},
				{
					runId: "run-2",
					planHash: "sha256:def",
					state: "running",
					startedAt: new Date().toISOString(),
				},
			];

			const storeWithRuns = new InMemoryRunStore({ runs });

			const count = await storeWithRuns.getRunCount();
			expect(count).toBe(2);

			const run1 = await storeWithRuns.getRun("run-1");
			expect(run1).not.toBeNull();
			expect(run1?.state).toBe("pending");

			await storeWithRuns.close();
		});

		it("should isolate data between stores", async () => {
			const store1 = new InMemoryRunStore();
			const store2 = new InMemoryRunStore();

			await store1.createRun({
				runId: "store1-run",
				planHash: "sha256:abc",
				state: "pending",
				startedAt: new Date().toISOString(),
			});

			// store2 should not have store1's run
			const run = await store2.getRun("store1-run");
			expect(run).toBeNull();

			await store1.close();
			await store2.close();
		});
	});

	describe("RunStore state machine", () => {
		it("should support run state transitions", async () => {
			const now = new Date().toISOString();

			await runStore.createRun({
				runId: "state-test",
				planHash: "sha256:test",
				state: "pending",
				startedAt: now,
			});

			// Transition to running
			await runStore.updateRun("state-test", { state: "running" });
			let run = await runStore.getRun("state-test");
			expect(run?.state).toBe("running");

			// Transition to completed
			const completedAt = new Date().toISOString();
			await runStore.updateRun("state-test", {
				state: "completed",
				completedAt,
			});
			run = await runStore.getRun("state-test");
			expect(run?.state).toBe("completed");
			expect(run?.completedAt).toBe(completedAt);
		});

		it("should filter runs by state", async () => {
			const now = new Date().toISOString();

			await runStore.createRun({
				runId: "run-pending",
				planHash: "sha256:a",
				state: "pending",
				startedAt: now,
			});
			await runStore.createRun({
				runId: "run-running",
				planHash: "sha256:b",
				state: "running",
				startedAt: now,
			});
			await runStore.createRun({
				runId: "run-completed",
				planHash: "sha256:c",
				state: "completed",
				startedAt: now,
				completedAt: now,
			});

			const pendingRuns = await runStore.listRuns({ state: "pending" });
			expect(pendingRuns).toHaveLength(1);
			expect(pendingRuns[0].runId).toBe("run-pending");

			const runningRuns = await runStore.listRuns({ state: "running" });
			expect(runningRuns).toHaveLength(1);
			expect(runningRuns[0].runId).toBe("run-running");

			const completedRuns = await runStore.listRuns({ state: "completed" });
			expect(completedRuns).toHaveLength(1);
			expect(completedRuns[0].runId).toBe("run-completed");
		});
	});

	describe("Step outcomes", () => {
		it("should track step outcomes for a run", async () => {
			const now = new Date().toISOString();

			await runStore.createRun({
				runId: "steps-test",
				planHash: "sha256:test",
				state: "running",
				startedAt: now,
			});

			await runStore.appendStep({
				stepId: "step-1",
				runId: "steps-test",
				nodeId: "pr-42",
				gateName: "lint",
				status: "pass",
				durationMs: 1234,
				timestamp: now,
			});

			await runStore.appendStep({
				stepId: "step-2",
				runId: "steps-test",
				nodeId: "pr-42",
				gateName: "test",
				status: "pass",
				durationMs: 5678,
				timestamp: now,
			});

			const steps = await runStore.getStepsForRun("steps-test");
			expect(steps).toHaveLength(2);
			expect(steps[0].gateName).toBe("lint");
			expect(steps[1].gateName).toBe("test");
		});
	});

	describe("Receipts", () => {
		it("should track receipts for scope/risk escalation", async () => {
			const now = new Date().toISOString();

			await runStore.createRun({
				runId: "receipts-test",
				planHash: "sha256:test",
				state: "running",
				startedAt: now,
			});

			await runStore.saveReceipt({
				receiptId: "receipt-1",
				runId: "receipts-test",
				reason: "Scope expanded beyond initial plan",
				approver: "alice@example.com",
				timestamp: now,
			});

			const receipts = await runStore.getReceiptsForRun("receipts-test");
			expect(receipts).toHaveLength(1);
			expect(receipts[0].reason).toBe("Scope expanded beyond initial plan");
			expect(receipts[0].approver).toBe("alice@example.com");
		});
	});

	describe("RunStore metadata", () => {
		it("should store and retrieve metadata", async () => {
			const now = new Date().toISOString();

			await runStore.createRun({
				runId: "metadata-test",
				planHash: "sha256:test",
				state: "pending",
				startedAt: now,
				metadata: {
					mode: "senior-dev",
					procedure: "merge-weave-main",
					repo: "owner/repo",
				},
			});

			const run = await runStore.getRun("metadata-test");
			expect(run?.metadata).toBeDefined();
			expect(run?.metadata?.mode).toBe("senior-dev");
			expect(run?.metadata?.procedure).toBe("merge-weave-main");
			expect(run?.metadata?.repo).toBe("owner/repo");
		});
	});

	describe("Pagination", () => {
		it("should support limit and offset", async () => {
			// Create multiple runs with different timestamps
			for (let i = 1; i <= 5; i++) {
				const timestamp = new Date(Date.now() + i * 1000).toISOString();
				await runStore.createRun({
					runId: `run-${i}`,
					planHash: "sha256:test",
					state: "pending",
					startedAt: timestamp,
				});
			}

			// Get first 2 runs
			const page1 = await runStore.listRuns({ limit: 2 });
			expect(page1).toHaveLength(2);

			// Get next 2 runs
			const page2 = await runStore.listRuns({ limit: 2, offset: 2 });
			expect(page2).toHaveLength(2);

			// Verify no overlap
			const page1Ids = page1.map((r) => r.runId);
			const page2Ids = page2.map((r) => r.runId);
			expect(page1Ids).not.toContain(page2Ids[0]);
			expect(page1Ids).not.toContain(page2Ids[1]);
		});
	});

	describe("Store cleanup", () => {
		it("should close gracefully", async () => {
			await expect(runStore.close()).resolves.not.toThrow();
		});

		it("should handle multiple close calls", async () => {
			await runStore.close();
			await expect(runStore.close()).resolves.not.toThrow();
		});
	});
});
