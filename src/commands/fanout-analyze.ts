/**
 * D1 Analyze Command - Replayable Analysis Pipeline Phase 1
 *
 * Transforms a HarvestBundle into an AnalysisPool containing only facts.
 * This phase is deterministic: same input → identical output.
 *
 * Non-negotiable invariants enforced:
 * - §2 (Determinism before judgment): Pure extraction, no recommendations
 * - §3 (Unknown is not False): Preserves confidence levels
 * - §5 (MCP/CLI parity): Same logic via both interfaces
 *
 * @module
 */

import { Command } from "commander";
import { createHash } from "node:crypto";
import { throwExit } from "../cli/exitHandler.js";

// =============================================================================
// TYPES - Matching schemas
// =============================================================================

// Input: HarvestBundle (from D0)
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

// Output: AnalysisPool (D1 output)
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
  type:
    "depends_on" | "blocks" | "implements" | "references" | "modifies_same_file" | "branches_from";
  from: string;
  to: string;
  source: "label" | "body_parse" | "file_overlap" | "git" | "explicit";
  confidence: "known" | "inferred";
}

interface Conflict {
  type: "merge_conflict" | "file_overlap" | "semantic_conflict";
  entities: string[];
  files?: string[];
  resolution: "unknown" | "requires_rebase" | "requires_manual";
}

interface Blocker {
  type:
    | "ci_failed"
    | "review_pending"
    | "review_rejected"
    | "merge_conflict"
    | "missing_dependency"
    | "draft";
  entity: string;
  reason: string;
}

