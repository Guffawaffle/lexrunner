/**
 * Handoff Readiness Calculator
 *
 * Analyzes audit log to determine tier handoff readiness.
 *
 * @module
 */

import {
  type InterventionAuditEntry,
  type InterventionStats,
  type TierReadiness,
  type HandoffReadinessReport,
  type HandoffThresholds,
  type DeterminismLevel,
  DEFAULT_HANDOFF_THRESHOLDS,
  INTERVENTION_CATALOG,
} from "./schema.js";

// =============================================================================
// STATISTICS CALCULATOR
// =============================================================================

/**
 * Calculate statistics for a single intervention
 */
export function calculateInterventionStats(
  interventionId: string,
  entries: InterventionAuditEntry[]
): InterventionStats | null {
  const interventionEntries = entries.filter((e) => e.intervention_id === interventionId);

  if (interventionEntries.length === 0) {
    return null;
  }

  const first = interventionEntries[0];
  const catalog = INTERVENTION_CATALOG.find((i) => i.id === interventionId);

  const successful = interventionEntries.filter((e) => e.success).length;
  const overrides = interventionEntries.filter((e) => e.required_human_override).length;
  const totalTime = interventionEntries.reduce((sum, e) => sum + e.time_to_complete_ms, 0);

  return {
    intervention_id: interventionId,
    intervention_name: catalog?.name ?? first.intervention_name,
    determinism_level: catalog?.determinism_level ?? first.determinism_level,
    total_executions: interventionEntries.length,
    successful_executions: successful,
    success_rate: interventionEntries.length > 0 ? successful / interventionEntries.length : 0,
    human_overrides: overrides,
    avg_time_ms: interventionEntries.length > 0 ? totalTime / interventionEntries.length : 0,
  };
}

/**
 * Calculate statistics for all interventions in the audit log
 */
export function calculateAllStats(entries: InterventionAuditEntry[]): InterventionStats[] {
  const interventionIds = Array.from(new Set(entries.map((e) => e.intervention_id)));
  const stats: InterventionStats[] = [];

  for (const id of interventionIds) {
    const stat = calculateInterventionStats(id, entries);
    if (stat) {
      stats.push(stat);
    }
  }

  return stats.sort((a, b) => a.intervention_id.localeCompare(b.intervention_id));
}

// =============================================================================
// LEVEL STATISTICS
// =============================================================================

interface LevelStats {
  count: number;
  success_rate: number;
  total_executions: number;
  successful_executions: number;
}

/**
 * Calculate statistics by determinism level
 */
export function calculateLevelStats(
  entries: InterventionAuditEntry[],
  level: DeterminismLevel
): LevelStats {
  const levelEntries = entries.filter((e) => e.determinism_level === level);
  const uniqueInterventions = new Set(levelEntries.map((e) => e.intervention_id));
  const successful = levelEntries.filter((e) => e.success).length;

  return {
    count: uniqueInterventions.size,
    success_rate: levelEntries.length > 0 ? successful / levelEntries.length : 0,
    total_executions: levelEntries.length,
    successful_executions: successful,
  };
}

// =============================================================================
// TIER READINESS ASSESSMENT
// =============================================================================

/**
 * Assess readiness for a specific tier
 */
