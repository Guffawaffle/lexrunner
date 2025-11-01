/**
 * E2E Tests for Diffgraph Planner
 * Comprehensive end-to-end tests for plan generation using realistic repository scenarios
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	loadFixture,
	createMockGitHub,
	assertPlanStructure,
	createMockPRBatch,
	assertDeepEqual,
	type PlanFixture
} from "../helpers/plannerTestHelpers.js";
import {
	parsePRDescription,
	validateDependencies,
	type ParsedDependency
} from "../../src/planner/dependencyParser.js";
import { FileAnalyzer } from "../../src/planner/fileAnalysis.js";

/**
 * Helper: Generate plan structure from parsed PRs
 * This simulates a minimal plan generator using dependency and file analysis
 */
function generatePlanFromParsedPRs(parsedPRs: ParsedDependency[]): any {
	// Build dependency graph
	const graph = new Map<string, Set<string>>();
	const allPRs = new Set<string>();

	for (const pr of parsedPRs) {
		allPRs.add(pr.prId);
		const deps = pr.dependencies.map(dep => {
			// Normalize dependency format to PR-XXX
			if (dep.startsWith('#')) {
				return `PR-${dep.substring(1)}`;
			}
			if (dep.match(/^PR-\d+$/i)) {
				return dep.toUpperCase();
			}
			if (dep.includes('#')) {
				const prNum = dep.split('#')[1];
				return `PR-${prNum}`;
			}
			return dep;
		});
		graph.set(pr.prId, new Set(deps));
	}

	// Topological sort to create layers
	const layers: string[][] = [];
	const visited = new Set<string>();
	const inDegree = new Map<string, number>();

	// Calculate in-degrees (number of PRs that depend on this PR)
	for (const prId of allPRs) {
		inDegree.set(prId, 0);
	}
	for (const [prId, deps] of graph.entries()) {
		// For each dependency, increment its in-degree count
		// But we want PRs with NO dependencies to be in layer 0
		// So we need to track who depends ON what, not who is depended BY what
		for (const dep of deps) {
			if (allPRs.has(dep)) {
				// prId depends on dep, so prId has an incoming edge from dep
				inDegree.set(prId, (inDegree.get(prId) || 0) + 1);
			}
		}
	}

	// Find nodes with zero in-degree for each layer
	while (visited.size < allPRs.size) {
		const currentLayer: string[] = [];
		
		for (const prId of allPRs) {
			if (!visited.has(prId) && inDegree.get(prId) === 0) {
				currentLayer.push(prId);
			}
		}

		if (currentLayer.length === 0 && visited.size < allPRs.size) {
			// Cycle detected or orphans
			break;
		}

		currentLayer.sort(); // Deterministic ordering
		layers.push(currentLayer);

		for (const prId of currentLayer) {
			visited.add(prId);
			const deps = graph.get(prId) || new Set();
			// This PR is done - any PR that depends on it can have its in-degree decremented
			for (const otherPrId of allPRs) {
				const otherDeps = graph.get(otherPrId) || new Set();
				if (otherDeps.has(prId)) {
					inDegree.set(otherPrId, (inDegree.get(otherPrId) || 0) - 1);
				}
			}
		}
	}

	// Find orphans (PRs with no dependencies and nothing depends on them)
	const orphans: string[] = [];
	for (const prId of allPRs) {
		const hasDeps = (graph.get(prId)?.size || 0) > 0;
		const isDepended = Array.from(graph.values()).some(deps => deps.has(prId));
		if (!hasDeps && !isDepended) {
			orphans.push(prId);
		}
	}

	return {
		layers,
		orphans: orphans.sort(),
		nodes: Array.from(allPRs).sort(),
		edges: Array.from(graph.entries())
			.flatMap(([from, tos]) => Array.from(tos).map(to => ({ from, to })))
			.sort((a, b) => {
				const fromCmp = a.from.localeCompare(b.from);
				return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
			})
	};
}

