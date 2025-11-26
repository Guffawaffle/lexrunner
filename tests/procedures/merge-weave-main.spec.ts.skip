/**
 * Tests for merge-weave-main procedure definition
 * LR-067: Validates state machine, transitions, decision points, and nextOptions
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { WeaveState, WeaveEvent } from "../../src/weave/types.js";

// Path to the procedure definition
const PROCEDURE_PATH = path.join(process.cwd(), "procedures", "merge-weave-main.yaml");

interface NextOption {
	action: string;
	description: string;
	riskLevel?: "low" | "medium" | "high";
	requiresLLMDecision?: boolean;
	prompt?: string;
	constraints?: string[];
}

interface Transition {
	to: string;
	description: string;
}

interface StateDefinition {
	description: string;
	terminal: boolean;
}

interface DecisionOption {
	action: string;
	description: string;
	riskLevel?: "low" | "medium" | "high";
	requiresLLMDecision?: boolean;
	prompt?: string;
	constraints?: string[];
}

interface DecisionPoint {
	state: string;
	trigger: string;
	prompt: string;
	options: DecisionOption[];
}

interface ProcedureDefinition {
	version: number;
	id: string;
	name: string;
	description: string;
	states: Record<string, StateDefinition>;
	transitions: Record<string, Record<string, Transition>>;
	decisionPoints: Record<string, DecisionPoint>;
	nextOptions: Record<string, NextOption[]>;
	integration: {
		stateMachine: string;
		types: string;
		mapping: Record<string, string[]>;
	};
}

describe("merge-weave-main Procedure", () => {
	let procedure: ProcedureDefinition;

	beforeEach(() => {
		// Load and parse the procedure file
		const content = fs.readFileSync(PROCEDURE_PATH, "utf-8");
		procedure = yaml.parse(content) as ProcedureDefinition;
	});

	describe("Procedure Metadata", () => {
		it("should have correct version and id", () => {
			expect(procedure.version).toBe(1);
			expect(procedure.id).toBe("merge-weave-main");
			expect(procedure.name).toBe("Merge-Weave Main");
		});

		it("should have a description", () => {
			expect(procedure.description).toBeTruthy();
			expect(typeof procedure.description).toBe("string");
		});
	});

	describe("States", () => {
		const expectedStates = [
			"planning",
			"gated",
			"decision_gate_failure",
			"weaving",
			"completed",
			"failed"
		];

		it("should define all required states", () => {
			const definedStates = Object.keys(procedure.states);
			
			for (const state of expectedStates) {
				expect(definedStates).toContain(state);
			}
		});

		it("should mark completed and failed as terminal states", () => {
			expect(procedure.states.completed.terminal).toBe(true);
			expect(procedure.states.failed.terminal).toBe(true);
		});

		it("should mark non-terminal states correctly", () => {
			expect(procedure.states.planning.terminal).toBe(false);
			expect(procedure.states.gated.terminal).toBe(false);
			expect(procedure.states.decision_gate_failure.terminal).toBe(false);
			expect(procedure.states.weaving.terminal).toBe(false);
		});

		it("should have descriptions for all states", () => {
			for (const [stateName, state] of Object.entries(procedure.states)) {
				expect(state.description).toBeTruthy();
				expect(typeof state.description).toBe("string");
			}
		});
	});

	describe("Transitions", () => {
		it("should define transitions from planning state", () => {
			const planningTransitions = procedure.transitions.planning;
			expect(planningTransitions.PLAN_READY.to).toBe("gated");
			expect(planningTransitions.PLAN_EMPTY.to).toBe("completed");
			expect(planningTransitions.PLAN_FAILED.to).toBe("failed");
		});

		it("should define transitions from gated state", () => {
			const gatedTransitions = procedure.transitions.gated;
			expect(gatedTransitions.ALL_GATES_PASSED.to).toBe("weaving");
			expect(gatedTransitions.SOME_GATES_FAILED.to).toBe("decision_gate_failure");
		});

		it("should define transitions from decision_gate_failure state", () => {
			const decisionTransitions = procedure.transitions.decision_gate_failure;
			expect(decisionTransitions.RETRY_GATES.to).toBe("gated");
			expect(decisionTransitions.SKIP_FAILED.to).toBe("weaving");
			expect(decisionTransitions.ABORT.to).toBe("failed");
		});

		it("should define transitions from weaving state", () => {
			const weavingTransitions = procedure.transitions.weaving;
			expect(weavingTransitions.ALL_MERGED.to).toBe("completed");
			expect(weavingTransitions.MERGE_CONFLICT.to).toBe("decision_gate_failure");
			expect(weavingTransitions.MERGE_FAILED.to).toBe("failed");
		});

		it("should have descriptions for all transitions", () => {
			for (const [fromState, transitions] of Object.entries(procedure.transitions)) {
				for (const [event, transition] of Object.entries(transitions)) {
					expect(transition.description).toBeTruthy();
					expect(typeof transition.description).toBe("string");
				}
			}
		});

		it("should only transition to defined states", () => {
			const definedStates = Object.keys(procedure.states);
			
			for (const [fromState, transitions] of Object.entries(procedure.transitions)) {
				for (const [event, transition] of Object.entries(transitions)) {
					expect(definedStates).toContain(transition.to);
				}
			}
		});
	});

	describe("Decision Points", () => {
		it("should define gate_failure decision point", () => {
			const gateFailure = procedure.decisionPoints.gate_failure;
			expect(gateFailure.state).toBe("decision_gate_failure");
			expect(gateFailure.trigger).toBe("SOME_GATES_FAILED");
			expect(gateFailure.prompt).toBeTruthy();
			expect(gateFailure.options.length).toBeGreaterThan(0);
		});

		it("should define conflict_resolution decision point", () => {
			const conflictResolution = procedure.decisionPoints.conflict_resolution;
			expect(conflictResolution.state).toBe("decision_gate_failure");
			expect(conflictResolution.trigger).toBe("MERGE_CONFLICT");
			expect(conflictResolution.prompt).toBeTruthy();
			expect(conflictResolution.options.length).toBeGreaterThan(0);
		});

		it("should have gate_failure options for retry, skip, and abort", () => {
			const options = procedure.decisionPoints.gate_failure.options;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("retry_gates");
			expect(actions).toContain("skip_failed");
			expect(actions).toContain("abort");
		});

		it("should have conflict_resolution options for resolve, skip, and abort", () => {
			const options = procedure.decisionPoints.conflict_resolution.options;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("resolve_conflict");
			expect(actions).toContain("skip_pr");
			expect(actions).toContain("abort");
		});

		it("should mark skip_failed as requiring LLM decision with rationale", () => {
			const options = procedure.decisionPoints.gate_failure.options;
			const skipOption = options.find(o => o.action === "skip_failed");
			
			expect(skipOption).toBeDefined();
			expect(skipOption!.requiresLLMDecision).toBe(true);
			expect(skipOption!.prompt).toBeTruthy();
		});

		it("should mark resolve_conflict as requiring LLM decision", () => {
			const options = procedure.decisionPoints.conflict_resolution.options;
			const resolveOption = options.find(o => o.action === "resolve_conflict");
			
			expect(resolveOption).toBeDefined();
			expect(resolveOption!.requiresLLMDecision).toBe(true);
			expect(resolveOption!.prompt).toBeTruthy();
		});
	});

	describe("Next Options", () => {
		it("should define nextOptions for all non-terminal states", () => {
			const nonTerminalStates = Object.entries(procedure.states)
				.filter(([_, state]) => !state.terminal)
				.map(([name, _]) => name);
			
			for (const state of nonTerminalStates) {
				expect(procedure.nextOptions[state]).toBeDefined();
				expect(Array.isArray(procedure.nextOptions[state])).toBe(true);
			}
		});

		it("should define nextOptions for terminal states", () => {
			expect(procedure.nextOptions.completed).toBeDefined();
			expect(procedure.nextOptions.failed).toBeDefined();
		});

		it("should have wait and abort options for planning state", () => {
			const options = procedure.nextOptions.planning;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("wait");
			expect(actions).toContain("abort");
		});

		it("should have wait, pause, and abort options for gated state", () => {
			const options = procedure.nextOptions.gated;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("wait");
			expect(actions).toContain("pause");
			expect(actions).toContain("abort");
		});

		it("should have wait, pause, and abort options for weaving state", () => {
			const options = procedure.nextOptions.weaving;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("wait");
			expect(actions).toContain("pause");
			expect(actions).toContain("abort");
		});

		it("should have view_summary and create_release options for completed state", () => {
			const options = procedure.nextOptions.completed;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("view_summary");
			expect(actions).toContain("create_release");
		});

		it("should have decision options for decision_gate_failure state", () => {
			const options = procedure.nextOptions.decision_gate_failure;
			const actions = options.map(o => o.action);
			
			expect(actions).toContain("retry_gates");
			expect(actions).toContain("skip_failed");
			expect(actions).toContain("abort");
		});

		it("should have valid risk levels for all options", () => {
			const validRiskLevels = ["low", "medium", "high"];
			
			for (const [state, options] of Object.entries(procedure.nextOptions)) {
				for (const option of options) {
					if (option.riskLevel) {
						expect(validRiskLevels).toContain(option.riskLevel);
					}
				}
			}
		});

		it("should have descriptions for all options", () => {
			for (const [state, options] of Object.entries(procedure.nextOptions)) {
				for (const option of options) {
					expect(option.description).toBeTruthy();
					expect(typeof option.description).toBe("string");
				}
			}
		});
	});

	describe("Integration", () => {
		it("should reference the weave state machine", () => {
			expect(procedure.integration.stateMachine).toBe("src/weave/stateMachine.ts");
			expect(procedure.integration.types).toBe("src/weave/types.ts");
		});

		it("should map procedure states to weave states", () => {
			expect(procedure.integration.mapping.planning).toContain("idle");
			expect(procedure.integration.mapping.planning).toContain("planning");
			expect(procedure.integration.mapping.planning).toContain("computing_order");
			
			expect(procedure.integration.mapping.gated).toContain("ready");
			expect(procedure.integration.mapping.gated).toContain("validating");
			
			expect(procedure.integration.mapping.weaving).toContain("merging");
			
			expect(procedure.integration.mapping.completed).toContain("completed");
			expect(procedure.integration.mapping.failed).toContain("failed");
		});

		it("should map all procedure states", () => {
			const procedureStates = Object.keys(procedure.states);
			const mappedStates = Object.keys(procedure.integration.mapping);
			
			for (const state of procedureStates) {
				expect(mappedStates).toContain(state);
			}
		});
	});

	describe("Full State Machine Traversal", () => {
		it("should support happy path: planning → gated → weaving → completed", () => {
			// Start in planning
			let currentState = "planning";
			expect(procedure.states[currentState]).toBeDefined();
			
			// PLAN_READY → gated
			currentState = procedure.transitions.planning.PLAN_READY.to;
			expect(currentState).toBe("gated");
			
			// ALL_GATES_PASSED → weaving
			currentState = procedure.transitions.gated.ALL_GATES_PASSED.to;
			expect(currentState).toBe("weaving");
			
			// ALL_MERGED → completed
			currentState = procedure.transitions.weaving.ALL_MERGED.to;
			expect(currentState).toBe("completed");
			
			// Verify terminal state
			expect(procedure.states[currentState].terminal).toBe(true);
		});

		it("should support empty plan path: planning → completed", () => {
			let currentState = "planning";
			
			// PLAN_EMPTY → completed
			currentState = procedure.transitions.planning.PLAN_EMPTY.to;
			expect(currentState).toBe("completed");
			expect(procedure.states[currentState].terminal).toBe(true);
		});

		it("should support gate failure with retry path", () => {
			let currentState = "gated";
			
			// SOME_GATES_FAILED → decision_gate_failure
			currentState = procedure.transitions.gated.SOME_GATES_FAILED.to;
			expect(currentState).toBe("decision_gate_failure");
			
			// RETRY_GATES → gated
			currentState = procedure.transitions.decision_gate_failure.RETRY_GATES.to;
			expect(currentState).toBe("gated");
		});

		it("should support gate failure with skip path", () => {
			let currentState = "gated";
			
			// SOME_GATES_FAILED → decision_gate_failure
			currentState = procedure.transitions.gated.SOME_GATES_FAILED.to;
			expect(currentState).toBe("decision_gate_failure");
			
			// SKIP_FAILED → weaving
			currentState = procedure.transitions.decision_gate_failure.SKIP_FAILED.to;
			expect(currentState).toBe("weaving");
		});

		it("should support merge conflict path", () => {
			let currentState = "weaving";
			
			// MERGE_CONFLICT → decision_gate_failure
			currentState = procedure.transitions.weaving.MERGE_CONFLICT.to;
			expect(currentState).toBe("decision_gate_failure");
		});

		it("should support abort from decision_gate_failure", () => {
			let currentState = "decision_gate_failure";
			
			// ABORT → failed
			currentState = procedure.transitions.decision_gate_failure.ABORT.to;
			expect(currentState).toBe("failed");
			expect(procedure.states[currentState].terminal).toBe(true);
		});

		it("should support planning failure path", () => {
			let currentState = "planning";
			
			// PLAN_FAILED → failed
			currentState = procedure.transitions.planning.PLAN_FAILED.to;
			expect(currentState).toBe("failed");
			expect(procedure.states[currentState].terminal).toBe(true);
		});

		it("should support merge failure path", () => {
			let currentState = "weaving";
			
			// MERGE_FAILED → failed
			currentState = procedure.transitions.weaving.MERGE_FAILED.to;
			expect(currentState).toBe("failed");
			expect(procedure.states[currentState].terminal).toBe(true);
		});
	});

	describe("Integration with WeaveState", () => {
		it("should map procedure states to valid WeaveState values", () => {
			// Verify that the mapping references actual WeaveState enum values
			const weaveStates = Object.values(WeaveState);
			
			for (const [procedureState, mappedStates] of Object.entries(procedure.integration.mapping)) {
				for (const mappedState of mappedStates) {
					// Mapping values should directly match WeaveState enum values (lowercase)
					expect(weaveStates).toContain(mappedState);
				}
			}
		});
	});
});

describe("Procedure + RunManager Integration", () => {
	let procedure: ProcedureDefinition;

	beforeEach(() => {
		const content = fs.readFileSync(PROCEDURE_PATH, "utf-8");
		procedure = yaml.parse(content) as ProcedureDefinition;
	});

	it("should provide nextOptions that match allowed actions", () => {
		// For each state, verify nextOptions provide valid actions
		for (const [stateName, state] of Object.entries(procedure.states)) {
			const options = procedure.nextOptions[stateName] || [];
			
			// Each option should have action and description
			for (const option of options) {
				expect(option.action).toBeTruthy();
				expect(option.description).toBeTruthy();
			}
		}
	});

	it("should have decision options that match decision point triggers", () => {
		// Verify decision points reference valid triggers
		for (const [pointName, point] of Object.entries(procedure.decisionPoints)) {
			// The state should exist
			expect(procedure.states[point.state]).toBeDefined();
			
			// The trigger should be a valid event for some transition
			let triggerFound = false;
			for (const [fromState, transitions] of Object.entries(procedure.transitions)) {
				if (point.trigger in transitions) {
					triggerFound = true;
					break;
				}
			}
			expect(triggerFound).toBe(true);
		}
	});

	it("should support StatusResponse generation for each state", () => {
		// Simulate StatusResponse generation for each state
		for (const [stateName, state] of Object.entries(procedure.states)) {
			const options = procedure.nextOptions[stateName] || [];
			
			// A StatusResponse would include these nextOptions
			const statusResponse = {
				runId: "test-run-id",
				state: stateName,
				mode: "senior-dev",
				procedure: procedure.id,
				summary: state.description,
				nextOptions: options
			};
			
			// Verify structure is valid
			expect(statusResponse.state).toBe(stateName);
			expect(statusResponse.procedure).toBe("merge-weave-main");
			expect(Array.isArray(statusResponse.nextOptions)).toBe(true);
		}
	});
});
