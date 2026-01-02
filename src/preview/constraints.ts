/**
 * Constraint Preview Module
 *
 * Provides constraint preview functionality for dry-run mode.
 * Shows what constraints/rules will apply before execution.
 */

import type { Plan } from "../schema.js";
import {
  getLexSonaConfig,
  isLexSonaEnabled,
  deriveShadowConstraints,
  type LexSonaWorkflowContext,
  type LexSonaShadowResult,
} from "../lexsona/index.js";

/**
 * Source of a constraint
 */
export type ConstraintSource = "baseline" | "persona" | "learned";

/**
 * A previewed constraint
 */
export interface PreviewedConstraint {
  id: string;
  statement: string;
  source: ConstraintSource;
  appliesTo: string[]; // Which plan items this affects
  severity?: string;
  confidence?: number;
}

/**
 * Constraint conflict
 */
export interface ConstraintConflict {
  constraint1: string;
  constraint2: string;
  reason: string;
}

/**
 * Constraint preview result
 */
export interface ConstraintPreview {
  constraints: PreviewedConstraint[];
  conflicts: ConstraintConflict[];
  warnings: string[];
  totalCount: number;
  bySource: {
    baseline: number;
    persona: number;
    learned: number;
  };
}

/**
 * Extract scope information from a plan
 */
function extractScopeFromPlan(plan: Plan): Record<string, unknown> {
  return {
    target: plan.target,
    itemCount: plan.items.length,
    gates: plan.policy?.requiredGates || [],
    hasPolicy: !!plan.policy,
  };
}

/**
 * Match plan items that a constraint applies to
 */
function matchPlanItems(constraint: any, plan: Plan): string[] {
  // For now, constraints apply to all items
  // In the future, this could be more sophisticated based on constraint metadata
  return plan.items.map((item) => item.name);
}

/**
 * Derive warnings from constraints and plan
 */
function deriveWarnings(constraints: PreviewedConstraint[], plan: Plan): string[] {
  const warnings: string[] = [];

  // Check for items with no explicit gate configuration
  const itemsWithNoGates = plan.items.filter((item) => !item.gates || item.gates.length === 0);
  if (itemsWithNoGates.length > 0) {
    warnings.push(
      `${itemsWithNoGates.length} item(s) have no explicit gate configuration (will use defaults)`
    );
  }

  // Check for items with missing dependencies
  const allItemNames = new Set(plan.items.map((item) => item.name));
  for (const item of plan.items) {
    for (const dep of item.deps) {
      if (!allItemNames.has(dep)) {
        warnings.push(`Item "${item.name}" depends on missing item "${dep}"`);
      }
    }
  }

  return warnings;
}

/**
 * Check for conflicts between constraints
 */
function checkConflicts(constraints: PreviewedConstraint[]): ConstraintConflict[] {
  // Currently no conflict detection logic
  // In the future, this could detect contradictory constraints
  return [];
}

/**
 * Convert LexSona shadow result to previewed constraints
 */
function convertLexSonaConstraints(
  shadowResult: LexSonaShadowResult,
  plan: Plan
): PreviewedConstraint[] {
  if (!shadowResult.success || !shadowResult.constraintSet) {
    return [];
  }

  return shadowResult.constraintSet.topConstraints.map((c) => ({
    id: c.id,
    statement: c.description,
    source: "persona" as ConstraintSource,
    appliesTo: matchPlanItems(c, plan),
    severity: c.severity,
    confidence: c.confidence,
  }));
}

/**
 * Get baseline constraints (hardcoded rules)
 */
function getBaselineConstraints(plan: Plan): PreviewedConstraint[] {
  const baseline: PreviewedConstraint[] = [];
  const allItems = plan.items.map((item) => item.name);

  // Baseline constraint: merge-gates-required
  if (plan.policy?.requiredGates && plan.policy.requiredGates.length > 0) {
    baseline.push({
      id: "merge-gates-required",
      statement: "All gates must pass before merge",
      source: "baseline",
      appliesTo: allItems,
    });
  }

  // Baseline constraint: require-ci-green
  baseline.push({
    id: "require-ci-green",
    statement: "CI must be green",
    source: "baseline",
    appliesTo: allItems,
  });

  // Baseline constraint: no-force-push (if policy exists)
  if (plan.policy) {
    baseline.push({
      id: "no-force-push",
      statement: "Use merge, not rebase",
      source: "baseline",
      appliesTo: allItems,
    });
  }

  // Baseline constraint: flaky-gate-retry
  const hasRetryConfig = plan.policy?.retries && Object.keys(plan.policy.retries).length > 0;
  if (hasRetryConfig) {
    baseline.push({
      id: "flaky-gate-retry",
      statement: "Retry failed gates up to configured times",
      source: "baseline",
      appliesTo: allItems,
    });
  }

  return baseline;
}

