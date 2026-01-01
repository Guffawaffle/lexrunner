/**
 * Integration test for D1 Analyzer
 *
 * Demonstrates the full workflow: HarvestBundle → AnalysisPool
 */

import { describe, it, expect } from "vitest";
import { analyze, saveAnalysisPool, loadAnalysisPool } from "../../../src/fanout/analyzer.js";
import type { HarvestBundle } from "../../../src/fanout/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Create a realistic HarvestBundle for integration testing
 */
function createRealisticBundle(): HarvestBundle {
  return {
    schemaVersion: "1.0.0",
    provenance: {
      harvestedAt: "2025-01-01T00:00:00Z",
      toolVersion: "lexrunner@0.8.0",
      inputDigest: "abc123def456",
    },
    queryParams: {
      owner: "testorg",
      repo: "testrepo",
      issueFilter: { state: "open" },
    },
    repoPin: {
      defaultBranch: "main",
      defaultBranchSha: "sha123abc",
      fetchedAt: "2025-01-01T00:00:00Z",
    },
    issues: [
      {
        number: 1,
        nodeId: "I_node1",
        title: "Refactor authentication module",
        body: `
## Description
Refactor the authentication module to use JWT tokens.

## Acceptance Criteria
- [ ] JWT tokens are generated
- [ ] Tokens are verified
- [ ] Tests pass

## Definition of Done
- Code reviewed
- Tests added
- Documentation updated

## Affected Files
- src/auth/jwt.ts
- src/auth/middleware.ts
- tests/auth/jwt.spec.ts
        `,
        state: "open",
        labels: ["enhancement", "auth"],
        assignees: ["copilot"],
        author: "dev1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        comments: [],
        commentsFetched: false,
        commentsCount: 0,
      },
      {
        number: 2,
        nodeId: "I_node2",
        title: "Add user profile API",
        body: `
## Description
Add API endpoints for user profile management.

Depends-on: #1

## Acceptance Criteria
- [ ] GET /profile endpoint works
- [ ] PUT /profile endpoint works

## Files
- src/api/profile.ts
- src/auth/middleware.ts
- tests/api/profile.spec.ts
        `,
        state: "open",
        labels: ["feature", "api"],
        assignees: ["dev2"],
        author: "dev2",
        createdAt: "2025-01-01T01:00:00Z",
        updatedAt: "2025-01-01T01:00:00Z",
        comments: [],
        commentsFetched: false,
        commentsCount: 0,
      },
      {
        number: 3,
        nodeId: "I_node3",
        title: "Fix typo in README",
        body: `
## Description
Fix a typo in the README file.

## Acceptance Criteria
- [ ] Typo fixed
- [ ] Spelling checked

## Definition of Done
- Reviewed

## Files
- README.md
        `,
        state: "open",
        labels: ["documentation"],
        assignees: [],
        author: "dev1",
        createdAt: "2025-01-01T02:00:00Z",
        updatedAt: "2025-01-01T02:00:00Z",
        comments: [],
        commentsFetched: false,
        commentsCount: 0,
      },
      {
        number: 4,
        nodeId: "I_node4",
        title: "Refactor database layer",
        body: `
Large refactoring task affecting 20 files and approximately 1500 lines.

This is complex and lacks clear acceptance criteria.
        `,
        state: "open",
        labels: ["refactor"],
        assignees: [],
        author: "dev3",
        createdAt: "2025-01-01T03:00:00Z",
        updatedAt: "2025-01-01T03:00:00Z",
        comments: [],
        commentsFetched: false,
        commentsCount: 0,
      },
    ],
    pullRequests: [
      {
        number: 10,
        nodeId: "PR_node10",
        title: "Implement caching layer",
        body: "Add Redis caching",
        state: "open",
        labels: ["enhancement"],
        assignees: ["dev1"],
        author: "dev1",
        createdAt: "2025-01-01T04:00:00Z",
        updatedAt: "2025-01-01T04:00:00Z",
        headSha: "head123",
        baseSha: "base123",
        mergeBaseSha: "merge123",
        baseBranch: "main",
        headBranch: "feature/cache",
        diff: null,
        diffTruncated: false,
        diffBytesCaptured: 0,
        touchedFiles: ["src/cache/redis.ts", "src/auth/middleware.ts"],
        reviewComments: [],
        ciStatus: {
          state: "success",
          totalChecks: 5,
          passedChecks: 5,
          failedChecks: 0,
        },
      },
    ],
    securitySignals: {
      source: "npm_audit",
      fetchedAt: "2025-01-01T00:00:00Z",
      vulnerabilities: [
        {
          severity: "high",
          package: "lodash",
          fixAvailable: true,
          advisory: "https://github.com/advisories/GHSA-xxxx",
        },
        {
          severity: "moderate",
          package: "axios",
          fixAvailable: false,
          advisory: "https://github.com/advisories/GHSA-yyyy",
        },
      ],
      fetchError: null,
    },
  };
}

