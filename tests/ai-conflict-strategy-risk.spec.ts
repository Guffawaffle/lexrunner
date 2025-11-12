/**
 * Tests for Risk Scoring and Abstention Logic
 */

import { describe, it, expect } from "vitest";
import {
	calculateRiskScore,
	shouldAbstain,
	getRiskLevel,
	assessRisk,
	RISK_THRESHOLD
} from "../src/ai/riskScoring.js";
import type { ConflictResolutionInput } from "../src/ai/conflictStrategySchema.js";

describe("Risk Scoring", () => {
	describe("calculateRiskScore", () => {
		it("should return 0 for trivial conflicts", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: [
					{ type: "whitespace", message: "Whitespace only", confidence: 1.0 }
				]
			};

			const risk = calculateRiskScore(input);
			expect(risk).toBeGreaterThanOrEqual(0);
			expect(risk).toBeLessThan(0.25);
		});

		it("should increase risk for multiple files", () => {
			const singleFile: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: []
			};

			const multiFile: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts", "src/file3.ts"],
				hunkHashes: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
				symbols: [],
				hints: []
			};

			const risk1 = calculateRiskScore(singleFile);
			const risk2 = calculateRiskScore(multiFile);

			expect(risk2).toBeGreaterThan(risk1);
		});

		it("should increase risk for multiple hunks", () => {
			const fewHunks: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: []
			};

			const manyHunks: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: [
					"a".repeat(64),
					"b".repeat(64),
					"c".repeat(64),
					"d".repeat(64)
				],
				symbols: [],
				hints: []
			};

			const risk1 = calculateRiskScore(fewHunks);
			const risk2 = calculateRiskScore(manyHunks);

			expect(risk2).toBeGreaterThan(risk1);
		});

		it("should increase risk for semantic conflicts", () => {
			const trivial: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: [
					{ type: "whitespace", message: "Whitespace", confidence: 1.0 }
				]
			};

			const semantic: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: [
					{ type: "semantic", message: "Logic conflict", confidence: 0.8 }
				]
			};

			const risk1 = calculateRiskScore(trivial);
			const risk2 = calculateRiskScore(semantic);

			expect(risk2).toBeGreaterThan(risk1);
		});

		it("should increase risk for structural changes", () => {
			const noStructural: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [
					{ name: "myVar", type: "variable", path: "src/file1.ts" }
				],
				hints: []
			};

			const withStructural: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [
					{ name: "MyClass", type: "class", path: "src/file1.ts" },
					{ name: "myFunc", type: "function", path: "src/file1.ts" }
				],
				hints: []
			};

			const risk1 = calculateRiskScore(noStructural);
			const risk2 = calculateRiskScore(withStructural);

			expect(risk2).toBeGreaterThan(risk1);
		});

		it("should increase risk for low confidence hints", () => {
			const highConfidence: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: [
					{ type: "import-order", message: "Import order", confidence: 0.95 }
				]
			};

			const lowConfidence: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: [
					{ type: "semantic", message: "Unclear", confidence: 0.3 },
					{ type: "structural", message: "Unknown", confidence: 0.2 }
				]
			};

			const risk1 = calculateRiskScore(highConfidence);
			const risk2 = calculateRiskScore(lowConfidence);

			expect(risk2).toBeGreaterThan(risk1);
		});

		it("should increase risk for unknown symbols", () => {
			const knownSymbols: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [
					{ name: "MyClass", type: "class", path: "src/file1.ts" }
				],
				hints: []
			};

			const unknownSymbols: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [
					{ name: "something", type: "other", path: "src/file1.ts" }
				],
				hints: []
			};

			const risk1 = calculateRiskScore(knownSymbols);
			const risk2 = calculateRiskScore(unknownSymbols);

			expect(risk2).toBeGreaterThan(risk1);
		});

		it("should clamp risk score to [0, 1]", () => {
			const extremeInput: ConflictResolutionInput = {
				paths: Array.from({ length: 20 }, (_, i) => `file${i}.ts`),
				hunkHashes: Array.from({ length: 20 }, () => "a".repeat(64)),
				symbols: Array.from({ length: 10 }, (_, i) => ({
					name: `class${i}`,
					type: "class" as const,
					path: "src/file1.ts"
				})),
				hints: Array.from({ length: 10 }, () => ({
					type: "semantic" as const,
					message: "Complex",
					confidence: 0.1
				}))
			};

			const risk = calculateRiskScore(extremeInput);
			expect(risk).toBeGreaterThanOrEqual(0);
			expect(risk).toBeLessThanOrEqual(1);
		});
	});

	describe("shouldAbstain", () => {
		it("should abstain when risk > threshold", () => {
			expect(shouldAbstain(0.4)).toBe(true);
			expect(shouldAbstain(0.5)).toBe(true);
			expect(shouldAbstain(1.0)).toBe(true);
		});

		it("should not abstain when risk <= threshold", () => {
			expect(shouldAbstain(0.0)).toBe(false);
			expect(shouldAbstain(0.25)).toBe(false);
			expect(shouldAbstain(0.35)).toBe(false);
		});

		it("should use threshold of 0.35", () => {
			expect(RISK_THRESHOLD).toBe(0.35);
			expect(shouldAbstain(0.35)).toBe(false);
			expect(shouldAbstain(0.36)).toBe(true);
		});
	});

	describe("getRiskLevel", () => {
		it("should return correct risk levels", () => {
			expect(getRiskLevel(0.0)).toBe("low");
			expect(getRiskLevel(0.2)).toBe("low");
			expect(getRiskLevel(0.25)).toBe("medium");
			expect(getRiskLevel(0.4)).toBe("medium");
			expect(getRiskLevel(0.5)).toBe("high");
			expect(getRiskLevel(0.7)).toBe("high");
			expect(getRiskLevel(0.75)).toBe("critical");
			expect(getRiskLevel(1.0)).toBe("critical");
		});
	});

	describe("assessRisk", () => {
		it("should provide complete risk assessment", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts"],
				hunkHashes: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
				symbols: [
					{ name: "MyClass", type: "class", path: "src/file1.ts" }
				],
				hints: [
					{ type: "semantic", message: "Complex conflict", confidence: 0.5 }
				]
			};

			const assessment = assessRisk(input);

			expect(assessment).toHaveProperty("score");
			expect(assessment).toHaveProperty("level");
			expect(assessment).toHaveProperty("abstain");
			expect(assessment).toHaveProperty("factors");

			expect(assessment.score).toBeGreaterThanOrEqual(0);
			expect(assessment.score).toBeLessThanOrEqual(1);
			expect(["low", "medium", "high", "critical"]).toContain(assessment.level);
			expect(typeof assessment.abstain).toBe("boolean");
			expect(Array.isArray(assessment.factors)).toBe(true);
		});

		it("should identify risk factors", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts"],
				hunkHashes: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
				symbols: [
					{ name: "MyClass", type: "class", path: "src/file1.ts" }
				],
				hints: [
					{ type: "semantic", message: "Complex", confidence: 0.3 }
				]
			};

			const assessment = assessRisk(input);

			expect(assessment.factors).toContain("Multiple files (2)");
			expect(assessment.factors).toContain("Multiple hunks (3)");
			expect(assessment.factors).toContain("Semantic conflicts (1)");
			expect(assessment.factors).toContain("Structural changes (1)");
			expect(assessment.factors).toContain("Low confidence hints (1)");
		});

		it("should recommend abstention for high risk", () => {
			const highRiskInput: ConflictResolutionInput = {
				paths: Array.from({ length: 5 }, (_, i) => `file${i}.ts`),
				hunkHashes: Array.from({ length: 5 }, () => "a".repeat(64)),
				symbols: [
					{ name: "ClassA", type: "class", path: "src/file1.ts" },
					{ name: "ClassB", type: "class", path: "src/file2.ts" }
				],
				hints: [
					{ type: "semantic", message: "Complex", confidence: 0.2 },
					{ type: "semantic", message: "Unclear", confidence: 0.3 }
				]
			};

			const assessment = assessRisk(highRiskInput);
			expect(assessment.abstain).toBe(true);
		});

		it("should not recommend abstention for low risk", () => {
			const lowRiskInput: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: [
					{ type: "whitespace", message: "Whitespace", confidence: 1.0 }
				]
			};

			const assessment = assessRisk(lowRiskInput);
			expect(assessment.abstain).toBe(false);
		});
	});
});
