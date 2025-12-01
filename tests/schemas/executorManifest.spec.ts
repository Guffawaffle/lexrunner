/**
 * Executor Manifest Schema Tests
 * Tests for the executor-manifest.yaml schema validation
 */

import { describe, it, expect } from "vitest";
import {
	ExecutorManifestSchema,
	ExecutorSchemaVersion,
	ToolBudget,
	ExecutorGuardrails,
	ExecutorAuthorities,
	JordanModeProtocol,
	ReceiptPhase,
	StochasticPhase,
	validateExecutorManifest,
	safeParseExecutorManifest,
} from "../../src/schemas/executorManifest.js";

describe("Executor Manifest Schema", () => {
	describe("ExecutorSchemaVersion", () => {
		it("should validate correct executor schema version format", () => {
			expect(() =>
				ExecutorSchemaVersion.parse("executor-1.0.0")
			).not.toThrow();
			expect(() =>
				ExecutorSchemaVersion.parse("executor-2.1.3")
			).not.toThrow();
			expect(() =>
				ExecutorSchemaVersion.parse("executor-0.0.1")
			).not.toThrow();
		});

		it("should reject invalid version formats", () => {
			expect(() => ExecutorSchemaVersion.parse("1.0.0")).toThrow();
			expect(() => ExecutorSchemaVersion.parse("executor-1.0")).toThrow();
			expect(() =>
				ExecutorSchemaVersion.parse("executor-v1.0.0")
			).toThrow();
			expect(() => ExecutorSchemaVersion.parse("exec-1.0.0")).toThrow();
		});
	});

	describe("ToolBudget", () => {
		it("should validate tool budget with all fields", () => {
			const budget = {
				allowed: ["grep_search", "read_file"],
				denied: ["run_in_terminal"],
				limits: {
					maxToolCalls: 20,
					maxTokensOut: 2000,
				},
			};

			const result = ToolBudget.parse(budget);
			expect(result.allowed).toEqual(["grep_search", "read_file"]);
			expect(result.denied).toEqual(["run_in_terminal"]);
			expect(result.limits?.maxToolCalls).toBe(20);
		});

		it("should apply defaults for empty arrays", () => {
			const result = ToolBudget.parse({});
			expect(result.allowed).toEqual([]);
			expect(result.denied).toEqual([]);
		});

		it("should validate limits constraints", () => {
			expect(() =>
				ToolBudget.parse({
					limits: { maxToolCalls: 0 },
				})
			).toThrow();

			expect(() =>
				ToolBudget.parse({
					limits: { maxToolCalls: -1 },
				})
			).toThrow();
		});
	});

	describe("ExecutorGuardrails", () => {
		it("should validate complete guardrail profile", () => {
			const profile = {
				scope: {
					allowedPaths: ["src/**", "tests/**"],
					deniedPaths: ["*.env", "secrets/**"],
				},
				tool: {
					required: ["get_errors"],
					optional: ["grep_search"],
				},
				epistemic: {
					allowIDK: true,
					escalationThreshold: "high-risk",
				},
				style: {
					requirePlan: true,
					requireSummary: true,
				},
				audit: {
					level: "normal",
					frameSchema: "frame-v2",
				},
			};

			const result = ExecutorGuardrails.parse(profile);
			expect(result.scope?.allowedPaths).toEqual(["src/**", "tests/**"]);
			expect(result.epistemic?.escalationThreshold).toBe("high-risk");
			expect(result.audit?.level).toBe("normal");
		});

		it("should allow partial guardrail profiles", () => {
			const profile = {
				scope: {
					allowedPaths: ["src/**"],
				},
			};

			const result = ExecutorGuardrails.parse(profile);
			expect(result.scope?.allowedPaths).toEqual(["src/**"]);
			expect(result.tool).toBeUndefined();
		});

		it("should validate escalation threshold enum", () => {
			const validThresholds = [
				"low-risk",
				"medium-risk",
				"high-risk",
				"critical",
			];

			for (const threshold of validThresholds) {
				const result = ExecutorGuardrails.parse({
					epistemic: { escalationThreshold: threshold },
				});
				expect(result.epistemic?.escalationThreshold).toBe(threshold);
			}
		});

		it("should reject invalid escalation threshold", () => {
			expect(() =>
				ExecutorGuardrails.parse({
					epistemic: { escalationThreshold: "invalid" },
				})
			).toThrow();
		});

		it("should validate audit level enum", () => {
			const validLevels = ["minimal", "normal", "verbose", "debug"];

			for (const level of validLevels) {
				const result = ExecutorGuardrails.parse({
					audit: { level },
				});
				expect(result.audit?.level).toBe(level);
			}
		});
	});

	describe("ExecutorAuthorities", () => {
		it("should validate complete authorities configuration", () => {
			const authorities = {
				codeReview: true,
				framePersistence: true,
				keystoneIssues: false,
			};

			const result = ExecutorAuthorities.parse(authorities);
			expect(result.codeReview).toBe(true);
			expect(result.framePersistence).toBe(true);
			expect(result.keystoneIssues).toBe(false);
		});

		it("should apply defaults for missing authority fields", () => {
			const result = ExecutorAuthorities.parse({});
			expect(result.codeReview).toBe(false);
			expect(result.framePersistence).toBe(false);
			expect(result.keystoneIssues).toBe(false);
		});

		it("should allow partial authorities configuration", () => {
			const authorities = {
				codeReview: true,
			};

			const result = ExecutorAuthorities.parse(authorities);
			expect(result.codeReview).toBe(true);
			expect(result.framePersistence).toBe(false);
			expect(result.keystoneIssues).toBe(false);
		});
	});

	describe("JordanModeProtocol", () => {
		it("should validate complete Jordan-mode protocol", () => {
			const protocol = {
				prepPhase: ["load-context", "validate-scope"],
				stochasticPhase: {
					promptTemplate: "prompts/code-review.prompt.md",
					maxCalls: 1,
				},
				receiptPhase: {
					frameType: "review-frame",
					fields: ["decision", "rationale", "suggestions"],
				},
			};

			const result = JordanModeProtocol.parse(protocol);
			expect(result.prepPhase).toEqual([
				"load-context",
				"validate-scope",
			]);
			expect(result.stochasticPhase.promptTemplate).toBe(
				"prompts/code-review.prompt.md"
			);
			expect(result.receiptPhase.fields).toHaveLength(3);
		});

		it("should apply default for prepPhase", () => {
			const protocol = {
				stochasticPhase: {
					promptTemplate: "test.prompt.md",
				},
				receiptPhase: {
					frameType: "test-frame",
					fields: ["output"],
				},
			};

			const result = JordanModeProtocol.parse(protocol);
			expect(result.prepPhase).toEqual([]);
		});

		it("should apply default maxCalls of 1", () => {
			const protocol = {
				stochasticPhase: {
					promptTemplate: "test.prompt.md",
				},
				receiptPhase: {
					frameType: "test-frame",
					fields: ["output"],
				},
			};

			const result = JordanModeProtocol.parse(protocol);
			expect(result.stochasticPhase.maxCalls).toBe(1);
		});

		it("should require at least one field in receiptPhase", () => {
			expect(() =>
				JordanModeProtocol.parse({
					stochasticPhase: { promptTemplate: "test.prompt.md" },
					receiptPhase: { frameType: "test-frame", fields: [] },
				})
			).toThrow();
		});
	});

	describe("ReceiptPhase", () => {
		it("should validate receipt phase with fields", () => {
			const receipt = {
				frameType: "review-frame",
				fields: ["decision", "rationale"],
			};

			const result = ReceiptPhase.parse(receipt);
			expect(result.frameType).toBe("review-frame");
			expect(result.fields).toEqual(["decision", "rationale"]);
		});

		it("should reject empty fields array", () => {
			expect(() =>
				ReceiptPhase.parse({
					frameType: "test-frame",
					fields: [],
				})
			).toThrow();
		});
	});

	describe("StochasticPhase", () => {
		it("should validate stochastic phase", () => {
			const phase = {
				promptTemplate: "prompts/review.prompt.md",
				maxCalls: 3,
			};

			const result = StochasticPhase.parse(phase);
			expect(result.promptTemplate).toBe("prompts/review.prompt.md");
			expect(result.maxCalls).toBe(3);
		});

		it("should reject maxCalls less than 1", () => {
			expect(() =>
				StochasticPhase.parse({
					promptTemplate: "test.prompt.md",
					maxCalls: 0,
				})
			).toThrow();
		});
	});

	describe("ExecutorManifestSchema", () => {
		const validManifest = {
			schemaVersion: "executor-1.0.0",
			role: "senior-dev-review",
			description: "Code review with mentorship feedback",
			toolBudget: {
				allowed: ["grep_search", "read_file", "list_dir", "get_errors"],
				denied: [
					"run_in_terminal",
					"create_file",
					"replace_string_in_file",
				],
				limits: {
					maxToolCalls: 20,
					maxTokensOut: 2000,
				},
			},
			guardrails: {
				scope: {
					allowedPaths: ["src/**", "tests/**"],
					deniedPaths: ["*.env", "secrets/**"],
				},
				tool: {
					required: ["get_errors"],
					optional: ["grep_search"],
				},
				epistemic: {
					allowIDK: true,
					escalationThreshold: "high-risk",
				},
				style: {
					requirePlan: true,
					requireSummary: true,
				},
				audit: {
					level: "normal",
					frameSchema: "frame-v2",
				},
			},
			authorities: {
				codeReview: true,
				framePersistence: true,
				keystoneIssues: true,
			},
			jordanModeProtocol: {
				prepPhase: ["load-context", "validate-scope"],
				stochasticPhase: {
					promptTemplate: "prompts/code-review.prompt.md",
					maxCalls: 1,
				},
				receiptPhase: {
					frameType: "review-frame",
					fields: ["decision", "rationale", "suggestions"],
				},
			},
		};

		it("should validate complete executor manifest", () => {
			const result = ExecutorManifestSchema.parse(validManifest);
			expect(result.schemaVersion).toBe("executor-1.0.0");
			expect(result.role).toBe("senior-dev-review");
			expect(result.description).toBe(
				"Code review with mentorship feedback"
			);
		});

		it("should validate minimal executor manifest", () => {
			const minimalManifest = {
				schemaVersion: "executor-1.0.0",
				role: "simple-executor",
				toolBudget: {},
				jordanModeProtocol: {
					stochasticPhase: {
						promptTemplate: "prompts/simple.prompt.md",
					},
					receiptPhase: {
						frameType: "simple-frame",
						fields: ["output"],
					},
				},
			};

			const result = ExecutorManifestSchema.parse(minimalManifest);
			expect(result.role).toBe("simple-executor");
			expect(result.toolBudget.allowed).toEqual([]);
			expect(result.guardrails).toBeUndefined();
			expect(result.authorities).toBeUndefined();
		});

		it("should validate executor manifest with authorities", () => {
			const manifestWithAuthorities = {
				schemaVersion: "executor-1.0.0",
				role: "senior-dev-review",
				toolBudget: {},
				authorities: {
					codeReview: true,
					framePersistence: true,
					keystoneIssues: true,
				},
				jordanModeProtocol: {
					stochasticPhase: {
						promptTemplate: "prompts/review.prompt.md",
					},
					receiptPhase: {
						frameType: "review-frame",
						fields: ["output"],
					},
				},
			};

			const result = ExecutorManifestSchema.parse(manifestWithAuthorities);
			expect(result.authorities?.codeReview).toBe(true);
			expect(result.authorities?.framePersistence).toBe(true);
			expect(result.authorities?.keystoneIssues).toBe(true);
		});

		it("should reject missing required fields", () => {
			expect(() =>
				ExecutorManifestSchema.parse({
					schemaVersion: "executor-1.0.0",
					role: "test",
					// Missing toolBudget and jordanModeProtocol
				})
			).toThrow();
		});

		it("should reject empty role", () => {
			expect(() =>
				ExecutorManifestSchema.parse({
					schemaVersion: "executor-1.0.0",
					role: "",
					toolBudget: {},
					jordanModeProtocol: {
						stochasticPhase: { promptTemplate: "test.md" },
						receiptPhase: { frameType: "test", fields: ["a"] },
					},
				})
			).toThrow();
		});

		it("should validate using validateExecutorManifest helper", () => {
			const result = validateExecutorManifest(validManifest);
			expect(result.role).toBe("senior-dev-review");
		});

		it("should throw on invalid manifest using validateExecutorManifest", () => {
			expect(() => validateExecutorManifest({ invalid: true })).toThrow();
		});

		it("should return success with safeParseExecutorManifest for valid data", () => {
			const result = safeParseExecutorManifest(validManifest);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.role).toBe("senior-dev-review");
			}
		});

		it("should return failure with safeParseExecutorManifest for invalid data", () => {
			const result = safeParseExecutorManifest({ invalid: true });
			expect(result.success).toBe(false);
		});
	});
});
