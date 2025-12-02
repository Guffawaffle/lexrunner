/**
 * Tests for Frame types and schemas
 */

import { describe, it, expect } from "vitest";
import {
	ExecutionFrameSchema,
	ExecutionFrameMetadataSchema,
	validateExecutionFrame,
	safeValidateExecutionFrame,
} from "../../src/frames/types.js";
import type { ExecutionFrame } from "../../src/frames/types.js";

describe("ExecutionFrameMetadataSchema", () => {
	it("should validate complete metadata", () => {
		const metadata = {
			duration_ms: 45000,
			conflicts_resolved: 1,
			gates_passed: ["lint", "typecheck", "test"],
			gates_failed: [],
			artifacts: ["/tmp/build.log"],
			run_id: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			plan_hash: "abc123",
		};

		const result = ExecutionFrameMetadataSchema.safeParse(metadata);
		expect(result.success).toBe(true);
	});

	it("should validate minimal metadata", () => {
		const metadata = {};

		const result = ExecutionFrameMetadataSchema.safeParse(metadata);
		expect(result.success).toBe(true);
	});

	it("should validate metadata with error", () => {
		const metadata = {
			error: "Merge conflict in src/cli.ts",
			exit_code: 1,
		};

		const result = ExecutionFrameMetadataSchema.safeParse(metadata);
		expect(result.success).toBe(true);
	});
});

describe("ExecutionFrameSchema", () => {
	it("should validate merge-weave frame", () => {
		const frame: ExecutionFrame = {
			type: "merge-weave",
			reference_point: "merge-weave-2025-12-01-abc123",
			summary_caption: "Merged 3 PRs (PR-101, PR-102, PR-103) into main",
			module_scope: ["PR-101", "PR-102", "PR-103"],
			keywords: ["merge-weave", "integration"],
			outcome: "success",
			next_actions: ["Run e2e tests", "Deploy to staging"],
			metadata: {
				duration_ms: 45000,
				conflicts_resolved: 1,
				gates_passed: ["lint", "typecheck", "test"],
			},
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(true);
	});

	it("should validate gate frame", () => {
		const frame: ExecutionFrame = {
			type: "gate",
			reference_point: "gate-lint-pr-101-2025-12-01-def456",
			summary_caption: "Gate 'lint' passed for pr-101",
			module_scope: ["pr-101"],
			keywords: ["gate", "lint", "pr-101"],
			outcome: "success",
			next_actions: ["Continue to next gate"],
			metadata: {
				duration_ms: 5000,
				exit_code: 0,
			},
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(true);
	});

	it("should validate execution frame", () => {
		const frame: ExecutionFrame = {
			type: "execution",
			reference_point: "executor-senior-dev-2025-12-01-ghi789",
			summary_caption: "Executed procedure 'senior-dev' on src/cli.ts",
			module_scope: ["src/cli.ts"],
			keywords: ["executor", "senior-dev", "execution"],
			outcome: "success",
			next_actions: ["Review findings", "Continue to next workflow step"],
			metadata: {
				duration_ms: 120000,
				run_id: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			},
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(true);
	});

	it("should validate procedure frame", () => {
		const frame: ExecutionFrame = {
			type: "procedure",
			reference_point: "procedure-pr-review-2025-12-01-jkl012",
			summary_caption: "Completed procedure 'pr-review' for PR-101",
			module_scope: ["PR-101"],
			keywords: ["procedure", "pr-review"],
			outcome: "success",
			next_actions: ["Address review comments", "Merge PR"],
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(true);
	});

	it("should validate frame with failure outcome", () => {
		const frame: ExecutionFrame = {
			type: "merge-weave",
			reference_point: "merge-weave-2025-12-01-fail01",
			summary_caption: "Failed to merge PRs (PR-101, PR-102) into main",
			module_scope: ["PR-101", "PR-102"],
			keywords: ["merge-weave", "integration", "main"],
			outcome: "failure",
			next_actions: ["Review merge failure logs", "Resolve conflicts manually"],
			metadata: {
				error: "Merge conflict in src/cli.ts",
				duration_ms: 10000,
			},
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(true);
	});

	it("should validate frame with partial outcome", () => {
		const frame: ExecutionFrame = {
			type: "merge-weave",
			reference_point: "merge-weave-2025-12-01-part01",
			summary_caption: "Partially merged PRs (PR-101, PR-102, PR-103) into main",
			module_scope: ["PR-101", "PR-102", "PR-103"],
			keywords: ["merge-weave", "integration", "main"],
			outcome: "partial",
			next_actions: ["Review partial merge results", "Resolve remaining conflicts"],
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(true);
	});

	it("should reject frame with invalid type", () => {
		const frame = {
			type: "invalid-type",
			reference_point: "test",
			summary_caption: "test",
			module_scope: [],
			keywords: [],
			outcome: "success",
			next_actions: [],
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(false);
	});

	it("should reject frame with invalid outcome", () => {
		const frame = {
			type: "gate",
			reference_point: "test",
			summary_caption: "test",
			module_scope: [],
			keywords: [],
			outcome: "invalid",
			next_actions: [],
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(false);
	});

	it("should reject frame missing required fields", () => {
		const frame = {
			type: "gate",
			summary_caption: "test",
		};

		const result = ExecutionFrameSchema.safeParse(frame);
		expect(result.success).toBe(false);
	});
});

describe("validateExecutionFrame", () => {
	it("should return validated frame for valid input", () => {
		const frame: ExecutionFrame = {
			type: "gate",
			reference_point: "gate-test-2025-12-01-abc",
			summary_caption: "Test gate",
			module_scope: ["test"],
			keywords: ["test"],
			outcome: "success",
			next_actions: ["next"],
		};

		const result = validateExecutionFrame(frame);
		expect(result.type).toBe("gate");
		expect(result.outcome).toBe("success");
	});

	it("should throw for invalid input", () => {
		const invalid = { type: "invalid" };

		expect(() => validateExecutionFrame(invalid)).toThrow();
	});
});

describe("safeValidateExecutionFrame", () => {
	it("should return success for valid frame", () => {
		const frame: ExecutionFrame = {
			type: "execution",
			reference_point: "test-ref",
			summary_caption: "Test",
			module_scope: [],
			keywords: [],
			outcome: "success",
			next_actions: [],
		};

		const result = safeValidateExecutionFrame(frame);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.type).toBe("execution");
		}
	});

	it("should return error for invalid frame", () => {
		const invalid = { type: "invalid" };

		const result = safeValidateExecutionFrame(invalid);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeDefined();
		}
	});
});
