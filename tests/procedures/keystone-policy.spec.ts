/**
 * Tests for Keystone Policy Schema and Loader Integration
 *
 * Validates keystone policy schema parsing and procedure integration.
 */

import { describe, it, expect } from "vitest";
import {
	KeystonePolicySchema,
	ProcedureDefinitionSchema,
	validateProcedureSchema,
	createProcedureLoader,
} from "../../src/procedures/index.js";

describe("KeystonePolicySchema", () => {
	describe("Schema Validation", () => {
		it("validates a complete keystone policy", () => {
			const policy = {
				maxPerWave: 2,
				ideal: 0,
				litmusTest: "Could this be split into fannable pieces? If yes, split it.",
				whenToUse: [
					"True cross-cutting concerns",
					"Hot-path fixes",
				],
				whenNotToUse: [
					"Single-PR issues",
					"Issues that could be done before/after wave",
				],
				risks: [
					"Bottleneck creep",
					"Less parallelism",
				],
				requiredDocumentation: [
					"Issue number in commit message",
					"Rationale for why not fanned out",
				],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.maxPerWave).toBe(2);
				expect(result.data.ideal).toBe(0);
				expect(result.data.litmusTest).toContain("split");
				expect(result.data.whenToUse).toHaveLength(2);
				expect(result.data.whenNotToUse).toHaveLength(2);
				expect(result.data.risks).toHaveLength(2);
				expect(result.data.requiredDocumentation).toHaveLength(2);
			}
		});

		it("applies default values for maxPerWave and ideal", () => {
			const policy = {
				litmusTest: "Test question",
				whenToUse: ["Valid use case"],
				whenNotToUse: ["Invalid use case"],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.maxPerWave).toBe(2);
				expect(result.data.ideal).toBe(0);
			}
		});

		it("allows requiredDocumentation to be optional", () => {
			const policy = {
				maxPerWave: 1,
				ideal: 0,
				litmusTest: "Test question",
				whenToUse: ["Valid use case"],
				whenNotToUse: ["Invalid use case"],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.requiredDocumentation).toBeUndefined();
			}
		});

		it("rejects missing litmusTest", () => {
			const policy = {
				maxPerWave: 2,
				ideal: 0,
				whenToUse: ["Valid use case"],
				whenNotToUse: ["Invalid use case"],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(false);
		});

		it("rejects empty whenToUse array", () => {
			const policy = {
				litmusTest: "Test question",
				whenToUse: [],
				whenNotToUse: ["Invalid use case"],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(false);
		});

		it("rejects empty whenNotToUse array", () => {
			const policy = {
				litmusTest: "Test question",
				whenToUse: ["Valid use case"],
				whenNotToUse: [],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(false);
		});

		it("rejects empty risks array", () => {
			const policy = {
				litmusTest: "Test question",
				whenToUse: ["Valid use case"],
				whenNotToUse: ["Invalid use case"],
				risks: [],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(false);
		});

		it("rejects negative maxPerWave", () => {
			const policy = {
				maxPerWave: -1,
				ideal: 0,
				litmusTest: "Test question",
				whenToUse: ["Valid use case"],
				whenNotToUse: ["Invalid use case"],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(false);
		});

		it("rejects non-integer maxPerWave", () => {
			const policy = {
				maxPerWave: 2.5,
				ideal: 0,
				litmusTest: "Test question",
				whenToUse: ["Valid use case"],
				whenNotToUse: ["Invalid use case"],
				risks: ["Some risk"],
			};

			const result = KeystonePolicySchema.safeParse(policy);
			expect(result.success).toBe(false);
		});
	});

	describe("ProcedureDefinitionSchema with keystonePolicy", () => {
		it("validates procedure with keystone policy", () => {
			const procedure = {
				schemaVersion: "1.0.0",
				id: "test-procedure",
				name: "Test Procedure",
				description: "A test procedure with keystone policy",
				states: ["start", "end"],
				initialState: "start",
				transitions: {
					start: { DONE: "end" },
					end: {},
				},
				keystonePolicy: {
					maxPerWave: 3,
					ideal: 0,
					litmusTest: "Can this be fanned out?",
					whenToUse: ["Cross-cutting concerns"],
					whenNotToUse: ["Single-file changes"],
					risks: ["Bottleneck creep"],
				},
			};

			const result = ProcedureDefinitionSchema.safeParse(procedure);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.keystonePolicy).toBeDefined();
				expect(result.data.keystonePolicy?.maxPerWave).toBe(3);
			}
		});

		it("validates procedure without keystone policy", () => {
			const procedure = {
				schemaVersion: "1.0.0",
				id: "test-procedure",
				name: "Test Procedure",
				description: "A test procedure without keystone policy",
				states: ["start", "end"],
				initialState: "start",
				transitions: {
					start: { DONE: "end" },
					end: {},
				},
			};

			const result = ProcedureDefinitionSchema.safeParse(procedure);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.keystonePolicy).toBeUndefined();
			}
		});

		it("rejects procedure with invalid keystone policy", () => {
			const procedure = {
				schemaVersion: "1.0.0",
				id: "test-procedure",
				name: "Test Procedure",
				description: "A test procedure",
				states: ["start", "end"],
				initialState: "start",
				transitions: {
					start: { DONE: "end" },
					end: {},
				},
				keystonePolicy: {
					maxPerWave: 2,
					// Missing required fields
				},
			};

			const result = ProcedureDefinitionSchema.safeParse(procedure);
			expect(result.success).toBe(false);
		});
	});
});

