/**
 * Unit tests for D1 Analyzer module
 *
 * Tests the pure analysis functions with deterministic inputs.
 */

import { describe, it, expect } from "vitest";
import { analyze } from "../../../src/fanout/analyzer.js";
import type { HarvestBundle, HarvestedIssue } from "../../../src/fanout/types.js";

/**
 * Create a minimal HarvestBundle for testing
 */
function createTestBundle(issues: HarvestedIssue[]): HarvestBundle {
  return {
    schemaVersion: "1.0.0",
    provenance: {
      harvestedAt: "2025-01-01T00:00:00Z",
      toolVersion: "lexrunner@0.8.0",
      inputDigest: "test-digest",
    },
    queryParams: {
      owner: "test",
      repo: "repo",
    },
    repoPin: {
      defaultBranch: "main",
      defaultBranchSha: "abc123",
      fetchedAt: "2025-01-01T00:00:00Z",
    },
    issues,
    pullRequests: [],
    securitySignals: {
      source: "none",
      fetchedAt: null,
      vulnerabilities: null,
      fetchError: null,
    },
  };
}

/**
 * Create a test issue
 */
function createTestIssue(number: number, body: string, assignees: string[] = []): HarvestedIssue {
  return {
    number,
    nodeId: `node-${number}`,
    title: `Issue ${number}`,
    body,
    state: "open",
    labels: [],
    assignees,
    author: "testuser",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    comments: [],
    commentsFetched: false,
    commentsCount: 0,
  };
}