describe("D1 Analyzer Integration", () => {
  it("should analyze a realistic HarvestBundle end-to-end", () => {
    const bundle = createRealisticBundle();
    const pool = analyze(bundle);

    // Verify schema version
    expect(pool.schemaVersion).toBe("1.0.0");

    // Verify provenance
    expect(pool.harvestDigest).toBeDefined();
    expect(pool.analyzedAt).toBeDefined();
    expect(pool.toolVersion).toBe("lexrunner@0.8.0");

    // Verify all issues were analyzed
    expect(pool.issues).toHaveLength(4);

    // Verify issue 1 (well-defined, ready)
    const issue1 = pool.issues.find((i) => i.issueNumber === 1);
    expect(issue1).toBeDefined();
    expect(issue1?.hasAcceptanceCriteria).toBe(true);
    expect(issue1?.hasDefinitionOfDone).toBe(true);
    expect(issue1?.hasCopilotAssignment).toBe(true);
    expect(issue1?.affectedFiles).toContain("src/auth/jwt.ts");
    expect(issue1?.affectedModules).toContain("auth");
    expect(issue1?.judgmentRequired.required).toBe(false);

    // Verify issue 2 (depends on issue 1)
    const issue2 = pool.issues.find((i) => i.issueNumber === 2);
    expect(issue2).toBeDefined();
    expect(issue2?.explicitDependencies).toContainEqual({
      type: "depends-on",
      target: "#1",
    });
    expect(issue2?.hasAcceptanceCriteria).toBe(true);

    // Verify issue 3 (independent, well-defined)
    const issue3 = pool.issues.find((i) => i.issueNumber === 3);
    expect(issue3).toBeDefined();
    expect(issue3?.affectedFiles).toContain("README.md");
    expect(issue3?.hasAcceptanceCriteria).toBe(true);

    // Verify issue 4 (complex, judgment required)
    const issue4 = pool.issues.find((i) => i.issueNumber === 4);
    expect(issue4).toBeDefined();
    expect(issue4?.complexity.estimatedFiles).toBe(20);
    expect(issue4?.complexity.estimatedLines).toBe(1500);
    expect(issue4?.complexity.score).toBeGreaterThanOrEqual(5);
    expect(issue4?.judgmentRequired.required).toBe(true);
    expect(issue4?.judgmentRequired.reasons).toContain("missing AC");
    expect(issue4?.judgmentRequired.reasons).toContain("missing DOD");
    expect(issue4?.judgmentRequired.reasons).toContain("ambiguous scope");

    // Verify overlaps
    expect(pool.overlaps.length).toBeGreaterThan(0);
    // Issues 1 and 2 should have some overlap (both touch middleware)
    const overlap12 = pool.overlaps.find((o) => o.issue1 === 1 && o.issue2 === 2);
    expect(overlap12).toBeDefined();
    expect(overlap12?.breakdown.fileOverlap).toBeGreaterThan(0);

    // Verify dependency graph
    expect(pool.dependencyGraph).toHaveLength(4);
    const dep2 = pool.dependencyGraph.find((d) => d.issueNumber === 2);
    expect(dep2?.dependsOn).toContain(1);

    // Verify layer classification
    expect(pool.layers["0"]).toBeDefined();
    expect(pool.layers["0"]).toContain(1); // Issue 1 has no deps
    expect(pool.layers["0"]).toContain(3); // Issue 3 has no deps
    expect(pool.layers["1"]).toBeDefined();
    expect(pool.layers["1"]).toContain(2); // Issue 2 depends on issue 1

    // Verify ready issues
    expect(pool.readyIssues).toContain(1); // Well-defined, layer 0
    expect(pool.readyIssues).toContain(3); // Well-defined, layer 0
    expect(pool.readyIssues).not.toContain(2); // Not layer 0
    expect(pool.readyIssues).not.toContain(4); // Judgment required

    // Verify hotspots
    // src/auth/middleware.ts is touched by issues 1, 2 and PR 10
    const middlewareHotspot = pool.hotspots.find((h) => h.path === "src/auth/middleware.ts");
    expect(middlewareHotspot).toBeDefined();
    expect(middlewareHotspot?.touchedByIssues).toContain(1);
    expect(middlewareHotspot?.touchedByIssues).toContain(2);

    // Verify security posture
    expect(pool.securityPosture.source).toBe("npm_audit");
    expect(pool.securityPosture.totalVulnerabilities).toBe(2);
    expect(pool.securityPosture.fixableVulnerabilities).toBe(1);

    // Verify summary
    expect(pool.summary.totalIssues).toBe(4);
    expect(pool.summary.totalPRs).toBe(1);
    expect(pool.summary.maxLayer).toBeGreaterThanOrEqual(1);
    expect(pool.summary.judgmentRequiredCount).toBeGreaterThanOrEqual(1);

    // Verify all evidence IDs are unique and properly formatted
    const allEvidenceIds = [
      ...pool.issues.map((i) => i.evidenceId),
      ...pool.overlaps.map((o) => o.evidenceId),
      ...pool.hotspots.map((h) => h.evidenceId),
    ];
    const uniqueIds = new Set(allEvidenceIds);
    expect(uniqueIds.size).toBe(allEvidenceIds.length);
    for (const id of allEvidenceIds) {
      expect(id).toMatch(/^E-[A-Z]+-\d{3,}$/);
    }
  });

  it("should support save/load roundtrip", async () => {
    const bundle = createRealisticBundle();
    const pool = analyze(bundle);

    // Save to temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lexrunner-test-"));
    const tmpFile = path.join(tmpDir, "pool.json");

    try {
      await saveAnalysisPool(pool, tmpFile);

      // Verify file exists
      const stat = await fs.stat(tmpFile);
      expect(stat.isFile()).toBe(true);

      // Load it back
      const loaded = await loadAnalysisPool(tmpFile);

      // Verify it matches
      expect(loaded).toEqual(pool);
    } finally {
      // Clean up
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should be deterministic across multiple runs", () => {
    const bundle = createRealisticBundle();

    const pool1 = analyze(bundle);
    const pool2 = analyze(bundle);
    const pool3 = analyze(bundle);

    // All pools should be identical except for analyzedAt timestamp
    // Compare issues (should be deterministic)
    expect(pool1.issues).toEqual(pool2.issues);
    expect(pool2.issues).toEqual(pool3.issues);

    // Compare overlaps (should be deterministic)
    expect(pool1.overlaps).toEqual(pool2.overlaps);
    expect(pool2.overlaps).toEqual(pool3.overlaps);

    // Compare dependency graph (should be deterministic)
    expect(pool1.dependencyGraph).toEqual(pool2.dependencyGraph);
    expect(pool2.dependencyGraph).toEqual(pool3.dependencyGraph);

    // Evidence IDs should be the same
    expect(pool1.issues[0].evidenceId).toBe(pool2.issues[0].evidenceId);
    expect(pool1.overlaps[0]?.evidenceId).toBe(pool2.overlaps[0]?.evidenceId);

    // Timestamps will differ, but should be valid ISO strings
    expect(pool1.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(pool2.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should handle empty bundles gracefully", () => {
    const emptyBundle: HarvestBundle = {
      schemaVersion: "1.0.0",
      provenance: {
        harvestedAt: "2025-01-01T00:00:00Z",
        toolVersion: "lexrunner@0.8.0",
        inputDigest: "empty",
      },
      queryParams: {
        owner: "test",
        repo: "repo",
      },
      repoPin: {
        defaultBranch: "main",
        defaultBranchSha: "sha123",
        fetchedAt: "2025-01-01T00:00:00Z",
      },
      issues: [],
      pullRequests: [],
      securitySignals: {
        source: "none",
        fetchedAt: null,
        vulnerabilities: null,
        fetchError: null,
      },
    };

    const pool = analyze(emptyBundle);

    expect(pool.issues).toHaveLength(0);
    expect(pool.overlaps).toHaveLength(0);
    expect(pool.dependencyGraph).toHaveLength(0);
    expect(pool.hotspots).toHaveLength(0);
    expect(pool.readyIssues).toHaveLength(0);
    expect(pool.summary.totalIssues).toBe(0);
    expect(pool.summary.totalPRs).toBe(0);
  });
});
