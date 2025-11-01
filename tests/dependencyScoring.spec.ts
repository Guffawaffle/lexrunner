/**
 * Dependency Scoring Tests
 * Comprehensive test suite for the scoring and weighting system
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	scoreDependencies,
	mergeDuplicateScores,
	sortScores,
	type DependencyScore,
	type ScoringOptions
} from "../src/planner/dependencyScoring.js";
import { FileAnalyzer } from "../src/planner/fileAnalysis.js";
import type { Octokit } from "@octokit/rest";

/**
 * Mock FileAnalyzer for testing
 */
class MockFileAnalyzer extends FileAnalyzer {
	private mockSuggestions: any[] = [];

	constructor() {
		// Pass null as Octokit since we're mocking
		super(null as any, "test-owner", "test-repo");
	}

	setMockSuggestions(suggestions: any[]): void {
		this.mockSuggestions = suggestions;
	}

	async suggestDependenciesWithHeuristics(): Promise<any[]> {
		return this.mockSuggestions;
	}
}

describe("Dependency Scoring", () => {
	let mockAnalyzer: MockFileAnalyzer;

	beforeEach(() => {
		mockAnalyzer = new MockFileAnalyzer();
	});

	describe("Explicit Dependencies", () => {
		it("should score explicit dependency as 1.0", async () => {
			const prs = [
				{
					number: 101,
					name: "PR-101",
					body: "Depends-on: #99",
					sha: "abc123"
				}
			];

			mockAnalyzer.setMockSuggestions([]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toHaveLength(1);
			expect(scores[0].score).toBe(1.0);
			expect(scores[0].reason).toBe("explicit-footer");
			expect(scores[0].from).toBe("PR-101");
			expect(scores[0].to).toBe("PR-99");
			expect(scores[0].evidence.explicit).toEqual(["#99"]);
		});

		it("should handle multiple explicit dependencies", async () => {
			const prs = [
				{
					number: 103,
					name: "PR-103",
					body: "Depends-on: #101\nDepends-on: #102",
					sha: "ghi789"
				}
			];

			mockAnalyzer.setMockSuggestions([]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toHaveLength(2);
			expect(scores[0].score).toBe(1.0);
			expect(scores[1].score).toBe(1.0);
			expect(scores[0].from).toBe("PR-103");
			expect(scores[1].from).toBe("PR-103");
		});

		it("should normalize dependency references", async () => {
			const prs = [
				{
					number: 101,
					name: "PR-101",
					body: "Depends-on: Guffawaffle/lex-pr-runner#99",
					sha: "abc123"
				}
			];

			mockAnalyzer.setMockSuggestions([]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toHaveLength(1);
			expect(scores[0].to).toBe("PR-99");
		});
	});

	describe("Shared File Scoring", () => {
		it("should score shared files in range 0.7-0.9", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "shared file modifications",
					confidence: 0.95,
					sharedFiles: ["src/foo.ts", "src/bar.ts"],
					heuristic: "shared-files"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toHaveLength(1);
			expect(scores[0].score).toBeGreaterThanOrEqual(0.7);
			expect(scores[0].score).toBeLessThanOrEqual(0.9);
			expect(scores[0].reason).toBe("shared-files");
			expect(scores[0].evidence.files).toEqual(["src/foo.ts", "src/bar.ts"]);
		});

		it("should cap shared files score at 0.9", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "shared file modifications",
					confidence: 1.0,
					sharedFiles: ["src/main.ts"],
					heuristic: "shared-files"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores[0].score).toBeCloseTo(0.9, 2);
		});
	});

	describe("Directory Proximity Scoring", () => {
		it("should score directory proximity in range 0.5-0.7", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "both modify files in 2 common directories",
					confidence: 0.8,
					sharedFiles: ["src/api", "src/models"],
					heuristic: "directory-proximity"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toHaveLength(1);
			expect(scores[0].score).toBeGreaterThanOrEqual(0.5);
			expect(scores[0].score).toBeLessThanOrEqual(0.7);
			expect(scores[0].reason).toBe("directory-proximity");
		});

		it("should cap directory proximity score at 0.7", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "both modify files in common directory",
					confidence: 1.0,
					sharedFiles: ["src/api"],
					heuristic: "directory-proximity"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores[0].score).toBeCloseTo(0.7, 2);
		});
	});

	describe("Test Overlap Scoring", () => {
		it("should score test overlap in range 0.4-0.6", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "both modify 1 shared test file",
					confidence: 0.75,
					sharedFiles: ["tests/api.spec.ts"],
					heuristic: "test-overlap"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toHaveLength(1);
			expect(scores[0].score).toBeGreaterThanOrEqual(0.4);
			expect(scores[0].score).toBeLessThanOrEqual(0.6);
			expect(scores[0].reason).toBe("test-overlap");
		});

		it("should cap test overlap score at 0.6", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "both modify shared test files",
					confidence: 1.0,
					sharedFiles: ["tests/api.spec.ts", "tests/models.spec.ts"],
					heuristic: "test-overlap"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores[0].score).toBeCloseTo(0.6, 2);
		});
	});

	describe("Multiple Signals", () => {
		it("should take max score when multiple signals for same PR pair", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "shared files",
					confidence: 0.9,
					sharedFiles: ["src/api.ts"],
					heuristic: "shared-files"
				},
				{
					from: "PR-101",
					to: "PR-102",
					reason: "directory proximity",
					confidence: 0.7,
					sharedFiles: ["src/api"],
					heuristic: "directory-proximity"
				},
				{
					from: "PR-101",
					to: "PR-102",
					reason: "test overlap",
					confidence: 0.5,
					sharedFiles: ["tests/api.spec.ts"],
					heuristic: "test-overlap"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			// Should only have 1 score (max of the three)
			expect(scores).toHaveLength(1);
			expect(scores[0].score).toBeCloseTo(0.81, 2); // 0.9 * 0.9 = 0.81
			expect(scores[0].reason).toBe("shared-files");
		});

		it("should merge evidence when scores are equal", async () => {
			const scores: DependencyScore[] = [
				{
					from: "PR-101",
					to: "PR-102",
					score: 1.0,
					reason: "explicit-footer",
					evidence: { explicit: ["#102"] }
				},
				{
					from: "PR-101",
					to: "PR-102",
					score: 1.0,
					reason: "explicit-footer",
					evidence: { explicit: ["PR-102"] }
				}
			];

			const merged = mergeDuplicateScores(scores);

			expect(merged).toHaveLength(1);
			expect(merged[0].evidence.explicit).toEqual(["#102", "PR-102"]);
		});
	});

	describe("Deterministic Sorting", () => {
		it("should sort by score descending first", () => {
			const scores: DependencyScore[] = [
				{
					from: "PR-101",
					to: "PR-102",
					score: 0.5,
					reason: "test",
					evidence: {}
				},
				{
					from: "PR-103",
					to: "PR-104",
					score: 1.0,
					reason: "test",
					evidence: {}
				},
				{
					from: "PR-105",
					to: "PR-106",
					score: 0.8,
					reason: "test",
					evidence: {}
				}
			];

			const sorted = sortScores(scores);

			expect(sorted[0].score).toBe(1.0);
			expect(sorted[1].score).toBe(0.8);
			expect(sorted[2].score).toBe(0.5);
		});

		it("should sort by PR number ascending when scores are equal", () => {
			const scores: DependencyScore[] = [
				{
					from: "PR-105",
					to: "PR-106",
					score: 1.0,
					reason: "test",
					evidence: {}
				},
				{
					from: "PR-101",
					to: "PR-102",
					score: 1.0,
					reason: "test",
					evidence: {}
				},
				{
					from: "PR-103",
					to: "PR-104",
					score: 1.0,
					reason: "test",
					evidence: {}
				}
			];

			const sorted = sortScores(scores);

			expect(sorted[0].from).toBe("PR-101");
			expect(sorted[1].from).toBe("PR-103");
			expect(sorted[2].from).toBe("PR-105");
		});

		it("should produce same output for same input", () => {
			const scores: DependencyScore[] = [
				{
					from: "PR-103",
					to: "PR-104",
					score: 0.8,
					reason: "test",
					evidence: {}
				},
				{
					from: "PR-101",
					to: "PR-102",
					score: 1.0,
					reason: "test",
					evidence: {}
				}
			];

			const sorted1 = sortScores(scores);
			const sorted2 = sortScores(scores);

			expect(sorted1).toEqual(sorted2);
		});
	});

	describe("Custom Weights", () => {
		it("should use custom weights when provided", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "shared files",
					confidence: 1.0,
					sharedFiles: ["src/api.ts"],
					heuristic: "shared-files"
				}
			]);

			const options: ScoringOptions = {
				weights: {
					sharedFiles: 0.5 // Custom weight instead of default 0.8
				}
			};

			const scores = await scoreDependencies(prs, mockAnalyzer, options);

			expect(scores[0].score).toBeCloseTo(0.5, 2); // 1.0 * 0.5 = 0.5
		});

		it("should override explicit dependency score with custom weight", async () => {
			const prs = [
				{
					number: 101,
					name: "PR-101",
					body: "Depends-on: #99",
					sha: "abc123"
				}
			];

			mockAnalyzer.setMockSuggestions([]);

			const options: ScoringOptions = {
				weights: {
					explicit: 0.95 // Custom weight
				}
			};

			const scores = await scoreDependencies(prs, mockAnalyzer, options);

			expect(scores[0].score).toBe(0.95);
		});
	});

	describe("Threshold Filtering", () => {
		it("should filter out scores below threshold", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "weak signal",
					confidence: 0.2,
					sharedFiles: ["src/api"],
					heuristic: "directory-proximity"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			// Default threshold is 0.3, so 0.2 * 0.7 = 0.14 should be filtered
			expect(scores).toHaveLength(0);
		});

		it("should use custom threshold when provided", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "weak signal",
					confidence: 0.3,
					sharedFiles: ["src/api"],
					heuristic: "directory-proximity"
				}
			]);

			const options: ScoringOptions = {
				threshold: 0.1 // Lower threshold
			};

			const scores = await scoreDependencies(prs, mockAnalyzer, options);

			// 0.3 * 0.6 = 0.18, which is above 0.1
			expect(scores).toHaveLength(1);
		});

		it("should not filter explicit dependencies regardless of threshold", async () => {
			const prs = [
				{
					number: 101,
					name: "PR-101",
					body: "Depends-on: #99",
					sha: "abc123"
				}
			];

			mockAnalyzer.setMockSuggestions([]);

			const options: ScoringOptions = {
				threshold: 0.99 // Very high threshold
			};

			const scores = await scoreDependencies(prs, mockAnalyzer, options);

			// Explicit dependency with score 1.0 should still be included
			expect(scores).toHaveLength(1);
			expect(scores[0].score).toBe(1.0);
		});
	});

	describe("Empty Inputs", () => {
		it("should return empty array for empty PR list", async () => {
			const prs: any[] = [];

			mockAnalyzer.setMockSuggestions([]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toEqual([]);
		});

		it("should return empty array when no dependencies found", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" },
				{ number: 102, name: "PR-102", body: null, sha: "def456" }
			];

			mockAnalyzer.setMockSuggestions([]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toEqual([]);
		});

		it("should handle PRs with no body", async () => {
			const prs = [
				{ number: 101, name: "PR-101", body: null, sha: "abc123" }
			];

			mockAnalyzer.setMockSuggestions([]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			expect(scores).toEqual([]);
		});
	});

	describe("Integration Scenarios", () => {
		it("should correctly rank mix of explicit and file-overlap suggestions", async () => {
			const prs = [
				{
					number: 101,
					name: "PR-101",
					body: "Depends-on: #99",
					sha: "abc123"
				},
				{
					number: 102,
					name: "PR-102",
					body: null,
					sha: "def456"
				},
				{
					number: 103,
					name: "PR-103",
					body: "Depends-on: #101",
					sha: "ghi789"
				}
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-102",
					to: "PR-101",
					reason: "shared files",
					confidence: 0.9,
					sharedFiles: ["src/api.ts"],
					heuristic: "shared-files"
				},
				{
					from: "PR-103",
					to: "PR-102",
					reason: "directory proximity",
					confidence: 0.6,
					sharedFiles: ["src/api"],
					heuristic: "directory-proximity"
				}
			]);

			const scores = await scoreDependencies(prs, mockAnalyzer);

			// Should have 4 scores: 2 explicit (1.0) + 2 file-based (0.72, 0.36)
			expect(scores.length).toBeGreaterThanOrEqual(3);

			// First two should be explicit dependencies (score 1.0)
			const explicitScores = scores.filter(s => s.score === 1.0);
			expect(explicitScores).toHaveLength(2);

			// Shared files should rank higher than directory proximity
			const sharedFilesScore = scores.find(
				s => s.reason === "shared-files"
			);
			const dirProxScore = scores.find(
				s => s.reason === "directory-proximity"
			);

			if (sharedFilesScore && dirProxScore) {
				expect(sharedFilesScore.score).toBeGreaterThan(dirProxScore.score);
			}
		});

		it("should maintain deterministic order across multiple runs", async () => {
			const prs = [
				{
					number: 101,
					name: "PR-101",
					body: "Depends-on: #99",
					sha: "abc123"
				},
				{
					number: 102,
					name: "PR-102",
					body: "Depends-on: #99",
					sha: "def456"
				}
			];

			mockAnalyzer.setMockSuggestions([
				{
					from: "PR-101",
					to: "PR-102",
					reason: "shared files",
					confidence: 0.8,
					sharedFiles: ["src/api.ts"],
					heuristic: "shared-files"
				}
			]);

			const scores1 = await scoreDependencies(prs, mockAnalyzer);
			const scores2 = await scoreDependencies(prs, mockAnalyzer);

			expect(scores1).toEqual(scores2);
		});
	});
});
