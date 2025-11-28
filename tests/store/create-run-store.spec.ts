/**
 * createRunStore Factory Function Tests
 *
 * Tests the factory function for creating RunStore instances.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";
import { createRunStore, SqliteRunStore } from "../../src/store/index.js";
import type { RunRecord } from "../../src/store/run-store.js";

describe("createRunStore factory", () => {
	let testDir: string;
	const stores: Array<{ close: () => Promise<void> }> = [];

	afterEach(async () => {
		// Close all stores
		for (const store of stores) {
			await store.close();
		}
		stores.length = 0;

		// Clean up test directory
		if (testDir) {
			await rm(testDir, { recursive: true, force: true });
		}
	});

	describe("default configuration", () => {
		it("should create SqliteRunStore instance", async () => {
			testDir = await mkdtemp(join(tmpdir(), "store-factory-test-"));

			// Ensure .lexrunner directory exists
			await mkdir(join(testDir, ".lexrunner"), { recursive: true });

			const store = createRunStore({ baseDir: testDir });
			stores.push(store);

			// Verify it's a SqliteRunStore by checking it works
			const run: RunRecord = {
				runId: "run-001",
				planHash: "sha256:abc123",
				state: "pending",
				startedAt: new Date().toISOString(),
			};

			await store.createRun(run);
			const retrieved = await store.getRun("run-001");

			expect(retrieved).not.toBeNull();
			expect(retrieved!.runId).toBe("run-001");
		});

		it("should create database at default path", async () => {
			testDir = await mkdtemp(join(tmpdir(), "store-factory-test-"));

			// Ensure .lexrunner directory exists
			await mkdir(join(testDir, ".lexrunner"), { recursive: true });

			const store = createRunStore({ baseDir: testDir });
			stores.push(store);

			// Create a run to trigger database file creation
			await store.createRun({
				runId: "run-001",
				planHash: "sha256:abc123",
				state: "pending",
				startedAt: new Date().toISOString(),
			});

			// Verify database file exists at expected location
			const expectedPath = join(testDir, ".lexrunner", "runs.db");
			expect(existsSync(expectedPath)).toBe(true);
		});
	});

	describe("custom configuration", () => {
		it("should use custom database path when provided", async () => {
			testDir = await mkdtemp(join(tmpdir(), "store-factory-test-"));
			const customPath = join(testDir, "custom.db");

			const store = createRunStore({ dbPath: customPath });
			stores.push(store);

			// Create a run to trigger database file creation
			await store.createRun({
				runId: "run-001",
				planHash: "sha256:abc123",
				state: "pending",
				startedAt: new Date().toISOString(),
			});

			// Verify database file exists at custom location
			expect(existsSync(customPath)).toBe(true);
		});

		it("should use custom baseDir when provided", async () => {
			testDir = await mkdtemp(join(tmpdir(), "store-factory-test-"));
			const customBaseDir = join(testDir, "custom-base");
			await mkdir(join(customBaseDir, ".lexrunner"), { recursive: true });

			const store = createRunStore({ baseDir: customBaseDir });
			stores.push(store);

			// Create a run to trigger database file creation
			await store.createRun({
				runId: "run-001",
				planHash: "sha256:abc123",
				state: "pending",
				startedAt: new Date().toISOString(),
			});

			// Verify database file exists in custom base directory
			const expectedPath = join(customBaseDir, ".lexrunner", "runs.db");
			expect(existsSync(expectedPath)).toBe(true);
		});
	});

	describe("SqliteRunStore functionality", () => {
		it("should support full run lifecycle", async () => {
			testDir = await mkdtemp(join(tmpdir(), "store-factory-test-"));
			await mkdir(join(testDir, ".lexrunner"), { recursive: true });

			const store = createRunStore({ baseDir: testDir });
			stores.push(store);

			// Create run
			await store.createRun({
				runId: "lifecycle-test",
				planHash: "sha256:lifecycle",
				state: "pending",
				startedAt: "2024-01-15T10:30:00.000Z",
			});

			// Update run
			await store.updateRun("lifecycle-test", { state: "running" });

			// Append step
			await store.appendStep({
				stepId: "step-001",
				runId: "lifecycle-test",
				nodeId: "pr-42",
				gateName: "lint",
				status: "pass",
				durationMs: 1234,
				timestamp: "2024-01-15T10:30:05.000Z",
			});

			// Save receipt
			await store.saveReceipt({
				receiptId: "receipt-001",
				runId: "lifecycle-test",
				reason: "Scope expanded",
				timestamp: "2024-01-15T10:30:10.000Z",
			});

			// Complete run
			await store.updateRun("lifecycle-test", {
				state: "completed",
				completedAt: "2024-01-15T10:31:00.000Z",
			});

			// Verify final state
			const run = await store.getRun("lifecycle-test");
			expect(run?.state).toBe("completed");

			const steps = await store.getStepsForRun("lifecycle-test");
			expect(steps).toHaveLength(1);

			const receipts = await store.getReceiptsForRun("lifecycle-test");
			expect(receipts).toHaveLength(1);
		});
	});
});
