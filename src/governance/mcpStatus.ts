/**
 * MCP Status Governance Integration
 *
 * Implements acceptance criteria 4: "Tier Metrics in MCP Server"
 *
 * Provides governance status for MCP status tool:
 * - Tier distribution
 * - Escalation rate with threshold warnings
 * - Turn Cost summary
 * - Hostility score
 */

import type { TierMetrics } from "../tiers/metrics.js";
import { TIER_METRIC_TARGETS, meetsGovernanceTargets } from "../tiers/metrics.js";
import type { HostilityScore } from "../hostility/score.js";
import type { TurnCostSummary } from "../metrics/turncost.js";

/**
 * Governance status for MCP status output
 */
export interface GovernanceStatus {
  /** Tier distribution and metrics */
  tiers?: {
    /** Count by tier */
    distribution: {
      senior: number;
      mid: number;
      junior: number;
    };
    /** Escalation rate (0-1) */
    escalationRate: number;
    /** Whether escalation rate exceeds threshold */
    escalationWarning: boolean;
    /** Tier match rate (0-1) */
    tierMatchRate: number;
    /** Whether governance targets are met */
    meetsTargets: boolean;
  };
  /** Turn Cost summary */
  turnCost?: {
    /** Weighted score */
    weightedScore: number;
    /** Event count */
    eventCount: number;
    /** Whether there's a regression */
    hasRegression: boolean;
    /** Comparison to prior run */
    priorRunScore?: number;
  };
  /** Environmental hostility */
  hostility?: {
    /** Overall score (0-1) */
    score: number;
    /** Status (low/medium/high) */
    status: "low" | "medium" | "high";
    /** Number of recommendations */
    recommendationCount: number;
  };
  /** Overall governance health */
  health: "healthy" | "warning" | "critical";
  /** Summary warnings */
  warnings: string[];
}

/**
 * Build governance status from component metrics.
 *
 * @param tierMetrics - Optional tier metrics from execution
 * @param turnCostSummary - Optional Turn Cost summary
 * @param hostilityScore - Optional hostility score
 * @param priorTurnCostScore - Optional prior run Turn Cost for comparison
 * @returns Complete governance status
 */
export function buildGovernanceStatus(
  tierMetrics?: TierMetrics,
  turnCostSummary?: TurnCostSummary,
  hostilityScore?: HostilityScore,
  priorTurnCostScore?: number
): GovernanceStatus {
  const warnings: string[] = [];
  let health: GovernanceStatus["health"] = "healthy";

  // Build tier status if available
  let tiers: GovernanceStatus["tiers"] | undefined;
  if (tierMetrics) {
    const targetsMet = meetsGovernanceTargets(tierMetrics);
    const escalationWarning = tierMetrics.escalationRate > TIER_METRIC_TARGETS.escalationRate;

    if (escalationWarning) {
      warnings.push(
        `Escalation rate (${(tierMetrics.escalationRate * 100).toFixed(1)}%) ` +
          `exceeds threshold (${TIER_METRIC_TARGETS.escalationRate * 100}%)`
      );
      health = "warning";
    }

    if (!targetsMet.tierMatchRate) {
      warnings.push(
        `Tier match rate (${(tierMetrics.tierMatchRate * 100).toFixed(1)}%) ` +
          `below target (${TIER_METRIC_TARGETS.tierMatchRate * 100}%)`
      );
      health = "warning";
    }

    tiers = {
      distribution: {
        senior: tierMetrics.byActualTier.senior,
        mid: tierMetrics.byActualTier.mid,
        junior: tierMetrics.byActualTier.junior,
      },
      escalationRate: tierMetrics.escalationRate,
      escalationWarning,
      tierMatchRate: tierMetrics.tierMatchRate,
      meetsTargets: targetsMet.meetsAll,
    };
  }

  // Build Turn Cost status if available
  let turnCost: GovernanceStatus["turnCost"] | undefined;
  if (turnCostSummary) {
    let hasRegression = false;

    if (priorTurnCostScore !== undefined && priorTurnCostScore > 0) {
      const percentageChange =
        (turnCostSummary.weightedScore - priorTurnCostScore) / priorTurnCostScore;
      hasRegression = percentageChange > 0.2; // 20% threshold

      if (hasRegression) {
        warnings.push(
          `Turn Cost regression: +${(percentageChange * 100).toFixed(0)}% from prior run`
        );
        health = "warning";
      }
    }

    turnCost = {
      weightedScore: turnCostSummary.weightedScore,
      eventCount: turnCostSummary.eventCount,
      hasRegression,
      priorRunScore: priorTurnCostScore,
    };
  }

  // Build hostility status if available
  let hostility: GovernanceStatus["hostility"] | undefined;
  if (hostilityScore) {
    hostility = {
      score: hostilityScore.total,
      status: hostilityScore.status,
      recommendationCount: hostilityScore.recommendations.length,
    };

    if (hostilityScore.status === "high") {
      warnings.push(`Environment hostility is high (${(hostilityScore.total * 100).toFixed(0)}%)`);
      health = health === "healthy" ? "warning" : health;
    }

    // Critical if hostility is very high
    if (hostilityScore.total > 0.8) {
      health = "critical";
    }
  }

  // Check for critical conditions
  if (warnings.length > 3) {
    health = "critical";
  }

  return {
    tiers,
    turnCost,
    hostility,
    health,
    warnings,
  };
}

