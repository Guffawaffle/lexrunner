/**
 * Metrics Module - Public API
 *
 * Re-exports all public types and functions from the metrics module.
 * Implements Turn Cost tracking for merge-weave operations.
 * Provides governance metrics export for observability (Wave 3).
 */

// Turn Cost tracking
export {
  MergeWeaveTurnCost,
  createTurnCostTracker,
  DEFAULT_TURN_COST_WEIGHTS,
  type TurnCostWeights,
  type TurnCostComponents,
  type TurnCostEvent,
  type TurnCostSummary,
} from "./turncost.js";

// Governance metrics export (Wave 3)
export {
  GovernanceMetricsCollector,
  createMetricsCollector,
  getGlobalMetricsCollector,
  resetGlobalMetricsCollector,
  METRIC_DEFINITIONS,
  type MetricType,
  type MetricDefinition,
  type MetricValue,
  type MetricsSnapshot,
  type TurnCostMetrics,
  type TierDistributionMetrics,
  type FailureRateMetrics,
  type BudgetRemainingMetrics,
} from "./export.js";
