/**
 * Fanout Types — D0 Harvest and D1 Analysis schemas
 *
 * This module defines the core data structures for the fanout pipeline:
 * - HarvestBundle: D0 output (deterministic world-state snapshot)
 * - AnalysisPool: D1 output (pure computed analysis with evidence IDs)
 *
 * Design principles:
 * - Pin reality hard: capture SHAs at harvest time
 * - Truncation as first-class truth: never silently omit data
 * - Evidence IDs: every computed fact is referenceable
 * - Canonicalization: deterministic digests for replay
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Evidence ID format: E-{CATEGORY}-{SEQUENCE}
 * Examples: E-ISSUE-001, E-OVERLAP-042, E-HOTSPOT-007
 */
export const EvidenceIdSchema = z
  .string()
  .regex(/^E-[A-Z]+-\d{3,}$/, "Evidence ID must match E-{CATEGORY}-{NNN}");

export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

// =============================================================================
// D0 HARVEST BUNDLE
// =============================================================================

/**
 * Provenance metadata for audit trail
 */
export const ProvenanceSchema = z.object({
  /** ISO timestamp when harvest started */
  harvestedAt: z.string().datetime(),
  /** Tool version (e.g., "lexrunner@0.7.0") */
  toolVersion: z.string(),
  /** SHA256 of canonicalized query params for replay verification */
  inputDigest: z.string(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Query parameters used for harvest (enables replay)
 */
export const QueryParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  issueFilter: z
    .object({
      state: z.enum(["open", "closed", "all"]).optional(),
      labels: z.array(z.string()).optional(),
    })
    .optional(),
  prFilter: z
    .object({
      state: z.enum(["open", "closed", "all"]).optional(),
    })
    .optional(),
});

export type QueryParams = z.infer<typeof QueryParamsSchema>;

/**
 * Comment on an issue or PR
 */
export const HarvestedCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
});

export type HarvestedComment = z.infer<typeof HarvestedCommentSchema>;

/**
 * Harvested issue data
 */
export const HarvestedIssueSchema = z.object({
  number: z.number(),
  nodeId: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  author: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Comments fetched for this issue */
  comments: z.array(HarvestedCommentSchema),
  /** Whether comments were fetched (false if skipped) */
  commentsFetched: z.boolean(),
  /** Total comment count from API (may differ from comments.length if paginated) */
  commentsCount: z.number(),
});

export type HarvestedIssue = z.infer<typeof HarvestedIssueSchema>;

/**
 * Review comment on a PR (inline code comment)
 */
export const ReviewCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string(),
  path: z.string(),
  line: z.number().nullable(),
});

export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

/**
 * CI status summary for a PR
 */
export const CIStatusSchema = z.object({
  /** Overall state (null if no checks) */
  state: z.enum(["pending", "success", "failure", "error"]).nullable(),
  totalChecks: z.number(),
  passedChecks: z.number(),
  failedChecks: z.number(),
});

export type CIStatus = z.infer<typeof CIStatusSchema>;

/**
 * Harvested PR data (extends issue with PR-specific fields)
 */
export const HarvestedPRSchema = z.object({
  number: z.number(),
  nodeId: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed", "merged"]),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  author: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // PR-specific SHA pinning (critical for determinism)
  /** SHA of the PR head (the branch being merged) */
  headSha: z.string(),
  /** SHA of the PR base branch at time of harvest */
  baseSha: z.string(),
  /** SHA of merge-base commit (common ancestor), null if not computable */
  mergeBaseSha: z.string().nullable(),
  /** Name of base branch (e.g., "main") */
  baseBranch: z.string(),
  /** Name of head branch (e.g., "feature/foo") */
  headBranch: z.string(),

  // Diff data with explicit truncation tracking
  /** Raw diff content, null if fetch failed or skipped */
  diff: z.string().nullable(),
  /** True if diff was truncated by GitHub API */
  diffTruncated: z.boolean(),
  /** Number of bytes captured in diff (0 if null) */
  diffBytesCaptured: z.number(),
  /** List of touched files (always populated, even if diff is truncated) */
  touchedFiles: z.array(z.string()),

  // Review comments (inline code comments)
  reviewComments: z.array(ReviewCommentSchema),

  // CI status at harvest time
  ciStatus: CIStatusSchema,
});

