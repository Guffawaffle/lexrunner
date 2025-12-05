/**
 * Tests for Frame emitter functions
 */

import { describe, it, expect } from "vitest";
import {
	emitMergeWeaveFrame,
	emitExecutorFrame,
	emitGateFrame,
	emitProcedureFrame,
} from "../../src/frames/emitter.js";
import type { MergeWeaveFrameInput, ExecutorFrameInput, GateFrameInput } from "../../src/frames/types.js";

describe("emitMergeWeaveFrame", () => {
	it("should emit successful merge-weave frame", () => {
		const input: MergeWeaveFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			mergedPRs: ["PR-101", "PR-102", "PR-103"],
			conflictsResolved: 1,
			gatesPassed: ["lint", "typecheck", "test"],
			durationMs: 45000,
			outcome: "success",
			targetBranch: "main",
			planHash: "abc123",
		};

		const result = emitMergeWeaveFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();
		expect(result.frameId).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("merge-weave");
		expect(frame.outcome).toBe("success");
		expect(frame.summary_caption).toContain("Merged 3 PRs");
		expect(frame.summary_caption).toContain("PR-101, PR-102, PR-103");
		expect(frame.module_scope).toEqual(["PR-101", "PR-102", "PR-103"]);
		expect(frame.keywords).toContain("merge-weave");
		expect(frame.keywords).toContain("integration");
		expect(frame.keywords).toContain("main");
		expect(frame.next_actions).toContain("Run e2e tests");
		expect(frame.next_actions).toContain("Deploy to staging");
		expect(frame.metadata?.duration_ms).toBe(45000);
		expect(frame.metadata?.conflicts_resolved).toBe(1);
		expect(frame.metadata?.gates_passed).toEqual(["lint", "typecheck", "test"]);
		expect(frame.metadata?.run_id).toBe("01JFZG7X2T3K4M5N6P7Q8R9S0W");
		expect(frame.metadata?.plan_hash).toBe("abc123");
	});

	it("should emit failed merge-weave frame", () => {
		const input: MergeWeaveFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
			mergedPRs: ["PR-101", "PR-102"],
			conflictsResolved: 0,
			gatesPassed: [],
			gatesFailed: ["lint"],
			durationMs: 10000,
			outcome: "failure",
			targetBranch: "main",
			error: "Merge conflict in src/cli.ts",
		};

		const result = emitMergeWeaveFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("merge-weave");
		expect(frame.outcome).toBe("failure");
		expect(frame.summary_caption).toContain("Failed to merge PRs");
		expect(frame.next_actions).toContain("Review merge failure logs");
		expect(frame.next_actions).toContain("Resolve conflicts manually");
		expect(frame.metadata?.error).toBe("Merge conflict in src/cli.ts");
		expect(frame.metadata?.gates_failed).toEqual(["lint"]);
	});

	it("should emit partial merge-weave frame", () => {
		const input: MergeWeaveFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0Y",
			mergedPRs: ["PR-101", "PR-102", "PR-103"],
			conflictsResolved: 1,
			gatesPassed: ["lint"],
			gatesFailed: ["test"],
			durationMs: 30000,
			outcome: "partial",
			targetBranch: "develop",
		};

		const result = emitMergeWeaveFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("merge-weave");
		expect(frame.outcome).toBe("partial");
		expect(frame.summary_caption).toContain("Partially merged PRs");
		expect(frame.next_actions).toContain("Review partial merge results");
		expect(frame.next_actions).toContain("Resolve remaining conflicts");
	});

	it("should generate unique reference points", () => {
		const input: MergeWeaveFrameInput = {
			runId: "test",
			mergedPRs: ["PR-1"],
			conflictsResolved: 0,
			gatesPassed: [],
			durationMs: 1000,
			outcome: "success",
			targetBranch: "main",
		};

		const result1 = emitMergeWeaveFrame(input);
		const result2 = emitMergeWeaveFrame(input);

		expect(result1.frameId).not.toBe(result2.frameId);
	});

	it("should include Turn Cost data when provided", () => {
		const input: MergeWeaveFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			mergedPRs: ["PR-101", "PR-102"],
			conflictsResolved: 2,
			gatesPassed: ["lint", "test"],
			durationMs: 30000,
			outcome: "success",
			targetBranch: "main",
			turnCost: {
				components: {
					latencyMs: 15000,
					contextResetTokens: 0,
					renegotiationCount: 2,
					tokenBloat: 500,
					attentionSwitchCount: 1,
				},
				weightedScore: 3.25,
				eventCount: 6,
				priorRunScore: 5.8,
				improvement: "-44%",
			},
		};

		const result = emitMergeWeaveFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.metadata?.turn_cost).toBeDefined();
		expect(frame.metadata?.turn_cost?.components.latencyMs).toBe(15000);
		expect(frame.metadata?.turn_cost?.components.renegotiationCount).toBe(2);
		expect(frame.metadata?.turn_cost?.weightedScore).toBe(3.25);
		expect(frame.metadata?.turn_cost?.improvement).toBe("-44%");
	});
});