/**
 * Preview constraints for a plan
 *
 * @param plan - The execution plan
 * @param persona - Optional persona ID (will use LEXSONA_PERSONA env var if not provided)
 * @returns Constraint preview with constraints, conflicts, and warnings
 */
export async function previewConstraints(
  plan: Plan,
  persona?: string | null
): Promise<ConstraintPreview> {
  const allConstraints: PreviewedConstraint[] = [];

  // 1. Get baseline constraints
  const baselineConstraints = getBaselineConstraints(plan);
  allConstraints.push(...baselineConstraints);

  // 2. Get persona constraints from LexSona (if enabled)
  const lexsonaConfig = getLexSonaConfig();
  const effectivePersona = persona !== undefined ? persona : lexsonaConfig.personaId;

  if (effectivePersona && isLexSonaEnabled({ ...lexsonaConfig, personaId: effectivePersona })) {
    const workflowContext: LexSonaWorkflowContext = {
      workflowId: "merge-weave",
      stepKind: "preview",
      repo: plan.target,
      hints: {
        task: "constraint-preview",
        ...extractScopeFromPlan(plan),
      },
    };

    const shadowResult = await deriveShadowConstraints(
      workflowContext,
      effectivePersona ? { ...lexsonaConfig, personaId: effectivePersona } : lexsonaConfig
    );
    const personaConstraints = convertLexSonaConstraints(shadowResult, plan);
    allConstraints.push(...personaConstraints);
  }

  // 3. Get learned constraints (placeholder for future implementation)
  // const learnedConstraints = await getLearnedConstraints(plan);
  // allConstraints.push(...learnedConstraints);

  // 4. Check for conflicts
  const conflicts = checkConflicts(allConstraints);

  // 5. Derive warnings
  const warnings = deriveWarnings(allConstraints, plan);

  // 6. Count by source
  const bySource = {
    baseline: allConstraints.filter((c) => c.source === "baseline").length,
    persona: allConstraints.filter((c) => c.source === "persona").length,
    learned: allConstraints.filter((c) => c.source === "learned").length,
  };

  return {
    constraints: allConstraints,
    conflicts,
    warnings,
    totalCount: allConstraints.length,
    bySource,
  };
}

/**
 * Format constraint preview for console output
 */
export function formatConstraintPreview(preview: ConstraintPreview): string {
  const lines: string[] = [];

  lines.push(`📋 Active Constraints (${preview.totalCount} total)`);
  lines.push("");

  // Group by source
  const bySource: Record<ConstraintSource, PreviewedConstraint[]> = {
    baseline: [],
    persona: [],
    learned: [],
  };

  for (const constraint of preview.constraints) {
    bySource[constraint.source].push(constraint);
  }

  // Baseline constraints
  if (bySource.baseline.length > 0) {
    lines.push("From baseline:");
    for (const c of bySource.baseline) {
      lines.push(`  • ${c.id} — ${c.statement}`);
    }
    lines.push("");
  }

  // Persona constraints
  if (bySource.persona.length > 0) {
    lines.push("From persona:");
    for (const c of bySource.persona) {
      const confidence = c.confidence ? ` (${(c.confidence * 100).toFixed(0)}%)` : "";
      lines.push(`  • ${c.id} — ${c.statement}${confidence}`);
    }
    lines.push("");
  }

  // Learned constraints
  if (bySource.learned.length > 0) {
    lines.push("From learned rules:");
    for (const c of bySource.learned) {
      lines.push(`  • ${c.id} — ${c.statement}`);
    }
    lines.push("");
  } else {
    lines.push("From learned rules:");
    lines.push("  (none active for this scope)");
    lines.push("");
  }

  // Warnings
  if (preview.warnings.length > 0) {
    lines.push("⚠️  Warnings:");
    for (const warning of preview.warnings) {
      lines.push(`  • ${warning}`);
    }
    lines.push("");
  }

  // Conflicts
  if (preview.conflicts.length > 0) {
    lines.push("❌ Constraint Conflicts Detected:");
    for (const conflict of preview.conflicts) {
      lines.push(`  • ${conflict.constraint1} conflicts with ${conflict.constraint2}`);
      lines.push(`    Reason: ${conflict.reason}`);
    }
    lines.push("");
  } else {
    lines.push("✅ No constraint conflicts detected.");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format constraint preview as JSON
 */
export function formatConstraintPreviewJSON(preview: ConstraintPreview): string {
  return JSON.stringify(preview, null, 2);
}
