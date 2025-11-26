/**
 * Tests for the Procedure Library
 *
 * Tests loader, schema validation, and state machine functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import YAML from "yaml";
import {
	ProcedureLoader,
	ProcedureLoadError,
	createProcedureLoader,
	validateProcedureSchema,
	validateProcedureSemantics,
	ProcedureStateMachine
} from "../../src/procedures/index.js";
import type { ProcedureDefinition, RunContext } from "../../src/procedures/index.js";

describe("Procedure Schema Validation", () => {
	it("validates a valid procedure definition", () => {
		const definition = {
			schemaVersion: "1.0.0",
			id: "test-procedure",
			name: "Test Procedure",
			description: "A test procedure",
			states: ["start", "middle", "end"],
			initialState: "start",
			transitions: {
				start: { NEXT: "middle" },
				middle: { NEXT: "end" },
				end: {}
			}
		};

		const result = validateProcedureSchema(definition);
		expect(result.valid).toBe(true);
		expect(result.data).toBeDefined();
	});

	it("rejects invalid schema version", () => {
		const definition = {
			schemaVersion: "2.0.0",
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start"],
			initialState: "start",
			transitions: {}
		};

		const result = validateProcedureSchema(definition);
		expect(result.valid).toBe(false);
		expect(result.errors).toBeDefined();
		expect(result.errors!.some(e => e.path === "schemaVersion")).toBe(true);
	});

	it("rejects missing required fields", () => {
		const definition = {
			schemaVersion: "1.0.0",
			id: "test"
			// missing name, description, states, initialState, transitions
		};

		const result = validateProcedureSchema(definition);
		expect(result.valid).toBe(false);
		expect(result.errors).toBeDefined();
		expect(result.errors!.length).toBeGreaterThan(0);
	});

	it("validates decision points", () => {
		const definition = {
			schemaVersion: "1.0.0",
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "decision", "end"],
			initialState: "start",
			transitions: {
				start: { GO: "decision" },
				decision: { YES: "end", NO: "end" },
				end: {}
			},
			decisionPoints: [
				{
					state: "decision",
					requiresLLMDecision: true,
					prompt: "Make a choice",
					options: [
						{ action: "yes", description: "Proceed" },
						{ action: "no", description: "Stop", riskLevel: "low" }
					]
				}
			]
		};

		const result = validateProcedureSchema(definition);
		expect(result.valid).toBe(true);
	});

	it("validates completion gates", () => {
		const definition = {
			schemaVersion: "1.0.0",
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "start",
			transitions: {
				start: { DONE: "end" },
				end: {}
			},
			completionGates: ["lint", "test", "build"]
		};

		const result = validateProcedureSchema(definition);
		expect(result.valid).toBe(true);
		expect(result.data?.completionGates).toEqual(["lint", "test", "build"]);
	});
});

describe("Procedure Semantic Validation", () => {
	it("detects invalid initial state", () => {
		const definition = {
			schemaVersion: "1.0.0" as const,
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "nonexistent",
			transitions: {
				start: { DONE: "end" },
				end: {}
			}
		};

		const errors = validateProcedureSemantics(definition);
		expect(errors.length).toBe(1);
		expect(errors[0].code).toBe("invalid_initial_state");
	});

	it("detects invalid transition target", () => {
		const definition = {
			schemaVersion: "1.0.0" as const,
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "start",
			transitions: {
				start: { DONE: "nonexistent" },
				end: {}
			}
		};

		const errors = validateProcedureSemantics(definition);
		expect(errors.length).toBe(1);
		expect(errors[0].code).toBe("invalid_transition_target");
	});

	it("detects invalid transition source", () => {
		const definition = {
			schemaVersion: "1.0.0" as const,
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "start",
			transitions: {
				start: { DONE: "end" },
				nonexistent: { DONE: "end" },
				end: {}
			}
		};

		const errors = validateProcedureSemantics(definition);
		expect(errors.length).toBe(1);
		expect(errors[0].code).toBe("invalid_transition_source");
	});

	it("detects invalid decision point state", () => {
		const definition = {
			schemaVersion: "1.0.0" as const,
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "start",
			transitions: {
				start: { DONE: "end" },
				end: {}
			},
			decisionPoints: [
				{
					state: "nonexistent",
					requiresLLMDecision: true,
					prompt: "Choose",
					options: [{ action: "a", description: "A" }]
				}
			]
		};

		const errors = validateProcedureSemantics(definition);
		expect(errors.length).toBe(1);
		expect(errors[0].code).toBe("invalid_decision_point_state");
	});

	it("passes for valid procedure", () => {
		const definition = {
			schemaVersion: "1.0.0" as const,
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "middle", "end"],
			initialState: "start",
			transitions: {
				start: { GO: "middle" },
				middle: { GO: "end" },
				end: {}
			}
		};

		const errors = validateProcedureSemantics(definition);
		expect(errors.length).toBe(0);
	});
});

describe("ProcedureStateMachine", () => {
	const testDefinition: ProcedureDefinition = {
		schemaVersion: "1.0.0",
		id: "test-sm",
		name: "Test State Machine",
		description: "A test state machine",
		states: ["planning", "gated", "weaving", "completed", "failed", "decision"],
		initialState: "planning",
		transitions: {
			planning: { PLAN_READY: "gated", PLAN_FAILED: "failed" },
			gated: { GATES_PASSED: "weaving", GATES_FAILED: "decision" },
			decision: { RETRY: "gated", SKIP: "weaving", ABORT: "failed" },
			weaving: { WEAVE_COMPLETE: "completed" },
			completed: {},
			failed: {}
		},
		decisionPoints: [
			{
				state: "decision",
				requiresLLMDecision: true,
				prompt: "What to do?",
				options: [
					{ action: "retry", description: "Retry", riskLevel: "low" },
					{ action: "skip", description: "Skip", riskLevel: "medium" },
					{ action: "abort", description: "Abort", riskLevel: "low" }
				]
			}
		],
		completionGates: ["lint", "test"]
	};

	let sm: ProcedureStateMachine;

	beforeEach(() => {
		sm = new ProcedureStateMachine(testDefinition);
	});

	it("returns correct id, name, and description", () => {
		expect(sm.id).toBe("test-sm");
		expect(sm.name).toBe("Test State Machine");
		expect(sm.description).toBe("A test state machine");
	});

	it("returns correct initial state", () => {
		expect(sm.getInitialState()).toBe("planning");
	});

	it("validates transitions correctly", () => {
		expect(sm.canTransition("planning", "PLAN_READY")).toBe(true);
		expect(sm.canTransition("planning", "PLAN_FAILED")).toBe(true);
		expect(sm.canTransition("planning", "INVALID")).toBe(false);
		expect(sm.canTransition("completed", "ANYTHING")).toBe(false);
	});

	it("applies transitions correctly", () => {
		expect(sm.applyTransition("planning", "PLAN_READY")).toBe("gated");
		expect(sm.applyTransition("gated", "GATES_PASSED")).toBe("weaving");
		expect(sm.applyTransition("weaving", "WEAVE_COMPLETE")).toBe("completed");
	});

	it("throws on invalid transition", () => {
		expect(() => sm.applyTransition("planning", "INVALID")).toThrow();
		expect(() => sm.applyTransition("completed", "ANYTHING")).toThrow();
	});

	it("identifies terminal states", () => {
		expect(sm.isTerminal("completed")).toBe(true);
		expect(sm.isTerminal("failed")).toBe(true);
		expect(sm.isTerminal("planning")).toBe(false);
		expect(sm.isTerminal("gated")).toBe(false);
	});

	it("returns decision points", () => {
		const dp = sm.getDecisionPoint("decision");
		expect(dp).not.toBeNull();
		expect(dp?.requiresLLMDecision).toBe(true);
		expect(dp?.options.length).toBe(3);

		expect(sm.getDecisionPoint("planning")).toBeNull();
	});

	it("returns completion gates", () => {
		expect(sm.getCompletionGates()).toEqual(["lint", "test"]);
	});

	it("returns next options for regular state", () => {
		const context: RunContext = { runId: "test-run", state: "planning" };
		const options = sm.getNextOptions("planning", context);

		expect(options.length).toBe(2);
		expect(options.map(o => o.action).sort()).toEqual(["PLAN_FAILED", "PLAN_READY"]);
		expect(options.every(o => o.requiresLLMDecision === false)).toBe(true);
	});

	it("returns next options for decision point state", () => {
		const context: RunContext = { runId: "test-run", state: "decision" };
		const options = sm.getNextOptions("decision", context);

		expect(options.length).toBe(3);
		expect(options.map(o => o.action).sort()).toEqual(["abort", "retry", "skip"]);
		expect(options.every(o => o.requiresLLMDecision === true)).toBe(true);
	});

	it("returns empty options for terminal state", () => {
		const context: RunContext = { runId: "test-run", state: "completed" };
		const options = sm.getNextOptions("completed", context);
		expect(options.length).toBe(0);
	});
});

describe("ProcedureLoader", () => {
	let tempDir: string;
	let loader: ProcedureLoader;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procedure-test-"));
		loader = createProcedureLoader({ proceduresDir: tempDir });
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	const writeProcedure = (filename: string, content: object): void => {
		fs.writeFileSync(
			path.join(tempDir, filename),
			YAML.stringify(content),
			"utf8"
		);
	};

	it("loads a valid procedure", async () => {
		writeProcedure("test-proc.yaml", {
			schemaVersion: "1.0.0",
			id: "test-proc",
			name: "Test Procedure",
			description: "A test",
			states: ["start", "end"],
			initialState: "start",
			transitions: {
				start: { DONE: "end" },
				end: {}
			}
		});

		const procedure = await loader.loadProcedure("test-proc");
		expect(procedure.id).toBe("test-proc");
		expect(procedure.name).toBe("Test Procedure");
		expect(procedure.getInitialState()).toBe("start");
	});

	it("caches loaded procedures", async () => {
		writeProcedure("cached.yaml", {
			schemaVersion: "1.0.0",
			id: "cached",
			name: "Cached",
			description: "Cached procedure",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		const p1 = await loader.loadProcedure("cached");
		const p2 = await loader.loadProcedure("cached");
		expect(p1).toBe(p2);
	});

	it("throws for non-existent procedure", async () => {
		await expect(loader.loadProcedure("nonexistent")).rejects.toThrow(
			ProcedureLoadError
		);
	});

	it("throws for ID mismatch", async () => {
		writeProcedure("mismatch.yaml", {
			schemaVersion: "1.0.0",
			id: "wrong-id",
			name: "Mismatch",
			description: "ID mismatch",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		await expect(loader.loadProcedure("mismatch")).rejects.toThrow(
			/ID mismatch/
		);
	});

	it("throws for invalid YAML", async () => {
		fs.writeFileSync(path.join(tempDir, "invalid.yaml"), "{ unclosed: brace", "utf8");

		await expect(loader.loadProcedure("invalid")).rejects.toThrow(
			ProcedureLoadError
		);
	});

	it("throws for invalid schema", async () => {
		writeProcedure("bad-schema.yaml", {
			schemaVersion: "1.0.0",
			id: "bad-schema"
			// missing required fields
		});

		await expect(loader.loadProcedure("bad-schema")).rejects.toThrow(
			ProcedureLoadError
		);
	});

	it("lists all procedures", async () => {
		writeProcedure("alpha.yaml", {
			schemaVersion: "1.0.0",
			id: "alpha",
			name: "Alpha",
			description: "Alpha procedure",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		writeProcedure("beta.yaml", {
			schemaVersion: "1.0.0",
			id: "beta",
			name: "Beta",
			description: "Beta procedure",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		const summaries = await loader.listProcedures();
		expect(summaries.length).toBe(2);
		expect(summaries[0].id).toBe("alpha");
		expect(summaries[1].id).toBe("beta");
	});

	it("skips invalid files when listing", async () => {
		writeProcedure("valid.yaml", {
			schemaVersion: "1.0.0",
			id: "valid",
			name: "Valid",
			description: "Valid procedure",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		fs.writeFileSync(path.join(tempDir, "invalid.yaml"), "{ unclosed: brace", "utf8");

		const summaries = await loader.listProcedures();
		expect(summaries.length).toBe(1);
		expect(summaries[0].id).toBe("valid");
	});

	it("returns empty list for missing directory", async () => {
		const emptyLoader = createProcedureLoader({
			proceduresDir: "/nonexistent/dir"
		});
		const summaries = await emptyLoader.listProcedures();
		expect(summaries).toEqual([]);
	});

	it("validates procedure definitions", () => {
		const valid = {
			schemaVersion: "1.0.0",
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "start",
			transitions: {
				start: { DONE: "end" },
				end: {}
			}
		};

		const result = loader.validateProcedure(valid);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("reports validation errors", () => {
		const invalid = {
			schemaVersion: "1.0.0",
			id: "test",
			name: "Test",
			description: "Test",
			states: ["start", "end"],
			initialState: "nonexistent",
			transitions: {
				start: { DONE: "end" },
				end: {}
			}
		};

		const result = loader.validateProcedure(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].code).toBe("invalid_initial_state");
	});

	it("clears cache", async () => {
		writeProcedure("cached.yaml", {
			schemaVersion: "1.0.0",
			id: "cached",
			name: "Cached",
			description: "Cached",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		const p1 = await loader.loadProcedure("cached");
		loader.clearCache();

		// Modify the file
		writeProcedure("cached.yaml", {
			schemaVersion: "1.0.0",
			id: "cached",
			name: "Modified",
			description: "Modified",
			states: ["s"],
			initialState: "s",
			transitions: { s: {} }
		});

		const p2 = await loader.loadProcedure("cached");
		expect(p2.name).toBe("Modified");
		expect(p1).not.toBe(p2);
	});
});

describe("Integration: Real Procedure Files", () => {
	it("loads merge-weave-main procedure from procedures/", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });

		const procedure = await loader.loadProcedure("merge-weave-main");
		expect(procedure.id).toBe("merge-weave-main");
		expect(procedure.name).toBe("Merge Weave to Main");
		expect(procedure.getInitialState()).toBe("planning");

		// Check transitions work
		expect(procedure.canTransition("planning", "PLAN_READY")).toBe(true);
		expect(procedure.applyTransition("planning", "PLAN_READY")).toBe("gated");

		// Check terminal states
		expect(procedure.isTerminal("completed")).toBe(true);
		expect(procedure.isTerminal("failed")).toBe(true);

		// Check decision point
		const dp = procedure.getDecisionPoint("decision_gate_failure");
		expect(dp).not.toBeNull();
		expect(dp?.requiresLLMDecision).toBe(true);

		// Check completion gates
		expect(procedure.getCompletionGates()).toEqual(["lint", "typecheck", "test"]);
	});

	it("lists real procedures", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });
		const summaries = await loader.listProcedures();

		expect(summaries.length).toBeGreaterThanOrEqual(1);
		expect(summaries.some(s => s.id === "merge-weave-main")).toBe(true);
	});
});
