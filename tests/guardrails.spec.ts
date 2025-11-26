import { describe, it, expect } from "vitest";
import {
	G_scopeSchema,
	G_toolSchema,
	G_epistSchema,
	G_styleSchema,
	G_auditSchema,
	GuardrailProfileSchema,
	validateGuardrailProfile,
	safeValidateGuardrailProfile,
	validateG_scope,
	validateG_tool,
	validateG_epist,
	validateG_style,
	validateG_audit,
} from "../src/types/guardrails.js";

// ─────────────────────────────────────────────────────────────────────────────
// G_scope Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("G_scope — Access Boundaries", () => {
	it("validates empty scope", () => {
		const result = G_scopeSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("validates file access patterns", () => {
		const scope = {
			files: {
				allow: [{ path: "src/**/*.ts", access: "read" }],
				deny: [{ path: "**/.env*", access: "read" }],
			},
		};

		const result = G_scopeSchema.safeParse(scope);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.files?.allow).toHaveLength(1);
			expect(result.data.files?.deny).toHaveLength(1);
		}
	});

	it("validates network access", () => {
		const scope = {
			network: {
				allow: ["api.github.com", "*.npmjs.org"],
				deny: ["*"],
			},
		};

		const result = G_scopeSchema.safeParse(scope);
		expect(result.success).toBe(true);
	});

	it("validates environment variable access", () => {
		const scope = {
			env: {
				allow: ["NODE_ENV", "CI", "PATH"],
				deny: ["*_SECRET", "*_TOKEN", "*_KEY"],
			},
		};

		const result = G_scopeSchema.safeParse(scope);
		expect(result.success).toBe(true);
	});

	it("validates combined scope", () => {
		const scope = {
			files: {
				allow: [
					{ path: "src/**", access: "read" },
					{ path: "tests/**", access: "write" },
				],
				deny: [{ path: "**/node_modules/**", access: "read" }],
			},
			network: {
				allow: ["localhost:*"],
				deny: [],
			},
			env: {
				allow: ["NODE_ENV"],
				deny: [],
			},
		};

		const result = G_scopeSchema.safeParse(scope);
		expect(result.success).toBe(true);
	});

	it("rejects invalid access type", () => {
		const scope = {
			files: {
				allow: [{ path: "src/**", access: "execute" }], // invalid access type
			},
		};

		const result = G_scopeSchema.safeParse(scope);
		expect(result.success).toBe(false);
	});

	it("rejects empty path", () => {
		const scope = {
			files: {
				allow: [{ path: "", access: "read" }],
			},
		};

		const result = G_scopeSchema.safeParse(scope);
		expect(result.success).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// G_tool Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("G_tool — Tool Invocation Boundaries", () => {
	it("validates empty tool guardrail", () => {
		const result = G_toolSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("validates allowed tools with constraints", () => {
		const tool = {
			allow: [
				{ name: "npm", allowedArgs: ["run", "test", "build"] },
				{ name: "git", allowedArgs: ["status", "diff", "log"] },
			],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.allow).toHaveLength(2);
		}
	});

	it("validates denied tools", () => {
		const tool = {
			deny: [
				{ name: "rm", deniedArgs: ["-rf", "--force"] },
				{ name: "curl" },
				{ name: "wget" },
			],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(true);
	});

	it("validates maxInvocations", () => {
		const tool = {
			allow: [{ name: "git", maxInvocations: 100 }],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.allow[0].maxInvocations).toBe(100);
		}
	});

	it("validates requireConfirmation list", () => {
		const tool = {
			allow: [{ name: "git" }, { name: "npm" }],
			requireConfirmation: ["git push", "npm publish", "git commit --amend"],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.requireConfirmation).toHaveLength(3);
		}
	});

	it("rejects empty tool name", () => {
		const tool = {
			allow: [{ name: "" }],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(false);
	});

	it("rejects non-positive maxInvocations", () => {
		const tool = {
			allow: [{ name: "git", maxInvocations: 0 }],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(false);
	});

	it("rejects negative maxInvocations", () => {
		const tool = {
			allow: [{ name: "git", maxInvocations: -5 }],
		};

		const result = G_toolSchema.safeParse(tool);
		expect(result.success).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// G_epist Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("G_epist — Epistemic Guardrail", () => {
	it("validates empty epistemic guardrail", () => {
		const result = G_epistSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.prohibitHallucination).toBe(true); // default
		}
	});

	it("validates source citation requirement", () => {
		const epist = {
			requireSourceCitation: true,
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(true);
	});

	it("validates uncertainty handling", () => {
		const epist = {
			uncertaintyHandling: {
				level: 0.5,
				action: "escalate",
			},
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.uncertaintyHandling?.level).toBe(0.5);
			expect(result.data.uncertaintyHandling?.action).toBe("escalate");
		}
	});

	it("validates all uncertainty actions", () => {
		const actions = ["continue", "warn", "escalate", "halt"] as const;

		for (const action of actions) {
			const epist = {
				uncertaintyHandling: { level: 0.3, action },
			};

			const result = G_epistSchema.safeParse(epist);
			expect(result.success).toBe(true);
		}
	});

	it("validates allowed assumptions", () => {
		const epist = {
			allowedAssumptions: [
				"standard TypeScript project structure",
				"npm as package manager",
				"ES modules",
			],
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.allowedAssumptions).toHaveLength(3);
		}
	});

	it("validates complete epistemic guardrail", () => {
		const epist = {
			requireSourceCitation: true,
			uncertaintyHandling: {
				level: 0.7,
				action: "warn",
			},
			prohibitHallucination: true,
			allowedAssumptions: ["TypeScript 5.x"],
			requireExplicitUncertainty: true,
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(true);
	});

	it("rejects uncertainty level below 0", () => {
		const epist = {
			uncertaintyHandling: {
				level: -0.1,
				action: "halt",
			},
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(false);
	});

	it("rejects uncertainty level above 1", () => {
		const epist = {
			uncertaintyHandling: {
				level: 1.5,
				action: "halt",
			},
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(false);
	});

	it("rejects invalid uncertainty action", () => {
		const epist = {
			uncertaintyHandling: {
				level: 0.5,
				action: "panic",
			},
		};

		const result = G_epistSchema.safeParse(epist);
		expect(result.success).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// G_style Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("G_style — Output Format Guardrail", () => {
	it("validates empty style guardrail", () => {
		const result = G_styleSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.language).toBe("en-US"); // default
		}
	});

	it("validates output format", () => {
		const style = {
			outputFormat: {
				type: "json",
				schema: "gate-result",
			},
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(true);
	});

	it("validates all output format types", () => {
		const types = ["text", "json", "yaml", "markdown", "code"] as const;

		for (const type of types) {
			const style = {
				outputFormat: { type },
			};

			const result = G_styleSchema.safeParse(style);
			expect(result.success).toBe(true);
		}
	});

	it("validates output format with maxLength", () => {
		const style = {
			outputFormat: {
				type: "text",
				maxLength: 10000,
			},
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(true);
	});

	it("validates code style constraints", () => {
		const style = {
			codeStyle: {
				indentation: "tabs",
				lineLength: 100,
				conventions: ["no-console", "prefer-const", "strict-null-checks"],
			},
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(true);
	});

	it("validates prohibited patterns", () => {
		const style = {
			prohibitedPatterns: ["TODO", "FIXME", "HACK", "XXX"],
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(true);
	});

	it("validates required sections", () => {
		const style = {
			requiredSections: ["summary", "changes", "testing", "rollback"],
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(true);
	});

	it("validates complete style guardrail", () => {
		const style = {
			outputFormat: { type: "markdown" },
			language: "en-GB",
			codeStyle: {
				indentation: "spaces",
				lineLength: 120,
				conventions: ["prefer-arrow-functions"],
			},
			prohibitedPatterns: ["console.log"],
			requiredSections: ["summary"],
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(true);
	});

	it("rejects invalid output format type", () => {
		const style = {
			outputFormat: { type: "xml" },
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(false);
	});

	it("rejects invalid indentation", () => {
		const style = {
			codeStyle: { indentation: "mixed" },
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(false);
	});

	it("rejects non-positive lineLength", () => {
		const style = {
			codeStyle: { lineLength: 0 },
		};

		const result = G_styleSchema.safeParse(style);
		expect(result.success).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// G_audit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("G_audit — Audit and Logging Guardrail", () => {
	it("validates empty audit guardrail", () => {
		const result = G_auditSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.logLevel).toBe("info"); // default
			expect(result.data.captureInputs).toBe(true); // default
			expect(result.data.captureOutputs).toBe(true); // default
		}
	});

	it("validates log levels", () => {
		const levels = ["debug", "info", "warn", "error"] as const;

		for (const logLevel of levels) {
			const result = G_auditSchema.safeParse({ logLevel });
			expect(result.success).toBe(true);
		}
	});

	it("validates frame requirements", () => {
		const audit = {
			frames: [
				{ trigger: "on-start", requiredFields: ["reference_point"] },
				{ trigger: "on-complete", requiredFields: ["summary_caption", "status_snapshot"] },
				{ trigger: "on-error", requiredFields: ["error_message"] },
			],
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.frames).toHaveLength(3);
		}
	});

	it("validates all frame trigger types", () => {
		const triggers = ["on-start", "on-complete", "on-error", "on-milestone", "periodic"] as const;

		for (const trigger of triggers) {
			const audit = {
				frames: [{ trigger, requiredFields: [] }],
			};

			const result = G_auditSchema.safeParse(audit);
			expect(result.success).toBe(true);
		}
	});

	it("validates periodic frame with interval", () => {
		const audit = {
			frames: [
				{
					trigger: "periodic",
					intervalSeconds: 300, // every 5 minutes
					requiredFields: ["status_snapshot"],
				},
			],
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(true);
	});

	it("validates retention and sensitive fields", () => {
		const audit = {
			retentionDays: 90,
			sensitiveFields: ["api_key", "token", "password", "secret"],
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(true);
	});

	it("validates complete audit guardrail", () => {
		const audit = {
			logLevel: "debug",
			frames: [
				{ trigger: "on-start", requiredFields: ["reference_point"] },
				{ trigger: "on-complete", requiredFields: ["summary_caption"] },
			],
			captureInputs: true,
			captureOutputs: true,
			retentionDays: 365,
			sensitiveFields: ["api_key"],
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(true);
	});

	it("rejects invalid log level", () => {
		const audit = {
			logLevel: "trace",
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(false);
	});

	it("rejects invalid frame trigger", () => {
		const audit = {
			frames: [{ trigger: "on-crash", requiredFields: [] }],
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(false);
	});

	it("rejects non-positive retentionDays", () => {
		const audit = {
			retentionDays: 0,
		};

		const result = G_auditSchema.safeParse(audit);
		expect(result.success).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// GuardrailProfile Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GuardrailProfile — Composable Profile", () => {
	it("validates minimal profile", () => {
		const profile = {
			name: "test-profile",
			version: "1.0.0",
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
	});

	it("validates profile with description", () => {
		const profile = {
			name: "senior-dev-reviewer",
			version: "1.0.0",
			description: "Guardrails for senior developer code review",
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
	});

	it("validates profile with extends", () => {
		const profile = {
			name: "strict-reviewer",
			version: "1.0.0",
			extends: ["base-profile", "code-review-profile"],
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.extends).toHaveLength(2);
		}
	});

	it("validates complete profile with all guardrail types", () => {
		const profile = {
			name: "comprehensive-profile",
			version: "2.1.0",
			description: "A comprehensive guardrail profile",
			extends: ["base"],
			scope: {
				files: {
					allow: [{ path: "src/**", access: "read" }],
					deny: [{ path: "**/.env*", access: "read" }],
				},
				network: {
					allow: ["api.github.com"],
					deny: [],
				},
			},
			tool: {
				allow: [{ name: "git", allowedArgs: ["diff", "log", "show"] }],
				deny: [{ name: "rm" }],
				requireConfirmation: ["git push"],
			},
			epist: {
				prohibitHallucination: true,
				requireExplicitUncertainty: true,
				allowedAssumptions: ["TypeScript project"],
			},
			style: {
				outputFormat: { type: "markdown" },
				language: "en-US",
				requiredSections: ["summary"],
			},
			audit: {
				logLevel: "info",
				frames: [{ trigger: "on-complete", requiredFields: ["summary_caption"] }],
				captureInputs: true,
				captureOutputs: true,
			},
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
	});

	it("validates profile with only scope guardrail", () => {
		const profile = {
			name: "scope-only",
			version: "1.0.0",
			scope: {
				files: {
					allow: [{ path: "**", access: "read" }],
				},
			},
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
	});

	it("validates profile with only tool guardrail", () => {
		const profile = {
			name: "tool-only",
			version: "1.0.0",
			tool: {
				allow: [{ name: "npm" }, { name: "git" }],
			},
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
	});

	it("rejects empty name", () => {
		const profile = {
			name: "",
			version: "1.0.0",
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(false);
	});

	it("rejects invalid version format", () => {
		const invalidVersions = ["1.0", "v1.0.0", "1", "1.0.0-beta", "latest"];

		for (const version of invalidVersions) {
			const profile = {
				name: "test",
				version,
			};

			const result = GuardrailProfileSchema.safeParse(profile);
			expect(result.success).toBe(false);
		}
	});

	it("accepts valid semver versions", () => {
		const validVersions = ["0.0.1", "1.0.0", "2.3.4", "10.20.30"];

		for (const version of validVersions) {
			const profile = {
				name: "test",
				version,
			};

			const result = GuardrailProfileSchema.safeParse(profile);
			expect(result.success).toBe(true);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation Function Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Validation Functions", () => {
	describe("validateGuardrailProfile", () => {
		it("returns validated profile for valid input", () => {
			const profile = validateGuardrailProfile({
				name: "test",
				version: "1.0.0",
			});

			expect(profile.name).toBe("test");
			expect(profile.version).toBe("1.0.0");
		});

		it("throws on invalid input", () => {
			expect(() =>
				validateGuardrailProfile({
					name: "",
					version: "invalid",
				})
			).toThrow();
		});
	});

	describe("safeValidateGuardrailProfile", () => {
		it("returns success for valid input", () => {
			const result = safeValidateGuardrailProfile({
				name: "test",
				version: "1.0.0",
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe("test");
			}
		});

		it("returns error for invalid input", () => {
			const result = safeValidateGuardrailProfile({
				name: "",
				version: "invalid",
			});

			expect(result.success).toBe(false);
		});
	});

	describe("Individual guardrail validators", () => {
		it("validateG_scope works", () => {
			const scope = validateG_scope({
				files: { allow: [{ path: "src/**", access: "read" }] },
			});
			expect(scope.files?.allow).toHaveLength(1);
		});

		it("validateG_tool works", () => {
			const tool = validateG_tool({
				allow: [{ name: "git" }],
			});
			expect(tool.allow).toHaveLength(1);
		});

		it("validateG_epist works", () => {
			const epist = validateG_epist({
				prohibitHallucination: true,
			});
			expect(epist.prohibitHallucination).toBe(true);
		});

		it("validateG_style works", () => {
			const style = validateG_style({
				language: "en-GB",
			});
			expect(style.language).toBe("en-GB");
		});

		it("validateG_audit works", () => {
			const audit = validateG_audit({
				logLevel: "debug",
			});
			expect(audit.logLevel).toBe("debug");
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Composability Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Profile Composability", () => {
	it("profiles can be combined by spreading", () => {
		const baseScope: { scope: { files: { allow: { path: string; access: "read" | "write" }[] } } } = {
			scope: {
				files: {
					allow: [{ path: "src/**", access: "read" }],
				},
			},
		};

		const baseTool: { tool: { allow: { name: string }[] } } = {
			tool: {
				allow: [{ name: "git" }],
			},
		};

		const combined = {
			name: "combined",
			version: "1.0.0",
			...baseScope,
			...baseTool,
		};

		const result = GuardrailProfileSchema.safeParse(combined);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.scope?.files?.allow).toHaveLength(1);
			expect(result.data.tool?.allow).toHaveLength(1);
		}
	});

	it("profiles support inheritance via extends field", () => {
		const profile = {
			name: "extended-profile",
			version: "1.0.0",
			extends: ["base-profile", "strict-profile", "audit-profile"],
			// Override specific settings
			epist: {
				prohibitHallucination: true,
			},
		};

		const result = GuardrailProfileSchema.safeParse(profile);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.extends).toEqual(["base-profile", "strict-profile", "audit-profile"]);
		}
	});
});
