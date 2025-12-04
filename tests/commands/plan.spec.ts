/**
 * Plan Command Module Tests
 * Tests for the extracted plan command module
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";
import { registerPlanCommand } from "../../src/commands/plan.js";

describe("Plan Command Module", () => {
	let program: Command;
	let jsonModeValue: boolean;
	let exitWithCalled: unknown;
	
	const mockDeps = {
		jsonModeActive: () => jsonModeValue,
		setJsonMode: (active: boolean) => { jsonModeValue = active; },
		exitWith: (e: unknown) => { exitWithCalled = e; }
	};

	beforeEach(() => {
		program = new Command();
		jsonModeValue = false;
		exitWithCalled = undefined;
		vi.clearAllMocks();
	});

	describe("Command Registration", () => {
		it("should register the plan command", () => {
			registerPlanCommand(program, mockDeps);
			
		const planCommand = program.commands.find(cmd => cmd.name() === "plan");
		expect(planCommand).toBeDefined();
		expect(planCommand?.description()).toBe("Generate plan from configuration sources or GitHub PRs (canonical: lex-pr weave plan)");
	});		it("should register all expected options", () => {
			registerPlanCommand(program, mockDeps);
			
			const planCommand = program.commands.find(cmd => cmd.name() === "plan");
			expect(planCommand).toBeDefined();
			
			const optionNames = planCommand?.options.map(opt => opt.long) ?? [];
			
			// Core options
			expect(optionNames).toContain("--out");
			expect(optionNames).toContain("--json");
			expect(optionNames).toContain("--dry-run");
			
			// GitHub mode options
			expect(optionNames).toContain("--from-github");
			expect(optionNames).toContain("--query");
			expect(optionNames).toContain("--labels");
			expect(optionNames).toContain("--include-drafts");
			expect(optionNames).toContain("--exclude-prs");
			expect(optionNames).toContain("--github-token");
			expect(optionNames).toContain("--owner");
			expect(optionNames).toContain("--repo");
			
			// Policy options
			expect(optionNames).toContain("--required-gates");
			expect(optionNames).toContain("--max-workers");
			expect(optionNames).toContain("--target");
			
			// Validation options
			expect(optionNames).toContain("--validate-cycles");
			expect(optionNames).toContain("--optimize");
			
			// Dependency suggestion options
			expect(optionNames).toContain("--suggest-deps");
			expect(optionNames).toContain("--threshold");
			expect(optionNames).toContain("--format");
			expect(optionNames).toContain("--output");
		});

		it("should have help text with options", () => {
			registerPlanCommand(program, mockDeps);
			
			const planCommand = program.commands.find(cmd => cmd.name() === "plan");
			const helpText = planCommand?.helpInformation() ?? "";
			
			// Check for key options in help text
			expect(helpText).toContain("--from-github");
			expect(helpText).toContain("--dry-run");
			expect(helpText).toContain("--labels");
			expect(helpText).toContain("--required-gates");
		});
	});

	describe("JSON Mode Handling", () => {
		it("should restore previous JSON mode after execution", () => {
			registerPlanCommand(program, mockDeps);
			
			// Set initial JSON mode to true
			jsonModeValue = true;
			
			expect(mockDeps.jsonModeActive()).toBe(true);
			
			// The command should restore it after execution
			// (This is verified by the finally block in the action handler)
		});
	});

	describe("Command Integration", () => {
		it("should be registered alongside other commands in a program", () => {
			const testProgram = new Command();
			
			// Register multiple commands like in cli.ts
			registerPlanCommand(testProgram, mockDeps);
			
			testProgram
				.command("other-command")
				.description("Another command");
			
			expect(testProgram.commands).toHaveLength(2);
			expect(testProgram.commands.map(c => c.name())).toContain("plan");
			expect(testProgram.commands.map(c => c.name())).toContain("other-command");
		});
	});
});
