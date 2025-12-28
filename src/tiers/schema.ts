/**
 * Capability Tier Schema
 *
 * Defines tier types for task assignment governance.
 * Implements Claim 3.4: Matching task tier to model capability
 * reduces overall Turn Cost by avoiding over/under-allocation.
 */

import { z } from "zod";

/**
 * Capability tier levels
 *
 * | Tier | Role | LexRunner Context |
 * |------|------|-------------------|
 * | senior | Design, critique, decide | Architecture decisions, complex conflict resolution |
 * | mid | Implement, extend, refactor | Standard merge-weave, gate execution |
 * | junior | Verify, instrument, lint | Lint gates, formatting, simple validations |
 */
export const CapabilityTier = z.enum(["senior", "mid", "junior"]);
export type CapabilityTier = z.infer<typeof CapabilityTier>;

/**
 * Tier assignment for a plan item
 */
export const TierAssignment = z.object({
  /** Suggested tier based on heuristics */
  suggested: CapabilityTier,
  /** Actual tier used during execution (may differ due to override) */
  actual: CapabilityTier.optional(),
  /** Whether the task was escalated to a higher tier */
  escalated: z.boolean().default(false),
  /** Reason for escalation if applicable */
  escalationReason: z.string().optional(),
  /** Whether actual tier differs from suggested tier */
  mismatch: z.boolean().optional(),
});

export type TierAssignment = z.infer<typeof TierAssignment>;

/**
 * Tier override specification from CLI
 * Format: "item-name=tier" (e.g., "PR-123=senior")
 */
export const TierOverride = z.object({
  /** Item name to override */
  itemName: z.string(),
  /** Tier to assign */
  tier: CapabilityTier,
});

export type TierOverride = z.infer<typeof TierOverride>;

/**
 * Parse tier override string from CLI
 * @param overrideStr Format: "item-name=tier"
 * @returns Parsed tier override or null if invalid
 */
export function parseTierOverride(overrideStr: string): TierOverride | null {
  const parts = overrideStr.split("=");
  if (parts.length !== 2) {
    return null;
  }

  const [itemName, tierStr] = parts;
  const tierResult = CapabilityTier.safeParse(tierStr.toLowerCase());

  if (!tierResult.success || !itemName) {
    return null;
  }

  return {
    itemName: itemName.trim(),
    tier: tierResult.data,
  };
}

/**
 * Parse multiple tier overrides from CLI argument
 * @param overrides Array of override strings or comma-separated string
 * @returns Array of valid tier overrides
 */
export function parseTierOverrides(overrides: string | string[]): TierOverride[] {
  const overrideList = typeof overrides === "string" ? overrides.split(",") : overrides;

  const result: TierOverride[] = [];
  for (const override of overrideList) {
    const parsed = parseTierOverride(override.trim());
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}
