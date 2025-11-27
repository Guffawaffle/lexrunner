/**
 * Tests for the pr-review Procedure
 *
 * Tests state machine traversal and integration with ProcedureLoader.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	createProcedureLoader,
	ProcedureStateMachine
} from "../../src/procedures/index.js";
import type { Procedure, RunContext } from "../../src/procedures/index.js";

describe("PR Review Procedure", () => {
	let procedure: Procedure;

	beforeEach(async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });
		procedure = await loader.loadProcedure("pr-review");
	});

	describe("Procedure Metadata", () => {
		it("has correct id", () => {
			expect(procedure.id).toBe("pr-review");
		});

		it("has correct name", () => {
			expect(procedure.name).toBe("PR Review");
		});

		it("has a description", () => {
			expect(procedure.description).toContain("senior-dev executor");
		});
	});

	describe("Initial State", () => {
		it("starts in preparing state", () => {
			expect(procedure.getInitialState()).toBe("preparing");
		});
	});

	describe("State Machine Traversal - Happy Path", () => {
		it("transitions from preparing to analyzing on CONTEXT_READY", () => {
			expect(procedure.canTransition("preparing", "CONTEXT_READY")).toBe(true);
			expect(procedure.applyTransition("preparing", "CONTEXT_READY")).toBe("analyzing");
		});

		it("transitions from analyzing to reviewing on ANALYSIS_COMPLETE", () => {
			expect(procedure.canTransition("analyzing", "ANALYSIS_COMPLETE")).toBe(true);
			expect(procedure.applyTransition("analyzing", "ANALYSIS_COMPLETE")).toBe("reviewing");
		});

		it("transitions from reviewing to decision_findings on REVIEW_COMPLETE", () => {
			expect(procedure.canTransition("reviewing", "REVIEW_COMPLETE")).toBe(true);
			expect(procedure.applyTransition("reviewing", "REVIEW_COMPLETE")).toBe("decision_findings");
		});

		it("transitions from decision_findings to completed on APPROVE", () => {
			expect(procedure.canTransition("decision_findings", "APPROVE")).toBe(true);
			expect(procedure.applyTransition("decision_findings", "APPROVE")).toBe("completed");
		});

		it("transitions from decision_findings to completed on REQUEST_CHANGES", () => {
			expect(procedure.canTransition("decision_findings", "REQUEST_CHANGES")).toBe(true);
			expect(procedure.applyTransition("decision_findings", "REQUEST_CHANGES")).toBe("completed");
		});

		it("completes full happy path: preparing → analyzing → reviewing → decision_findings → completed", () => {
			let state = procedure.getInitialState();
			expect(state).toBe("preparing");

			state = procedure.applyTransition(state, "CONTEXT_READY");
			expect(state).toBe("analyzing");

			state = procedure.applyTransition(state, "ANALYSIS_COMPLETE");
			expect(state).toBe("reviewing");

			state = procedure.applyTransition(state, "REVIEW_COMPLETE");
			expect(state).toBe("decision_findings");

			state = procedure.applyTransition(state, "APPROVE");
			expect(state).toBe("completed");

			expect(procedure.isTerminal(state)).toBe(true);
		});
	});

	describe("State Machine Traversal - Failure Paths", () => {
		it("transitions from preparing to failed on CONTEXT_FAILED", () => {
			expect(procedure.canTransition("preparing", "CONTEXT_FAILED")).toBe(true);
			expect(procedure.applyTransition("preparing", "CONTEXT_FAILED")).toBe("failed");
		});

		it("transitions from analyzing to decision_findings on ANALYSIS_FAILED", () => {
			// Analysis failure can proceed with warnings
			expect(procedure.canTransition("analyzing", "ANALYSIS_FAILED")).toBe(true);
			expect(procedure.applyTransition("analyzing", "ANALYSIS_FAILED")).toBe("decision_findings");
		});

		it("transitions from reviewing to failed on REVIEW_FAILED", () => {
			expect(procedure.canTransition("reviewing", "REVIEW_FAILED")).toBe(true);
			expect(procedure.applyTransition("reviewing", "REVIEW_FAILED")).toBe("failed");
		});

		it("transitions from decision_findings to failed on ABORT", () => {
			expect(procedure.canTransition("decision_findings", "ABORT")).toBe(true);
			expect(procedure.applyTransition("decision_findings", "ABORT")).toBe("failed");
		});
	});

	describe("State Machine Traversal - Loopback", () => {
		it("transitions from decision_findings back to preparing on NEEDS_MORE_CONTEXT", () => {
			expect(procedure.canTransition("decision_findings", "NEEDS_MORE_CONTEXT")).toBe(true);
			expect(procedure.applyTransition("decision_findings", "NEEDS_MORE_CONTEXT")).toBe("preparing");
		});

		it("completes full loopback path: preparing → ... → decision_findings → preparing", () => {
			let state = procedure.getInitialState();

			// Go through to decision_findings
			state = procedure.applyTransition(state, "CONTEXT_READY");
			state = procedure.applyTransition(state, "ANALYSIS_COMPLETE");
			state = procedure.applyTransition(state, "REVIEW_COMPLETE");
			expect(state).toBe("decision_findings");

			// Loop back to preparing
			state = procedure.applyTransition(state, "NEEDS_MORE_CONTEXT");
			expect(state).toBe("preparing");

			// Can continue again
			state = procedure.applyTransition(state, "CONTEXT_READY");
			expect(state).toBe("analyzing");
		});
	});

	describe("Terminal States", () => {
		it("completed is a terminal state", () => {
			expect(procedure.isTerminal("completed")).toBe(true);
		});

		it("failed is a terminal state", () => {
			expect(procedure.isTerminal("failed")).toBe(true);
		});

		it("preparing is not a terminal state", () => {
			expect(procedure.isTerminal("preparing")).toBe(false);
		});

		it("analyzing is not a terminal state", () => {
			expect(procedure.isTerminal("analyzing")).toBe(false);
		});

		it("reviewing is not a terminal state", () => {
			expect(procedure.isTerminal("reviewing")).toBe(false);
		});

		it("decision_findings is not a terminal state", () => {
			expect(procedure.isTerminal("decision_findings")).toBe(false);
		});
	});

	describe("Decision Points", () => {
		it("has a decision point for decision_findings state", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			expect(dp).not.toBeNull();
		});

		it("decision point requires LLM decision", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			expect(dp?.requiresLLMDecision).toBe(true);
		});

		it("decision point has correct prompt", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			expect(dp?.prompt).toContain("Approve");
			expect(dp?.prompt).toContain("request changes");
		});

		it("decision point has four options", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			expect(dp?.options.length).toBe(4);
		});

		it("decision point options include approve", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			const approveOption = dp?.options.find(o => o.action === "approve");
			expect(approveOption).toBeDefined();
			expect(approveOption?.description).toBe("Approve PR");
		});

		it("decision point options include request_changes", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			const requestChangesOption = dp?.options.find(o => o.action === "request_changes");
			expect(requestChangesOption).toBeDefined();
			expect(requestChangesOption?.description).toBe("Request changes with comments");
		});

		it("decision point options include needs_more_context", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			const moreContextOption = dp?.options.find(o => o.action === "needs_more_context");
			expect(moreContextOption).toBeDefined();
			expect(moreContextOption?.description).toBe("Read more files/context");
		});

		it("decision point options include abort", () => {
			const dp = procedure.getDecisionPoint("decision_findings");
			const abortOption = dp?.options.find(o => o.action === "abort");
			expect(abortOption).toBeDefined();
			expect(abortOption?.description).toBe("Cancel review");
		});

		it("non-decision states have no decision point", () => {
			expect(procedure.getDecisionPoint("preparing")).toBeNull();
			expect(procedure.getDecisionPoint("analyzing")).toBeNull();
			expect(procedure.getDecisionPoint("reviewing")).toBeNull();
			expect(procedure.getDecisionPoint("completed")).toBeNull();
			expect(procedure.getDecisionPoint("failed")).toBeNull();
		});
	});

	describe("Completion Gates", () => {
		it("has completion gates", () => {
			const gates = procedure.getCompletionGates();
			expect(gates.length).toBeGreaterThan(0);
		});

		it("includes lint gate", () => {
			const gates = procedure.getCompletionGates();
			expect(gates).toContain("lint");
		});

		it("includes typecheck gate", () => {
			const gates = procedure.getCompletionGates();
			expect(gates).toContain("typecheck");
		});

		it("includes test gate", () => {
			const gates = procedure.getCompletionGates();
			expect(gates).toContain("test");
		});
	});

	describe("Next Options", () => {
		it("returns available transitions for preparing state", () => {
			const context: RunContext = { runId: "test-run", state: "preparing" };
			const options = procedure.getNextOptions("preparing", context);

			expect(options.length).toBe(2);
			expect(options.map(o => o.action).sort()).toEqual(["CONTEXT_FAILED", "CONTEXT_READY"]);
			expect(options.every(o => o.requiresLLMDecision === false)).toBe(true);
		});

		it("returns available transitions for analyzing state", () => {
			const context: RunContext = { runId: "test-run", state: "analyzing" };
			const options = procedure.getNextOptions("analyzing", context);

			expect(options.length).toBe(2);
			expect(options.map(o => o.action).sort()).toEqual(["ANALYSIS_COMPLETE", "ANALYSIS_FAILED"]);
		});

		it("returns LLM decision options for decision_findings state", () => {
			const context: RunContext = { runId: "test-run", state: "decision_findings" };
			const options = procedure.getNextOptions("decision_findings", context);

			expect(options.length).toBe(4);
			expect(options.map(o => o.action).sort()).toEqual(["abort", "approve", "needs_more_context", "request_changes"]);
			expect(options.every(o => o.requiresLLMDecision === true)).toBe(true);
		});

		it("returns empty options for terminal states", () => {
			const completedContext: RunContext = { runId: "test-run", state: "completed" };
			expect(procedure.getNextOptions("completed", completedContext).length).toBe(0);

			const failedContext: RunContext = { runId: "test-run", state: "failed" };
			expect(procedure.getNextOptions("failed", failedContext).length).toBe(0);
		});
	});

	describe("Invalid Transitions", () => {
		it("rejects invalid event from preparing", () => {
			expect(procedure.canTransition("preparing", "INVALID_EVENT")).toBe(false);
			expect(() => procedure.applyTransition("preparing", "INVALID_EVENT")).toThrow();
		});

		it("rejects transition from terminal states", () => {
			expect(procedure.canTransition("completed", "CONTEXT_READY")).toBe(false);
			expect(procedure.canTransition("failed", "CONTEXT_READY")).toBe(false);
		});
	});
});

describe("PR Review Procedure - Integration with Loader", () => {
	it("is listed in available procedures", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });
		const summaries = await loader.listProcedures();

		expect(summaries.some(s => s.id === "pr-review")).toBe(true);
	});

	it("can be loaded by ID", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });
		const procedure = await loader.loadProcedure("pr-review");

		expect(procedure).toBeDefined();
		expect(procedure.id).toBe("pr-review");
	});

	it("validates correctly via loader", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });

		// Load and re-validate
		const procedure = await loader.loadProcedure("pr-review");

		// If it loaded successfully, validation passed
		expect(procedure.id).toBe("pr-review");
	});
});
