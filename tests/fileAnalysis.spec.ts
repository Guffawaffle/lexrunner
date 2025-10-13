/**
 * Tests for file-change analysis engine & intersection detection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileAnalyzer, createFileAnalyzer } from "../src/planner/fileAnalysis.js";
import type { FileChange } from "../src/planner/types.js";

// Mock Octokit
const mockOctokit = {
	rest: {
		pulls: {
			listFiles: vi.fn()
		}
	}
} as any;

describe("FileAnalyzer", () => {
	let analyzer: FileAnalyzer;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetAllMocks();
		analyzer = createFileAnalyzer(mockOctokit, "testowner", "testrepo");
	});

	describe("getPRFileChanges", () => {
		it("should fetch and cache PR file changes", async () => {
			const mockFiles = [
				{
					filename: "src/core.ts",
					status: "modified",
					additions: 10,
					deletions: 5,
					changes: 15,
					patch: "@@ -1,5 +1,10 @@"
				},
				{
					filename: "README.md",
					status: "modified",
					additions: 2,
					deletions: 1,
					changes: 3,
					patch: "@@ -1,1 +1,2 @@"
				}
			];

			mockOctokit.rest.pulls.listFiles.mockResolvedValue({ data: mockFiles });

			const files = await analyzer.getPRFileChanges(101);

			expect(files).toHaveLength(2);
			expect(files[0].filename).toBe("src/core.ts");
			expect(files[0].status).toBe("modified");
			expect(files[0].additions).toBe(10);
			expect(files[0].deletions).toBe(5);

			// Verify caching - should not call API again
			mockOctokit.rest.pulls.listFiles.mockClear();
			const cachedFiles = await analyzer.getPRFileChanges(101);
			expect(cachedFiles).toEqual(files);
			expect(mockOctokit.rest.pulls.listFiles).not.toHaveBeenCalled();
		});

		it("should handle renamed files", async () => {
			const mockFiles = [
				{
					filename: "src/newName.ts",
					status: "renamed",
					additions: 5,
					deletions: 2,
					changes: 7,
					previous_filename: "src/oldName.ts"
				}
			];

			mockOctokit.rest.pulls.listFiles.mockResolvedValue({ data: mockFiles });

			const files = await analyzer.getPRFileChanges(102);

			expect(files[0].status).toBe("renamed");
			expect(files[0].previousFilename).toBe("src/oldName.ts");
		});

		it("should handle API errors gracefully", async () => {
			mockOctokit.rest.pulls.listFiles.mockRejectedValue(
				new Error("API rate limit exceeded")
			);

			await expect(analyzer.getPRFileChanges(103)).rejects.toThrow(
				"Failed to fetch file changes for PR #103"
			);
		});
	});

	describe("buildIntersectionMatrix", () => {
		it("should identify file intersections between PRs", async () => {
			// PR 101 modifies core.ts and utils.ts
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/core.ts",
							status: "modified",
							additions: 10,
							deletions: 5,
							changes: 15
						},
						{
							filename: "src/utils.ts",
							status: "modified",
							additions: 3,
							deletions: 1,
							changes: 4
						}
					]
				})
				// PR 102 modifies core.ts and api.ts
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/core.ts",
							status: "modified",
							additions: 8,
							deletions: 3,
							changes: 11
						},
						{
							filename: "src/api.ts",
							status: "added",
							additions: 50,
							deletions: 0,
							changes: 50
						}
					]
				});

			const prs = [
				{ number: 101, name: "PR-101" },
				{ number: 102, name: "PR-102" }
			];

			const intersections = await analyzer.buildIntersectionMatrix(prs);

			expect(intersections).toHaveLength(1);
			expect(intersections[0].prs).toEqual(["PR-101", "PR-102"]);
			expect(intersections[0].files).toEqual(["src/core.ts"]);
			expect(intersections[0].confidence).toBeGreaterThan(0.5);
		});

		it("should return empty array when PRs have no shared files", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/feature-a.ts",
							status: "added",
							additions: 100,
							deletions: 0,
							changes: 100
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/feature-b.ts",
							status: "added",
							additions: 80,
							deletions: 0,
							changes: 80
						}
					]
				});

			const prs = [
				{ number: 201, name: "PR-201" },
				{ number: 202, name: "PR-202" }
			];

			const intersections = await analyzer.buildIntersectionMatrix(prs);

			expect(intersections).toHaveLength(0);
		});

		it("should handle multiple PR intersections deterministically", async () => {
			// PR 301: modifies file1.ts, file2.ts
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{ filename: "file1.ts", status: "modified", additions: 5, deletions: 2, changes: 7 },
						{ filename: "file2.ts", status: "modified", additions: 3, deletions: 1, changes: 4 }
					]
				})
				// PR 302: modifies file2.ts, file3.ts
				.mockResolvedValueOnce({
					data: [
						{ filename: "file2.ts", status: "modified", additions: 4, deletions: 2, changes: 6 },
						{ filename: "file3.ts", status: "modified", additions: 2, deletions: 1, changes: 3 }
					]
				})
				// PR 303: modifies file1.ts, file3.ts
				.mockResolvedValueOnce({
					data: [
						{ filename: "file1.ts", status: "modified", additions: 6, deletions: 3, changes: 9 },
						{ filename: "file3.ts", status: "modified", additions: 8, deletions: 4, changes: 12 }
					]
				});

			const prs = [
				{ number: 301, name: "PR-301" },
				{ number: 302, name: "PR-302" },
				{ number: 303, name: "PR-303" }
			];

			const intersections = await analyzer.buildIntersectionMatrix(prs);

			// Should have 3 pairs: 301-302, 301-303, 302-303
			expect(intersections).toHaveLength(3);
			
			// Verify deterministic ordering
			expect(intersections[0].prs).toEqual(["PR-301", "PR-302"]);
			expect(intersections[1].prs).toEqual(["PR-301", "PR-303"]);
			expect(intersections[2].prs).toEqual(["PR-302", "PR-303"]);

			// Verify files are sorted
			expect(intersections[0].files).toEqual(["file2.ts"]);
			expect(intersections[1].files).toEqual(["file1.ts"]);
			expect(intersections[2].files).toEqual(["file3.ts"]);
		});

		it("should calculate confidence based on change types", async () => {
			// Both modify the same file = high confidence
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{ filename: "shared.ts", status: "modified", additions: 10, deletions: 5, changes: 15 }
					]
				})
				.mockResolvedValueOnce({
					data: [
						{ filename: "shared.ts", status: "modified", additions: 8, deletions: 3, changes: 11 }
					]
				});

			const prs = [
				{ number: 401, name: "PR-401" },
				{ number: 402, name: "PR-402" }
			];

			const intersections = await analyzer.buildIntersectionMatrix(prs);

			expect(intersections[0].confidence).toBe(1.0);
		});
	});

	describe("predictConflicts", () => {
		it("should detect high severity conflicts for substantial modifications", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/important.ts",
							status: "modified",
							additions: 50,
							deletions: 30,
							changes: 80
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/important.ts",
							status: "modified",
							additions: 60,
							deletions: 40,
							changes: 100
						}
					]
				});

			const prs = [
				{ number: 501, name: "PR-501" },
				{ number: 502, name: "PR-502" }
			];

			const conflicts = await analyzer.predictConflicts(prs);

			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].severity).toBe("high");
			expect(conflicts[0].prs).toEqual(["PR-501", "PR-502"]);
			expect(conflicts[0].files).toEqual(["src/important.ts"]);
			expect(conflicts[0].reason).toContain("Both modify");
		});

		it("should detect medium severity conflicts for small modifications", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/config.ts",
							status: "modified",
							additions: 5,
							deletions: 2,
							changes: 7
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/config.ts",
							status: "modified",
							additions: 3,
							deletions: 1,
							changes: 4
						}
					]
				});

			const prs = [
				{ number: 601, name: "PR-601" },
				{ number: 602, name: "PR-602" }
			];

			const conflicts = await analyzer.predictConflicts(prs);

			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].severity).toBe("medium");
		});

		it("should detect high severity conflicts for deletion conflicts", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/deprecated.ts",
							status: "removed",
							additions: 0,
							deletions: 50,
							changes: 50
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/deprecated.ts",
							status: "modified",
							additions: 10,
							deletions: 5,
							changes: 15
						}
					]
				});

			const prs = [
				{ number: 701, name: "PR-701" },
				{ number: 702, name: "PR-702" }
			];

			const conflicts = await analyzer.predictConflicts(prs);

			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].severity).toBe("high");
			expect(conflicts[0].reason).toContain("Conflicting changes");
		});

		it("should not report low severity conflicts", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/test.ts",
							status: "added",
							additions: 20,
							deletions: 0,
							changes: 20
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/test.ts",
							status: "added",
							additions: 15,
							deletions: 0,
							changes: 15
						}
					]
				});

			const prs = [
				{ number: 801, name: "PR-801" },
				{ number: 802, name: "PR-802" }
			];

			const conflicts = await analyzer.predictConflicts(prs);

			// Low severity conflicts are not reported
			expect(conflicts).toHaveLength(0);
		});
	});

	describe("suggestDependencies", () => {
		it("should suggest dependencies for high confidence intersections", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/core.ts",
							status: "modified",
							additions: 20,
							deletions: 10,
							changes: 30
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/core.ts",
							status: "modified",
							additions: 15,
							deletions: 8,
							changes: 23
						}
					]
				});

			const prs = [
				{ number: 901, name: "PR-901" },
				{ number: 902, name: "PR-902" }
			];

			const suggestions = await analyzer.suggestDependencies(prs);

			expect(suggestions).toHaveLength(1);
			expect(suggestions[0].from).toBe("PR-901");
			expect(suggestions[0].to).toBe("PR-902");
			expect(suggestions[0].reason).toBe("shared file modifications");
			expect(suggestions[0].confidence).toBeGreaterThan(0.6);
			expect(suggestions[0].sharedFiles).toEqual(["src/core.ts"]);
			expect(suggestions[0].heuristic).toBe("shared-files");
		});

		it("should not suggest dependencies for low confidence intersections", async () => {
			mockOctokit.rest.pulls.listFiles
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/new-file.ts",
							status: "added",
							additions: 100,
							deletions: 0,
							changes: 100
						}
					]
				})
				.mockResolvedValueOnce({
					data: [
						{
							filename: "src/new-file.ts",
							status: "added",
							additions: 90,
							deletions: 0,
							changes: 90
						}
					]
				});

			const prs = [
				{ number: 1001, name: "PR-1001" },
				{ number: 1002, name: "PR-1002" }
			];

			const suggestions = await analyzer.suggestDependencies(prs);

			// Low confidence (both adding same file) - should not suggest
			expect(suggestions).toHaveLength(0);
		});
	});

	describe("suggestDependenciesWithHeuristics", () => {
		describe("shared-files heuristic", () => {
			it("should detect shared file modifications", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/core.ts",
								status: "modified",
								additions: 20,
								deletions: 10,
								changes: 30
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/core.ts",
								status: "modified",
								additions: 15,
								deletions: 8,
								changes: 23
							}
						]
					});

				const prs = [
					{ number: 1, name: "PR-1" },
					{ number: 2, name: "PR-2" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				expect(suggestions.length).toBeGreaterThan(0);
				const sharedFileSuggestion = suggestions.find(s => s.heuristic === "shared-files");
				expect(sharedFileSuggestion).toBeDefined();
				expect(sharedFileSuggestion?.confidence).toBeGreaterThan(0.6);
			});
		});

		describe("directory-proximity heuristic", () => {
			it("should detect PRs modifying files in same directory", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/core.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/utils.ts",
								status: "modified",
								additions: 8,
								deletions: 3,
								changes: 11
							}
						]
					});

				const prs = [
					{ number: 10, name: "PR-10" },
					{ number: 11, name: "PR-11" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				const proximitySuggestion = suggestions.find(s => s.heuristic === "directory-proximity");
				expect(proximitySuggestion).toBeDefined();
				expect(proximitySuggestion?.reason).toContain("common director");
				expect(proximitySuggestion?.sharedFiles).toContain("src/planner");
			});

			it("should not suggest for unrelated directories", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/core.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "tests/integration/test.ts",
								status: "modified",
								additions: 8,
								deletions: 3,
								changes: 11
							}
						]
					});

				const prs = [
					{ number: 20, name: "PR-20" },
					{ number: 21, name: "PR-21" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				const proximitySuggestion = suggestions.find(s => s.heuristic === "directory-proximity");
				expect(proximitySuggestion).toBeUndefined();
			});
		});

		describe("test-overlap heuristic", () => {
			it("should detect shared test file modifications with high confidence", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "tests/core.spec.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "tests/core.spec.ts",
								status: "modified",
								additions: 8,
								deletions: 3,
								changes: 11
							}
						]
					});

				const prs = [
					{ number: 30, name: "PR-30" },
					{ number: 31, name: "PR-31" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				// Shared test file should be detected (may be by shared-files or test-overlap heuristic)
				expect(suggestions.length).toBeGreaterThan(0);
				const suggestion = suggestions.find(s => 
					s.from === "PR-30" && s.to === "PR-31"
				);
				expect(suggestion).toBeDefined();
				expect(suggestion?.confidence).toBeGreaterThan(0.7);
			});

			it("should detect tests for same module in different directories", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/__tests__/core.test.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "tests/unit/core.spec.ts",
								status: "added",
								additions: 8,
								deletions: 0,
								changes: 8
							}
						]
					});

				const prs = [
					{ number: 40, name: "PR-40" },
					{ number: 41, name: "PR-41" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				// Should detect same module being tested (different directories, so no directory-proximity)
				const testSuggestion = suggestions.find(s => s.heuristic === "test-overlap");
				expect(testSuggestion).toBeDefined();
				expect(testSuggestion?.reason).toContain("tests for same module");
			});

			it("should not detect test overlap when no test files present", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/core.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/utils.ts",
								status: "modified",
								additions: 8,
								deletions: 3,
								changes: 11
							}
						]
					});

				const prs = [
					{ number: 50, name: "PR-50" },
					{ number: 51, name: "PR-51" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				const testSuggestion = suggestions.find(s => s.heuristic === "test-overlap");
				expect(testSuggestion).toBeUndefined();
			});
		});

		describe("deterministic ordering", () => {
			it("should sort by confidence descending, then by PR name ascending", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/core.ts",
								status: "modified",
								additions: 50,
								deletions: 20,
								changes: 70
							},
							{
								filename: "tests/core.spec.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/utils.ts",
								status: "modified",
								additions: 5,
								deletions: 2,
								changes: 7
							},
							{
								filename: "tests/core.spec.ts",
								status: "modified",
								additions: 8,
								deletions: 3,
								changes: 11
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/core.ts",
								status: "modified",
								additions: 30,
								deletions: 15,
								changes: 45
							}
						]
					});

				const prs = [
					{ number: 1, name: "PR-1" },
					{ number: 2, name: "PR-2" },
					{ number: 3, name: "PR-3" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				// Should be sorted by confidence descending
				for (let i = 0; i < suggestions.length - 1; i++) {
					if (Math.abs(suggestions[i].confidence - suggestions[i + 1].confidence) > 0.001) {
						expect(suggestions[i].confidence).toBeGreaterThanOrEqual(suggestions[i + 1].confidence);
					}
				}

				// For same confidence, should be sorted by PR name
				const sameConfidence = suggestions.filter(s => 
					Math.abs(s.confidence - suggestions[0].confidence) < 0.001
				);
				if (sameConfidence.length > 1) {
					for (let i = 0; i < sameConfidence.length - 1; i++) {
						expect(sameConfidence[i].from.localeCompare(sameConfidence[i + 1].from)).toBeLessThanOrEqual(0);
					}
				}
			});
		});

		describe("deduplication", () => {
			it("should keep highest confidence suggestion for each PR pair", async () => {
				mockOctokit.rest.pulls.listFiles
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/core.ts",
								status: "modified",
								additions: 50,
								deletions: 20,
								changes: 70
							},
							{
								filename: "tests/planner.spec.ts",
								status: "modified",
								additions: 10,
								deletions: 5,
								changes: 15
							}
						]
					})
					.mockResolvedValueOnce({
						data: [
							{
								filename: "src/planner/core.ts",
								status: "modified",
								additions: 30,
								deletions: 15,
								changes: 45
							},
							{
								filename: "tests/planner.spec.ts",
								status: "modified",
								additions: 8,
								deletions: 3,
								changes: 11
							}
						]
					});

				const prs = [
					{ number: 100, name: "PR-100" },
					{ number: 101, name: "PR-101" }
				];

				const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

				// Should have only one suggestion for this PR pair (highest confidence)
				const pr100to101 = suggestions.filter(s => s.from === "PR-100" && s.to === "PR-101");
				expect(pr100to101).toHaveLength(1);
				
				// Should be the highest confidence (likely shared-files or test-overlap)
				expect(pr100to101[0].confidence).toBeGreaterThan(0.6);
			});
		});
	});

	describe("analyzeFiles", () => {
		it("should perform complete file analysis", async () => {
			// Mock to return different data for different PR numbers
			mockOctokit.rest.pulls.listFiles.mockImplementation(async ({ pull_number }: any) => {
				if (pull_number === 1101) {
					return {
						data: [
							{
								filename: "src/main.ts",
								status: "modified",
								additions: 25,
								deletions: 15,
								changes: 40
							}
						]
					};
				} else if (pull_number === 1102) {
					return {
						data: [
							{
								filename: "src/main.ts",
								status: "modified",
								additions: 20,
								deletions: 12,
								changes: 32
							}
						]
					};
				}
				return { data: [] };
			});

			const prs = [
				{ number: 1101, name: "PR-1101" },
				{ number: 1102, name: "PR-1102" }
			];

			const result = await analyzer.analyzeFiles(prs);

			expect(result.fileIntersections).toHaveLength(1);
			expect(result.suggestions).toHaveLength(1);
			expect(result.conflicts).toHaveLength(1);
		});
	});

	describe("cache management", () => {
		it("should clear cache", async () => {
			mockOctokit.rest.pulls.listFiles.mockResolvedValue({
				data: [
					{
						filename: "test.ts",
						status: "modified",
						additions: 5,
						deletions: 2,
						changes: 7
					}
				]
			});

			await analyzer.getPRFileChanges(1201);
			
			let stats = analyzer.getCacheStats();
			expect(stats.size).toBe(1);

			analyzer.clearCache();

			stats = analyzer.getCacheStats();
			expect(stats.size).toBe(0);
		});

		it("should provide cache statistics", async () => {
			mockOctokit.rest.pulls.listFiles.mockResolvedValue({
				data: [
					{
						filename: "test.ts",
						status: "modified",
						additions: 5,
						deletions: 2,
						changes: 7
					}
				]
			});

			await analyzer.getPRFileChanges(1301);
			await analyzer.getPRFileChanges(1302);

			const stats = analyzer.getCacheStats();
			expect(stats.size).toBe(2);
			expect(stats.entries).toHaveLength(2);
			expect(stats.entries).toContain("1301-latest");
			expect(stats.entries).toContain("1302-latest");
		});
	});
});
