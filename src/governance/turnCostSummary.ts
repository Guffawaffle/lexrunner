/**
 * Turn Cost Summary Integration
 *
 * Implements acceptance criteria 3: "Turn Cost in Merge-Weave Summary"
 *
 * Provides formatted summaries of Turn Cost metrics, comparison with
 * prior runs, and regression detection for end-of-run reporting.
 */

import type { TurnCostSummary, TurnCostComponents } from "../metrics/turncost.js";

/**
 * Threshold for flagging a significant Turn Cost regression (20% increase)
 */
export const TURN_COST_REGRESSION_THRESHOLD = 0.2;

/**
 * Turn Cost comparison result
 */
export interface TurnCostComparison {
  /** Current run's weighted score */
  currentScore: number;
  /** Prior run's weighted score (if available) */
  priorScore?: number;
  /** Percentage change (positive = worse, negative = improvement) */
  percentageChange?: number;
  /** Whether this represents a significant regression */
  isRegression: boolean;
  /** Human-readable summary of the comparison */
  summary: string;
}

/**
 * Format Turn Cost summary for end-of-run display.
 *
 * @param summary - Turn Cost summary from the tracker
 * @returns Formatted string for display
 */
export function formatTurnCostSummary(summary: TurnCostSummary): string {
  const lines: string[] = [];

  lines.push("Turn Cost Summary");
  lines.push("─────────────────");
  lines.push("");

  // Component breakdown
  lines.push("Component Breakdown:");
  lines.push(`  Latency:           ${formatDuration(summary.components.latencyMs)}`);
  lines.push(`  Renegotiations:    ${summary.components.renegotiationCount}`);
  lines.push(`  Token Bloat:       ${summary.components.tokenBloat}`);
  lines.push(`  Attention Switches: ${summary.components.attentionSwitchCount}`);
  lines.push("");

  // Weighted score
  lines.push(`Weighted Score: ${summary.weightedScore.toFixed(2)}`);
  lines.push(`Total Events:   ${summary.eventCount}`);

  // Prior run comparison if available
  if (summary.priorRunScore !== undefined) {
    lines.push("");
    lines.push(`Prior Run Score: ${summary.priorRunScore.toFixed(2)}`);
    lines.push(`Change:          ${summary.improvement}`);

    // Flag significant regressions
    const comparison = compareTurnCosts(summary.weightedScore, summary.priorRunScore);
    if (comparison.isRegression) {
      lines.push("");
      lines.push("⚠️  SIGNIFICANT REGRESSION DETECTED");
      lines.push(
        `   Current score is ${(comparison.percentageChange! * 100).toFixed(0)}% higher than prior run`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Compare current Turn Cost to a prior run.
 *
 * @param currentScore - Current run's weighted score
 * @param priorScore - Prior run's weighted score (optional)
 * @returns Comparison result with regression detection
 */
export function compareTurnCosts(currentScore: number, priorScore?: number): TurnCostComparison {
  if (priorScore === undefined || priorScore === 0) {
    return {
      currentScore,
      isRegression: false,
      summary: "No prior run for comparison",
    };
  }

  const percentageChange = (currentScore - priorScore) / priorScore;
  const isRegression = percentageChange > TURN_COST_REGRESSION_THRESHOLD;

  let summary: string;
  if (isRegression) {
    summary = `Turn Cost increased by ${(percentageChange * 100).toFixed(0)}% (threshold: ${(TURN_COST_REGRESSION_THRESHOLD * 100).toFixed(0)}%)`;
  } else if (percentageChange < 0) {
    summary = `Turn Cost improved by ${(Math.abs(percentageChange) * 100).toFixed(0)}%`;
  } else {
    summary = `Turn Cost stable (${(percentageChange * 100).toFixed(0)}% change)`;
  }

  return {
    currentScore,
    priorScore,
    percentageChange,
    isRegression,
    summary,
  };
}

/**
 * Format a Turn Cost comparison for display.
 *
 * @param comparison - Comparison result
 * @returns Formatted comparison string
 */
export function formatTurnCostComparison(comparison: TurnCostComparison): string {
  const lines: string[] = [];

  lines.push("Turn Cost Comparison");
  lines.push("────────────────────");
  lines.push(`Current Score: ${comparison.currentScore.toFixed(2)}`);

  if (comparison.priorScore !== undefined) {
    lines.push(`Prior Score:   ${comparison.priorScore.toFixed(2)}`);

    if (comparison.percentageChange !== undefined) {
      const sign = comparison.percentageChange >= 0 ? "+" : "";
      lines.push(`Change:        ${sign}${(comparison.percentageChange * 100).toFixed(1)}%`);
    }
  }

  lines.push("");
  lines.push(comparison.isRegression ? `⚠️  ${comparison.summary}` : comparison.summary);

  return lines.join("\n");
}

/**
 * Helper to format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

/**
 * Convert Turn Cost summary to JSON-serializable format for Frame emission
 */
export function turnCostSummaryToJSON(
  summary: TurnCostSummary,
  priorScore?: number
): Record<string, unknown> {
  const comparison = compareTurnCosts(summary.weightedScore, priorScore);

  return {
    components: {
      ...summary.components,
    },
    weightedScore: summary.weightedScore,
    eventCount: summary.eventCount,
    comparison:
      priorScore !== undefined
        ? {
            priorScore,
            percentageChange: comparison.percentageChange,
            isRegression: comparison.isRegression,
          }
        : null,
  };
}
