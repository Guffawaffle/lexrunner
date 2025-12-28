/**
 * Governance Integration Module
 *
 * Provides integration between:
 * - Environmental Hostility Scoring
 * - Disciplined Failure Pattern (Receipts)
 * - Turn Cost Tracking
 * - Capability Tier Routing
 *
 * This module implements the acceptance criteria for Wave 3 integration.
 *
 * @module governance
 */

// Timeout adjustment based on hostility
export {
  calculateHostilityAdjustedTimeout,
  logTimeoutAdjustment,
  getAdjustedTimeout,
  type TimeoutAdjustment,
  DEFAULT_GATE_TIMEOUT_MS,
  MAX_TIMEOUT_MULTIPLIER,
  MIN_TIMEOUT_MULTIPLIER,
} from "./timeoutAdjustment.js";

// Turn Cost summary integration
export {
  formatTurnCostSummary,
  compareTurnCosts,
  formatTurnCostComparison,
  turnCostSummaryToJSON,
  TURN_COST_REGRESSION_THRESHOLD,
  type TurnCostComparison,
} from "./turnCostSummary.js";

// Tier metrics for MCP status
export {
  buildGovernanceStatus,
  formatGovernanceStatus,
  governanceStatusToJSON,
  type GovernanceStatus,
} from "./mcpStatus.js";
