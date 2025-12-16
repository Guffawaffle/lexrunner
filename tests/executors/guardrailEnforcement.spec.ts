import { describe, it, expect, beforeEach } from "vitest";
import {
	createGuardrailEnforcer,
	GuardrailEnforcer,
	ScopeViolation,
	ToolViolation,
	EpistemicViolation,
	StyleViolation,
	AuditViolation,
	resetToolTracker,
	DEFAULT_ENFORCEMENT_CONFIG,
} from "../../src/executors/guardrailEnforcement.js";
import type { GuardrailProfile } from "../../src/types/guardrails.js";

describe("Guardrail Enforcement Runtime", () => {
	beforeEach(() => {
		// Reset tool invocation tracker before each test
		resetToolTracker();
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Scope Guardrail Tests
	// ═════════════════════════════════════════════════════════════════════════

	describe("Scope Guardrails — File Access", () => {
		it("allows file access when no scope guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceFileAccess("src/test.ts", "read")
			).not.toThrow();
		});

		it("allows file access matching allow patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "src/**", access: "read" }],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceFileAccess("src/test.ts", "read")
			).not.toThrow();
			expect(() =>
				enforcer.enforceFileAccess("src/nested/file.ts", "read")
			).not.toThrow();
		});

		it("denies file access not in allow list", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "src/**", access: "read" }],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceFileAccess("tests/test.spec.ts", "read")
			).toThrow(ScopeViolation);
			expect(() =>
				enforcer.enforceFileAccess(".env", "read")
			).toThrow(ScopeViolation);
		});

		it("denies file access matching deny patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "**", access: "read" }],
						deny: [{ path: "**/.env*", access: "read" }],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceFileAccess("src/.env", "read")
			).toThrow(ScopeViolation);
			expect(() =>
				enforcer.enforceFileAccess(".env.local", "read")
			).toThrow(ScopeViolation);
		});

		it("respects read vs write access levels", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "src/**", access: "read" }],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceFileAccess("src/test.ts", "read")
			).not.toThrow();
			expect(() =>
				enforcer.enforceFileAccess("src/test.ts", "write")
			).toThrow(ScopeViolation);
		});

		it("can be disabled via config", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "src/**", access: "read" }],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile, {
				scope: false,
				tool: true,
				epistemic: true,
				style: true,
				audit: true,
			});

			// Should not throw even though not in allow list
			expect(() =>
				enforcer.enforceFileAccess("forbidden/file.ts", "read")
			).not.toThrow();
		});
	});

	describe("Scope Guardrails — Network Access", () => {
		it("allows network access when no scope guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceNetworkAccess("api.github.com")
			).not.toThrow();
		});

		it("allows network access matching allow patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					network: {
						allow: ["api.github.com", "*.npmjs.org"],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceNetworkAccess("api.github.com")
			).not.toThrow();
			expect(() =>
				enforcer.enforceNetworkAccess("registry.npmjs.org")
			).not.toThrow();
		});

		it("denies network access not in allow list", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					network: {
						allow: ["api.github.com"],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceNetworkAccess("evil.com")
			).toThrow(ScopeViolation);
		});

		it("denies network access matching deny patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					network: {
						allow: ["*"],
						deny: ["*.malicious.com"],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceNetworkAccess("api.malicious.com")
			).toThrow(ScopeViolation);
		});
	});

	describe("Scope Guardrails — Environment Variables", () => {
		it("allows env var access when no scope guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() => enforcer.enforceEnvAccess("NODE_ENV")).not.toThrow();
		});

		it("allows env var access matching allow patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					env: {
						allow: ["NODE_ENV", "CI", "PATH"],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceEnvAccess("NODE_ENV")).not.toThrow();
			expect(() => enforcer.enforceEnvAccess("CI")).not.toThrow();
		});

		it("denies env var access not in allow list", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					env: {
						allow: ["NODE_ENV"],
						deny: [],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceEnvAccess("SECRET_TOKEN")).toThrow(
				ScopeViolation
			);
		});

		it("denies env var access matching deny patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-scope",
				version: "1.0.0",
				scope: {
					env: {
						allow: ["*"],
						deny: ["*_SECRET", "*_TOKEN", "*_KEY"],
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceEnvAccess("API_SECRET")).toThrow(
				ScopeViolation
			);
			expect(() => enforcer.enforceEnvAccess("GITHUB_TOKEN")).toThrow(
				ScopeViolation
			);
			expect(() => enforcer.enforceEnvAccess("AWS_KEY")).toThrow(
				ScopeViolation
			);
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Tool Guardrail Tests
	// ═════════════════════════════════════════════════════════════════════════

	describe("Tool Guardrails", () => {
		it("allows tool invocation when no tool guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceToolInvocation("git", ["status"])
			).not.toThrow();
		});

		it("allows tool invocation matching allow list", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [
						{ name: "git", allowedArgs: ["status", "diff", "log"] },
						{ name: "npm", allowedArgs: ["run", "test", "build"] },
					],
					deny: [],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceToolInvocation("git", ["status"])
			).not.toThrow();
			expect(() =>
				enforcer.enforceToolInvocation("npm", ["run", "test"])
			).not.toThrow();
		});

		it("denies tool not in allow list", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [{ name: "git", allowedArgs: [] }],
					deny: [],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceToolInvocation("rm", ["-rf"])).toThrow(
				ToolViolation
			);
		});

		it("denies tool invocation with disallowed args", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [{ name: "git", allowedArgs: ["status", "diff"] }],
					deny: [],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceToolInvocation("git", ["push"])
			).toThrow(ToolViolation);
		});

		it("denies tool in deny list", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [{ name: "*", allowedArgs: [] }],
					deny: [{ name: "rm", allowedArgs: [], deniedArgs: [] }],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceToolInvocation("rm", [])).toThrow(
				ToolViolation
			);
		});

		it("denies tool invocation with denied args", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [{ name: "rm", allowedArgs: [] }],
					deny: [{ name: "rm", allowedArgs: [], deniedArgs: ["-rf", "--force"] }],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceToolInvocation("rm", ["-rf"])).toThrow(
				ToolViolation
			);
		});

		it("enforces max invocation limits", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [{ name: "git", allowedArgs: [], maxInvocations: 2 }],
					deny: [],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceToolInvocation("git", ["status"])
			).not.toThrow();
			expect(() =>
				enforcer.enforceToolInvocation("git", ["diff"])
			).not.toThrow();
			expect(() => enforcer.enforceToolInvocation("git", ["log"])).toThrow(
				ToolViolation
			);
		});

		it("can be disabled via config", () => {
			const profile: GuardrailProfile = {
				name: "test-tool",
				version: "1.0.0",
				tool: {
					allow: [{ name: "git", allowedArgs: [] }],
					deny: [],
					requireConfirmation: [],
				},
			};

			const enforcer = createGuardrailEnforcer(profile, {
				scope: true,
				tool: false,
				epistemic: true,
				style: true,
				audit: true,
			});

			// Should not throw even though not in allow list
			expect(() => enforcer.enforceToolInvocation("rm", ["-rf"])).not.toThrow();
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Epistemic Guardrail Tests
	// ═════════════════════════════════════════════════════════════════════════

	describe("Epistemic Guardrails — Uncertainty", () => {
		it("allows when no epistemic guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceUncertaintyThreshold(0.1, "test context")
			).not.toThrow();
		});

		it("continues when confidence above threshold", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					uncertaintyHandling: {
						level: 0.5,
						action: "halt",
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceUncertaintyThreshold(0.8, "test context")
			).not.toThrow();
		});

		it("halts when confidence below threshold and action is halt", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					uncertaintyHandling: {
						level: 0.7,
						action: "halt",
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceUncertaintyThreshold(0.3, "test context")
			).toThrow(EpistemicViolation);
		});

		it("escalates when confidence below threshold and action is escalate", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					uncertaintyHandling: {
						level: 0.7,
						action: "escalate",
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceUncertaintyThreshold(0.3, "test context")
			).toThrow(EpistemicViolation);
		});

		it("warns but continues when action is warn", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					uncertaintyHandling: {
						level: 0.7,
						action: "warn",
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			// Should warn but not throw
			expect(() =>
				enforcer.enforceUncertaintyThreshold(0.3, "test context")
			).not.toThrow();
		});
	});

	describe("Epistemic Guardrails — Assumptions", () => {
		it("allows when no allowed assumptions defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceAllowedAssumptions("any assumption")
			).not.toThrow();
		});

		it("allows matching assumptions", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					allowedAssumptions: [
						"standard TypeScript project",
						"npm as package manager",
					],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceAllowedAssumptions(
					"This is a standard TypeScript project"
				)
			).not.toThrow();
		});

		it("denies non-matching assumptions", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					allowedAssumptions: ["standard TypeScript project"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceAllowedAssumptions("using Python")
			).toThrow(EpistemicViolation);
		});
	});

	describe("Epistemic Guardrails — Citations", () => {
		it("allows when citation not required", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceCitationRequirement("some claim", false)
			).not.toThrow();
		});

		it("allows when citation provided and required", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					requireSourceCitation: true,
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceCitationRequirement("some claim", true)
			).not.toThrow();
		});

		it("denies when citation missing and required", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					requireSourceCitation: true,
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceCitationRequirement("some claim", false)
			).toThrow(EpistemicViolation);
		});

		it("can be disabled via config", () => {
			const profile: GuardrailProfile = {
				name: "test-epist",
				version: "1.0.0",
				epist: {
					requireSourceCitation: true,
				},
			};

			const enforcer = createGuardrailEnforcer(profile, {
				scope: true,
				tool: true,
				epistemic: false,
				style: true,
				audit: true,
			});

			// Should not throw even though citation is missing
			expect(() =>
				enforcer.enforceCitationRequirement("some claim", false)
			).not.toThrow();
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Style Guardrail Tests
	// ═════════════════════════════════════════════════════════════════════════

	describe("Style Guardrails — Output Format", () => {
		it("allows when no style guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceOutputFormat("any output", "text")
			).not.toThrow();
		});

		it("allows output within max length", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					outputFormat: {
						type: "text",
						maxLength: 100,
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceOutputFormat("short text", "text")
			).not.toThrow();
		});

		it("denies output exceeding max length", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					outputFormat: {
						type: "text",
						maxLength: 10,
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceOutputFormat(
					"this is a very long output that exceeds the limit",
					"text"
				)
			).toThrow(StyleViolation);
		});

		it("denies mismatched output type", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					outputFormat: {
						type: "json",
					},
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceOutputFormat("plain text", "text")
			).toThrow(StyleViolation);
		});
	});

	describe("Style Guardrails — Prohibited Patterns", () => {
		it("allows when no prohibited patterns defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceProhibitedPatterns("TODO: fix this")
			).not.toThrow();
		});

		it("allows output without prohibited patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					prohibitedPatterns: ["TODO", "FIXME", "HACK"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceProhibitedPatterns("clean code here")
			).not.toThrow();
		});

		it("denies output with prohibited patterns", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					prohibitedPatterns: ["TODO", "FIXME"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceProhibitedPatterns("TODO: fix this later")
			).toThrow(StyleViolation);
			expect(() =>
				enforcer.enforceProhibitedPatterns("FIXME: broken code")
			).toThrow(StyleViolation);
		});
	});

	describe("Style Guardrails — Required Sections", () => {
		it("allows when no required sections defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceRequiredSections("output", ["intro"])
			).not.toThrow();
		});

		it("allows output with all required sections", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					requiredSections: ["summary", "changes", "testing"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceRequiredSections("output", [
					"summary",
					"changes",
					"testing",
					"extra",
				])
			).not.toThrow();
		});

		it("denies output missing required sections", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					requiredSections: ["summary", "changes", "testing"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceRequiredSections("output", ["summary", "changes"])
			).toThrow(StyleViolation);
		});

		it("can be disabled via config", () => {
			const profile: GuardrailProfile = {
				name: "test-style",
				version: "1.0.0",
				style: {
					requiredSections: ["summary"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile, {
				scope: true,
				tool: true,
				epistemic: true,
				style: false,
				audit: true,
			});

			// Should not throw even though section is missing
			expect(() =>
				enforcer.enforceRequiredSections("output", [])
			).not.toThrow();
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Audit Guardrail Tests
	// ═════════════════════════════════════════════════════════════════════════

	describe("Audit Guardrails — Log Level", () => {
		it("allows when no audit guardrails defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() => enforcer.enforceLogLevel("debug")).not.toThrow();
		});

		it("allows log level meeting minimum", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					logLevel: "info",
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceLogLevel("info")).not.toThrow();
			expect(() => enforcer.enforceLogLevel("warn")).not.toThrow();
			expect(() => enforcer.enforceLogLevel("error")).not.toThrow();
		});

		it("denies log level below minimum", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					logLevel: "warn",
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() => enforcer.enforceLogLevel("debug")).toThrow(
				AuditViolation
			);
			expect(() => enforcer.enforceLogLevel("info")).toThrow(AuditViolation);
		});
	});

	describe("Audit Guardrails — Frame Requirements", () => {
		it("allows when no frame requirements defined", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", [])
			).not.toThrow();
		});

		it("allows frame with all required fields", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					frames: [
						{
							trigger: "on-complete",
							requiredFields: ["summary_caption", "status_snapshot"],
						},
					],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", [
					"summary_caption",
					"status_snapshot",
					"extra_field",
				])
			).not.toThrow();
		});

		it("denies frame missing required fields", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					frames: [
						{
							trigger: "on-complete",
							requiredFields: ["summary_caption", "status_snapshot"],
						},
					],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", ["summary_caption"])
			).toThrow(AuditViolation);
		});

		it("checks appropriate trigger type", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					frames: [
						{
							trigger: "on-start",
							requiredFields: ["reference_point"],
						},
						{
							trigger: "on-complete",
							requiredFields: ["summary_caption"],
						},
					],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			// on-start requires reference_point
			expect(() =>
				enforcer.enforceFrameRequirements("on-start", ["reference_point"])
			).not.toThrow();

			// on-complete requires summary_caption (reference_point not required)
			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", ["reference_point"])
			).toThrow(AuditViolation);
		});

		it("can be disabled via config", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					frames: [
						{
							trigger: "on-complete",
							requiredFields: ["summary_caption"],
						},
					],
				},
			};

			const enforcer = createGuardrailEnforcer(profile, {
				scope: true,
				tool: true,
				epistemic: true,
				style: true,
				audit: false,
			});

			// Should not throw even though field is missing
			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", [])
			).not.toThrow();
		});
	});

	describe("Audit Guardrails — Sensitive Fields", () => {
		it("identifies sensitive fields", () => {
			const profile: GuardrailProfile = {
				name: "test-audit",
				version: "1.0.0",
				audit: {
					sensitiveFields: ["api_key", "token", "password", "*_secret"],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(enforcer.isSensitiveField("api_key")).toBe(true);
			expect(enforcer.isSensitiveField("token")).toBe(true);
			expect(enforcer.isSensitiveField("github_secret")).toBe(true);
			expect(enforcer.isSensitiveField("username")).toBe(false);
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Integration Tests
	// ═════════════════════════════════════════════════════════════════════════

	describe("Complete Profile Enforcement", () => {
		it("enforces all guardrail types together", () => {
			const profile: GuardrailProfile = {
				name: "comprehensive-profile",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "src/**", access: "read" }],
						deny: [],
					},
				},
				tool: {
					allow: [{ name: "git", allowedArgs: ["status"] }],
					deny: [],
					requireConfirmation: [],
				},
				epist: {
					requireSourceCitation: true,
				},
				style: {
					prohibitedPatterns: ["TODO"],
				},
				audit: {
					frames: [
						{
							trigger: "on-complete",
							requiredFields: ["summary_caption"],
						},
					],
				},
			};

			const enforcer = createGuardrailEnforcer(profile);

			// Scope enforcement works
			expect(() =>
				enforcer.enforceFileAccess("src/test.ts", "read")
			).not.toThrow();
			expect(() =>
				enforcer.enforceFileAccess("forbidden/file.ts", "read")
			).toThrow(ScopeViolation);

			// Tool enforcement works
			expect(() =>
				enforcer.enforceToolInvocation("git", ["status"])
			).not.toThrow();
			expect(() =>
				enforcer.enforceToolInvocation("npm", ["install"])
			).toThrow(ToolViolation);

			// Epistemic enforcement works
			expect(() =>
				enforcer.enforceCitationRequirement("claim", true)
			).not.toThrow();
			expect(() =>
				enforcer.enforceCitationRequirement("claim", false)
			).toThrow(EpistemicViolation);

			// Style enforcement works
			expect(() =>
				enforcer.enforceProhibitedPatterns("clean output")
			).not.toThrow();
			expect(() =>
				enforcer.enforceProhibitedPatterns("TODO: fix this")
			).toThrow(StyleViolation);

			// Audit enforcement works
			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", ["summary_caption"])
			).not.toThrow();
			expect(() =>
				enforcer.enforceFrameRequirements("on-complete", [])
			).toThrow(AuditViolation);
		});

		it("allows selective disabling of guardrails", () => {
			const profile: GuardrailProfile = {
				name: "selective-profile",
				version: "1.0.0",
				scope: {
					files: {
						allow: [{ path: "src/**", access: "read" }],
						deny: [],
					},
				},
				tool: {
					allow: [{ name: "git", allowedArgs: [] }],
					deny: [],
					requireConfirmation: [],
				},
				epist: {
					requireSourceCitation: true,
				},
			};

			const enforcer = createGuardrailEnforcer(profile, {
				scope: true,
				tool: false, // Tool enforcement disabled
				epistemic: true,
				style: true,
				audit: true,
			});

			// Scope enforcement still active
			expect(() =>
				enforcer.enforceFileAccess("forbidden/file.ts", "read")
			).toThrow(ScopeViolation);

			// Tool enforcement disabled - no errors
			expect(() =>
				enforcer.enforceToolInvocation("rm", ["-rf"])
			).not.toThrow();

			// Epistemic enforcement still active
			expect(() =>
				enforcer.enforceCitationRequirement("claim", false)
			).toThrow(EpistemicViolation);
		});
	});

	describe("GuardrailEnforcer API", () => {
		it("provides access to config", () => {
			const config = {
				scope: true,
				tool: false,
				epistemic: true,
				style: false,
				audit: true,
			};

			const enforcer = createGuardrailEnforcer(undefined, config);

			expect(enforcer.getConfig()).toEqual(config);
		});

		it("provides access to profile", () => {
			const profile: GuardrailProfile = {
				name: "test",
				version: "1.0.0",
			};

			const enforcer = createGuardrailEnforcer(profile);

			expect(enforcer.getProfile()).toEqual(profile);
		});

		it("uses default config when not provided", () => {
			const enforcer = createGuardrailEnforcer(undefined);

			expect(enforcer.getConfig()).toEqual(DEFAULT_ENFORCEMENT_CONFIG);
		});
	});
});
