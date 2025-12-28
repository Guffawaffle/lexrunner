/**
 * Environmental Hostility Scoring
 *
 * Implements Definition 3.2 (Environmental Hostility) from the governance thesis:
 * The degree to which an environment impedes effective agent operation through:
 * - Unclear or implicit constraints
 * - Opaque requirements (unstated expectations)
 * - Unbounded problem surfaces
 * - Missing receipts and traceability
 * - Punitive error dynamics
 * - Fragmented state
 * - Model switches without continuity protocols
 */

import { z } from "zod";

/**
 * Status indicator for a hostility component.
 * - good: Score < 0.3, environment is well-configured
 * - warning: Score 0.3-0.6, improvement recommended
 * - critical: Score > 0.6, significant impediment to agent operation
 */
export type HostilityStatus = "good" | "warning" | "critical";

/**
 * Schema for a single hostility component check result.
 */
export const HostilityComponentSchema = z.object({
  score: z.number().min(0).max(1),
  status: z.enum(["good", "warning", "critical"]),
  details: z.string(),
  recommendation: z.string().optional(),
});

export type HostilityComponent = z.infer<typeof HostilityComponentSchema>;

/**
 * Schema for the complete hostility score with all component breakdowns.
 */
export const HostilityScoreSchema = z.object({
  total: z.number().min(0).max(1),
  status: z.enum(["low", "medium", "high"]),
  components: z.object({
    constraintClarity: HostilityComponentSchema,
    requirementExplicitness: HostilityComponentSchema,
    problemBoundedness: HostilityComponentSchema,
    receiptCompleteness: HostilityComponentSchema,
    errorRecoverability: HostilityComponentSchema,
    stateCoherence: HostilityComponentSchema,
    modelContinuity: HostilityComponentSchema,
  }),
  recommendations: z.array(z.string()),
});

export type HostilityScore = z.infer<typeof HostilityScoreSchema>;

/**
 * Component names for iteration and display
 */
export const HOSTILITY_COMPONENT_NAMES = [
  "constraintClarity",
  "requirementExplicitness",
  "problemBoundedness",
  "receiptCompleteness",
  "errorRecoverability",
  "stateCoherence",
  "modelContinuity",
] as const;

export type HostilityComponentName = (typeof HOSTILITY_COMPONENT_NAMES)[number];

/**
 * Human-readable labels for each component
 */
export const COMPONENT_LABELS: Record<HostilityComponentName, string> = {
  constraintClarity: "Constraint Clarity",
  requirementExplicitness: "Requirement Explicitness",
  problemBoundedness: "Problem Boundedness",
  receiptCompleteness: "Receipt Completeness",
  errorRecoverability: "Error Recoverability",
  stateCoherence: "State Coherence",
  modelContinuity: "Model Continuity",
};

/**
 * Compute status from score.
 * - good: score < 0.3
 * - warning: 0.3 <= score < 0.6
 * - critical: score >= 0.6
 */
export function computeStatus(score: number): HostilityStatus {
  if (score < 0.3) return "good";
  if (score < 0.6) return "warning";
  return "critical";
}

/**
 * Compute overall status from total score.
 * - low (good): total < 0.3
 * - medium: 0.3 <= total < 0.6
 * - high: total >= 0.6
 */
export function computeOverallStatus(total: number): "low" | "medium" | "high" {
  if (total < 0.3) return "low";
  if (total < 0.6) return "medium";
  return "high";
}

/**
 * Create a hostility component result.
 */
export function createComponent(
  score: number,
  details: string,
  recommendation?: string
): HostilityComponent {
  const clampedScore = Math.max(0, Math.min(1, score));
  return {
    score: clampedScore,
    status: computeStatus(clampedScore),
    details,
    recommendation,
  };
}

/**
 * Aggregate component scores into a total hostility score.
 */
export function aggregateScore(components: HostilityScore["components"]): HostilityScore {
  const componentValues = Object.values(components);
  const total = componentValues.reduce((sum, c) => sum + c.score, 0) / componentValues.length;

  const recommendations = componentValues
    .filter((c) => c.recommendation)
    .map((c) => c.recommendation!);

  return {
    total,
    status: computeOverallStatus(total),
    components,
    recommendations,
  };
}
