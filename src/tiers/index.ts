/**
 * Capability Tier Module
 *
 * Exports tier routing functionality for task assignment governance.
 * Implements Claim 3.4: Matching task tier to model capability.
 */

// Schema exports - both Zod schemas and types
export { CapabilityTier, TierAssignment, parseTierOverride, parseTierOverrides } from "./schema.js";

export type { TierOverride } from "./schema.js";

// Suggestion heuristics exports
export {
  suggestTier,
  createTierAssignment,
  suggestTiersForPlan,
  isDeterministicGate,
  isLintOnly,
  isFormatOnly,
  touchesContracts,
  hasHighConflictPrediction,
  hasComplexDependencies,
} from "./suggest.js";

// Metrics exports
export type { TierMetrics } from "./metrics.js";
export {
  calculateTierMetrics,
  meetsGovernanceTargets,
  formatTierMetrics,
  tierMetricsToJSON,
  TIER_METRIC_TARGETS,
} from "./metrics.js";