describe("emitExecutorFrame", () => {
	it("should emit successful executor frame", () => {
		const input: ExecutorFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			procedure: "senior-dev",
			moduleScope: ["src/cli.ts", "src/schema.ts"],
			durationMs: 120000,
			outcome: "success",
			nextAction: "Review findings and address issues",
			artifacts: ["/tmp/review-report.md"],
		};

		const result = emitExecutorFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();
		expect(result.frameId).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("execution");
		expect(frame.outcome).toBe("success");
		expect(frame.summary_caption).toContain("Executed procedure 'senior-dev'");
		expect(frame.summary_caption).toContain("src/cli.ts, src/schema.ts");
		expect(frame.module_scope).toEqual(["src/cli.ts", "src/schema.ts"]);
		expect(frame.keywords).toContain("executor");
		expect(frame.keywords).toContain("senior-dev");
		expect(frame.next_actions).toContain("Review findings and address issues");
		expect(frame.metadata?.duration_ms).toBe(120000);
		expect(frame.metadata?.artifacts).toEqual(["/tmp/review-report.md"]);
		expect(frame.metadata?.run_id).toBe("01JFZG7X2T3K4M5N6P7Q8R9S0W");
	});

	it("should emit failed executor frame", () => {
		const input: ExecutorFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
			procedure: "pr-review",
			moduleScope: ["PR-101"],
			durationMs: 5000,
			outcome: "failure",
			nextAction: "Check PR context availability",
			error: "Failed to fetch PR metadata",
		};

		const result = emitExecutorFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("execution");
		expect(frame.outcome).toBe("failure");
		expect(frame.summary_caption).toContain("Failed to execute procedure");
		expect(frame.metadata?.error).toBe("Failed to fetch PR metadata");
	});
});

describe("emitGateFrame", () => {
	it("should emit successful gate frame", () => {
		const input: GateFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			gateName: "lint",
			itemName: "PR-101",
			durationMs: 5000,
			outcome: "success",
			exitCode: 0,
			artifacts: ["/tmp/lint-report.json"],
		};

		const result = emitGateFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();
		expect(result.frameId).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("gate");
		expect(frame.outcome).toBe("success");
		expect(frame.summary_caption).toBe("Gate 'lint' passed for PR-101");
		expect(frame.module_scope).toEqual(["PR-101"]);
		expect(frame.keywords).toContain("gate");
		expect(frame.keywords).toContain("lint");
		expect(frame.keywords).toContain("PR-101");
		expect(frame.next_actions).toContain("Continue to next gate");
		expect(frame.metadata?.duration_ms).toBe(5000);
		expect(frame.metadata?.exit_code).toBe(0);
		expect(frame.metadata?.artifacts).toEqual(["/tmp/lint-report.json"]);
	});

	it("should emit failed gate frame", () => {
		const input: GateFrameInput = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
			gateName: "test",
			itemName: "PR-102",
			durationMs: 30000,
			outcome: "failure",
			exitCode: 1,
			error: "3 test cases failed",
		};

		const result = emitGateFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("gate");
		expect(frame.outcome).toBe("failure");
		expect(frame.summary_caption).toBe("Gate 'test' failed for PR-102");
		expect(frame.next_actions).toContain("Review test failure");
		expect(frame.next_actions).toContain("Fix issues and re-run gate");
		expect(frame.metadata?.exit_code).toBe(1);
		expect(frame.metadata?.error).toBe("3 test cases failed");
	});
});

describe("emitProcedureFrame", () => {
	it("should emit successful procedure frame", () => {
		const input = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
			procedure: "merge-weave-main",
			moduleScope: ["PR-101", "PR-102"],
			durationMs: 60000,
			outcome: "success" as const,
			nextActions: ["Deploy to staging", "Run integration tests"],
			artifacts: ["/tmp/merge-report.json"],
			planHash: "def456",
		};

		const result = emitProcedureFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();
		expect(result.frameId).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("procedure");
		expect(frame.outcome).toBe("success");
		expect(frame.summary_caption).toContain("Completed procedure 'merge-weave-main'");
		expect(frame.module_scope).toEqual(["PR-101", "PR-102"]);
		expect(frame.keywords).toContain("procedure");
		expect(frame.keywords).toContain("merge-weave-main");
		expect(frame.next_actions).toContain("Deploy to staging");
		expect(frame.next_actions).toContain("Run integration tests");
		expect(frame.metadata?.duration_ms).toBe(60000);
		expect(frame.metadata?.plan_hash).toBe("def456");
	});

	it("should emit failed procedure frame", () => {
		const input = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
			procedure: "pr-review",
			moduleScope: ["PR-103"],
			durationMs: 10000,
			outcome: "failure" as const,
			nextActions: ["Check PR status", "Retry review"],
			error: "PR not found",
		};

		const result = emitProcedureFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("procedure");
		expect(frame.outcome).toBe("failure");
		expect(frame.summary_caption).toContain("Failed procedure 'pr-review'");
		expect(frame.metadata?.error).toBe("PR not found");
	});

	it("should emit partial procedure frame", () => {
		const input = {
			runId: "01JFZG7X2T3K4M5N6P7Q8R9S0Y",
			procedure: "batch-merge",
			moduleScope: ["PR-101", "PR-102", "PR-103"],
			durationMs: 45000,
			outcome: "partial" as const,
			nextActions: ["Review partial results", "Continue with remaining items"],
		};

		const result = emitProcedureFrame(input);

		expect(result.success).toBe(true);
		expect(result.frame).toBeDefined();

		const frame = result.frame!;
		expect(frame.type).toBe("procedure");
		expect(frame.outcome).toBe("partial");
		expect(frame.summary_caption).toContain("Partially completed procedure");
	});
});