describe("Integration: merge-weave-main with Keystone Policy", () => {
	it("loads merge-weave-main procedure with keystone policy", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });
		const procedure = await loader.loadProcedure("merge-weave-main");

		expect(procedure.id).toBe("merge-weave-main");
	});

	it("validates merge-weave-main YAML includes keystone policy", async () => {
		const loader = createProcedureLoader({ proceduresDir: "procedures" });
		const fs = await import("fs");
		const YAML = await import("yaml");

		const content = fs.readFileSync("procedures/merge-weave-main.yaml", "utf8");
		const parsed = YAML.parse(content);

		// Validate keystone policy is present and valid
		expect(parsed.keystonePolicy).toBeDefined();
		expect(parsed.keystonePolicy.maxPerWave).toBe(2);
		expect(parsed.keystonePolicy.ideal).toBe(0);
		expect(parsed.keystonePolicy.litmusTest).toContain("split");
		expect(parsed.keystonePolicy.whenToUse).toBeInstanceOf(Array);
		expect(parsed.keystonePolicy.whenToUse.length).toBeGreaterThan(0);
		expect(parsed.keystonePolicy.whenNotToUse).toBeInstanceOf(Array);
		expect(parsed.keystonePolicy.whenNotToUse.length).toBeGreaterThan(0);
		expect(parsed.keystonePolicy.risks).toBeInstanceOf(Array);
		expect(parsed.keystonePolicy.risks.length).toBeGreaterThan(0);
		expect(parsed.keystonePolicy.requiredDocumentation).toBeInstanceOf(Array);
		expect(parsed.keystonePolicy.requiredDocumentation.length).toBeGreaterThan(0);

		// Validate the full procedure with schema
		const result = validateProcedureSchema(parsed);
		expect(result.valid).toBe(true);
	});

	it("validates keystone policy has correct governance rules", async () => {
		const fs = await import("fs");
		const YAML = await import("yaml");

		const content = fs.readFileSync("procedures/merge-weave-main.yaml", "utf8");
		const parsed = YAML.parse(content);
		const policy = parsed.keystonePolicy;

		// Check governance constraints
		expect(policy.maxPerWave).toBeLessThanOrEqual(2);
		expect(policy.ideal).toBe(0);

		// Check litmus test is actionable
		expect(policy.litmusTest.length).toBeGreaterThan(10);

		// Check whenToUse contains cross-cutting concern guidance
		const whenToUseText = policy.whenToUse.join(" ").toLowerCase();
		expect(whenToUseText).toContain("cross-cutting");

		// Check whenNotToUse prevents convenience use
		const whenNotToUseText = policy.whenNotToUse.join(" ").toLowerCase();
		expect(whenNotToUseText).toMatch(/single|convenience/);

		// Check risks include parallelism concerns
		const risksText = policy.risks.join(" ").toLowerCase();
		expect(risksText).toContain("parallelism");

		// Check documentation requirements
		expect(policy.requiredDocumentation.length).toBeGreaterThanOrEqual(2);
	});
});
