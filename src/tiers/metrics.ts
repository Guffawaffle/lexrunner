/**
 * Tier Metrics Tracking
 *
 * Implements metrics calculation for tier routing governance.
 * Tracks tier match rate, escalation rate, and cost efficiency.
 */

import type { CapabilityTier, TierAssignment } from "./schema.js";

/**
 * Aggregated tier metrics for a plan execution
 */
export interface TierMetrics {
  /** Total number of tasks tracked */
  totalTasks: number;
  /** Count of tasks by suggested tier */
  byTier: Record<CapabilityTier, number>;
  /** Count of tasks by actual tier (after overrides/escalations) */
  byActualTier: Record<CapabilityTier, number>;
  /** Number of tasks that were escalated */
  escalations: number;
  /** Number of tier mismatches (actual != suggested) */
  mismatches: number;
  /** Tier match rate (1 - mismatch rate) */
  tierMatchRate: number;
  /** Escalation rate */
  escalationRate: number;
}

/**
 * Initialize empty tier counts
 */
function initTierCounts(): Record<CapabilityTier, number> {
  return { senior: 0, mid: 0, junior: 0 };
}

/**
 * Calculate tier metrics from assignments
 */
export function calculateTierMetrics(
  assignments: TierAssignment[] | Map<string, TierAssignment>
): TierMetrics {
  const assignmentList =
    assignments instanceof Map ? Array.from(assignments.values()) : assignments;

  const byTier = initTierCounts();
  const byActualTier = initTierCounts();
  let escalations = 0;
  let mismatches = 0;

  for (const assignment of assignmentList) {
    // Count by suggested tier
    byTier[assignment.suggested]++;

    // Count by actual tier (or suggested if no actual)
    const actualTier = assignment.actual || assignment.suggested;
    byActualTier[actualTier]++;

    // Count escalations
    if (assignment.escalated) {
      escalations++;
    }

    // Count mismatches
    if (assignment.mismatch) {
      mismatches++;
    }
  }

  const total = assignmentList.length;

  return {
    totalTasks: total,
    byTier,
    byActualTier,
    escalations,
    mismatches,
    tierMatchRate: total > 0 ? (total - mismatches) / total : 1,
    escalationRate: total > 0 ? escalations / total : 0,
  };
}

/**
 * Target metrics for governance compliance
 */
export const TIER_METRIC_TARGETS = {
  /** Target tier match rate (> 90%) */
  tierMatchRate: 0.9,
  /** Target escalation rate (< 10%) */
  escalationRate: 0.1,
  /** Target cost efficiency ratio (< 1.2) */
  costEfficiency: 1.2,
} as const;

/**
 * Check if metrics meet governance targets
 */
export function meetsGovernanceTargets(metrics: TierMetrics): {
  meetsAll: boolean;
  tierMatchRate: boolean;
  escalationRate: boolean;
} {
  const tierMatchMet = metrics.tierMatchRate >= TIER_METRIC_TARGETS.tierMatchRate;
  const escalationMet = metrics.escalationRate <= TIER_METRIC_TARGETS.escalationRate;

  return {
    meetsAll: tierMatchMet && escalationMet,
    tierMatchRate: tierMatchMet,
    escalationRate: escalationMet,
  };
}

/**
 * Format tier metrics for display
 */
export function formatTierMetrics(metrics: TierMetrics): string {
  const lines: string[] = [
    `Tier Metrics Summary`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Total Tasks: ${metrics.totalTasks}`,
    ``,
    `Suggested Tier Distribution:`,
    `  Senior: ${metrics.byTier.senior}`,
    `  Mid:    ${metrics.byTier.mid}`,
    `  Junior: ${metrics.byTier.junior}`,
    ``,
    `Actual Tier Distribution:`,
    `  Senior: ${metrics.byActualTier.senior}`,
    `  Mid:    ${metrics.byActualTier.mid}`,
    `  Junior: ${metrics.byActualTier.junior}`,
    ``,
    `Governance Metrics:`,
    `  Tier Match Rate:   ${(metrics.tierMatchRate * 100).toFixed(1)}% (target: >${TIER_METRIC_TARGETS.tierMatchRate * 100}%)`,
    `  Escalation Rate:   ${(metrics.escalationRate * 100).toFixed(1)}% (target: <${TIER_METRIC_TARGETS.escalationRate * 100}%)`,
    `  Escalations:       ${metrics.escalations}`,
    `  Mismatches:        ${metrics.mismatches}`,
  ];

  return lines.join("\n");
}

/**
 * Convert tier metrics to JSON-serializable format for Frame emission
 */
export function tierMetricsToJSON(metrics: TierMetrics): Record<string, unknown> {
  return {
    totalTasks: metrics.totalTasks,
    byTier: { ...metrics.byTier },
    byActualTier: { ...metrics.byActualTier },
    escalations: metrics.escalations,
    mismatches: metrics.mismatches,
    tierMatchRate: metrics.tierMatchRate,
    escalationRate: metrics.escalationRate,
    governance: meetsGovernanceTargets(metrics),
  };
}
