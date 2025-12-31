/**
 * D1 Determinism Test - Replayable Analysis Pipeline
 *
 * Non-negotiable §2: "Determinism before judgment"
 * Same HarvestBundle → identical AnalysisPool, always.
 *
 * This test validates that the D1 analyze phase is pure:
 * - No side effects
 * - No timestamp contamination in deterministic fields
 * - Identical output for identical input
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// =============================================================================
// TYPES (matching schemas)
// =============================================================================

interface HarvestBundle {
  schemaVersion: "1.0.0";
  phase: "D0";
  timestamp: string;
  inputDigest: string;
  bundle: Bundle;
  outputDigest: string;
}

interface Bundle {
  repository: Repository;
  pullRequests: HarvestPR[];
  issues: HarvestIssue[];
  harvestedAt: string;
}

interface Repository {
  owner: string;
  name: string;
  defaultBranch: string;
  defaultBranchSha: string;
}

interface HarvestPR {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  headSha: string;
  baseSha: string;
  mergeBaseSha: string | "unknown" | "unavailable";
  author: string;
  labels: string[];
  ciStatus: "pass" | "fail" | "pending" | "unknown" | "unavailable";
  reviewStatus: "approved" | "changes_requested" | "pending" | "none" | "unknown" | "unavailable";
  conflictStatus: "clean" | "conflicted" | "unknown" | "unavailable";
  updatedAt: string;
  body: string | "truncated";
  changedFiles: number | "unknown" | "unavailable";
  additions: number | "unknown" | "unavailable";
  deletions: number | "unknown" | "unavailable";
}

interface HarvestIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  labels: string[];
  updatedAt: string;
  body: string | "truncated";
  assignees: string[];
}

interface AnalysisPool {
  schemaVersion: "1.0.0";
  phase: "D1";
  timestamp: string;
  inputDigest: string;
  pool: Pool;
  outputDigest: string;
}

interface Pool {
  entities: Entity[];
  relations: Relation[];
  conflicts: Conflict[];
  blockers: Blocker[];
}

interface Entity {
  eid: string;
  type: "pull_request" | "issue" | "commit" | "branch";
  ref: string;
  facts: Fact[];
}

interface Fact {
  key: string;
  value: string | boolean | number | string[];
  source: "api" | "computed" | "inferred";
  confidence: "known" | "unknown" | "unavailable";
}

interface Relation {
  type: string;
  from: string;
  to: string;
  source: string;
  confidence: string;
}

interface Conflict {
  type: string;
  entities: string[];
  files?: string[];
  resolution: string;
}

interface Blocker {
  type: string;
  entity: string;
  reason: string;
}

// =============================================================================
// ANALYSIS LOGIC (copied from fanout-analyze.ts for unit testing)
// =============================================================================

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function canonicalStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = v[key];
            return acc;
          },
          {} as Record<string, unknown>
        );
    }
    return v;
  });
}

function makeEid(type: "PR" | "ISSUE" | "COMMIT" | "BRANCH", ref: string | number): string {
  return `${type}:${ref}`;
}

function parseDependencies(body: string): number[] {
  if (body === "truncated") return [];
  const patterns = [
    /depends[\s-]*on[:\s]*#(\d+)/gi,
    /requires[:\s]*#(\d+)/gi,
    /blocked[\s-]*by[:\s]*#(\d+)/gi,
    /after[:\s]*#(\d+)/gi,
  ];
  const deps = new Set<number>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      deps.add(parseInt(match[1], 10));
    }
  }
  return Array.from(deps).sort((a, b) => a - b);
}

function parseImplements(body: string): number[] {
  if (body === "truncated") return [];
  const patterns = [/(?:closes?|fixes?|resolves?)[:\s]*#(\d+)/gi, /implements[:\s]*#(\d+)/gi];
  const refs = new Set<number>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      refs.add(parseInt(match[1], 10));
    }
  }
  return Array.from(refs).sort((a, b) => a - b);
}

function parseStackLabels(labels: string[]): { order: number; total: number } | null {
  for (const label of labels) {
    const match = label.match(/^stack:(\d+)(?:\/(\d+))?$/);
    if (match) {
      return {
        order: parseInt(match[1], 10),
        total: match[2] ? parseInt(match[2], 10) : -1,
      };
    }
  }
  return null;
}

/**
 * Deterministic analysis function
 */
