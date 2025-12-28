/**
 * Tier Suggestion Heuristics
 *
 * Implements heuristics for suggesting capability tiers based on plan item characteristics.
 * Aligned with governance Claim 3.4 for coordination cost compression.
 */

import type { PlanItem, Gate } from "../schema.js";
import type { CapabilityTier, TierAssignment, TierOverride } from "./schema.js";

/**
 * Deterministic gate names that indicate junior-tier work
 */
const DETERMINISTIC_GATES = [
  "lint",
  "format",
  "typecheck",
  "prettier",
  "eslint",
  "check",
  "validate",
] as const;

/**
 * Contract-related file patterns that indicate senior-tier work
 */
const CONTRACT_PATTERNS = [
  "contract",
  "agents",
  "policy",
  ".policy.json",
  "governance",
  "rules",
] as const;

/**
 * Threshold for dependency count to suggest senior tier
 */
const HIGH_DEPENDENCY_THRESHOLD = 5;

/**
 * Threshold for moderate dependency count (used for high conflict prediction)
 */
const MODERATE_DEPENDENCY_THRESHOLD = 3;

/**
 * Check if a gate is deterministic (predictable, automatable)
 */
export function isDeterministicGate(gate: Gate): boolean {
  const gateName = gate.name?.toLowerCase() || "";
  return DETERMINISTIC_GATES.some((dg) => gateName.includes(dg) || gateName === dg);
}

/**
 * Check if item has only lint/format gates
 */
export function isLintOnly(item: PlanItem): boolean {
  if (!item.gates || item.gates.length === 0) {
    return false;
  }
  return item.gates.every((g) => isDeterministicGate(g));
}

/**
 * Check if item has only format-related gates
 */
export function isFormatOnly(item: PlanItem): boolean {
  if (!item.gates || item.gates.length === 0) {
    return false;
  }
  const formatGates = ["format", "prettier"];
  return item.gates.every((g) => {
    const name = g.name?.toLowerCase() || "";
    return formatGates.some((fg) => name.includes(fg) || name === fg);
  });
}

/**
 * Check if item likely touches contract files
 * Uses heuristics based on item name since we don't have file list
 */
export function touchesContracts(item: PlanItem): boolean {
  const name = item.name.toLowerCase();
  return CONTRACT_PATTERNS.some((pattern) => name.includes(pattern));
}

/**
 * Check if item has high conflict prediction based on dependencies
 */
export function hasHighConflictPrediction(item: PlanItem): boolean {
  return item.deps.length > MODERATE_DEPENDENCY_THRESHOLD;
}

/**
 * Check if item has complex dependency graph
 */
export function hasComplexDependencies(item: PlanItem): boolean {
  return item.deps.length > HIGH_DEPENDENCY_THRESHOLD;
}

/**
 * Suggest capability tier for a plan item based on heuristics
 *
 * Tier assignment rules (in order of precedence):
 * 1. Senior tier: High conflict prediction, complex dependencies, or touches contracts
 * 2. Junior tier: Only deterministic gates (lint, format, typecheck)
 * 3. Mid tier: Default for standard implementation work
 */
export function suggestTier(item: PlanItem): CapabilityTier {
  // Senior tier indicators (check first - highest priority)
  if (hasHighConflictPrediction(item)) {
    return "senior";
  }
  if (hasComplexDependencies(item)) {
    return "senior";
  }
  if (touchesContracts(item)) {
    return "senior";
  }

  // Junior tier indicators
  if (isLintOnly(item)) {
    return "junior";
  }
  if (isFormatOnly(item)) {
    return "junior";
  }

  // Default to mid tier
  return "mid";
}

/**
 * Create tier assignment for a plan item
 */
export function createTierAssignment(item: PlanItem, overrides?: TierOverride[]): TierAssignment {
  const suggested = suggestTier(item);

  // Check for override
  const override = overrides?.find((o) => o.itemName === item.name);

  if (override) {
    return {
      suggested,
      actual: override.tier,
      escalated: isEscalation(suggested, override.tier),
      mismatch: suggested !== override.tier,
    };
  }

  return {
    suggested,
    escalated: false,
  };
}

/**
 * Check if tier change represents an escalation (going to a higher tier)
 */
function isEscalation(from: CapabilityTier, to: CapabilityTier): boolean {
  const tierOrder: Record<CapabilityTier, number> = {
    junior: 0,
    mid: 1,
    senior: 2,
  };
  return tierOrder[to] > tierOrder[from];
}

/**
 * Apply tier suggestions to all items in a plan
 */
export function suggestTiersForPlan(
  items: PlanItem[],
  overrides?: TierOverride[]
): Map<string, TierAssignment> {
  const assignments = new Map<string, TierAssignment>();

  for (const item of items) {
    assignments.set(item.name, createTierAssignment(item, overrides));
  }

  return assignments;
}