describe("D1 Analyzer", () => {
  describe("analyze()", () => {
    it("should produce an AnalysisPool with correct schema", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Fix bug in src/utils.ts"),
        createTestIssue(2, "Add feature to src/components/Button.tsx"),
      ]);

      const pool = analyze(bundle);

      expect(pool.schemaVersion).toBe("1.0.0");
      expect(pool.harvestDigest).toBeDefined();
      expect(pool.analyzedAt).toBeDefined();
      expect(pool.toolVersion).toBeDefined();
      expect(pool.issues).toHaveLength(2);
      expect(pool.overlaps).toHaveLength(1); // Only 1 pair for 2 issues
      expect(pool.dependencyGraph).toHaveLength(2);
      expect(pool.hotspots).toBeDefined();
      expect(pool.layers).toBeDefined();
      expect(pool.readyIssues).toBeDefined();
      expect(pool.securityPosture).toBeDefined();
      expect(pool.summary).toBeDefined();
    });

    it("should be deterministic (same input → same output)", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Fix bug in src/utils.ts"),
        createTestIssue(2, "Add feature"),
      ]);

      const pool1 = analyze(bundle);
      const pool2 = analyze(bundle);

      // Evidence IDs should be the same
      expect(pool1.issues[0].evidenceId).toBe(pool2.issues[0].evidenceId);
      expect(pool1.issues[1].evidenceId).toBe(pool2.issues[1].evidenceId);
      expect(pool1.overlaps[0]?.evidenceId).toBe(pool2.overlaps[0]?.evidenceId);

      // All other fields should match
      expect(pool1.issues).toEqual(pool2.issues);
      expect(pool1.overlaps).toEqual(pool2.overlaps);
      expect(pool1.dependencyGraph).toEqual(pool2.dependencyGraph);
    });

    it("should link back to harvest via digest", () => {
      const bundle = createTestBundle([createTestIssue(1, "Test")]);
      const pool = analyze(bundle);

      expect(pool.harvestDigest).toBeDefined();
      expect(pool.harvestDigest).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });
  });

  describe("Issue Analysis", () => {
    it("should extract affected files from issue body", () => {
      const bundle = createTestBundle([
        createTestIssue(
          1,
          `
# Bug Description
Need to fix src/utils/helper.ts and src/components/Button.tsx

Also affects:
- src/types/index.ts
- tests/utils.spec.ts
        `
        ),
      ]);

      const pool = analyze(bundle);
      const issue = pool.issues[0];

      expect(issue.affectedFiles).toContain("src/utils/helper.ts");
      expect(issue.affectedFiles).toContain("src/components/Button.tsx");
      expect(issue.affectedFiles).toContain("src/types/index.ts");
      expect(issue.affectedFiles).toContain("tests/utils.spec.ts");
    });

    it("should extract modules from files", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Modify src/utils/a.ts and src/components/b.tsx"),
      ]);

      const pool = analyze(bundle);
      const issue = pool.issues[0];

      expect(issue.affectedModules).toContain("utils");
      expect(issue.affectedModules).toContain("components");
    });

    it("should extract dependencies", () => {
      const bundle = createTestBundle([
        createTestIssue(
          1,
          `
## Dependencies
Depends-on: #2
Requires: #3
Blocks: #4
Blocked by: #5
        `
        ),
      ]);

      const pool = analyze(bundle);
      const issue = pool.issues[0];

      expect(issue.explicitDependencies).toContainEqual({ type: "depends-on", target: "#2" });
      expect(issue.explicitDependencies).toContainEqual({ type: "depends-on", target: "#3" });
      expect(issue.explicitDependencies).toContainEqual({ type: "blocks", target: "#4" });
      expect(issue.explicitDependencies).toContainEqual({ type: "blocked-by", target: "#5" });
    });

    it("should detect acceptance criteria", () => {
      const bundle = createTestBundle([
        createTestIssue(
          1,
          `
## Acceptance Criteria
- [ ] Feature works
- [ ] Tests pass
        `
        ),
        createTestIssue(2, "No AC here"),
      ]);

      const pool = analyze(bundle);

      expect(pool.issues[0].hasAcceptanceCriteria).toBe(true);
      expect(pool.issues[1].hasAcceptanceCriteria).toBe(false);
    });

    it("should detect definition of done", () => {
      const bundle = createTestBundle([
        createTestIssue(
          1,
          `
## Definition of Done
- Code reviewed
- Tests added
        `
        ),
        createTestIssue(2, "No DOD here"),
      ]);

      const pool = analyze(bundle);

      expect(pool.issues[0].hasDefinitionOfDone).toBe(true);
      expect(pool.issues[1].hasDefinitionOfDone).toBe(false);
    });

    it("should detect Copilot assignment", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Task for Copilot", ["copilot"]),
        createTestIssue(2, "Task for human", ["dev1"]),
      ]);

      const pool = analyze(bundle);

      expect(pool.issues[0].hasCopilotAssignment).toBe(true);
      expect(pool.issues[1].hasCopilotAssignment).toBe(false);
    });

    it("should compute complexity", () => {
      const bundle = createTestBundle([
        createTestIssue(
          1,
          `
Need to update 15 files
Estimated 800 lines of code changes
        `
        ),
        createTestIssue(2, "Small fix"),
      ]);

      const pool = analyze(bundle);

      expect(pool.issues[0].complexity.estimatedFiles).toBe(15);
      expect(pool.issues[0].complexity.estimatedLines).toBe(800);
      expect(pool.issues[0].complexity.score).toBeGreaterThan(0);
      expect(pool.issues[0].complexity.confidence).toBe("high");

      expect(pool.issues[1].complexity.score).toBeLessThan(pool.issues[0].complexity.score);
    });

    it("should determine judgment required", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Well-defined task\n## AC\n- [ ] Done\n## DOD\n- Done\n- src/file.ts"),
        createTestIssue(2, "Vague task with no AC or files"),
      ]);

      const pool = analyze(bundle);

      expect(pool.issues[0].judgmentRequired.required).toBe(false);
      expect(pool.issues[1].judgmentRequired.required).toBe(true);
      expect(pool.issues[1].judgmentRequired.reasons).toContain("missing AC");
      expect(pool.issues[1].judgmentRequired.reasons).toContain("missing DOD");
      expect(pool.issues[1].judgmentRequired.reasons).toContain("ambiguous scope");
    });

    it("should assign evidence IDs to issues", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Issue 1"),
        createTestIssue(2, "Issue 2"),
      ]);

      const pool = analyze(bundle);

      expect(pool.issues[0].evidenceId).toMatch(/^E-ISSUE-\d{3}$/);
      expect(pool.issues[1].evidenceId).toMatch(/^E-ISSUE-\d{3}$/);
      expect(pool.issues[0].evidenceId).not.toBe(pool.issues[1].evidenceId);
    });
  });

  describe("Overlap Computation", () => {
    it("should compute file overlap", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Modify src/a.ts and src/b.ts"),
        createTestIssue(2, "Modify src/b.ts and src/c.ts"),
      ]);

      const pool = analyze(bundle);
      const overlap = pool.overlaps[0];

      expect(overlap.issue1).toBe(1);
      expect(overlap.issue2).toBe(2);
      expect(overlap.breakdown.fileOverlap).toBeGreaterThan(0);
      expect(overlap.score).toBeGreaterThan(0);
    });

    it("should compute directory overlap", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Modify src/utils/a.ts and src/utils/b.ts"),
        createTestIssue(2, "Modify src/utils/c.ts and src/components/d.tsx"),
      ]);

      const pool = analyze(bundle);
      const overlap = pool.overlaps[0];

      expect(overlap.breakdown.directoryOverlap).toBeGreaterThan(0);
    });

    it("should compute module overlap", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Modify src/utils/a.ts and src/utils/b.ts"),
        createTestIssue(2, "Modify src/utils/c.ts and src/components/d.tsx"),
      ]);

      const pool = analyze(bundle);
      const overlap = pool.overlaps[0];

      expect(overlap.breakdown.moduleOverlap).toBeGreaterThan(0);
    });

    it("should determine conflict risk", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Modify src/same.ts and src/other.ts"),
        createTestIssue(2, "Modify src/same.ts and src/other.ts"),
        createTestIssue(3, "Modify src/different.ts"),
      ]);

      const pool = analyze(bundle);

      // High overlap between 1 and 2
      const overlap12 = pool.overlaps.find((o) => o.issue1 === 1 && o.issue2 === 2);
      expect(overlap12?.conflictRisk).toBe("high");

      // Low/no overlap between 1 and 3
      const overlap13 = pool.overlaps.find((o) => o.issue1 === 1 && o.issue2 === 3);
      expect(overlap13?.conflictRisk).toMatch(/^(none|low)$/);
    });

    it("should assign evidence IDs to overlaps", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Issue 1"),
        createTestIssue(2, "Issue 2"),
        createTestIssue(3, "Issue 3"),
      ]);

      const pool = analyze(bundle);

      expect(pool.overlaps[0].evidenceId).toMatch(/^E-OVERLAP-\d{3}$/);
      expect(pool.overlaps[1].evidenceId).toMatch(/^E-OVERLAP-\d{3}$/);
      expect(pool.overlaps[2].evidenceId).toMatch(/^E-OVERLAP-\d{3}$/);
    });

    it("should produce deterministic overlap order", () => {
      const bundle = createTestBundle([
        createTestIssue(3, "Issue 3"),
        createTestIssue(1, "Issue 1"),
        createTestIssue(2, "Issue 2"),
      ]);

      const pool = analyze(bundle);

      // Overlaps should be sorted by (issue1, issue2)
      expect(pool.overlaps[0].issue1).toBeLessThanOrEqual(pool.overlaps[0].issue2);
      if (pool.overlaps.length > 1) {
        expect(pool.overlaps[0].issue1).toBeLessThanOrEqual(pool.overlaps[1].issue1);
      }
    });
  });

  describe("Dependency Graph", () => {
    it("should build dependency graph from explicit deps", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Base task"),
        createTestIssue(2, "Depends-on: #1"),
        createTestIssue(3, "Depends-on: #2"),
      ]);

      const pool = analyze(bundle);

      const node1 = pool.dependencyGraph.find((n) => n.issueNumber === 1);
      const node2 = pool.dependencyGraph.find((n) => n.issueNumber === 2);
      const node3 = pool.dependencyGraph.find((n) => n.issueNumber === 3);

      expect(node1?.dependsOn).toEqual([]);
      expect(node2?.dependsOn).toEqual([1]);
      expect(node3?.dependsOn).toEqual([2]);
    });

    it("should handle blocks relationships", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Blocks: #2"),
        createTestIssue(2, "Blocked task"),
      ]);

      const pool = analyze(bundle);

      const node2 = pool.dependencyGraph.find((n) => n.issueNumber === 2);
      expect(node2?.dependsOn).toEqual([1]);
    });

    it("should handle blocked-by relationships", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Blocker"),
        createTestIssue(2, "Blocked by: #1"),
      ]);

      const pool = analyze(bundle);

      const node2 = pool.dependencyGraph.find((n) => n.issueNumber === 2);
      expect(node2?.blockedBy).toEqual([1]);
    });

    it("should ignore dependencies to non-existent issues", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Depends-on: #999"),
        createTestIssue(2, "Normal task"),
      ]);

      const pool = analyze(bundle);

      const node1 = pool.dependencyGraph.find((n) => n.issueNumber === 1);
      expect(node1?.dependsOn).toEqual([]);
    });
  });

  describe("Layer Classification", () => {
    it("should classify issues into layers", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Base task"),
        createTestIssue(2, "Depends-on: #1"),
        createTestIssue(3, "Depends-on: #2"),
      ]);

      const pool = analyze(bundle);

      expect(pool.layers["0"]).toContain(1);
      expect(pool.layers["1"]).toContain(2);
      expect(pool.layers["2"]).toContain(3);
    });

    it("should put independent issues in layer 0", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Independent task 1"),
        createTestIssue(2, "Independent task 2"),
        createTestIssue(3, "Independent task 3"),
      ]);

      const pool = analyze(bundle);

      expect(pool.layers["0"]).toContain(1);
      expect(pool.layers["0"]).toContain(2);
      expect(pool.layers["0"]).toContain(3);
    });

    it("should compute maxLayer in summary", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Base"),
        createTestIssue(2, "Depends-on: #1"),
        createTestIssue(3, "Depends-on: #2"),
      ]);

      const pool = analyze(bundle);

      expect(pool.summary.maxLayer).toBe(2);
    });

    it("should identify ready issues", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Ready task\n## AC\n- [ ] Done\n## DOD\n- Done\n- src/file.ts"),
        createTestIssue(2, "Not ready (missing AC)\n- src/file.ts"),
        createTestIssue(3, "Depends-on: #1\n## AC\n- [ ] Done\n## DOD\n- Done"),
      ]);

      const pool = analyze(bundle);

      // Issue 1 is layer 0 and has no judgment required
      expect(pool.readyIssues).toContain(1);
      // Issue 2 is layer 0 but has judgment required
      expect(pool.readyIssues).not.toContain(2);
      // Issue 3 is not layer 0
      expect(pool.readyIssues).not.toContain(3);
    });
  });

  describe("Hotspot Computation", () => {
    it("should identify files touched by multiple issues", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "Modify src/hotfile.ts"),
        createTestIssue(2, "Also modify src/hotfile.ts"),
        createTestIssue(3, "Also modify src/hotfile.ts"),
      ]);

      const pool = analyze(bundle);

      const hotspot = pool.hotspots.find((h) => h.path === "src/hotfile.ts");
      expect(hotspot).toBeDefined();
      expect(hotspot?.touchedByIssues).toEqual([1, 2, 3]);
    });

    it("should determine risk level based on touch count", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "src/low.ts"),
        createTestIssue(2, "src/low.ts"),
        createTestIssue(3, "src/medium.ts"),
        createTestIssue(4, "src/medium.ts"),
        createTestIssue(5, "src/medium.ts"),
        createTestIssue(6, "src/high.ts"),
        createTestIssue(7, "src/high.ts"),
        createTestIssue(8, "src/high.ts"),
        createTestIssue(9, "src/high.ts"),
        createTestIssue(10, "src/high.ts"),
      ]);

      const pool = analyze(bundle);

      const lowHotspot = pool.hotspots.find((h) => h.path === "src/low.ts");
      const mediumHotspot = pool.hotspots.find((h) => h.path === "src/medium.ts");
      const highHotspot = pool.hotspots.find((h) => h.path === "src/high.ts");

      expect(lowHotspot?.riskLevel).toBe("low");
      expect(mediumHotspot?.riskLevel).toBe("medium");
      expect(highHotspot?.riskLevel).toBe("high");
    });

    it("should assign evidence IDs to hotspots", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "src/a.ts"),
        createTestIssue(2, "src/a.ts"),
      ]);

      const pool = analyze(bundle);

      expect(pool.hotspots[0]?.evidenceId).toMatch(/^E-HOTSPOT-\d{3}$/);
    });

    it("should not create hotspots for single-touch files", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "src/unique1.ts"),
        createTestIssue(2, "src/unique2.ts"),
      ]);

      const pool = analyze(bundle);

      expect(pool.hotspots).toHaveLength(0);
    });
  });

  describe("Security Posture", () => {
    it("should extract security posture from harvest", () => {
      const bundle = createTestBundle([createTestIssue(1, "Test")]);
      bundle.securitySignals = {
        source: "npm_audit",
        fetchedAt: "2025-01-01T00:00:00Z",
        vulnerabilities: [
          { severity: "high", package: "lodash", fixAvailable: true },
          { severity: "moderate", package: "axios", fixAvailable: false },
        ],
        fetchError: null,
      };

      const pool = analyze(bundle);

      expect(pool.securityPosture.source).toBe("npm_audit");
      expect(pool.securityPosture.totalVulnerabilities).toBe(2);
      expect(pool.securityPosture.fixableVulnerabilities).toBe(1);
    });

    it("should handle missing security signals", () => {
      const bundle = createTestBundle([createTestIssue(1, "Test")]);

      const pool = analyze(bundle);

      expect(pool.securityPosture.source).toBe("none");
      expect(pool.securityPosture.totalVulnerabilities).toBeNull();
      expect(pool.securityPosture.fixableVulnerabilities).toBeNull();
    });
  });

  describe("Summary Statistics", () => {
    it("should compute summary stats", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "src/same.ts"),
        createTestIssue(2, "src/same.ts"),
        createTestIssue(3, "src/other.ts"),
      ]);

      const pool = analyze(bundle);

      expect(pool.summary.totalIssues).toBe(3);
      expect(pool.summary.totalPRs).toBe(0);
      expect(pool.summary.highOverlapPairs).toBeGreaterThanOrEqual(0);
      expect(pool.summary.maxLayer).toBeGreaterThanOrEqual(0);
      expect(pool.summary.judgmentRequiredCount).toBeGreaterThanOrEqual(0);
    });

    it("should count high overlap pairs", () => {
      const bundle = createTestBundle([
        createTestIssue(1, "src/same.ts and src/other.ts"),
        createTestIssue(2, "src/same.ts and src/other.ts"),
        createTestIssue(3, "src/different.ts"),
      ]);

      const pool = analyze(bundle);

      // Issues 1 and 2 should have high overlap
      expect(pool.summary.highOverlapPairs).toBeGreaterThan(0);
    });
  });
});