// =============================================================================
// ANALYSIS LOGIC - DETERMINISTIC
// =============================================================================

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function canonicalStringify(obj: unknown): string {
  // Sort keys recursively for deterministic output
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

/**
 * Extract EID from entity type and number
 */
function makeEid(type: "PR" | "ISSUE" | "COMMIT" | "BRANCH", ref: string | number): string {
  return `${type}:${ref}`;
}

/**
 * Parse dependency references from PR body
 * Looks for patterns like:
 * - Depends on #123
 * - Depends-on: #123
 * - Requires #123
 * - Blocked by #123
 */
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

/**
 * Parse issue references from PR body (implements/fixes)
 */
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

/**
 * Extract stack label dependencies (e.g., stack:1, stack:2)
 */
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
 * Deterministically analyze a HarvestBundle into an AnalysisPool
 */
function analyzeBundle(harvest: HarvestBundle): AnalysisPool {
  const timestamp = new Date().toISOString();
  const inputDigest = harvest.outputDigest; // Chain from D0

  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const conflicts: Conflict[] = [];
  const blockers: Blocker[] = [];

  // Track PRs by number for stack ordering
  const prByNumber = new Map<number, HarvestPR>();
  const stackPRs: { pr: HarvestPR; order: number }[] = [];

  // Process pull requests
  for (const pr of harvest.bundle.pullRequests) {
    prByNumber.set(pr.number, pr);
    const eid = makeEid("PR", pr.number);

    // Build facts
    const facts: Fact[] = [
      {
        key: "title",
        value: pr.title,
        source: "api",
        confidence: "known",
      },
      {
        key: "state",
        value: pr.state,
        source: "api",
        confidence: "known",
      },
      {
        key: "author",
        value: pr.author,
        source: "api",
        confidence: "known",
      },
      {
        key: "labels",
        value: pr.labels,
        source: "api",
        confidence: "known",
      },
      {
        key: "head_sha",
        value: pr.headSha,
        source: "api",
        confidence: "known",
      },
      {
        key: "base_sha",
        value: pr.baseSha,
        source: "api",
        confidence: "known",
      },
      {
        key: "updated_at",
        value: pr.updatedAt,
        source: "api",
        confidence: "known",
      },
    ];

    // Handle optional/unknown fields
    if (pr.draft !== undefined) {
      facts.push({
        key: "is_draft",
        value: pr.draft,
        source: "api",
        confidence: "known",
      });
    }

    // CI status
    if (typeof pr.ciStatus === "string" && !["unknown", "unavailable"].includes(pr.ciStatus)) {
      facts.push({
        key: "ci_status",
        value: pr.ciStatus,
        source: "api",
        confidence: "known",
      });
    } else {
      facts.push({
        key: "ci_status",
        value: pr.ciStatus,
        source: "api",
        confidence: pr.ciStatus as "unknown" | "unavailable",
      });
    }

    // Review status
    if (
      typeof pr.reviewStatus === "string" &&
      !["unknown", "unavailable"].includes(pr.reviewStatus)
    ) {
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
    if (
      typeof pr.conflictStatus === "string" &&
      !["unknown", "unavailable"].includes(pr.conflictStatus)
    ) {
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

    // Merge base SHA
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

    // Stats
    if (typeof pr.changedFiles === "number") {
      facts.push({
        key: "changed_files",
        value: pr.changedFiles,
        source: "api",
        confidence: "known",
      });
    }
    if (typeof pr.additions === "number") {
      facts.push({
        key: "additions",
        value: pr.additions,
        source: "api",
        confidence: "known",
      });
    }
    if (typeof pr.deletions === "number") {
      facts.push({
        key: "deletions",
        value: pr.deletions,
        source: "api",
        confidence: "known",
      });
    }

    entities.push({
      eid,
      type: "pull_request",
      ref: `#${pr.number}`,
      facts,
    });

    // Parse dependencies from body
    const deps = parseDependencies(pr.body);
    for (const dep of deps) {
      relations.push({
        type: "depends_on",
        from: eid,
        to: makeEid("PR", dep),
        source: "body_parse",
        confidence: "inferred",
      });
    }

    // Parse implements from body
    const implements_ = parseImplements(pr.body);
    for (const issueNum of implements_) {
      relations.push({
        type: "implements",
        from: eid,
        to: makeEid("ISSUE", issueNum),
        source: "body_parse",
        confidence: "inferred",
      });
    }

    // Check for stack labels
    const stack = parseStackLabels(pr.labels);
    if (stack) {
      stackPRs.push({ pr, order: stack.order });
    }

    // Generate blockers based on facts
    if (pr.ciStatus === "fail") {
      blockers.push({
        type: "ci_failed",
        entity: eid,
        reason: "CI checks failed",
      });
    }

    if (pr.reviewStatus === "changes_requested") {
      blockers.push({
        type: "review_rejected",
        entity: eid,
        reason: "Review requested changes",
      });
    }

    if (pr.reviewStatus === "pending" || pr.reviewStatus === "none") {
      blockers.push({
        type: "review_pending",
        entity: eid,
        reason: "Awaiting review approval",
      });
    }

    if (pr.conflictStatus === "conflicted") {
      blockers.push({
        type: "merge_conflict",
        entity: eid,
        reason: "Has merge conflicts with base branch",
      });
      conflicts.push({
        type: "merge_conflict",
        entities: [eid],
        resolution: "requires_rebase",
      });
    }

    if (pr.draft) {
      blockers.push({
        type: "draft",
        entity: eid,
        reason: "PR is in draft state",
      });
    }
  }

  // Process stack ordering (create depends_on relations)
  stackPRs.sort((a, b) => a.order - b.order);
  for (let i = 1; i < stackPRs.length; i++) {
    const prev = stackPRs[i - 1];
    const curr = stackPRs[i];
    relations.push({
      type: "depends_on",
      from: makeEid("PR", curr.pr.number),
      to: makeEid("PR", prev.pr.number),
      source: "label",
      confidence: "known",
    });
  }

  // Process issues
  for (const issue of harvest.bundle.issues) {
    const eid = makeEid("ISSUE", issue.number);

    const facts: Fact[] = [
      {
        key: "title",
        value: issue.title,
        source: "api",
        confidence: "known",
      },
      {
        key: "state",
        value: issue.state,
        source: "api",
        confidence: "known",
      },
      {
        key: "author",
        value: issue.author,
        source: "api",
        confidence: "known",
      },
      {
        key: "labels",
        value: issue.labels,
        source: "api",
        confidence: "known",
      },
      {
        key: "assignees",
        value: issue.assignees,
        source: "api",
        confidence: "known",
      },
      {
        key: "updated_at",
        value: issue.updatedAt,
        source: "api",
        confidence: "known",
      },
    ];

    entities.push({
      eid,
      type: "issue",
      ref: `#${issue.number}`,
      facts,
    });
  }

  // Validate relations (remove references to non-existent entities)
  const entityEids = new Set(entities.map((e) => e.eid));
  const validRelations = relations.filter((r) => {
    // Keep if both entities exist, or if target might be external
    if (entityEids.has(r.from) && entityEids.has(r.to)) {
      return true;
    }
    // Keep inferred relations even if target doesn't exist (might be closed PR)
    if (entityEids.has(r.from) && r.confidence === "inferred") {
      return true;
    }
    return false;
  });

  // Check for missing dependencies
  for (const rel of validRelations) {
    if (rel.type === "depends_on" && !entityEids.has(rel.to)) {
      blockers.push({
        type: "missing_dependency",
        entity: rel.from,
        reason: `Depends on ${rel.to} which is not in the harvest`,
      });
    }
  }

  const pool: Pool = {
    entities,
    relations: validRelations,
    conflicts,
    blockers,
  };

  const outputDigest = sha256(canonicalStringify(pool));

  return {
    schemaVersion: "1.0.0",
    phase: "D1",
    timestamp,
    inputDigest,
    pool,
    outputDigest,
  };
}

// =============================================================================
// CLI COMMAND
// =============================================================================

export function registerAnalyzeCommand(fanoutCommand: Command): void {
  fanoutCommand
    .command("analyze")
    .description("D1: Analyze harvest bundle into facts pool (deterministic)")
    .option("--input <file>", "Path to harvest bundle JSON file (default: stdin)")
    .option("--json", "Output JSON format (default)")
    .option("--output <file>", "Write output to file")
    .action(async (opts) => {
      try {
        const fs = await import("node:fs/promises");

        // Load harvest bundle from file or stdin
        let content: string;
        if (opts.input) {
          content = await fs.readFile(opts.input, "utf-8");
        } else {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          content = Buffer.concat(chunks).toString("utf-8");
          if (!content.trim()) {
            console.error("\n❌ No input provided. Provide JSON via stdin or use --input <file>\n");
            throwExit(1);
            return;
          }
        }

        let harvest: HarvestBundle;

        try {
          harvest = JSON.parse(content);
        } catch (e) {
          console.error(`\n❌ Invalid JSON${opts.input ? ` in ${opts.input}` : " from stdin"}\n`);
          throwExit(1);
          return; // TypeScript flow
        }

        // Validate schema version
        if (harvest.schemaVersion !== "1.0.0") {
          console.error(`\n❌ Unsupported schema version: ${harvest.schemaVersion}\n`);
          console.error("Expected: 1.0.0");
          throwExit(1);
          return;
        }

        if (harvest.phase !== "D0") {
          console.error(`\n❌ Invalid input phase: ${harvest.phase}\n`);
          console.error("Expected: D0 (HarvestBundle)");
          throwExit(1);
          return;
        }

        // Run deterministic analysis
        const analysisPool = analyzeBundle(harvest);

        const output = JSON.stringify(analysisPool, null, 2);

        if (opts.output) {
          await fs.writeFile(opts.output, output, "utf-8");
          console.error(`✓ Analysis pool written to ${opts.output}`);
          console.error(`  ${analysisPool.pool.entities.length} entities`);
          console.error(`  ${analysisPool.pool.relations.length} relations`);
          console.error(`  ${analysisPool.pool.conflicts.length} conflicts`);
          console.error(`  ${analysisPool.pool.blockers.length} blockers`);
          console.error(`  Input digest: ${analysisPool.inputDigest.slice(0, 20)}...`);
          console.error(`  Output digest: ${analysisPool.outputDigest.slice(0, 20)}...`);
        } else {
          // Output to stdout (JSON only)
          console.log(output);
        }
      } catch (error) {
        console.error(`\n❌ Analysis failed: ${error instanceof Error ? error.message : error}\n`);
        throwExit(1);
      }
    });
}
