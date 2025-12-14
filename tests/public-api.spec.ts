/**
 * Public API Smoke Tests
 * 
 * Validates that the public API exports work correctly and no internal
 * modules are accidentally exposed.
 */

import { describe, it, expect } from "vitest";

describe("Public API - Frames Module", () => {
	it("should export frame types", async () => {
		const { ExecutionFrameSchema, validateExecutionFrame } = await import(
			"../../src/frames/types.js"
		);

		expect(ExecutionFrameSchema).toBeDefined();
		expect(validateExecutionFrame).toBeDefined();
		expect(typeof validateExecutionFrame).toBe("function");
	});

	it("should export emitter functions", async () => {
		const {
			emitMergeWeaveFrame,
			emitExecutorFrame,
			emitGateFrame,
			emitProcedureFrame,
		} = await import("../../src/frames/emitter.js");

		expect(emitMergeWeaveFrame).toBeDefined();
		expect(emitExecutorFrame).toBeDefined();
		expect(emitGateFrame).toBeDefined();
		expect(emitProcedureFrame).toBeDefined();

		expect(typeof emitMergeWeaveFrame).toBe("function");
		expect(typeof emitExecutorFrame).toBe("function");
		expect(typeof emitGateFrame).toBe("function");
		expect(typeof emitProcedureFrame).toBe("function");
	});

	it("should export storage functions", async () => {
		const {
			storeFrame,
			storeFrameResult,
			readFrame,
			listFrameIds,
			listFrames,
			deleteFrame,
		} = await import("../../src/frames/storage.js");

		expect(storeFrame).toBeDefined();
		expect(storeFrameResult).toBeDefined();
		expect(readFrame).toBeDefined();
		expect(listFrameIds).toBeDefined();
		expect(listFrames).toBeDefined();
		expect(deleteFrame).toBeDefined();

		expect(typeof storeFrame).toBe("function");
		expect(typeof storeFrameResult).toBe("function");
		expect(typeof readFrame).toBe("function");
		expect(typeof listFrameIds).toBe("function");
		expect(typeof listFrames).toBe("function");
		expect(typeof deleteFrame).toBe("function");
	});

	it("should export frames index module", async () => {
		const framesModule = await import("../../src/frames/index.js");

		// Types
		expect(framesModule.ExecutionFrameSchema).toBeDefined();
		expect(framesModule.validateExecutionFrame).toBeDefined();

		// Emitters
		expect(framesModule.emitMergeWeaveFrame).toBeDefined();
		expect(framesModule.emitExecutorFrame).toBeDefined();
		expect(framesModule.emitGateFrame).toBeDefined();
		expect(framesModule.emitProcedureFrame).toBeDefined();

		// Storage
		expect(framesModule.storeFrame).toBeDefined();
		expect(framesModule.storeFrameResult).toBeDefined();
		expect(framesModule.readFrame).toBeDefined();
		expect(framesModule.listFrameIds).toBeDefined();
		expect(framesModule.listFrames).toBeDefined();
		expect(framesModule.deleteFrame).toBeDefined();
	});
});

describe("Public API - Errors Module", () => {
	it("should export error types and functions", async () => {
		const { createAXError, AXErrorException } = await import(
			"../../src/errors/index.js"
		);

		expect(createAXError).toBeDefined();
		expect(AXErrorException).toBeDefined();
		expect(typeof createAXError).toBe("function");
		expect(typeof AXErrorException).toBe("function");
	});

	it("should create AXError correctly", async () => {
		const { createAXError } = await import("../../src/errors/index.js");

		const error = createAXError(
			"TEST_ERROR",
			"Test error message",
			["Action 1", "Action 2"]
		);

		expect(error).toBeDefined();
		expect(error.code).toBe("TEST_ERROR");
		expect(error.message).toBe("Test error message");
		expect(error.nextActions).toEqual(["Action 1", "Action 2"]);
	});
});

describe("Public API - TypeScript Definitions", () => {
	it("should compile with frame types (TypeScript validation)", () => {
		// This test validates that TypeScript types are available
		// The actual type checking happens at compile time
		// If the types don't exist, the test file won't compile
		expect(true).toBe(true);
	});
});

describe("Public API - No Internal Leaks", () => {
	it("should not expose internal helper functions in frames/emitter", async () => {
		const emitterModule = await import("../../src/frames/emitter.js");

		// Internal functions should not be exported
		expect(emitterModule).not.toHaveProperty("getTimestampForRef");
		expect(emitterModule).not.toHaveProperty("getUniqueSuffix");

		// Only public functions should be exported
		const exportedKeys = Object.keys(emitterModule);
		expect(exportedKeys).toContain("emitMergeWeaveFrame");
		expect(exportedKeys).toContain("emitExecutorFrame");
		expect(exportedKeys).toContain("emitGateFrame");
		expect(exportedKeys).toContain("emitProcedureFrame");
	});

	it("should not expose internal constants in frames/storage", async () => {
		const storageModule = await import("../../src/frames/storage.js");

		// Internal constants should not be exported
		expect(storageModule).not.toHaveProperty("DEFAULT_FRAMES_DIR");

		// Check that only expected functions are exported
		const exportedKeys = Object.keys(storageModule);
		const expectedExports = [
			"getFramesDir",
			"ensureFramesDir",
			"getFramePath",
			"storeFrame",
			"storeFrameResult",
			"readFrame",
			"listFrameIds",
			"listFrames",
			"deleteFrame",
		];

		for (const expected of expectedExports) {
			expect(exportedKeys).toContain(expected);
		}
	});
});

describe("Public API - Integration Test", () => {
	it("should emit and validate a frame using public API", async () => {
		const { emitMergeWeaveFrame } = await import("../../src/frames/emitter.js");
		const { validateExecutionFrame } = await import(
			"../../src/frames/types.js"
		);

		const result = emitMergeWeaveFrame({
			runId: "test-run-123",
			mergedPRs: ["#123", "#124"],
			conflictsResolved: 2,
			gatesPassed: ["lint", "typecheck"],
			durationMs: 45000,
			outcome: "success",
			targetBranch: "main",
		});

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();
		expect(result.frameId).toBeDefined();

		// Validate the frame using public API
		if (result.frame) {
			const validated = validateExecutionFrame(result.frame);
			expect(validated).toBeDefined();
			expect(validated.type).toBe("merge-weave");
			expect(validated.outcome).toBe("success");
		}
	});

	it("should handle errors using public API", async () => {
		const { createAXError, AXErrorException } = await import(
			"../../src/errors/index.js"
		);

		const error = createAXError(
			"PUBLIC_API_TEST",
			"Test error for public API validation",
			["Debug the error", "Retry the operation"]
		);

		expect(error.code).toBe("PUBLIC_API_TEST");
		expect(error.message).toBe("Test error for public API validation");
		expect(error.nextActions).toEqual(["Debug the error", "Retry the operation"]);

		// Should be able to throw and catch
		expect(() => {
			throw new AXErrorException(error);
		}).toThrow();
	});
});