export type HarvestedPR = z.infer<typeof HarvestedPRSchema>;

/**
 * Vulnerability info from security scan
 */
export const VulnerabilitySchema = z.object({
  severity: z.enum(["critical", "high", "moderate", "low"]),
  package: z.string(),
  fixAvailable: z.boolean(),
  advisory: z.string().optional(),
});

export type Vulnerability = z.infer<typeof VulnerabilitySchema>;

/**
 * Security signals with explicit source tracking
 *
 * IMPORTANT: vulnerabilities is null when unknown, [] when none found.
 * This distinction prevents claiming "no vulns" when audit failed.
 */
export const SecuritySignalsSchema = z.object({
  /** Source of security data */
  source: z.enum(["dependabot", "npm_audit", "none"]),
  /** When security data was fetched (null if source is "none") */
  fetchedAt: z.string().datetime().nullable(),
  /** Vulnerabilities found (null = unknown/failed, [] = none found) */
  vulnerabilities: z.array(VulnerabilitySchema).nullable(),
  /** Error message if fetch failed */
  fetchError: z.string().nullable(),
});

export type SecuritySignals = z.infer<typeof SecuritySignalsSchema>;

/**
 * Repository-level pinning
 */
export const RepoPinSchema = z.object({
  /** Default branch name (e.g., "main") */
  defaultBranch: z.string(),
  /** SHA of default branch HEAD at harvest time */
  defaultBranchSha: z.string(),
  /** When repo was pinned */
  fetchedAt: z.string().datetime(),
});

export type RepoPin = z.infer<typeof RepoPinSchema>;

/**
 * Complete D0 Harvest Bundle
 *
 * This is the output of the harvest stage and input to analysis.
 * It captures a deterministic snapshot of the GitHub world-state.
 */
export const HarvestBundleSchema = z.object({
  /** Schema version for forward compatibility */
  schemaVersion: z.literal("1.0.0"),
  /** Provenance for audit and replay */
  provenance: ProvenanceSchema,
  /** Query params used (for replay) */
  queryParams: QueryParamsSchema,
  /** Repository-level pinning */
  repoPin: RepoPinSchema,
  /** Harvested issues */
  issues: z.array(HarvestedIssueSchema),
  /** Harvested pull requests */
  pullRequests: z.array(HarvestedPRSchema),
  /** Security signals (explicit source tracking) */
  securitySignals: SecuritySignalsSchema,
});

export type HarvestBundle = z.infer<typeof HarvestBundleSchema>;

// =============================================================================
// HARVEST OPTIONS
// =============================================================================

/**
 * Options for harvest operation
 */
