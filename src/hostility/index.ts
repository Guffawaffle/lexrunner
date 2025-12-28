/**
 * Environmental Hostility Scoring Module
 *
 * Implements the Environmental De-hostilization concept from the coordination
 * cost compression thesis (Definition 3.2).
 *
 * @module hostility
 */

// Score types and utilities
export {
  HostilityComponentSchema,
  HostilityScoreSchema,
  HOSTILITY_COMPONENT_NAMES,
  COMPONENT_LABELS,
  computeStatus,
  computeOverallStatus,
  createComponent,
  aggregateScore,
  type HostilityComponent,
  type HostilityScore,
  type HostilityStatus,
  type HostilityComponentName,
} from "./score.js";

// Individual check functions
export {
  checkConstraintClarity,
  checkRequirementExplicitness,
  checkProblemBoundedness,
  checkReceiptCompleteness,
  checkErrorRecoverability,
  checkStateCoherence,
  checkModelContinuity,
  runAllChecks,
  type CheckOptions,
} from "./checks.js";

import { runAllChecks, CheckOptions } from "./checks.js";
import {
  aggregateScore,
  HostilityScore,
  COMPONENT_LABELS,
  HostilityComponentName,
} from "./score.js";

/**
 * Run a complete environment quality check and return the hostility score.
 *
 * @param options - Check options including cwd, planPath, and profileDir
 * @returns Complete hostility score with component breakdown
 */
export function runEnvironmentQualityCheck(options: CheckOptions = {}): HostilityScore {
  const components = runAllChecks(options);

  // Cast to the expected type shape
  const typedComponents = components as HostilityScore["components"];

  return aggregateScore(typedComponents);
}

/**
 * Format a hostility score as a human-readable report.
 *
 * @param score - The hostility score to format
 * @returns Formatted report string
 */
export function formatHostilityReport(score: HostilityScore): string {
  const lines: string[] = [];

  lines.push("Environment Quality Report");
  lines.push("==========================");
  lines.push("");

  // Overall score with status indicator
  const statusLabel =
    score.status === "low"
      ? "low - good"
      : score.status === "medium"
        ? "medium - needs attention"
        : "high - significant issues";

  lines.push(`Overall Hostility Score: ${score.total.toFixed(2)} (${statusLabel})`);
  lines.push("");

  lines.push("Component Breakdown:");

  // Format each component
  const componentNames = Object.keys(score.components) as HostilityComponentName[];
  for (const name of componentNames) {
    const component = score.components[name];
    const icon = component.status === "good" ? "✓" : component.status === "warning" ? "~" : "✗";
    const label = COMPONENT_LABELS[name] || name;
    const paddedLabel = label.padEnd(24);
    lines.push(`  ${icon} ${paddedLabel} ${component.score.toFixed(1)}  ${component.details}`);
  }

  // Add recommendations if any
  if (score.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");
    score.recommendations.forEach((rec, idx) => {
      lines.push(`  ${idx + 1}. ${rec}`);
    });
  }

  return lines.join("\n");
}