/**
 * Format governance status for human-readable display.
 *
 * @param status - Governance status
 * @returns Formatted string
 */
export function formatGovernanceStatus(status: GovernanceStatus): string {
  const lines: string[] = [];

  lines.push("Governance Status");
  lines.push("═════════════════");
  lines.push("");

  // Health indicator
  const healthIcon = status.health === "healthy" ? "✅" : status.health === "warning" ? "⚠️" : "❌";
  lines.push(`Overall Health: ${healthIcon} ${status.health.toUpperCase()}`);
  lines.push("");

  // Tier distribution
  if (status.tiers) {
    lines.push("Tier Distribution:");
    lines.push(`  Senior: ${status.tiers.distribution.senior}`);
    lines.push(`  Mid:    ${status.tiers.distribution.mid}`);
    lines.push(`  Junior: ${status.tiers.distribution.junior}`);
    lines.push("");
    lines.push(
      `Escalation Rate: ${(status.tiers.escalationRate * 100).toFixed(1)}%${status.tiers.escalationWarning ? " ⚠️" : ""}`
    );
    lines.push(`Tier Match Rate: ${(status.tiers.tierMatchRate * 100).toFixed(1)}%`);
    lines.push(`Targets Met:     ${status.tiers.meetsTargets ? "✅" : "❌"}`);
    lines.push("");
  }

  // Turn Cost
  if (status.turnCost) {
    lines.push("Turn Cost:");
    lines.push(`  Weighted Score: ${status.turnCost.weightedScore.toFixed(2)}`);
    lines.push(`  Event Count:    ${status.turnCost.eventCount}`);
    if (status.turnCost.priorRunScore !== undefined) {
      lines.push(`  Prior Score:    ${status.turnCost.priorRunScore.toFixed(2)}`);
      lines.push(`  Regression:     ${status.turnCost.hasRegression ? "⚠️ Yes" : "No"}`);
    }
    lines.push("");
  }

  // Hostility
  if (status.hostility) {
    const hostilityIcon =
      status.hostility.status === "low" ? "✅" : status.hostility.status === "medium" ? "⚠️" : "❌";
    lines.push("Environment Hostility:");
    lines.push(`  Score:  ${(status.hostility.score * 100).toFixed(0)}% ${hostilityIcon}`);
    lines.push(`  Status: ${status.hostility.status}`);
    if (status.hostility.recommendationCount > 0) {
      lines.push(`  Recommendations: ${status.hostility.recommendationCount}`);
    }
    lines.push("");
  }

  // Warnings
  if (status.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of status.warnings) {
      lines.push(`  ⚠️ ${warning}`);
    }
  }

  return lines.join("\n");
}

/**
 * Convert governance status to JSON-serializable format
 */
export function governanceStatusToJSON(status: GovernanceStatus): Record<string, unknown> {
  return {
    health: status.health,
    tiers: status.tiers,
    turnCost: status.turnCost,
    hostility: status.hostility,
    warnings: status.warnings,
  };
}