export interface HarvestOptions {
  /** Skip fetching issue/PR comments (faster, less complete) */
  skipComments?: boolean;
  /** Skip fetching PR diffs (faster, less complete) */
  skipDiffs?: boolean;
  /** Skip security signals (no npm audit) */
  skipSecurity?: boolean;
  /** Workspace root for npm audit (if available) */
  workspaceRoot?: string;
  /** Max issues to fetch (for testing) */
  issueLimit?: number;
  /** Max PRs to fetch (for testing) */
  prLimit?: number;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse and validate a HarvestBundle from unknown data
 */
export function parseHarvestBundle(data: unknown): HarvestBundle {
  return HarvestBundleSchema.parse(data);
}

/**
 * Safely parse a HarvestBundle, returning result with errors
 */
export function safeParseHarvestBundle(data: unknown) {
  return HarvestBundleSchema.safeParse(data);
}

// =============================================================================
// D1 ANALYSIS POOL
// =============================================================================

/**
 * Issue metadata (computed from harvest)
 */
export const IssueAnalysisSchema = z.object({
  evidenceId: EvidenceIdSchema, // E-ISSUE-{number}
  issueNumber: z.number(),
  // Extracted from body
  affectedFiles: z.array(z.string()),
  affectedModules: z.array(z.string()), // Mapped via lexmap if available
  explicitDependencies: z.array(
    z.object({
      type: z.enum(["depends-on", "blocks", "blocked-by"]),
      target: z.string(), // "#123" or "owner/repo#456"
    })
  ),
  // Computed flags
  hasAcceptanceCriteria: z.boolean(),
  hasDefinitionOfDone: z.boolean(),
  hasCopilotAssignment: z.boolean(),
  // Complexity
  complexity: z.object({
    score: z.number().min(0).max(10),
    estimatedFiles: z.number(),
    estimatedLines: z.number(),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  // Risk signals
  judgmentRequired: z.object({
    required: z.boolean(),
    reasons: z.array(z.string()), // e.g., "missing AC", "ambiguous scope"
  }),
});

export type IssueAnalysis = z.infer<typeof IssueAnalysisSchema>;

/**
 * Overlap between two issues
 */
export const OverlapEvidenceSchema = z.object({
  evidenceId: EvidenceIdSchema, // E-OVERLAP-{seq}
  issue1: z.number(),
  issue2: z.number(),
  score: z.number().min(0).max(1),
  breakdown: z.object({
    fileOverlap: z.number(),
    directoryOverlap: z.number(),
    labelOverlap: z.number(),
    moduleOverlap: z.number(),
  }),
  conflictRisk: z.enum(["none", "low", "medium", "high"]),
});

export type OverlapEvidence = z.infer<typeof OverlapEvidenceSchema>;

/**
 * Dependency graph node
 */
export const DependencyNodeSchema = z.object({
  issueNumber: z.number(),
  dependsOn: z.array(z.number()), // Resolved issue numbers
  blockedBy: z.array(z.number()),
  layer: z.number(), // Topo layer (0 = no deps, 1 = depends on layer 0, etc.)
});

export type DependencyNode = z.infer<typeof DependencyNodeSchema>;

/**
 * Hotspot / churn risk
 */
export const HotspotEvidenceSchema = z.object({
  evidenceId: EvidenceIdSchema, // E-HOTSPOT-{seq}
  path: z.string(),
  commitCount30d: z.number().nullable(), // null = not computed
  authorCount30d: z.number().nullable(),
  touchedByIssues: z.array(z.number()),
  riskLevel: z.enum(["low", "medium", "high"]),
});

export type HotspotEvidence = z.infer<typeof HotspotEvidenceSchema>;

/**
 * Complete D1 Analysis Pool
 *
 * This is the output of the analysis stage (D1), with pure computed facts
 * and explicit evidence IDs for every computation.
 */
export const AnalysisPoolSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  // Provenance linking
  harvestDigest: z.string(), // SHA256 of input HarvestBundle
  analyzedAt: z.string().datetime(),
  toolVersion: z.string(),
  // Core analysis
  issues: z.array(IssueAnalysisSchema),
  overlaps: z.array(OverlapEvidenceSchema),
  dependencyGraph: z.array(DependencyNodeSchema),
  hotspots: z.array(HotspotEvidenceSchema),
  // Layer classification
  layers: z.record(z.string(), z.array(z.number())), // {"0": [1,2,3], "1": [4,5], ...}
  readyIssues: z.array(z.number()), // Issues in layer 0 with no blockers
  // Security posture (from harvest)
  securityPosture: z.object({
    source: z.enum(["dependabot", "npm_audit", "none"]),
    fixableVulnerabilities: z.number().nullable(),
    totalVulnerabilities: z.number().nullable(),
  }),
  // Summary stats (for quick reference, all derived from above)
  summary: z.object({
    totalIssues: z.number(),
    totalPRs: z.number(),
    highOverlapPairs: z.number(), // count of pairs with score > 0.5
    maxLayer: z.number(),
    judgmentRequiredCount: z.number(),
  }),
});

export type AnalysisPool = z.infer<typeof AnalysisPoolSchema>;

// =============================================================================
// ANALYSIS POOL VALIDATION HELPERS
// =============================================================================

/**
 * Parse and validate an AnalysisPool from unknown data
 */
export function parseAnalysisPool(data: unknown): AnalysisPool {
  return AnalysisPoolSchema.parse(data);
}

/**
 * Safely parse an AnalysisPool, returning result with errors
 */
export function safeParseAnalysisPool(data: unknown) {
  return AnalysisPoolSchema.safeParse(data);
}
