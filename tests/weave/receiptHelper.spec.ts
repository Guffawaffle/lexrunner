/**
 * Tests for Weave Receipt Helper
 *
 * Verifies receipt emission for merge-weave and gate operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	emitMergeReceipt,
	emitMergeFailureReceipt,
	emitWeaveCompletionReceipt,
	emitWeaveUncertaintyMarker,
	emitGateReceipt,
} from "../../src/weave/receiptHelper.js";
import { WeaveState, type WeaveContext, type BatchState } from "../../src/weave/types.js";

// Mock weave context factory
function createMockContext(overrides: Partial<WeaveContext> = {}): WeaveContext {
	return {
		runId: "test-run-123",
		state: WeaveState.MERGING,
		plan: {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{ name: "PR-1", deps: [] },
				{ name: "PR-2", deps: ["PR-1"] },
			],
		},
		prHeads: [],
		batches: [
			{ batchNumber: 0, items: ["PR-1"], state: "pending" },
			{ batchNumber: 1, items: ["PR-2"], state: "pending" },
		],
		currentBatchIndex: 0,
		startedAt: new Date().toISOString(),
		lastUpdatedAt: new Date().toISOString(),
		successfulMerges: 0,
		failedMerges: 0,
		metadata: {
			planHash: "abc123",
			targetBranch: "main",
			dryRun: false,
		},
		...overrides,
	};
}

describe("Weave Receipt Helper", () => {
	let logSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		logSpy = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("emitMergeReceipt", () => {
		it("should emit a valid receipt for merge operation", () => {
			const context = createMockContext();
			const batch: BatchState = { batchNumber: 0, items: ["PR-1"], state: "in-progress" };

			const receipt = emitMergeReceipt(context, batch, "abc123def", { log: false });

			expect(receipt.schemaVersion).toBe("1.0.0");
			expect(receipt.kind).toBe("ActionReceipt");
			expect(receipt.action).toContain("merge batch 1");
			expect(receipt.action).toContain("PR-1");
			expect(receipt.confidence).toBe("high");
			expect(receipt.reversibility).toBe("reversible");
			expect(receipt.rollbackPath).toContain("abc123def");
			expect(receipt.rollbackCommand).toBe("git reset --hard abc123def");
			expect(receipt.phase).toBe("apply");
			expect(receipt.runId).toBe("test-run-123");
			expect(receipt.planHash).toBe("abc123");
		});

		it("should include multiple items in batch", () => {
			const context = createMockContext();
			const batch: BatchState = { batchNumber: 1, items: ["PR-2", "PR-3"], state: "in-progress" };

			const receipt = emitMergeReceipt(context, batch, "head123", { log: false });

			expect(receipt.action).toContain("batch 2");
			expect(receipt.action).toContain("PR-2, PR-3");
		});
	});

	describe("emitMergeFailureReceipt", () => {
		it("should emit a failure receipt with escalation", () => {
			const context = createMockContext();
			const batch: BatchState = { batchNumber: 0, items: ["PR-1"], state: "failed" };

			const receipt = emitMergeFailureReceipt(
				context,
				batch,
				"Merge conflict in src/cli.ts",
				"abc123",
				{ log: false }
			);

			expect(receipt.outcome).toBe("failure");
			expect(receipt.rationale).toContain("Merge conflict");
			expect(receipt.escalationRequired).toBe(true);
			expect(receipt.escalationReason).toContain("conflict");
			expect(receipt.nextActions).toBeDefined();
			expect(receipt.nextActions?.length).toBeGreaterThan(0);
		});
	});

	describe("emitWeaveCompletionReceipt", () => {
		it("should emit success receipt when all batches complete", () => {
			const context = createMockContext({
				state: WeaveState.COMPLETED,
				successfulMerges: 2,
				failedMerges: 0,
			});

			const receipt = emitWeaveCompletionReceipt(context, { log: false });

			expect(receipt.outcome).toBe("success");
			expect(receipt.escalationRequired).toBe(false);
			expect(receipt.action).toContain("2 merged");
		});

		it("should emit partial receipt when some batches fail", () => {
			const context = createMockContext({
				state: WeaveState.FAILED,
				successfulMerges: 1,
				failedMerges: 1,
			});

			const receipt = emitWeaveCompletionReceipt(context, { log: false });

			expect(receipt.outcome).toBe("partial");
			expect(receipt.escalationRequired).toBe(true);
			expect(receipt.reversibility).toBe("partially-reversible");
		});

		it("should emit failure receipt when all batches fail", () => {
			const context = createMockContext({
				state: WeaveState.FAILED,
				successfulMerges: 0,
				failedMerges: 2,
			});

			const receipt = emitWeaveCompletionReceipt(context, { log: false });

			expect(receipt.outcome).toBe("failure");
			expect(receipt.escalationRequired).toBe(true);
			expect(receipt.reversibility).toBe("reversible");
		});
	});

	describe("emitWeaveUncertaintyMarker", () => {
		it("should emit marker with predicted conflicts", () => {
			const context = createMockContext();

			const marker = emitWeaveUncertaintyMarker(context, 3, { log: false });

			expect(marker.operation).toContain("weave execution");
			expect(marker.uncertainties).toContain("3 potential conflict(s) detected in preflight");
			expect(marker.proceedingAnyway).toBe(true);
			expect(marker.mitigations.length).toBeGreaterThan(0);
		});

		it("should emit marker with multi-batch uncertainty", () => {
			const context = createMockContext();

			const marker = emitWeaveUncertaintyMarker(context, 0, { log: false });

			expect(marker.uncertainties.some(u => u.includes("Multi-batch"))).toBe(true);
		});

		it("should emit marker with standard risk when no specific uncertainties", () => {
			const context = createMockContext({
				batches: [{ batchNumber: 0, items: ["PR-1"], state: "pending" }],
			});

			const marker = emitWeaveUncertaintyMarker(context, 0, { log: false });

			expect(marker.uncertainties.some(u => u.includes("Standard merge operation risk"))).toBe(true);
		});
	});

	describe("emitGateReceipt", () => {
		it("should emit success receipt for passing gate", () => {
			const receipt = emitGateReceipt("lint", "PR-123", true, 1500, "run-123", { log: false });

			expect(receipt.outcome).toBe("success");
			expect(receipt.action).toContain("lint");
			expect(receipt.action).toContain("PR-123");
			expect(receipt.reversibility).toBe("reversible");
			expect(receipt.phase).toBe("verify");
			expect(receipt.escalationRequired).toBe(false);
		});

		it("should include duration in success rationale", () => {
			const receipt = emitGateReceipt("lint", "PR-123", true, 1500, "run-123", { log: false });

			expect(receipt.rationale).toContain("1500ms");
		});

		it("should emit failure receipt for failing gate", () => {
			const receipt = emitGateReceipt("test", "PR-456", false, 5000, "run-456", { log: false });

			expect(receipt.outcome).toBe("failure");
			expect(receipt.escalationRequired).toBe(true);
			expect(receipt.escalationReason).toContain("test");
			expect(receipt.nextActions).toBeDefined();
			expect(receipt.nextActions?.some(a => a.includes("Re-run gate"))).toBe(true);
		});

		it("should work without runId", () => {
			const receipt = emitGateReceipt("build", "PR-789", true, 3000, undefined, { log: false });

			expect(receipt.runId).toBeUndefined();
			expect(receipt.action).toContain("build");
		});

		it("should include error context in failure receipt", () => {
			const receipt = emitGateReceipt(
				"test",
				"PR-456",
				false,
				5000,
				"run-456",
				{ log: false },
				{ error: "ENOENT: no such file or directory", exitCode: 1 }
			);

			expect(receipt.outcome).toBe("failure");
			expect(receipt.uncertaintyNotes).toBeDefined();
			expect(receipt.uncertaintyNotes?.some(n => n.includes("ENOENT"))).toBe(true);
			expect(receipt.uncertaintyNotes?.some(n => n.includes("Exit code: 1"))).toBe(true);
		});

		it("should truncate long error messages in context", () => {
			const longError = "x".repeat(300);
			const receipt = emitGateReceipt(
				"test",
				"PR-456",
				false,
				5000,
				"run-456",
				{ log: false },
				{ error: longError }
			);

			expect(receipt.uncertaintyNotes).toBeDefined();
			const errorNote = receipt.uncertaintyNotes?.find(n => n.includes("Error:"));
			expect(errorNote).toBeDefined();
			expect(errorNote!.length).toBeLessThan(250); // Should be truncated
			expect(errorNote).toContain("...");
		});
	});
});
