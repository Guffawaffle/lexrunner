/**
 * RunManager + RunStore Integration Tests
 *
 * Tests the integration between RunManager and RunStore for step outcome
 * and receipt persistence with dual-write mode (NDJSON + RunStore).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
	RunManager,
	createRunManager,
	readRunLog,
} from "../../src/runs/index.js";
import { InMemoryRunStore } from "../../src/store/index.js";
import type { StepOutcome, Receipt } from "../../src/store/run-store.js";

describe("RunManager with RunStore Integration", () => {
	let testDir: string;
	let store: InMemoryRunStore;
	let manager: RunManager;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "run-manager-store-test-"));
		store = new InMemoryRunStore();
		manager = createRunManager({ baseDir: testDir, runStore: store });
	});

	afterEach(async () => {
		await store.close();
		await rm(testDir, { recursive: true, force: true });
	});

	describe("constructor with options", () => {
		it("should accept options object with runStore", () => {
			const testStore = new InMemoryRunStore();
			const testManager = new RunManager({
				baseDir: testDir,
				runStore: testStore,
			});

			expect(testManager.getRunStore()).toBe(testStore);
		});

		it("should accept legacy string baseDir", () => {
			const testManager = new RunManager(testDir);

			expect(testManager.getRunStore()).toBeUndefined();
		});

		it("should default to cwd when no baseDir provided", () => {
			const testManager = new RunManager({});

			expect(testManager.getRunStore()).toBeUndefined();
		});
	});

	describe("getRunStore", () => {
		it("should return configured RunStore", () => {
			expect(manager.getRunStore()).toBe(store);
		});

		it("should return undefined when no RunStore configured", () => {
			const noStoreManager = createRunManager(testDir);
			expect(noStoreManager.getRunStore()).toBeUndefined();
		});
	});

	describe("recordStepOutcome", () => {
		const createStepOutcome = (runId: string): StepOutcome => ({
			stepId: `step-${Date.now()}`,
			runId,
			nodeId: "node-1",
			gateName: "lint",
			status: "pass",
			durationMs: 1234,
			timestamp: new Date().toISOString(),
		});

		it("should persist step outcome to RunStore", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome = createStepOutcome(run.runId);
			await manager.recordStepOutcome(outcome);

			const steps = await store.getStepsForRun(run.runId);
			expect(steps).toHaveLength(1);
			expect(steps[0].stepId).toBe(outcome.stepId);
			expect(steps[0].gateName).toBe("lint");
			expect(steps[0].status).toBe("pass");
		});

		it("should also persist step outcome to NDJSON log", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome = createStepOutcome(run.runId);
			await manager.recordStepOutcome(outcome);

			const logs = readRunLog(run.runId, "steps", testDir);
			expect(logs).toHaveLength(1);
			expect(logs[0].type).toBe("step_outcome");
			expect(logs[0].stepId).toBe(outcome.stepId);
		});

		it("should persist multiple step outcomes", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome1: StepOutcome = {
				stepId: "step-1",
				runId: run.runId,
				nodeId: "node-1",
				gateName: "lint",
				status: "pass",
				durationMs: 1000,
				timestamp: new Date().toISOString(),
			};

			const outcome2: StepOutcome = {
				stepId: "step-2",
				runId: run.runId,
				nodeId: "node-1",
				gateName: "test",
				status: "pass",
				durationMs: 5000,
				timestamp: new Date().toISOString(),
			};

			await manager.recordStepOutcome(outcome1);
			await manager.recordStepOutcome(outcome2);

			const steps = await store.getStepsForRun(run.runId);
			expect(steps).toHaveLength(2);
		});

		it("should include optional logs and artifacts", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome: StepOutcome = {
				stepId: "step-1",
				runId: run.runId,
				nodeId: "node-1",
				gateName: "test",
				status: "fail",
				durationMs: 5000,
				logs: "Test failed: 3 tests failing",
				artifacts: ["coverage/lcov.info", "reports/junit.xml"],
				timestamp: new Date().toISOString(),
			};

			await manager.recordStepOutcome(outcome);

			const steps = await store.getStepsForRun(run.runId);
			expect(steps[0].logs).toBe("Test failed: 3 tests failing");
			expect(steps[0].artifacts).toEqual(["coverage/lcov.info", "reports/junit.xml"]);
		});
	});

	describe("recordReceipt", () => {
		const createReceipt = (runId: string): Receipt => ({
			receiptId: `receipt-${Date.now()}`,
			runId,
			reason: "Scope expanded beyond initial plan",
			timestamp: new Date().toISOString(),
		});

		it("should persist receipt to RunStore", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const receipt = createReceipt(run.runId);
			await manager.recordReceipt(receipt);

			const receipts = await store.getReceiptsForRun(run.runId);
			expect(receipts).toHaveLength(1);
			expect(receipts[0].receiptId).toBe(receipt.receiptId);
			expect(receipts[0].reason).toBe("Scope expanded beyond initial plan");
		});

		it("should also persist receipt to NDJSON log", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const receipt = createReceipt(run.runId);
			await manager.recordReceipt(receipt);

			const logs = readRunLog(run.runId, "receipts", testDir);
			expect(logs).toHaveLength(1);
			expect(logs[0].type).toBe("receipt");
			expect(logs[0].receiptId).toBe(receipt.receiptId);
		});

		it("should include optional approver", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const receipt: Receipt = {
				receiptId: "receipt-1",
				runId: run.runId,
				reason: "Extended test coverage",
				approver: "alice@example.com",
				timestamp: new Date().toISOString(),
			};

			await manager.recordReceipt(receipt);

			const receipts = await store.getReceiptsForRun(run.runId);
			expect(receipts[0].approver).toBe("alice@example.com");
		});
	});

	describe("getStepOutcomes", () => {
		it("should return step outcomes from RunStore when configured", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome: StepOutcome = {
				stepId: "step-1",
				runId: run.runId,
				nodeId: "node-1",
				gateName: "lint",
				status: "pass",
				durationMs: 1000,
				timestamp: new Date().toISOString(),
			};

			await manager.recordStepOutcome(outcome);

			const steps = await manager.getStepOutcomes(run.runId);
			expect(steps).toHaveLength(1);
			expect(steps[0].stepId).toBe("step-1");
		});

		it("should return empty array for run with no steps", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const steps = await manager.getStepOutcomes(run.runId);
			expect(steps).toEqual([]);
		});
	});

	describe("getReceipts", () => {
		it("should return receipts from RunStore when configured", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const receipt: Receipt = {
				receiptId: "receipt-1",
				runId: run.runId,
				reason: "Scope change",
				timestamp: new Date().toISOString(),
			};

			await manager.recordReceipt(receipt);

			const receipts = await manager.getReceipts(run.runId);
			expect(receipts).toHaveLength(1);
			expect(receipts[0].receiptId).toBe("receipt-1");
		});

		it("should return empty array for run with no receipts", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const receipts = await manager.getReceipts(run.runId);
			expect(receipts).toEqual([]);
		});
	});

	describe("NDJSON fallback (no RunStore)", () => {
		let noStoreManager: RunManager;

		beforeEach(() => {
			noStoreManager = createRunManager(testDir);
		});

		it("should record step outcomes to NDJSON only", async () => {
			const run = await noStoreManager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome: StepOutcome = {
				stepId: "step-1",
				runId: run.runId,
				nodeId: "node-1",
				gateName: "lint",
				status: "pass",
				durationMs: 1000,
				timestamp: new Date().toISOString(),
			};

			await noStoreManager.recordStepOutcome(outcome);

			// Verify NDJSON was written
			const logs = readRunLog(run.runId, "steps", testDir);
			expect(logs).toHaveLength(1);
			expect(logs[0].stepId).toBe("step-1");
		});

		it("should retrieve step outcomes from NDJSON", async () => {
			const run = await noStoreManager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const outcome: StepOutcome = {
				stepId: "step-1",
				runId: run.runId,
				nodeId: "node-1",
				gateName: "lint",
				status: "pass",
				durationMs: 1000,
				timestamp: new Date().toISOString(),
			};

			await noStoreManager.recordStepOutcome(outcome);

			const steps = await noStoreManager.getStepOutcomes(run.runId);
			expect(steps).toHaveLength(1);
			expect(steps[0].stepId).toBe("step-1");
		});

		it("should retrieve receipts from NDJSON", async () => {
			const run = await noStoreManager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
			});

			const receipt: Receipt = {
				receiptId: "receipt-1",
				runId: run.runId,
				reason: "Scope change",
				timestamp: new Date().toISOString(),
			};

			await noStoreManager.recordReceipt(receipt);

			const receipts = await noStoreManager.getReceipts(run.runId);
			expect(receipts).toHaveLength(1);
			expect(receipts[0].receiptId).toBe("receipt-1");
		});
	});

	describe("full lifecycle with RunStore", () => {
		it("should handle complete run lifecycle with step outcomes and receipts", async () => {
			// 1. Create run
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo",
				task: "Merge PRs #1, #2",
			});

			expect(run.state).toBe("initialized");

			// 2. Transition to executing
			await manager.transitionState(run.runId, "executing");

			// 3. Record step outcomes
			await manager.recordStepOutcome({
				stepId: "step-1",
				runId: run.runId,
				nodeId: "pr-1",
				gateName: "lint",
				status: "pass",
				durationMs: 1000,
				timestamp: new Date().toISOString(),
			});

			await manager.recordStepOutcome({
				stepId: "step-2",
				runId: run.runId,
				nodeId: "pr-1",
				gateName: "test",
				status: "pass",
				durationMs: 5000,
				timestamp: new Date().toISOString(),
			});

			// 4. Record a scope escalation receipt
			await manager.recordReceipt({
				receiptId: "receipt-1",
				runId: run.runId,
				reason: "Extended test coverage approved",
				approver: "alice@example.com",
				timestamp: new Date().toISOString(),
			});

			// 5. Complete the run
			await manager.transitionState(run.runId, "completed");

			// Verify final state
			const finalRun = await manager.getRun(run.runId);
			expect(finalRun?.state).toBe("completed");
			expect(finalRun?.completedAt).toBeDefined();

			// Verify step outcomes
			const steps = await manager.getStepOutcomes(run.runId);
			expect(steps).toHaveLength(2);
			expect(steps[0].gateName).toBe("lint");
			expect(steps[1].gateName).toBe("test");

			// Verify receipts
			const receipts = await manager.getReceipts(run.runId);
			expect(receipts).toHaveLength(1);
			expect(receipts[0].approver).toBe("alice@example.com");

			// Verify NDJSON compatibility
			const stepLogs = readRunLog(run.runId, "steps", testDir);
			expect(stepLogs).toHaveLength(2);

			const receiptLogs = readRunLog(run.runId, "receipts", testDir);
			expect(receiptLogs).toHaveLength(1);
		});
	});
});
