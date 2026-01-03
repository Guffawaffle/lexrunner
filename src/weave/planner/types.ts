/**
 * Intervention Types
 *
 * Core types for the intervention planning system.
 *
 * @module
 */

import type { DeterminismLevel, MergeWeavePolicy } from "../policy/index.js";

// =============================================================================
// INTERVENTION DEFINITIONS
// =============================================================================

/**
 * All known intervention types
 */
export type InterventionType =
  // Discovery phase
  | "discover_prs"
  | "filter_drafts"
  | "undraft_copilot"
  | "parse_dependencies"
  // Gate phase
  | "run_base_gate"
  | "check_ci_status"
  | "review_checklist"
  | "quality_assessment"
  // Merge phase
  | "compute_merge_order"
  | "check_admin_authority"
  | "execute_merge"
  | "resolve_conflict"
  // Post-merge phase
  | "pull_changes"
  | "verify_gates"
  | "detect_failure_pattern"
  | "auto_fix"
  | "commit_fix"
  // Fanout phase
  | "detect_fanout_trigger"
  | "create_issue"
  | "escalate_to_pm";

/**
 * Determinism level mapping for each intervention type
 */
export const INTERVENTION_DETERMINISM: Record<InterventionType, DeterminismLevel> = {
  // D1: Pure logic
  discover_prs: "D1",
  filter_drafts: "D1",
  parse_dependencies: "D1",
  run_base_gate: "D1",
  check_ci_status: "D1",
  compute_merge_order: "D1",
  check_admin_authority: "D1",
  execute_merge: "D1",
  pull_changes: "D1",
  verify_gates: "D1",
  commit_fix: "D1",

  // D2: Bounded judgment
  undraft_copilot: "D2",
  review_checklist: "D2",
  detect_failure_pattern: "D2",
  auto_fix: "D2",
  detect_fanout_trigger: "D2",
  create_issue: "D2",

  // D3: Semantic reasoning
  quality_assessment: "D3",
  resolve_conflict: "D3",
  escalate_to_pm: "D3",
};

// =============================================================================
// INTERVENTION INSTANCES
// =============================================================================

/**
 * Base intervention with common fields
 */
export interface BaseIntervention {
  id: string;
  type: InterventionType;
  determinism: DeterminismLevel;
  phase: "discovery" | "gates" | "merge" | "post_merge" | "fanout";
  /** Target identifier (PR number, repo, gate name, etc.) */
  target?: string;
  /** Dependencies on other intervention IDs */
  dependsOn: string[];
  /** Intervention-specific parameters */
  params: Record<string, unknown>;
}

/**
 * Planned intervention with computed status
 */
export interface PlannedIntervention extends BaseIntervention {
  status: "pending" | "ready" | "blocked" | "completed" | "failed" | "skipped";
  /** Why this intervention was blocked or skipped */
  reason?: string;
}

// =============================================================================
// DISCOVERY CONTEXT
// =============================================================================

/**
 * Discovered PR metadata
 */
export interface DiscoveredPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  isDraft: boolean;
  isCopilot: boolean;
  isDependabot: boolean;
  ciStatus: "pending" | "success" | "failure" | "unknown";
  dependsOn: number[];
  labels: string[];
  headRef: string;
  baseRef: string;
  /** PR body/description (for checklist detection) */
  body?: string | null;
  /** Whether a review has been requested */
  reviewRequested?: boolean;
  /**
   * Timestamp of last commit (ISO 8601)
   * NOTE: Currently not populated by GitHub API (would require additional API call per PR).
   * Falls back to updatedAt which is a reasonable proxy for agent activity.
   */
  lastCommitDate?: string | null;
  /** Timestamp when PR was last updated (ISO 8601) - used as commit age proxy */
  updatedAt?: string;
}

/**
 * Context for intervention planning
 */
export interface PlanningContext {
  policy: MergeWeavePolicy;
  prs: DiscoveredPR[];
  currentRepo?: { owner: string; name: string };
  baseBranch?: string;
  /** Interventions already completed (for resumption) */
  completedInterventionIds?: string[];
}

// =============================================================================
// INTERVENTION PLAN
// =============================================================================

/**
 * Complete intervention plan
 */
export interface InterventionPlan {
  /** Unique plan identifier */
  id: string;
  /** When the plan was generated */
  generatedAt: string;
  /** Policy version used */
  policyVersion: string;
  /** All interventions in dependency order */
  interventions: PlannedIntervention[];
  /** Summary statistics */
  stats: {
    total: number;
    byDeterminism: Record<DeterminismLevel, number>;
    byPhase: Record<string, number>;
  };
}
