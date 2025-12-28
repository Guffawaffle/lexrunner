/**
 * Gate Timeout Adjustment based on Environmental Hostility
 *
 * Implements acceptance criteria 1: "Hostility → Gate Timeout Adjustment"
 *
 * When hostility score is high, increase gate timeouts to give more time
 * for operations that may be running in a challenging environment.
 * When hostility is low, use standard timeouts.
 */

import type { HostilityScore, HostilityStatus } from "../hostility/score.js";

/**
 * Default gate timeout in milliseconds (30 seconds)
 */
export const DEFAULT_GATE_TIMEOUT_MS = 30000;

/**
 * Maximum multiplier for timeout adjustment (3x)
 */
export const MAX_TIMEOUT_MULTIPLIER = 3.0;

/**
 * Minimum multiplier for timeout adjustment (1x - never reduce)
 */
export const MIN_TIMEOUT_MULTIPLIER = 1.0;

/**
 * Timeout adjustment result with auditability
 */
export interface TimeoutAdjustment {
  /** Original timeout in milliseconds */
  originalTimeoutMs: number;
  /** Adjusted timeout in milliseconds */
  adjustedTimeoutMs: number;
  /** Multiplier applied */
  multiplier: number;
  /** Reason for adjustment */
  reason: string;
  /** Hostility status that triggered adjustment */
  hostilityStatus: HostilityStatus | "low" | "medium" | "high";
  /** Hostility score (0-1) */
  hostilityScore: number;
}

/**
 * Calculate adjusted timeout based on hostility score.
 *
 * Timeout adjustment logic:
 * - Low hostility (score < 0.3): No adjustment (multiplier = 1.0)
 * - Medium hostility (0.3 <= score < 0.6): 1.5x multiplier
 * - High hostility (score >= 0.6): Linear scale from 2.0x to 3.0x
 *
 * @param baseTimeoutMs - Base timeout in milliseconds
 * @param hostilityScore - Hostility score object with total and status
 * @returns TimeoutAdjustment with adjusted timeout and audit information
 */
export function calculateHostilityAdjustedTimeout(
  baseTimeoutMs: number,
  hostilityScore: HostilityScore
): TimeoutAdjustment {
  const score = hostilityScore.total;
  const status = hostilityScore.status;

  let multiplier: number;
  let reason: string;

  if (score < 0.3) {
    // Low hostility - no adjustment
    multiplier = 1.0;
    reason = "Environment is well-configured; using standard timeout";
  } else if (score < 0.6) {
    // Medium hostility - moderate increase
    multiplier = 1.5;
    reason = "Environment needs attention; increased timeout for reliability";
  } else {
    // High hostility - significant increase
    // Scale linearly from 2.0 at 0.6 to 3.0 at 1.0
    multiplier = 2.0 + ((score - 0.6) / 0.4) * 1.0;
    multiplier = Math.min(multiplier, MAX_TIMEOUT_MULTIPLIER);
    reason = `High environment hostility (${(score * 100).toFixed(0)}%); using extended timeout`;
  }

  const adjustedTimeoutMs = Math.round(baseTimeoutMs * multiplier);

  return {
    originalTimeoutMs: baseTimeoutMs,
    adjustedTimeoutMs,
    multiplier,
    reason,
    hostilityStatus: status,
    hostilityScore: score,
  };
}

/**
 * Log timeout adjustment decision for auditability.
 *
 * @param adjustment - The timeout adjustment to log
 * @param gateName - Name of the gate being adjusted
 * @param itemName - Name of the item being processed
 */
export function logTimeoutAdjustment(
  adjustment: TimeoutAdjustment,
  gateName: string,
  itemName?: string
): void {
  const context = itemName ? `${gateName}@${itemName}` : gateName;

  // Only log if adjustment was made
  if (adjustment.multiplier === 1.0) {
    return;
  }

  console.log(
    JSON.stringify({
      event: "timeout_adjustment",
      gate: gateName,
      item: itemName,
      context,
      originalTimeoutMs: adjustment.originalTimeoutMs,
      adjustedTimeoutMs: adjustment.adjustedTimeoutMs,
      multiplier: adjustment.multiplier,
      reason: adjustment.reason,
      hostilityStatus: adjustment.hostilityStatus,
      hostilityScore: adjustment.hostilityScore,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Calculate timeout with optional hostility-based adjustment.
 *
 * If hostilityScore is not provided, returns the base timeout unchanged.
 *
 * @param baseTimeoutMs - Base timeout in milliseconds
 * @param hostilityScore - Optional hostility score for adjustment
 * @returns Adjusted timeout in milliseconds
 */
export function getAdjustedTimeout(baseTimeoutMs: number, hostilityScore?: HostilityScore): number {
  if (!hostilityScore) {
    return baseTimeoutMs;
  }

  const adjustment = calculateHostilityAdjustedTimeout(baseTimeoutMs, hostilityScore);

  return adjustment.adjustedTimeoutMs;
}