export function assessTierReadiness(
  entries: InterventionAuditEntry[],
  thresholds: HandoffThresholds = DEFAULT_HANDOFF_THRESHOLDS
): TierReadiness[] {
  const assessments: TierReadiness[] = [];

  // Junior tier: Ready when D1 is fully deterministic
  const d1Stats = calculateLevelStats(entries, "D1");
  const d1Ready =
    d1Stats.success_rate >= thresholds.d1_min_success_rate &&
    d1Stats.successful_executions >= thresholds.min_successful_runs;

  const d1Blocking = entries
    .filter((e) => e.determinism_level === "D1" && !e.success)
    .map((e) => e.intervention_id);
  const uniqueD1Blocking = Array.from(new Set(d1Blocking));

  assessments.push({
    tier: "junior",
    determinism_level: "D1",
    ready: d1Ready,
    success_rate: d1Stats.success_rate,
    target_rate: thresholds.d1_min_success_rate,
    successful_runs: d1Stats.successful_executions,
    required_runs: thresholds.min_successful_runs,
    blocking_interventions: uniqueD1Blocking,
  });

  // Mid tier: Ready when D2 error rate below 5%
  const d2Stats = calculateLevelStats(entries, "D2");
  const d2Ready =
    d2Stats.success_rate >= thresholds.d2_min_success_rate &&
    d2Stats.successful_executions >= thresholds.min_successful_runs;

  const d2Blocking = entries
    .filter((e) => e.determinism_level === "D2" && !e.success)
    .map((e) => e.intervention_id);
  const uniqueD2Blocking = Array.from(new Set(d2Blocking));

  assessments.push({
    tier: "mid",
    determinism_level: "D2",
    ready: d2Ready,
    success_rate: d2Stats.success_rate,
    target_rate: thresholds.d2_min_success_rate,
    successful_runs: d2Stats.successful_executions,
    required_runs: thresholds.min_successful_runs,
    blocking_interventions: uniqueD2Blocking,
  });

  // Script tier: Same as junior for D1 operations
  assessments.push({
    tier: "script",
    determinism_level: "D1",
    ready: d1Ready,
    success_rate: d1Stats.success_rate,
    target_rate: thresholds.d1_min_success_rate,
    successful_runs: d1Stats.successful_executions,
    required_runs: thresholds.min_successful_runs,
    blocking_interventions: uniqueD1Blocking,
  });

  return assessments;
}

// =============================================================================
// HANDOFF READINESS REPORT
// =============================================================================

/**
 * Generate a complete handoff readiness report
 */
export function generateHandoffReport(
  entries: InterventionAuditEntry[],
  thresholds: HandoffThresholds = DEFAULT_HANDOFF_THRESHOLDS
): HandoffReadinessReport {
  const stats = calculateAllStats(entries);
  const tierReadiness = assessTierReadiness(entries, thresholds);

  const d1Stats = calculateLevelStats(entries, "D1");
  const d2Stats = calculateLevelStats(entries, "D2");
  const d3Stats = calculateLevelStats(entries, "D3");

  const recommendations: string[] = [];

  // Generate recommendations
  const d1Ready = tierReadiness.find((t) => t.tier === "junior");
  if (d1Ready && !d1Ready.ready) {
    if (d1Ready.successful_runs < d1Ready.required_runs) {
      recommendations.push(
        `Run ${
          d1Ready.required_runs - d1Ready.successful_runs
        } more successful D1 interventions for junior tier handoff`
      );
    }
    if (d1Ready.success_rate < d1Ready.target_rate) {
      recommendations.push(
        `Improve D1 success rate from ${(d1Ready.success_rate * 100).toFixed(
          1
        )}% to ${(d1Ready.target_rate * 100).toFixed(1)}%`
      );
    }
    if (d1Ready.blocking_interventions.length > 0) {
      recommendations.push(
        `Fix failing D1 interventions: ${d1Ready.blocking_interventions.join(", ")}`
      );
    }
  }

  const d2Ready = tierReadiness.find((t) => t.tier === "mid");
  if (d2Ready && !d2Ready.ready) {
    if (d2Ready.successful_runs < d2Ready.required_runs) {
      recommendations.push(
        `Run ${
          d2Ready.required_runs - d2Ready.successful_runs
        } more successful D2 interventions for mid tier handoff`
      );
    }
    if (d2Ready.success_rate < d2Ready.target_rate) {
      recommendations.push(
        `Improve D2 success rate from ${(d2Ready.success_rate * 100).toFixed(
          1
        )}% to ${(d2Ready.target_rate * 100).toFixed(1)}%`
      );
    }
  }

  // D3 is never ready for handoff by design
  recommendations.push("D3 interventions require frontier models by design");

  return {
    generated_at: new Date().toISOString(),
    total_interventions: stats.length,
    by_level: {
      D1: {
        count: d1Stats.count,
        success_rate: d1Stats.success_rate,
        ready_for_handoff: d1Ready?.ready ?? false,
      },
      D2: {
        count: d2Stats.count,
        success_rate: d2Stats.success_rate,
        ready_for_handoff: d2Ready?.ready ?? false,
      },
      D3: {
        count: d3Stats.count,
        success_rate: d3Stats.success_rate,
        ready_for_handoff: false, // Always false for D3
      },
    },
    intervention_stats: stats,
    tier_readiness: tierReadiness,
    recommendations,
  };
}