describe("E2E: Diffgraph Planner", () => {
	describe("Real Repository Scenarios", () => {
		describe("Scenario A: Simple Stack (Linear Dependencies)", () => {
			it("should generate linear plan for dependent PRs", async () => {
				const fixture = await loadFixture("simple-stack");

				// Parse PR descriptions to extract dependencies
				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				// Validate no cycles
				expect(() => validateDependencies(parsedPRs)).not.toThrow();

				// Generate plan
				const plan = generatePlanFromParsedPRs(parsedPRs);

				// Assert structure
				assertPlanStructure(plan, {
					layers: fixture.expectedPlan?.layers
				});

				expect(plan.nodes).toHaveLength(3);
				expect(plan.edges).toHaveLength(2);
			});

			it("should have deterministic layer ordering", async () => {
				const fixture = await loadFixture("simple-stack");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan1 = generatePlanFromParsedPRs(parsedPRs);
				const plan2 = generatePlanFromParsedPRs(parsedPRs);
				const plan3 = generatePlanFromParsedPRs(parsedPRs);

				expect(plan1).toEqual(plan2);
				expect(plan2).toEqual(plan3);
			});
		});

		describe("Scenario B: Fan-Out/Fan-In (Diamond Pattern)", () => {
			it("should generate diamond pattern with correct layers", async () => {
				const fixture = await loadFixture("diamond-pattern");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				expect(() => validateDependencies(parsedPRs)).not.toThrow();

				const plan = generatePlanFromParsedPRs(parsedPRs);

				assertPlanStructure(plan, {
					layers: fixture.expectedPlan?.layers
				});

				// Verify layer structure: core → parallel features → integration
				expect(plan.layers[0]).toEqual(["PR-100"]); // Core
				expect(plan.layers[1].sort()).toEqual(["PR-101", "PR-102"]); // Parallel features
				expect(plan.layers[2]).toEqual(["PR-103"]); // Integration
			});
		});

		describe("Scenario C: Mixed Explicit + Implicit Dependencies", () => {
			it("should honor explicit dependencies", async () => {
				const fixture = await loadFixture("mixed-deps");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan = generatePlanFromParsedPRs(parsedPRs);

				// PR-201 explicitly depends on PR-200
				const pr201Deps = parsedPRs.find(p => p.prId === "PR-201")?.dependencies || [];
				expect(pr201Deps).toContain("#200");

				// Verify PR-200 is in earlier layer than PR-201
				const pr200Layer = plan.layers.findIndex(l => l.includes("PR-200"));
				const pr201Layer = plan.layers.findIndex(l => l.includes("PR-201"));
				expect(pr200Layer).toBeLessThan(pr201Layer);
			});

			it("should detect implicit dependencies via file analysis", async () => {
				const fixture = await loadFixture("mixed-deps");

				const mockOctokit = createMockGitHub(fixture.prs);
				const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

				const prs = fixture.prs.map(pr => ({
					number: pr.number,
					name: `PR-${pr.number}`,
					sha: pr.head?.sha
				}));

				const intersections = await analyzer.buildIntersectionMatrix(prs);

				// Should detect file overlap between PR-201 and PR-202 (handlers.ts)
				const overlap = intersections.find(
					i => i.prs.includes("PR-201") && i.prs.includes("PR-202")
				);

				expect(overlap).toBeDefined();
				expect(overlap?.files).toContain("src/api/handlers.ts");
				
				// Should also detect overlap between PR-200 and PR-203 (connection.ts)
				const dbOverlap = intersections.find(
					i => i.prs.includes("PR-200") && i.prs.includes("PR-203")
				);
				
				expect(dbOverlap).toBeDefined();
				expect(dbOverlap?.files).toContain("src/db/connection.ts");
			});
		});

		describe("Scenario D: File-Overlap Heavy (No Explicit Deps)", () => {
			it("should suggest dependencies based on file overlaps", async () => {
				const fixture = await loadFixture("file-overlap-heavy");

				const mockOctokit = createMockGitHub(fixture.prs);
				const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

				const prs = fixture.prs.map(pr => ({
					number: pr.number,
					name: `PR-${pr.number}`,
					sha: pr.head?.sha
				}));

				const suggestions = await analyzer.suggestDependencies(prs);

				// Should have suggestions for PRs modifying same files
				expect(suggestions.length).toBeGreaterThan(0);

				// PR-300 and PR-301 both modify helpers.ts
				const helpersSuggestion = suggestions.find(
					s => (s.from === "PR-300" && s.to === "PR-301") ||
					     (s.from === "PR-301" && s.to === "PR-300")
				);

				expect(helpersSuggestion).toBeDefined();
				expect(helpersSuggestion?.sharedFiles).toContain("src/utils/helpers.ts");
			});
		});

		describe("Scenario E: Cross-Module PRs (Low Overlap)", () => {
			it("should identify independent orphan PRs", async () => {
				const fixture = await loadFixture("cross-module");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan = generatePlanFromParsedPRs(parsedPRs);

				// All PRs should be orphans (no dependencies)
				expect(plan.orphans.sort()).toEqual(
					fixture.expectedPlan?.orphans?.sort()
				);

				// Should have minimal or no file intersections
				const mockOctokit = createMockGitHub(fixture.prs);
				const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

				const prs = fixture.prs.map(pr => ({
					number: pr.number,
					name: `PR-${pr.number}`
				}));

				const intersections = await analyzer.buildIntersectionMatrix(prs);

				// No shared files
				expect(intersections).toHaveLength(0);
			});
		});
	});

	describe("Edge Cases", () => {
		describe("Edge Case 1: Cycle Detection", () => {
			it("should detect and report cycle with clear error", async () => {
				const fixture = await loadFixture("cycle-error");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				// Cycle: PR-500 → PR-502 → PR-501 → PR-500
				expect(() => validateDependencies(parsedPRs)).toThrow(/Circular dependency/);
			});
		});

		describe("Edge Case 2: Self-Dependency", () => {
			it("should detect self-dependency and error", async () => {
				const fixture = await loadFixture("self-dependency");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				// PR-600 depends on itself
				const pr600 = parsedPRs.find(p => p.prId === "PR-600");
				expect(pr600?.dependencies).toContain("#600");

				// This should be caught by validation
				expect(() => validateDependencies(parsedPRs)).toThrow(/Circular dependency/);
			});
		});

		describe("Edge Case 3: Invalid PR Reference", () => {
			it("should handle missing PR gracefully", async () => {
				const fixture = await loadFixture("invalid-pr");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				// PR-700 depends on PR-999 which doesn't exist
				const pr700 = parsedPRs.find(p => p.prId === "PR-700");
				expect(pr700?.dependencies).toContain("#999");

				const plan = generatePlanFromParsedPRs(parsedPRs);

				// Plan should still generate but PR-999 won't be in nodes
				expect(plan.nodes).not.toContain("PR-999");
				expect(plan.nodes).toContain("PR-700");
			});
		});

		describe("Edge Case 4: Stale PR (Merged/Closed)", () => {
			it("should handle closed/merged PRs", async () => {
				const fixture = await loadFixture("stale-pr");

				// PR-801 is merged
				const mergedPR = fixture.prs.find(pr => pr.number === 801);
				expect(mergedPR?.state).toBe("closed");
				expect(mergedPR?.merged).toBe(true);

				// Filter should typically exclude closed PRs
				const openPRs = fixture.prs.filter(pr => pr.state === "open");
				expect(openPRs).toHaveLength(1);
				expect(openPRs[0].number).toBe(800);
			});
		});

		describe("Edge Case 5: Large Batch (100+ PRs)", () => {
			it("should handle 100 PRs in <10s", async () => {
				const prs = createMockPRBatch(100);

				const start = Date.now();

				const parsedPRs = prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan = generatePlanFromParsedPRs(parsedPRs);

				const duration = Date.now() - start;

				expect(plan.nodes).toHaveLength(100);
				expect(duration).toBeLessThan(10000);
			});

			it("should produce deterministic output for 100 PRs", async () => {
				const prs = createMockPRBatch(100);

				const parsedPRs = prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan1 = generatePlanFromParsedPRs(parsedPRs);
				const plan2 = generatePlanFromParsedPRs(parsedPRs);

				expect(plan1).toEqual(plan2);
			});
		});

		describe("Edge Case 6: Merge Conflicts (Predicted)", () => {
			it("should predict high-severity conflicts", async () => {
				const fixture = await loadFixture("merge-conflicts");

				const mockOctokit = createMockGitHub(fixture.prs);
				const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

				const prs = fixture.prs.map(pr => ({
					number: pr.number,
					name: `PR-${pr.number}`
				}));

				const conflicts = await analyzer.predictConflicts(prs);

				// Should detect high-severity conflict
				expect(conflicts).toHaveLength(1);
				expect(conflicts[0].severity).toBe("high");
				expect(conflicts[0].files).toContain("src/core/processor.ts");
				expect(conflicts[0].reason).toContain("Both modify");
			});
		});

		describe("Edge Case 7: Empty Repository", () => {
			it("should handle empty PR list gracefully", async () => {
				const fixture = await loadFixture("empty-repo");

				expect(fixture.prs).toHaveLength(0);

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan = generatePlanFromParsedPRs(parsedPRs);

				expect(plan.layers).toHaveLength(0);
				expect(plan.nodes).toHaveLength(0);
				expect(plan.orphans).toHaveLength(0);
			});
		});

		describe("Edge Case 8: Single PR", () => {
			it("should handle single PR as orphan", async () => {
				const fixture = await loadFixture("single-pr");

				const parsedPRs = fixture.prs.map(pr =>
					parsePRDescription(pr.number, pr.body)
				);

				const plan = generatePlanFromParsedPRs(parsedPRs);

				expect(plan.nodes).toHaveLength(1);
				expect(plan.orphans).toEqual(["PR-900"]);
				expect(plan.layers[0]).toEqual(["PR-900"]);
			});
		});
	});

	describe("Regression Tests", () => {
		it("should maintain deterministic layer ordering", async () => {
			const fixture = await loadFixture("diamond-pattern");

			const parsedPRs = fixture.prs.map(pr =>
				parsePRDescription(pr.number, pr.body)
			);

			// Run multiple times to ensure consistency
			const results = await Promise.all([
				generatePlanFromParsedPRs(parsedPRs),
				generatePlanFromParsedPRs(parsedPRs),
				generatePlanFromParsedPRs(parsedPRs)
			]);

			assertDeepEqual(results[0], results[1]);
			assertDeepEqual(results[1], results[2]);
		});

		it("should produce identical dependency suggestions for same inputs", async () => {
			const fixture = await loadFixture("file-overlap-heavy");

			const mockOctokit = createMockGitHub(fixture.prs);
			const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

			const prs = fixture.prs.map(pr => ({
				number: pr.number,
				name: `PR-${pr.number}`
			}));

			const suggestions1 = await analyzer.suggestDependencies(prs);
			const suggestions2 = await analyzer.suggestDependencies(prs);

			expect(suggestions1).toEqual(suggestions2);
		});

		it("should handle unicode in PR titles without breaking parsing", async () => {
			const prWithUnicode = {
				number: 999,
				title: "🚀 Feature: Add émojis and spëcial chars",
				body: "Implements feature with unicode\n\nDepends-on: #100",
				state: "open" as const,
				merged: false,
				files: [
					{
						filename: "src/feature.ts",
						status: "added",
						additions: 50,
						deletions: 0,
						changes: 50
					}
				]
			};

			const parsed = parsePRDescription(prWithUnicode.number, prWithUnicode.body);

			expect(parsed.prId).toBe("PR-999");
			expect(parsed.dependencies).toContain("#100");
		});
	});

	describe("Performance Benchmarks", () => {
		it("should generate plan for 10 PRs in <1s", async () => {
			const prs = createMockPRBatch(10);

			const start = Date.now();

			const parsedPRs = prs.map(pr =>
				parsePRDescription(pr.number, pr.body)
			);

			const plan = generatePlanFromParsedPRs(parsedPRs);

			const duration = Date.now() - start;

			expect(plan.nodes).toHaveLength(10);
			expect(duration).toBeLessThan(1000);
		});

		it("should generate plan for 100 PRs in <10s", async () => {
			const prs = createMockPRBatch(100);

			const start = Date.now();

			const parsedPRs = prs.map(pr =>
				parsePRDescription(pr.number, pr.body)
			);

			const plan = generatePlanFromParsedPRs(parsedPRs);

			const duration = Date.now() - start;

			expect(plan.nodes).toHaveLength(100);
			expect(duration).toBeLessThan(10000);
		});

		it("should handle file analysis for 20 PRs efficiently", async () => {
			const prs = createMockPRBatch(20);

			const mockOctokit = createMockGitHub(prs);
			const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

			const prInputs = prs.map(pr => ({
				number: pr.number,
				name: `PR-${pr.number}`
			}));

			const start = Date.now();
			await analyzer.buildIntersectionMatrix(prInputs);
			const duration = Date.now() - start;

			// Should complete in reasonable time
			expect(duration).toBeLessThan(5000);
		});
	});

	describe("Determinism Tests", () => {
		it("should produce identical plans for same inputs", async () => {
			const fixture = await loadFixture("mixed-deps");

			const parsedPRs = fixture.prs.map(pr =>
				parsePRDescription(pr.number, pr.body)
			);

			const plan1 = generatePlanFromParsedPRs(parsedPRs);
			const plan2 = generatePlanFromParsedPRs(parsedPRs);
			const plan3 = generatePlanFromParsedPRs(parsedPRs);

			expect(plan1).toEqual(plan2);
			expect(plan2).toEqual(plan3);
		});

		it("should produce identical scores for same file changes", async () => {
			const fixture = await loadFixture("file-overlap-heavy");

			const mockOctokit = createMockGitHub(fixture.prs);
			const analyzer = new FileAnalyzer(mockOctokit, "testowner", "testrepo");

			const prs = fixture.prs.map(pr => ({
				number: pr.number,
				name: `PR-${pr.number}`
			}));

			const suggestions1 = await analyzer.suggestDependencies(prs);
			const suggestions2 = await analyzer.suggestDependencies(prs);

			expect(suggestions1).toEqual(suggestions2);

			// Verify confidence scores are deterministic
			for (let i = 0; i < suggestions1.length; i++) {
				expect(suggestions1[i].confidence).toBe(suggestions2[i].confidence);
			}
		});

		it("should maintain order across multiple runs", async () => {
			const fixture = await loadFixture("simple-stack");

			const parsedPRs = fixture.prs.map(pr =>
				parsePRDescription(pr.number, pr.body)
			);

			const runs: any[] = [];
			for (let i = 0; i < 5; i++) {
				runs.push(generatePlanFromParsedPRs(parsedPRs));
			}

			// All runs should be identical
			for (let i = 1; i < runs.length; i++) {
				expect(runs[i]).toEqual(runs[0]);
			}
		});
	});
});
