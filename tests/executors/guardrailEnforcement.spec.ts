import { describe, it, expect } from "vitest";
import {
	matchesAccessPattern,
	checkFileAccess,
	checkNetworkAccess,
	checkEnvAccess,
	enforceGuardrail,
} from "../../src/executors/guardrailEnforcement.js";
import type {
	GuardrailProfile,
	G_scope,
	AccessPattern,
} from "../../src/types/guardrails.js";

describe("guardrailEnforcement", () => {
	describe("matchesAccessPattern", () => {
		it("matches exact file paths", () => {
			const pattern: AccessPattern = {
				path: "src/index.ts",
				access: "read",
			};
			expect(matchesAccessPattern("src/index.ts", pattern)).toBe(true);
			expect(matchesAccessPattern("src/other.ts", pattern)).toBe(false);
		});

		it("matches glob patterns", () => {
			const pattern: AccessPattern = {
				path: "src/**/*.ts",
				access: "read",
			};
			expect(matchesAccessPattern("src/index.ts", pattern)).toBe(true);
			expect(matchesAccessPattern("src/utils/helper.ts", pattern)).toBe(true);
			expect(matchesAccessPattern("tests/index.ts", pattern)).toBe(false);
		});

		it("matches wildcard patterns", () => {
			const pattern: AccessPattern = {
				path: "*.js",
				access: "read",
			};
			expect(matchesAccessPattern("index.js", pattern)).toBe(true);
			expect(matchesAccessPattern("index.ts", pattern)).toBe(false);
		});
	});

	describe("checkFileAccess", () => {
		it("allows access when no scope defined", () => {
			const result = checkFileAccess("src/index.ts", "read", undefined);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("allows access when no file restrictions", () => {
			const scope: G_scope = {};
			const result = checkFileAccess("src/index.ts", "read", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("denies access matching deny pattern", () => {
			const scope: G_scope = {
				files: {
					allow: [],
					deny: [{ path: "**/.env*", access: "read" }],
				},
			};
			const result = checkFileAccess(".env.local", "read", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].guardrailType).toBe("scope");
			expect(result.violations[0].constraint).toBe("files.deny");
			expect(result.blockingViolation).toBeDefined();
		});

		it("allows access not matching deny pattern", () => {
			const scope: G_scope = {
				files: {
					allow: [],
					deny: [{ path: "**/.env*", access: "read" }],
				},
			};
			const result = checkFileAccess("src/index.ts", "read", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("denies access when not matching allow pattern", () => {
			const scope: G_scope = {
				files: {
					allow: [{ path: "src/**/*.ts", access: "read" }],
					deny: [],
				},
			};
			const result = checkFileAccess("tests/index.ts", "read", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].constraint).toBe("files.allow");
		});

		it("allows access matching allow pattern", () => {
			const scope: G_scope = {
				files: {
					allow: [{ path: "src/**/*.ts", access: "read" }],
					deny: [],
				},
			};
			const result = checkFileAccess("src/index.ts", "read", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("deny takes precedence over allow", () => {
			const scope: G_scope = {
				files: {
					allow: [{ path: "**/*.ts", access: "read" }],
					deny: [{ path: "**/*.env.ts", access: "read" }],
				},
			};
			const result = checkFileAccess("config.env.ts", "read", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].constraint).toBe("files.deny");
		});

		it("respects access type (read vs write)", () => {
			const scope: G_scope = {
				files: {
					allow: [{ path: "src/**", access: "read" }],
					deny: [],
				},
			};
			const readResult = checkFileAccess("src/index.ts", "read", scope);
			expect(readResult.allowed).toBe(true);

			const writeResult = checkFileAccess("src/index.ts", "write", scope);
			expect(writeResult.allowed).toBe(false);
		});

		it("allows multiple allowed patterns", () => {
			const scope: G_scope = {
				files: {
					allow: [
						{ path: "src/**", access: "read" },
						{ path: "tests/**", access: "read" },
					],
					deny: [],
				},
			};
			expect(checkFileAccess("src/index.ts", "read", scope).allowed).toBe(true);
			expect(checkFileAccess("tests/test.ts", "read", scope).allowed).toBe(true);
			expect(checkFileAccess("docs/README.md", "read", scope).allowed).toBe(
				false
			);
		});
	});

	describe("checkNetworkAccess", () => {
		it("allows access when no scope defined", () => {
			const result = checkNetworkAccess("api.github.com", undefined);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("allows access when no network restrictions", () => {
			const scope: G_scope = {};
			const result = checkNetworkAccess("api.github.com", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("denies access matching deny pattern", () => {
			const scope: G_scope = {
				network: {
					allow: [],
					deny: ["*.malicious.com"],
				},
			};
			const result = checkNetworkAccess("api.malicious.com", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].constraint).toBe("network.deny");
		});

		it("allows access not matching deny pattern", () => {
			const scope: G_scope = {
				network: {
					allow: [],
					deny: ["*.malicious.com"],
				},
			};
			const result = checkNetworkAccess("api.github.com", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("denies access when not matching allow pattern", () => {
			const scope: G_scope = {
				network: {
					allow: ["api.github.com", "*.npmjs.org"],
					deny: [],
				},
			};
			const result = checkNetworkAccess("api.malicious.com", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].constraint).toBe("network.allow");
		});

		it("allows access matching allow pattern", () => {
			const scope: G_scope = {
				network: {
					allow: ["api.github.com", "*.npmjs.org"],
					deny: [],
				},
			};
			expect(checkNetworkAccess("api.github.com", scope).allowed).toBe(true);
			expect(checkNetworkAccess("registry.npmjs.org", scope).allowed).toBe(
				true
			);
		});

		it("deny takes precedence over allow", () => {
			const scope: G_scope = {
				network: {
					allow: ["*.github.com"],
					deny: ["api.github.com"],
				},
			};
			const result = checkNetworkAccess("api.github.com", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations[0].constraint).toBe("network.deny");
		});
	});

	describe("checkEnvAccess", () => {
		it("allows access when no scope defined", () => {
			const result = checkEnvAccess("NODE_ENV", undefined);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("allows access when no env restrictions", () => {
			const scope: G_scope = {};
			const result = checkEnvAccess("NODE_ENV", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("denies access matching deny pattern", () => {
			const scope: G_scope = {
				env: {
					allow: [],
					deny: ["*_SECRET", "*_TOKEN"],
				},
			};
			const result = checkEnvAccess("API_SECRET", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].constraint).toBe("env.deny");
		});

		it("allows access not matching deny pattern", () => {
			const scope: G_scope = {
				env: {
					allow: [],
					deny: ["*_SECRET"],
				},
			};
			const result = checkEnvAccess("NODE_ENV", scope);
			expect(result.allowed).toBe(true);
			expect(result.violations).toHaveLength(0);
		});

		it("denies access when not matching allow pattern", () => {
			const scope: G_scope = {
				env: {
					allow: ["NODE_ENV", "CI"],
					deny: [],
				},
			};
			const result = checkEnvAccess("API_KEY", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations).toHaveLength(1);
			expect(result.violations[0].constraint).toBe("env.allow");
		});

		it("allows access matching allow pattern", () => {
			const scope: G_scope = {
				env: {
					allow: ["NODE_ENV", "CI", "PATH"],
					deny: [],
				},
			};
			expect(checkEnvAccess("NODE_ENV", scope).allowed).toBe(true);
			expect(checkEnvAccess("CI", scope).allowed).toBe(true);
			expect(checkEnvAccess("PATH", scope).allowed).toBe(true);
		});

		it("deny takes precedence over allow", () => {
			const scope: G_scope = {
				env: {
					allow: ["*"],
					deny: ["*_SECRET"],
				},
			};
			const result = checkEnvAccess("API_SECRET", scope);
			expect(result.allowed).toBe(false);
			expect(result.violations[0].constraint).toBe("env.deny");
		});
	});

	describe("enforceGuardrail", () => {
		const profile: GuardrailProfile = {
			name: "test-profile",
			version: "1.0.0",
			scope: {
				files: {
					allow: [{ path: "src/**", access: "read" }],
					deny: [{ path: "**/.env*", access: "read" }],
				},
				network: {
					allow: ["api.github.com"],
					deny: [],
				},
				env: {
					allow: ["NODE_ENV", "CI"],
					deny: ["*_SECRET"],
				},
			},
		};

		it("enforces file access guardrails", () => {
			const allowedResult = enforceGuardrail(profile, {
				type: "file_access",
				target: "src/index.ts",
				accessType: "read",
			});
			expect(allowedResult.allowed).toBe(true);

			const deniedResult = enforceGuardrail(profile, {
				type: "file_access",
				target: ".env.local",
				accessType: "read",
			});
			expect(deniedResult.allowed).toBe(false);
		});

		it("enforces network access guardrails", () => {
			const allowedResult = enforceGuardrail(profile, {
				type: "network_access",
				target: "api.github.com",
			});
			expect(allowedResult.allowed).toBe(true);

			const deniedResult = enforceGuardrail(profile, {
				type: "network_access",
				target: "api.malicious.com",
			});
			expect(deniedResult.allowed).toBe(false);
		});

		it("enforces environment variable access guardrails", () => {
			const allowedResult = enforceGuardrail(profile, {
				type: "env_access",
				target: "NODE_ENV",
			});
			expect(allowedResult.allowed).toBe(true);

			const deniedResult = enforceGuardrail(profile, {
				type: "env_access",
				target: "API_SECRET",
			});
			expect(deniedResult.allowed).toBe(false);
		});

		it("throws error when accessType missing for file_access", () => {
			expect(() =>
				enforceGuardrail(profile, {
					type: "file_access",
					target: "src/index.ts",
				})
			).toThrow("accessType required for file_access action");
		});
	});

	describe("violation details", () => {
		it("includes timestamp in violations", () => {
			const scope: G_scope = {
				files: {
					deny: [{ path: "**/.env*", access: "read" }],
				},
			};
			const result = checkFileAccess(".env", "read", scope);
			expect(result.violations[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("includes context in violations", () => {
			const scope: G_scope = {
				files: {
					deny: [{ path: "**/.env*", access: "read" }],
				},
			};
			const result = checkFileAccess(".env", "read", scope);
			expect(result.violations[0].context).toEqual({
				filePath: ".env",
				accessType: "read",
				pattern: "**/.env*",
			});
		});

		it("includes message in violations", () => {
			const scope: G_scope = {
				files: {
					deny: [{ path: "**/.env*", access: "read" }],
				},
			};
			const result = checkFileAccess(".env", "read", scope);
			expect(result.violations[0].message).toContain("File access denied");
			expect(result.violations[0].message).toContain(".env");
		});

		it("sets severity to error for violations", () => {
			const scope: G_scope = {
				files: {
					deny: [{ path: "**/.env*", access: "read" }],
				},
			};
			const result = checkFileAccess(".env", "read", scope);
			expect(result.violations[0].severity).toBe("error");
		});
	});
});