// =============================================================================
// REPORT FORMATTING
// =============================================================================

/**
 * Format handoff report for console output
 */
export function formatHandoffReport(report: HandoffReadinessReport): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("                    HANDOFF READINESS REPORT                    ");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  // Level summary
  lines.push("📊 DETERMINISM LEVEL SUMMARY");
  lines.push("───────────────────────────────────────────────────────────────");

  const d1 = report.by_level.D1;
  const d1Status = d1.ready_for_handoff ? "✅ READY for junior tier" : "⏳ NOT READY";
  lines.push(
    `  D1 Interventions: ${d1.count} types, ${(d1.success_rate * 100).toFixed(
      1
    )}% success - ${d1Status}`
  );

  const d2 = report.by_level.D2;
  const d2Status = d2.ready_for_handoff ? "✅ READY for mid tier" : "⏳ NOT READY (target: 95%)";
  lines.push(
    `  D2 Interventions: ${d2.count} types, ${(d2.success_rate * 100).toFixed(
      1
    )}% success - ${d2Status}`
  );

  const d3 = report.by_level.D3;
  lines.push(
    `  D3 Interventions: ${d3.count} types, ${(d3.success_rate * 100).toFixed(
      1
    )}% success - Frontier only (by design)`
  );

  lines.push("");

  // Tier readiness
  lines.push("🎯 TIER HANDOFF READINESS");
  lines.push("───────────────────────────────────────────────────────────────");

  for (const tier of report.tier_readiness) {
    const emoji = tier.ready ? "✅" : "❌";
    const status = tier.ready ? "Ready" : "Not Ready";
    lines.push(
      `  ${emoji} ${tier.tier.toUpperCase()} (${
        tier.determinism_level
      }): ${status} - ${(tier.success_rate * 100).toFixed(1)}%/${(tier.target_rate * 100).toFixed(
        1
      )}% success, ${tier.successful_runs}/${tier.required_runs} runs`
    );
    if (!tier.ready && tier.blocking_interventions.length > 0) {
      lines.push(`     Blocking: ${tier.blocking_interventions.join(", ")}`);
    }
  }

  lines.push("");

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("💡 RECOMMENDATIONS");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
    lines.push("");
  }

  // Per-intervention stats
  if (report.intervention_stats.length > 0) {
    lines.push("📈 INTERVENTION STATISTICS");
    lines.push("───────────────────────────────────────────────────────────────");
    lines.push("  ID       | Name                          | Level | Rate   | Runs");
    lines.push("  ─────────┼───────────────────────────────┼───────┼────────┼─────");

    for (const stat of report.intervention_stats) {
      const name = stat.intervention_name.substring(0, 29).padEnd(29);
      const rate = `${(stat.success_rate * 100).toFixed(0)}%`.padStart(5);
      lines.push(
        `  ${stat.intervention_id} | ${name} | ${stat.determinism_level}    | ${rate} | ${stat.total_executions}`
      );
    }
    lines.push("");
  }

  lines.push("───────────────────────────────────────────────────────────────");
  lines.push(`Generated: ${report.generated_at}`);

  return lines.join("\n");
}
