/**
 * Tests for Frame storage functions
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync, readFileSync } from "fs";
import {
	storeFrame,
	storeFrameResult,
	readFrame,
	listFrameIds,
	listFrames,
	deleteFrame,
	getFramesDir,
	ensureFramesDir,
} from "../../src/frames/storage.js";
import type { ExecutionFrame, FrameEmitResult } from "../../src/frames/types.js";

describe("Frame Storage", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "frame-storage-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("getFramesDir", () => {
		it("should return correct frames directory path", () => {
			const framesDir = getFramesDir(testDir);
			expect(framesDir).toBe(join(testDir, ".lexrunner/frames"));
		});
	});

	describe("ensureFramesDir", () => {
		it("should create frames directory if it doesn't exist", () => {
			const framesDir = ensureFramesDir(testDir);
			expect(existsSync(framesDir)).toBe(true);
		});

		it("should be idempotent", () => {
			ensureFramesDir(testDir);
			const framesDir = ensureFramesDir(testDir);
			expect(existsSync(framesDir)).toBe(true);
		});
	});

	describe("storeFrame", () => {
		it("should store a Frame to disk", () => {
			const frame: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "merge-weave-2025-12-03-abc123",
				summary_caption: "Merged 3 PRs into main",
				module_scope: ["PR-101", "PR-102", "PR-103"],
				keywords: ["merge-weave", "integration", "main"],
				outcome: "success",
				next_actions: ["Deploy to staging", "Run e2e tests"],
				metadata: {
					duration_ms: 45000,
					run_id: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
				},
			};

			const framePath = storeFrame(frame, "test-frame-id", testDir);

			expect(existsSync(framePath)).toBe(true);

			const content = JSON.parse(readFileSync(framePath, "utf-8"));
			expect(content.type).toBe("merge-weave");
			expect(content.reference_point).toBe("merge-weave-2025-12-03-abc123");
			expect(content.outcome).toBe("success");
			expect(content.stored_at).toBeDefined();
		});

		it("should overwrite existing Frame with same ID", () => {
			const frame1: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "merge-weave-v1",
				summary_caption: "First version",
				module_scope: ["PR-1"],
				keywords: ["test"],
				outcome: "success",
				next_actions: [],
			};

			const frame2: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "merge-weave-v2",
				summary_caption: "Second version",
				module_scope: ["PR-1", "PR-2"],
				keywords: ["test"],
				outcome: "partial",
				next_actions: ["Review"],
			};

			storeFrame(frame1, "same-id", testDir);
			storeFrame(frame2, "same-id", testDir);

			const stored = readFrame("same-id", testDir);
			expect(stored?.summary_caption).toBe("Second version");
			expect(stored?.outcome).toBe("partial");
		});
	});

	describe("storeFrameResult", () => {
		it("should store Frame from successful FrameEmitResult", () => {
			const frame: ExecutionFrame = {
				type: "execution",
				reference_point: "executor-test-2025-12-03-def456",
				summary_caption: "Executed procedure 'test'",
				module_scope: ["src/test.ts"],
				keywords: ["executor", "test"],
				outcome: "success",
				next_actions: ["Continue"],
			};

			const result: FrameEmitResult = {
				success: true,
				frame,
				frameId: "executor-test-2025-12-03-def456",
			};

			const framePath = storeFrameResult(result, testDir);

			expect(framePath).not.toBeNull();
			expect(existsSync(framePath!)).toBe(true);
		});

		it("should return null for unsuccessful FrameEmitResult", () => {
			const result: FrameEmitResult = {
				success: false,
				error: "Validation failed",
			};

			const framePath = storeFrameResult(result, testDir);

			expect(framePath).toBeNull();
		});

		it("should return null for result without frame", () => {
			const result: FrameEmitResult = {
				success: true,
				// No frame or frameId
			};

			const framePath = storeFrameResult(result, testDir);

			expect(framePath).toBeNull();
		});
	});

	describe("readFrame", () => {
		it("should read a stored Frame", () => {
			const frame: ExecutionFrame = {
				type: "gate",
				reference_point: "gate-lint-2025-12-03-ghi789",
				summary_caption: "Gate 'lint' passed",
				module_scope: ["PR-101"],
				keywords: ["gate", "lint"],
				outcome: "success",
				next_actions: ["Continue to next gate"],
			};

			storeFrame(frame, "test-gate-frame", testDir);
			const stored = readFrame("test-gate-frame", testDir);

			expect(stored).not.toBeNull();
			expect(stored?.type).toBe("gate");
			expect(stored?.reference_point).toBe("gate-lint-2025-12-03-ghi789");
			expect(stored?.stored_at).toBeDefined();
		});

		it("should return null for non-existent Frame", () => {
			const stored = readFrame("non-existent", testDir);
			expect(stored).toBeNull();
		});
	});

	describe("listFrameIds", () => {
		it("should list all stored Frame IDs", () => {
			const frame1: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "frame-1",
				summary_caption: "Frame 1",
				module_scope: [],
				keywords: [],
				outcome: "success",
				next_actions: [],
			};

			const frame2: ExecutionFrame = {
				type: "execution",
				reference_point: "frame-2",
				summary_caption: "Frame 2",
				module_scope: [],
				keywords: [],
				outcome: "success",
				next_actions: [],
			};

			storeFrame(frame1, "alpha-frame", testDir);
			storeFrame(frame2, "beta-frame", testDir);

			const ids = listFrameIds(testDir);

			expect(ids).toHaveLength(2);
			expect(ids).toContain("alpha-frame");
			expect(ids).toContain("beta-frame");
		});

		it("should return empty array when no Frames exist", () => {
			const ids = listFrameIds(testDir);
			expect(ids).toEqual([]);
		});

		it("should return sorted list of IDs", () => {
			const frame: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "test",
				summary_caption: "Test",
				module_scope: [],
				keywords: [],
				outcome: "success",
				next_actions: [],
			};

			storeFrame(frame, "charlie", testDir);
			storeFrame(frame, "alpha", testDir);
			storeFrame(frame, "bravo", testDir);

			const ids = listFrameIds(testDir);

			expect(ids).toEqual(["alpha", "bravo", "charlie"]);
		});
	});

	describe("listFrames", () => {
		it("should list all stored Frames", () => {
			const frame1: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "frame-1",
				summary_caption: "Frame 1",
				module_scope: ["PR-1"],
				keywords: ["test"],
				outcome: "success",
				next_actions: [],
			};

			const frame2: ExecutionFrame = {
				type: "execution",
				reference_point: "frame-2",
				summary_caption: "Frame 2",
				module_scope: ["PR-2"],
				keywords: ["test"],
				outcome: "failure",
				next_actions: ["Fix"],
			};

			storeFrame(frame1, "frame-a", testDir);
			storeFrame(frame2, "frame-b", testDir);

			const frames = listFrames(testDir);

			expect(frames).toHaveLength(2);
			expect(frames.some(f => f.summary_caption === "Frame 1")).toBe(true);
			expect(frames.some(f => f.summary_caption === "Frame 2")).toBe(true);
		});

		it("should return empty array when no Frames exist", () => {
			const frames = listFrames(testDir);
			expect(frames).toEqual([]);
		});
	});

	describe("deleteFrame", () => {
		it("should delete a stored Frame", () => {
			const frame: ExecutionFrame = {
				type: "merge-weave",
				reference_point: "to-delete",
				summary_caption: "Will be deleted",
				module_scope: [],
				keywords: [],
				outcome: "success",
				next_actions: [],
			};

			storeFrame(frame, "delete-me", testDir);
			expect(readFrame("delete-me", testDir)).not.toBeNull();

			const deleted = deleteFrame("delete-me", testDir);

			expect(deleted).toBe(true);
			expect(readFrame("delete-me", testDir)).toBeNull();
		});

		it("should return false for non-existent Frame", () => {
			const deleted = deleteFrame("non-existent", testDir);
			expect(deleted).toBe(false);
		});
	});

	describe("integration: store → read → delete lifecycle", () => {
		it("should handle complete lifecycle", () => {
			const frame: ExecutionFrame = {
				type: "procedure",
				reference_point: "procedure-test-2025-12-03-xyz789",
				summary_caption: "Completed procedure 'merge-weave-main'",
				module_scope: ["PR-101", "PR-102", "PR-103"],
				keywords: ["procedure", "merge-weave-main"],
				outcome: "success",
				next_actions: ["Deploy to staging", "Run integration tests"],
				metadata: {
					duration_ms: 60000,
					plan_hash: "abc123",
				},
			};

			// Store
			const framePath = storeFrame(frame, "lifecycle-test", testDir);
			expect(existsSync(framePath)).toBe(true);

			// List
			const ids = listFrameIds(testDir);
			expect(ids).toContain("lifecycle-test");

			// Read
			const stored = readFrame("lifecycle-test", testDir);
			expect(stored?.type).toBe("procedure");
			expect(stored?.outcome).toBe("success");
			expect(stored?.stored_at).toBeDefined();

			// Delete
			const deleted = deleteFrame("lifecycle-test", testDir);
			expect(deleted).toBe(true);

			// Verify deletion
			expect(readFrame("lifecycle-test", testDir)).toBeNull();
			expect(listFrameIds(testDir)).not.toContain("lifecycle-test");
		});
	});
});
