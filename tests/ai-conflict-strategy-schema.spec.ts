/**
 * Tests for AI Conflict Resolution Strategy Schemas
 */

import { describe, it, expect } from "vitest";
import {
	ConflictResolutionInputSchema,
	ConflictResolutionOutputSchema,
	ResolutionOperationSchema,
	CachedResolutionSchema,
	type ConflictResolutionInput,
	type ConflictResolutionOutput
} from "../src/ai/conflictStrategySchema.js";

describe("Conflict Strategy Schemas", () => {
	describe("ConflictResolutionInputSchema", () => {
		it("should validate valid input", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts"],
				hunkHashes: [
					"a".repeat(64),
					"b".repeat(64)
				],
				symbols: [
					{ name: "MyClass", type: "class", path: "src/file1.ts" }
				],
				hints: [
					{ type: "import-order", message: "Import order conflict", confidence: 0.9 }
				]
			};

			const result = ConflictResolutionInputSchema.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should require at least one path", () => {
			const input = {
				paths: [],
				hunkHashes: ["a".repeat(64)]
			};

			const result = ConflictResolutionInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		});

		it("should validate SHA-256 hunk hashes", () => {
			const input = {
				paths: ["src/file1.ts"],
				hunkHashes: ["invalid-hash"]
			};

			const result = ConflictResolutionInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		});

		it("should accept valid symbol types", () => {
			const symbolTypes = ["function", "class", "variable", "import", "export", "other"];
			
			for (const type of symbolTypes) {
				const input = {
					paths: ["src/file1.ts"],
					hunkHashes: ["a".repeat(64)],
					symbols: [{ name: "test", type, path: "src/file1.ts" }]
				};

				const result = ConflictResolutionInputSchema.safeParse(input);
				expect(result.success).toBe(true);
			}
		});

		it("should accept valid hint types", () => {
			const hintTypes = ["import-order", "whitespace", "formatting", "semantic", "structural"];
			
			for (const type of hintTypes) {
				const input = {
					paths: ["src/file1.ts"],
					hunkHashes: ["a".repeat(64)],
					hints: [{ type, message: "test", confidence: 0.5 }]
				};

				const result = ConflictResolutionInputSchema.safeParse(input);
				expect(result.success).toBe(true);
			}
		});

		it("should default symbols and hints to empty arrays", () => {
			const input = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)]
			};

			const result = ConflictResolutionInputSchema.parse(input);
			expect(result.symbols).toEqual([]);
			expect(result.hints).toEqual([]);
		});
	});

	describe("ResolutionOperationSchema", () => {
		it("should validate valid operations", () => {
			const operations = [
				{ type: "accept-ours", path: "src/file1.ts", hunkHash: "a".repeat(64) },
				{ type: "accept-theirs", path: "src/file1.ts", hunkHash: "a".repeat(64) },
				{ type: "accept-base", path: "src/file1.ts", hunkHash: "a".repeat(64) },
				{ type: "merge-both", path: "src/file1.ts", hunkHash: "a".repeat(64) },
				{ type: "manual-review", path: "src/file1.ts", hunkHash: "a".repeat(64) }
			];

			for (const op of operations) {
				const result = ResolutionOperationSchema.safeParse(op);
				expect(result.success).toBe(true);
			}
		});

		it("should accept optional rationale", () => {
			const op = {
				type: "accept-ours",
				path: "src/file1.ts",
				hunkHash: "a".repeat(64),
				rationale: "This is safe because..."
			};

			const result = ResolutionOperationSchema.safeParse(op);
			expect(result.success).toBe(true);
		});
	});

	describe("ConflictResolutionOutputSchema", () => {
		it("should validate valid output", () => {
			const output: ConflictResolutionOutput = {
				strategy: "auto-resolve",
				ops: [
					{
						type: "accept-ours",
						path: "src/file1.ts",
						hunkHash: "a".repeat(64),
						rationale: "Safe"
					}
				],
				risk: 0.25,
				explanation: "Simple import conflict",
				abstained: false
			};

			const result = ConflictResolutionOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate strategy types", () => {
			const strategies = ["auto-resolve", "manual-review", "abort"];

			for (const strategy of strategies) {
				const output = {
					strategy,
					ops: [],
					risk: 0.5
				};

				const result = ConflictResolutionOutputSchema.safeParse(output);
				expect(result.success).toBe(true);
			}
		});

		it("should validate risk is between 0 and 1", () => {
			const validRisks = [0, 0.25, 0.5, 0.75, 1.0];
			const invalidRisks = [-0.1, 1.5, 2.0];

			for (const risk of validRisks) {
				const output = { strategy: "auto-resolve", ops: [], risk };
				const result = ConflictResolutionOutputSchema.safeParse(output);
				expect(result.success).toBe(true);
			}

			for (const risk of invalidRisks) {
				const output = { strategy: "auto-resolve", ops: [], risk };
				const result = ConflictResolutionOutputSchema.safeParse(output);
				expect(result.success).toBe(false);
			}
		});

		it("should default abstained to false", () => {
			const output = {
				strategy: "auto-resolve",
				ops: [],
				risk: 0.25
			};

			const result = ConflictResolutionOutputSchema.parse(output);
			expect(result.abstained).toBe(false);
		});

		it("should accept fallback method when provided", () => {
			const fallbackMethods = ["heuristic", "manual", "none"];

			for (const fallbackMethod of fallbackMethods) {
				const output = {
					strategy: "manual-review",
					ops: [],
					risk: 0.5,
					abstained: true,
					fallbackMethod
				};

				const result = ConflictResolutionOutputSchema.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
	});

	describe("CachedResolutionSchema", () => {
		it("should validate valid cached entry", () => {
			const cached = {
				cacheKey: "a".repeat(64),
				resolution: {
					strategy: "auto-resolve",
					ops: [],
					risk: 0.25,
					abstained: false
				},
				timestamp: new Date().toISOString()
			};

			const result = CachedResolutionSchema.safeParse(cached);
			expect(result.success).toBe(true);
		});

		it("should validate cache key is SHA-256", () => {
			const cached = {
				cacheKey: "invalid-key",
				resolution: {
					strategy: "auto-resolve",
					ops: [],
					risk: 0.25,
					abstained: false
				},
				timestamp: new Date().toISOString()
			};

			const result = CachedResolutionSchema.safeParse(cached);
			expect(result.success).toBe(false);
		});

		it("should accept optional TTL", () => {
			const cached = {
				cacheKey: "a".repeat(64),
				resolution: {
					strategy: "auto-resolve",
					ops: [],
					risk: 0.25,
					abstained: false
				},
				timestamp: new Date().toISOString(),
				ttl: 3600
			};

			const result = CachedResolutionSchema.safeParse(cached);
			expect(result.success).toBe(true);
		});
	});
});