function analyzeBundle(harvest: HarvestBundle): Omit<AnalysisPool, "timestamp"> {
  const inputDigest = harvest.outputDigest;

  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const conflicts: Conflict[] = [];
  const blockers: Blocker[] = [];

  const stackPRs: { pr: HarvestPR; order: number }[] = [];

  // Process pull requests
  for (const pr of harvest.bundle.pullRequests) {
    const eid = makeEid("PR", pr.number);

    const facts: Fact[] = [
      { key: "title", value: pr.title, source: "api", confidence: "known" },
      { key: "state", value: pr.state, source: "api", confidence: "known" },
      { key: "author", value: pr.author, source: "api", confidence: "known" },
      { key: "labels", value: pr.labels, source: "api", confidence: "known" },
      { key: "head_sha", value: pr.headSha, source: "api", confidence: "known" },
      { key: "base_sha", value: pr.baseSha, source: "api", confidence: "known" },
      { key: "updated_at", value: pr.updatedAt, source: "api", confidence: "known" },
    ];

    if (pr.draft !== undefined) {
      facts.push({ key: "is_draft", value: pr.draft, source: "api", confidence: "known" });
    }

    // CI status
    if (!["unknown", "unavailable"].includes(pr.ciStatus)) {
      facts.push({ key: "ci_status", value: pr.ciStatus, source: "api", confidence: "known" });
    } else {
      facts.push({
        key: "ci_status",
        value: pr.ciStatus,
        source: "api",
        confidence: pr.ciStatus as "unknown" | "unavailable",
      });
    }

    // Review status
    if (!["unknown", "unavailable"].includes(pr.reviewStatus)) {
      facts.push({
        key: "review_status",
        value: pr.reviewStatus,
        source: "api",
        confidence: "known",
      });
    } else {
      facts.push({
        key: "review_status",
        value: pr.reviewStatus,
        source: "api",
        confidence: pr.reviewStatus as "unknown" | "unavailable",
      });
    }

    // Conflict status
    if (!["unknown", "unavailable"].includes(pr.conflictStatus)) {
      facts.push({
        key: "has_conflicts",
        value: pr.conflictStatus === "conflicted",
        source: "api",
        confidence: "known",
      });
    } else {
      facts.push({
        key: "has_conflicts",
        value: pr.conflictStatus,
        source: "api",
        confidence: pr.conflictStatus as "unknown" | "unavailable",
      });
    }

    if (
      typeof pr.mergeBaseSha === "string" &&
      !["unknown", "unavailable"].includes(pr.mergeBaseSha)
    ) {
      facts.push({
        key: "merge_base_sha",
        value: pr.mergeBaseSha,
        source: "api",
        confidence: "known",
      });
    }

    if (typeof pr.changedFiles === "number") {
      facts.push({
        key: "changed_files",
        value: pr.changedFiles,
        source: "api",
        confidence: "known",
      });
    }
    if (typeof pr.additions === "number") {
      facts.push({ key: "additions", value: pr.additions, source: "api", confidence: "known" });
    }
    if (typeof pr.deletions === "number") {
      facts.push({ key: "deletions", value: pr.deletions, source: "api", confidence: "known" });
    }

    entities.push({ eid, type: "pull_request", ref: `#${pr.number}`, facts });

    // Parse dependencies
    for (const dep of parseDependencies(pr.body)) {
      relations.push({
        type: "depends_on",
        from: eid,
        to: makeEid("PR", dep),
        source: "body_parse",
        confidence: "inferred",
      });
    }

    // Parse implements
    for (const issueNum of parseImplements(pr.body)) {
      relations.push({
        type: "implements",
        from: eid,
        to: makeEid("ISSUE", issueNum),
        source: "body_parse",
        confidence: "inferred",
      });
    }

    // Stack labels
    const stack = parseStackLabels(pr.labels);
    if (stack) {
      stackPRs.push({ pr, order: stack.order });
    }

    // Blockers
    if (pr.ciStatus === "fail") {
      blockers.push({ type: "ci_failed", entity: eid, reason: "CI checks failed" });
    }
    if (pr.reviewStatus === "changes_requested") {
      blockers.push({ type: "review_rejected", entity: eid, reason: "Review requested changes" });
    }
    if (pr.reviewStatus === "pending" || pr.reviewStatus === "none") {
      blockers.push({ type: "review_pending", entity: eid, reason: "Awaiting review approval" });
    }
    if (pr.conflictStatus === "conflicted") {
      blockers.push({
        type: "merge_conflict",
        entity: eid,
        reason: "Has merge conflicts with base branch",
      });
      conflicts.push({ type: "merge_conflict", entities: [eid], resolution: "requires_rebase" });
    }
    if (pr.draft) {
      blockers.push({ type: "draft", entity: eid, reason: "PR is in draft state" });
    }
  }

  // Stack ordering
  stackPRs.sort((a, b) => a.order - b.order);
  for (let i = 1; i < stackPRs.length; i++) {
    relations.push({
      type: "depends_on",
      from: makeEid("PR", stackPRs[i].pr.number),
      to: makeEid("PR", stackPRs[i - 1].pr.number),
      source: "label",
      confidence: "known",
    });
  }

  // Process issues
  for (const issue of harvest.bundle.issues) {
    const eid = makeEid("ISSUE", issue.number);
    const facts: Fact[] = [
      { key: "title", value: issue.title, source: "api", confidence: "known" },
      { key: "state", value: issue.state, source: "api", confidence: "known" },
      { key: "author", value: issue.author, source: "api", confidence: "known" },
      { key: "labels", value: issue.labels, source: "api", confidence: "known" },
      { key: "assignees", value: issue.assignees, source: "api", confidence: "known" },
      { key: "updated_at", value: issue.updatedAt, source: "api", confidence: "known" },
    ];
    entities.push({ eid, type: "issue", ref: `#${issue.number}`, facts });
  }

  // Validate relations
  const entityEids = new Set(entities.map((e) => e.eid));
  const validRelations = relations.filter((r) => {
    if (entityEids.has(r.from) && entityEids.has(r.to)) return true;
    if (entityEids.has(r.from) && r.confidence === "inferred") return true;
    return false;
  });

  // Missing dependencies
  for (const rel of validRelations) {
    if (rel.type === "depends_on" && !entityEids.has(rel.to)) {
      blockers.push({
        type: "missing_dependency",
        entity: rel.from,
        reason: `Depends on ${rel.to} which is not in the harvest`,
      });
    }
  }

  const pool: Pool = { entities, relations: validRelations, conflicts, blockers };
  const outputDigest = sha256(canonicalStringify(pool));

  return {
    schemaVersion: "1.0.0",
    phase: "D1",
    inputDigest,
    pool,
    outputDigest,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe("D1 Determinism - Replayable Analysis", () => {
  it("same HarvestBundle produces identical AnalysisPool", async () => {
    // Load fixture
    const fixturePath = path.join(__dirname, "fixtures/harvest-bundle-fixture.json");
    const content = await fs.readFile(fixturePath, "utf-8");
    const harvest: HarvestBundle = JSON.parse(content);

    // Run analysis twice
    const result1 = analyzeBundle(harvest);
    const result2 = analyzeBundle(harvest);

    // Output digests must be identical
    expect(result1.outputDigest).toBe(result2.outputDigest);

    // Pool contents must be identical
    expect(result1.pool).toEqual(result2.pool);

    // Input digest must chain from harvest output
    expect(result1.inputDigest).toBe(harvest.outputDigest);
  });

  it("extracts correct entities from fixture", async () => {
    const fixturePath = path.join(__dirname, "fixtures/harvest-bundle-fixture.json");
    const content = await fs.readFile(fixturePath, "utf-8");
    const harvest: HarvestBundle = JSON.parse(content);

    const result = analyzeBundle(harvest);

    // Should have 3 PRs + 1 issue = 4 entities
    expect(result.pool.entities).toHaveLength(4);

    // Check entity types
    const prEntities = result.pool.entities.filter((e) => e.type === "pull_request");
    const issueEntities = result.pool.entities.filter((e) => e.type === "issue");
    expect(prEntities).toHaveLength(3);
    expect(issueEntities).toHaveLength(1);

    // Check EIDs
    expect(prEntities.map((e) => e.eid).sort()).toEqual(["PR:101", "PR:102", "PR:103"]);
    expect(issueEntities.map((e) => e.eid)).toEqual(["ISSUE:50"]);
  });

  it("extracts correct relations from fixture", async () => {
    const fixturePath = path.join(__dirname, "fixtures/harvest-bundle-fixture.json");
    const content = await fs.readFile(fixturePath, "utf-8");
    const harvest: HarvestBundle = JSON.parse(content);

    const result = analyzeBundle(harvest);

    // Should have:
    // - PR:101 implements ISSUE:50 (from "Closes #50")
    // - PR:102 depends_on PR:101 (from "Depends on #101" and stack:2)
    // - PR:103 depends_on PR:101 (from "Blocked by #101")
    // - PR:102 depends_on PR:101 (from stack labels)

    const implementsRels = result.pool.relations.filter((r) => r.type === "implements");
    const dependsRels = result.pool.relations.filter((r) => r.type === "depends_on");

    expect(implementsRels).toHaveLength(1);
    expect(implementsRels[0]).toMatchObject({
      from: "PR:101",
      to: "ISSUE:50",
      source: "body_parse",
    });

    // Stack labels create depends_on: PR:102 -> PR:101
    // Body parse creates: PR:102 -> PR:101, PR:103 -> PR:101
    expect(dependsRels.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts correct blockers from fixture", async () => {
    const fixturePath = path.join(__dirname, "fixtures/harvest-bundle-fixture.json");
    const content = await fs.readFile(fixturePath, "utf-8");
    const harvest: HarvestBundle = JSON.parse(content);

    const result = analyzeBundle(harvest);

    // PR:102 has pending review → review_pending blocker
    // PR:103 has: ci_failed, review_rejected, merge_conflict, draft
    const blockerTypes = result.pool.blockers.map((b) => `${b.entity}:${b.type}`);

    expect(blockerTypes).toContain("PR:102:review_pending");
    expect(blockerTypes).toContain("PR:103:ci_failed");
    expect(blockerTypes).toContain("PR:103:review_rejected");
    expect(blockerTypes).toContain("PR:103:merge_conflict");
    expect(blockerTypes).toContain("PR:103:draft");
  });

  it("extracts correct conflicts from fixture", async () => {
    const fixturePath = path.join(__dirname, "fixtures/harvest-bundle-fixture.json");
    const content = await fs.readFile(fixturePath, "utf-8");
    const harvest: HarvestBundle = JSON.parse(content);

    const result = analyzeBundle(harvest);

    // PR:103 has conflicted status
    expect(result.pool.conflicts).toHaveLength(1);
    expect(result.pool.conflicts[0]).toMatchObject({
      type: "merge_conflict",
      entities: ["PR:103"],
      resolution: "requires_rebase",
    });
  });

  it("output digest changes when input changes", async () => {
    const fixturePath = path.join(__dirname, "fixtures/harvest-bundle-fixture.json");
    const content = await fs.readFile(fixturePath, "utf-8");
    const harvest1: HarvestBundle = JSON.parse(content);
    const harvest2: HarvestBundle = JSON.parse(content);

    // Modify harvest2
    harvest2.bundle.pullRequests[0].title = "Modified title";
    harvest2.outputDigest = sha256(canonicalStringify(harvest2.bundle));

    const result1 = analyzeBundle(harvest1);
    const result2 = analyzeBundle(harvest2);

    // Digests must differ
    expect(result1.outputDigest).not.toBe(result2.outputDigest);
  });

  it("handles unknown/unavailable gracefully (ST-03)", async () => {
    const harvest: HarvestBundle = {
      schemaVersion: "1.0.0",
      phase: "D0",
      timestamp: "2024-01-15T10:00:00.000Z",
      inputDigest: "sha256:test",
      bundle: {
        repository: {
          owner: "test",
          name: "repo",
          defaultBranch: "main",
          defaultBranchSha: "1111111111111111111111111111111111111111",
        },
        pullRequests: [
          {
            number: 1,
            title: "Test PR",
            state: "open",
            headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            baseSha: "1111111111111111111111111111111111111111",
            mergeBaseSha: "unknown",
            author: "test",
            labels: [],
            ciStatus: "unknown",
            reviewStatus: "unavailable",
            conflictStatus: "unknown",
            updatedAt: "2024-01-15T10:00:00.000Z",
            body: "",
            changedFiles: "unknown",
            additions: "unavailable",
            deletions: 10,
          },
        ],
        issues: [],
        harvestedAt: "2024-01-15T10:00:00.000Z",
      },
      outputDigest: "sha256:test-output",
    };

    const result = analyzeBundle(harvest);

    // Should have entity with facts
    expect(result.pool.entities).toHaveLength(1);

    const entity = result.pool.entities[0];
    const ciStatusFact = entity.facts.find((f) => f.key === "ci_status");
    const reviewStatusFact = entity.facts.find((f) => f.key === "review_status");

    // Unknown/unavailable should be preserved
    expect(ciStatusFact).toMatchObject({
      value: "unknown",
      confidence: "unknown",
    });
    expect(reviewStatusFact).toMatchObject({
      value: "unavailable",
      confidence: "unavailable",
    });
  });
});
