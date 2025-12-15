/**
 * Vacuum-Ready Prompt Schema Tests
 * Tests for the vrp-1.0.0 schema validation
 */

import { describe, it, expect } from "vitest";
import {
	VacuumReadyPromptSchema,
	VRPSchemaVersion,
	ScopeClosure,
	ToolAnchoring,
	PolicyAttachment,
	TaskAtomicity,
	OutcomeCheckability,
	validateVacuumReadyPrompt,
	safeParseVacuumReadyPrompt,
} from "../../src/schemas/vacuumReadyPrompt.js";

describe("Vacuum-Ready Prompt Schema", () => {
	describe("VRPSchemaVersion", () => {
		it("should validate correct vrp schema version format", () => {
			expect(() => VRPSchemaVersion.parse("vrp-1.0.0")).not.toThrow();
			expect(() => VRPSchemaVersion.parse("vrp-2.1.3")).not.toThrow();
			expect(() => VRPSchemaVersion.parse("vrp-0.0.1")).not.toThrow();
		});

		it("should reject invalid version formats", () => {
			expect(() => VRPSchemaVersion.parse("1.0.0")).toThrow();
			expect(() => VRPSchemaVersion.parse("vrp-1.0")).toThrow();
			expect(() => VRPSchemaVersion.parse("vrp-v1.0.0")).toThrow();
			expect(() => VRPSchemaVersion.parse("vr-1.0.0")).toThrow();
		});
	});

	describe("ScopeClosure", () => {
		it("should validate scope closure with all fields", () => {
			const scope = {
				targetPaths: ["src/**", "tests/**"],
				excludePaths: ["*.env", "node_modules/**"],
				maxDepth: 3,
				description: "Review code in src and tests directories",
			};

			const result = ScopeClosure.parse(scope);
			expect(result.targetPaths).toEqual(["src/**", "tests/**"]);
			expect(result.excludePaths).toEqual(["*.env", "node_modules/**"]);
			expect(result.maxDepth).toBe(3);
			expect(result.description).toBe(
				"Review code in src and tests directories"
			);
		});

		it("should apply defaults for excludePaths", () => {
			const scope = {
				targetPaths: ["src/**"],
				description: "Review source code",
			};

			const result = ScopeClosure.parse(scope);
			expect(result.excludePaths).toEqual([]);
		});

		it("should require at least one target path", () => {
			expect(() =>
				ScopeClosure.parse({
					targetPaths: [],
					description: "Test",
				})
			).toThrow();
		});

		it("should require scope description", () => {
			expect(() =>
				ScopeClosure.parse({
					targetPaths: ["src/**"],
				})
			).toThrow();
		});

		it("should reject additional properties in strict mode", () => {
			expect(() =>
				ScopeClosure.parse({
					targetPaths: ["src/**"],
					description: "Test",
					extraField: "not allowed",
				})
			).toThrow();
		});
	});

	describe("ToolAnchoring", () => {
		it("should validate tool anchoring with all fields", () => {
			const tools = {
				allowedTools: ["grep_search", "read_file", "get_errors"],
				maxToolCalls: 20,
				rationale: "Need search and read to review code",
			};

			const result = ToolAnchoring.parse(tools);
			expect(result.allowedTools).toEqual([
				"grep_search",
				"read_file",
				"get_errors",
			]);
			expect(result.maxToolCalls).toBe(20);
			expect(result.rationale).toBe("Need search and read to review code");
		});

		it("should allow minimal tool anchoring", () => {
			const tools = {
				allowedTools: ["read_file"],
			};

			const result = ToolAnchoring.parse(tools);
			expect(result.allowedTools).toEqual(["read_file"]);
			expect(result.maxToolCalls).toBeUndefined();
			expect(result.rationale).toBeUndefined();
		});

		it("should require at least one allowed tool", () => {
			expect(() =>
				ToolAnchoring.parse({
					allowedTools: [],
				})
			).toThrow();
		});

		it("should reject additional properties in strict mode", () => {
			expect(() =>
				ToolAnchoring.parse({
					allowedTools: ["read_file"],
					extraField: "not allowed",
				})
			).toThrow();
		});
	});

	describe("PolicyAttachment", () => {
		it("should validate policy attachment with all fields", () => {
			const policy = {
				guardrails: [
					"Read-only operations",
					"No external API calls",
					"Stay within allowed paths",
				],
				constraints: ["Maximum 50 files", "No files larger than 1MB"],
				escalationRules: [
					"Escalate on security concerns",
					"Escalate on ambiguous requirements",
				],
			};

			const result = PolicyAttachment.parse(policy);
			expect(result.guardrails).toHaveLength(3);
			expect(result.constraints).toHaveLength(2);
			expect(result.escalationRules).toHaveLength(2);
		});

		it("should apply defaults for optional arrays", () => {
			const policy = {
				guardrails: ["Read-only operations"],
			};

			const result = PolicyAttachment.parse(policy);
			expect(result.guardrails).toEqual(["Read-only operations"]);
			expect(result.constraints).toEqual([]);
			expect(result.escalationRules).toEqual([]);
		});

		it("should require at least one guardrail", () => {
			expect(() =>
				PolicyAttachment.parse({
					guardrails: [],
				})
			).toThrow();
		});

		it("should reject additional properties in strict mode", () => {
			expect(() =>
				PolicyAttachment.parse({
					guardrails: ["Test"],
					extraField: "not allowed",
				})
			).toThrow();
		});
	});

	describe("TaskAtomicity", () => {
		it("should validate task atomicity with all fields", () => {
			const task = {
				deliverable: "Code review decision with rationale",
				deliverableType: "decision" as const,
				multipleOutputsProhibited: true,
			};

			const result = TaskAtomicity.parse(task);
			expect(result.deliverable).toBe(
				"Code review decision with rationale"
			);
			expect(result.deliverableType).toBe("decision");
			expect(result.multipleOutputsProhibited).toBe(true);
		});

		it("should apply default for multipleOutputsProhibited", () => {
			const task = {
				deliverable: "Analysis report",
				deliverableType: "analysis" as const,
			};

			const result = TaskAtomicity.parse(task);
			expect(result.multipleOutputsProhibited).toBe(true);
		});

		it("should validate all deliverable types", () => {
			const validTypes = [
				"frame",
				"report",
				"decision",
				"artifact",
				"analysis",
			];

			for (const type of validTypes) {
				const task = {
					deliverable: "Test deliverable",
					deliverableType: type,
				};

				const result = TaskAtomicity.parse(task);
				expect(result.deliverableType).toBe(type);
			}
		});

		it("should reject invalid deliverable type", () => {
			expect(() =>
				TaskAtomicity.parse({
					deliverable: "Test",
					deliverableType: "invalid",
				})
			).toThrow();
		});

		it("should reject additional properties in strict mode", () => {
			expect(() =>
				TaskAtomicity.parse({
					deliverable: "Test",
					deliverableType: "frame",
					extraField: "not allowed",
				})
			).toThrow();
		});
	});

	describe("OutcomeCheckability", () => {
		it("should validate outcome checkability with all fields", () => {
			const outcome = {
				successCriteria: [
					"Decision is approve, reject, or request-changes",
					"Rationale is provided",
					"All code paths reviewed",
				],
				failureCriteria: [
					"Decision is missing",
					"No rationale provided",
				],
				acceptanceTest: "Validate output matches frame schema",
			};

			const result = OutcomeCheckability.parse(outcome);
			expect(result.successCriteria).toHaveLength(3);
			expect(result.failureCriteria).toHaveLength(2);
			expect(result.acceptanceTest).toBe(
				"Validate output matches frame schema"
			);
		});

		it("should apply defaults for optional arrays", () => {
			const outcome = {
				successCriteria: ["Decision provided"],
			};

			const result = OutcomeCheckability.parse(outcome);
			expect(result.successCriteria).toEqual(["Decision provided"]);
			expect(result.failureCriteria).toEqual([]);
			expect(result.acceptanceTest).toBeUndefined();
		});

		it("should require at least one success criterion", () => {
			expect(() =>
				OutcomeCheckability.parse({
					successCriteria: [],
				})
			).toThrow();
		});

		it("should reject additional properties in strict mode", () => {
			expect(() =>
				OutcomeCheckability.parse({
					successCriteria: ["Test"],
					extraField: "not allowed",
				})
			).toThrow();
		});
	});

	describe("VacuumReadyPromptSchema", () => {
		const validPrompt = {
			schemaVersion: "vrp-1.0.0",
			promptId: "code-review-senior-dev",
			description: "Senior developer code review with mentorship feedback",
			scopeClosed: {
				targetPaths: ["src/**", "tests/**"],
				excludePaths: ["*.env", "node_modules/**"],
				description: "Review source and test code",
			},
			toolAnchored: {
				allowedTools: ["grep_search", "read_file", "get_errors"],
				maxToolCalls: 20,
				rationale: "Need search and read to review code thoroughly",
			},
			policyAttached: {
				guardrails: [
					"Read-only operations",
					"No external API calls",
					"Stay within allowed paths",
				],
				constraints: ["Maximum 50 files reviewed"],
				escalationRules: ["Escalate on security concerns"],
			},
			taskAtomic: {
				deliverable: "Code review decision with rationale",
				deliverableType: "decision" as const,
			},
			outcomeCheckable: {
				successCriteria: [
					"Decision is approve, reject, or request-changes",
					"Rationale is provided",
					"Suggestions are actionable",
				],
				failureCriteria: ["Decision is missing"],
			},
		};

		it("should validate complete vacuum-ready prompt", () => {
			const result = VacuumReadyPromptSchema.parse(validPrompt);
			expect(result.schemaVersion).toBe("vrp-1.0.0");
			expect(result.promptId).toBe("code-review-senior-dev");
			expect(result.scopeClosed.targetPaths).toHaveLength(2);
			expect(result.toolAnchored.allowedTools).toHaveLength(3);
			expect(result.policyAttached.guardrails).toHaveLength(3);
			expect(result.taskAtomic.deliverableType).toBe("decision");
			expect(result.outcomeCheckable.successCriteria).toHaveLength(3);
		});

		it("should validate prompt with metadata", () => {
			const promptWithMetadata = {
				...validPrompt,
				metadata: {
					author: "system",
					version: "1.0.0",
					tags: ["code-review", "mentorship"],
				},
			};

			const result = VacuumReadyPromptSchema.parse(promptWithMetadata);
			expect(result.metadata?.author).toBe("system");
			expect(result.metadata?.tags).toEqual(["code-review", "mentorship"]);
		});

		it("should reject missing required fields", () => {
			expect(() =>
				VacuumReadyPromptSchema.parse({
					schemaVersion: "vrp-1.0.0",
					promptId: "test",
					// Missing other required fields
				})
			).toThrow();
		});

		it("should reject prompt missing scope-closed property", () => {
			const { scopeClosed, ...incomplete } = validPrompt;
			expect(() => VacuumReadyPromptSchema.parse(incomplete)).toThrow();
		});

		it("should reject prompt missing tool-anchored property", () => {
			const { toolAnchored, ...incomplete } = validPrompt;
			expect(() => VacuumReadyPromptSchema.parse(incomplete)).toThrow();
		});

		it("should reject prompt missing policy-attached property", () => {
			const { policyAttached, ...incomplete } = validPrompt;
			expect(() => VacuumReadyPromptSchema.parse(incomplete)).toThrow();
		});

		it("should reject prompt missing task-atomic property", () => {
			const { taskAtomic, ...incomplete } = validPrompt;
			expect(() => VacuumReadyPromptSchema.parse(incomplete)).toThrow();
		});

		it("should reject prompt missing outcome-checkable property", () => {
			const { outcomeCheckable, ...incomplete } = validPrompt;
			expect(() => VacuumReadyPromptSchema.parse(incomplete)).toThrow();
		});

		it("should reject additional properties in strict mode", () => {
			expect(() =>
				VacuumReadyPromptSchema.parse({
					...validPrompt,
					extraField: "not allowed",
				})
			).toThrow();
		});

		it("should validate using validateVacuumReadyPrompt helper", () => {
			const result = validateVacuumReadyPrompt(validPrompt);
			expect(result.promptId).toBe("code-review-senior-dev");
		});

		it("should throw on invalid prompt using validateVacuumReadyPrompt", () => {
			expect(() => validateVacuumReadyPrompt({ invalid: true })).toThrow();
		});

		it("should return success with safeParseVacuumReadyPrompt for valid data", () => {
			const result = safeParseVacuumReadyPrompt(validPrompt);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.promptId).toBe("code-review-senior-dev");
			}
		});

		it("should return failure with safeParseVacuumReadyPrompt for invalid data", () => {
			const result = safeParseVacuumReadyPrompt({ invalid: true });
			expect(result.success).toBe(false);
		});
	});

	describe("Example Prompts - Validation", () => {
		it("should validate code review prompt example", () => {
			const codeReviewPrompt = {
				schemaVersion: "vrp-1.0.0",
				promptId: "code-review-v1",
				description: "Perform code review on a pull request",
				scopeClosed: {
					targetPaths: ["src/**/*.ts", "tests/**/*.ts"],
					excludePaths: ["node_modules/**", "dist/**"],
					description: "Review TypeScript source and test files only",
				},
				toolAnchored: {
					allowedTools: ["read_file", "grep_search", "get_errors"],
					maxToolCalls: 30,
				},
				policyAttached: {
					guardrails: [
						"Read-only access",
						"No modification of files",
						"Respect file size limits",
					],
				},
				taskAtomic: {
					deliverable: "Review decision frame",
					deliverableType: "frame" as const,
				},
				outcomeCheckable: {
					successCriteria: [
						"Frame contains decision field",
						"Frame contains rationale",
					],
				},
			};

			const result = validateVacuumReadyPrompt(codeReviewPrompt);
			expect(result.promptId).toBe("code-review-v1");
		});

		it("should validate refactoring task prompt example", () => {
			const refactoringPrompt = {
				schemaVersion: "vrp-1.0.0",
				promptId: "refactor-module-v1",
				description: "Refactor a specific module to improve maintainability",
				scopeClosed: {
					targetPaths: ["src/legacy/oldModule.ts"],
					description: "Refactor only the oldModule.ts file",
					maxDepth: 1,
				},
				toolAnchored: {
					allowedTools: ["read_file", "replace_string_in_file"],
					maxToolCalls: 10,
					rationale: "Need read and replace for refactoring",
				},
				policyAttached: {
					guardrails: [
						"Preserve existing API",
						"Maintain test coverage",
						"No breaking changes",
					],
					constraints: ["Single file modification only"],
				},
				taskAtomic: {
					deliverable: "Refactored module with improved structure",
					deliverableType: "artifact" as const,
				},
				outcomeCheckable: {
					successCriteria: [
						"All tests pass",
						"TypeScript compilation succeeds",
						"Code complexity reduced",
					],
					acceptanceTest: "npm test && npm run typecheck",
				},
			};

			const result = validateVacuumReadyPrompt(refactoringPrompt);
			expect(result.promptId).toBe("refactor-module-v1");
		});

		it("should validate testing task prompt example", () => {
			const testingPrompt = {
				schemaVersion: "vrp-1.0.0",
				promptId: "add-unit-tests-v1",
				description: "Add unit tests for a specific function",
				scopeClosed: {
					targetPaths: ["src/utils/parser.ts"],
					description: "Add tests for parser.ts utility functions",
				},
				toolAnchored: {
					allowedTools: ["read_file", "create_file"],
					maxToolCalls: 5,
				},
				policyAttached: {
					guardrails: [
						"Follow existing test patterns",
						"Use Vitest framework",
						"Maintain coverage threshold",
					],
				},
				taskAtomic: {
					deliverable: "Test file with comprehensive coverage",
					deliverableType: "artifact" as const,
					multipleOutputsProhibited: true,
				},
				outcomeCheckable: {
					successCriteria: [
						"Test file created in correct location",
						"All tests pass",
						"Coverage > 90%",
					],
					failureCriteria: [
						"Tests do not compile",
						"Coverage below threshold",
					],
					acceptanceTest: "npm test -- parser.spec.ts",
				},
			};

			const result = validateVacuumReadyPrompt(testingPrompt);
			expect(result.promptId).toBe("add-unit-tests-v1");
		});
	});
});
