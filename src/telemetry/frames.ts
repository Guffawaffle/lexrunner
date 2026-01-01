/**
 * Frame Emission Telemetry
 *
 * Tracks metrics for Frame emission operations.
 * Implements LPR-007: Sub B.4 - Frame emission metrics.
 */

import { metrics, METRICS } from "../monitoring/metrics.js";

/**
 * Frame emission event types
 */
export type FrameEventType = "fanout" | "merge-weave" | "gate" | "executor" | "procedure";

/**
 * Frame emission failure reasons
 */
export type FrameFailureReason =
  | "validation-error"
  | "storage-error"
  | "network-error"
  | "duplicate-detected"
  | "disabled"
  | "unknown";

/**
 * Frame emission metrics
 */
export const FRAME_METRICS = {
  /** Total number of frames emitted (counter) */
  FRAMES_EMITTED_TOTAL: "lex_pr_frames_emitted_total",
  /** Total number of frame emission failures (counter) */
  FRAMES_FAILED_TOTAL: "lex_pr_frames_failed_total",
  /** Duration of frame emission in milliseconds (histogram) */
  FRAME_EMISSION_DURATION_MS: "lex_pr_frame_emission_duration_ms",
} as const;

/**
 * Track successful frame emission
 */
export function trackFrameEmitted(eventType: FrameEventType): void {
  metrics.incrementCounter(FRAME_METRICS.FRAMES_EMITTED_TOTAL, { event_type: eventType });
}

/**
 * Track failed frame emission
 */
export function trackFrameEmissionFailed(
  eventType: FrameEventType,
  reason: FrameFailureReason
): void {
  metrics.incrementCounter(FRAME_METRICS.FRAMES_FAILED_TOTAL, {
    event_type: eventType,
    failure_reason: reason,
  });
}

/**
 * Track frame emission duration
 */
export function trackFrameEmissionDuration(eventType: FrameEventType, durationMs: number): void {
  // Use histogram buckets suitable for frame emission (typically < 1 second)
  const buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  metrics.observeHistogram(
    FRAME_METRICS.FRAME_EMISSION_DURATION_MS,
    durationMs,
    { event_type: eventType },
    buckets
  );
}

/**
 * Helper function to measure and track frame emission
 *
 * @param eventType - Type of frame event
 * @param operation - Async operation to measure
 * @returns Result of the operation
 *
 * @example
 * ```typescript
 * const result = await measureFrameEmission("merge-weave", async () => {
 *   return await emitMergeWeaveFrame(input);
 * });
 * ```
 */
export async function measureFrameEmission<T>(
  eventType: FrameEventType,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await operation();
    const durationMs = Date.now() - startTime;
    trackFrameEmissionDuration(eventType, durationMs);
    trackFrameEmitted(eventType);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    trackFrameEmissionDuration(eventType, durationMs);
    trackFrameEmissionFailed(eventType, "unknown");
    throw error;
  }
}

/**
 * Export frame metrics as JSON
 */
export function exportFrameMetrics(): Record<string, any> {
  return metrics.exportJSON();
}

/**
 * Export frame metrics in Prometheus format
 */
export function exportFrameMetricsPrometheus(): string {
  return metrics.exportPrometheus();
}

/**
 * Get frame emission statistics
 */
export function getFrameEmissionStats(): {
  emitted: Record<FrameEventType, number>;
  failed: Record<FrameEventType, Record<FrameFailureReason, number>>;
  avgDurationMs: Record<FrameEventType, number>;
} {
  const metricsData = metrics.exportJSON();
  const counters = metricsData.counters || {};
  const histograms = metricsData.histograms || {};

  const emitted: Record<string, number> = {};
  const failed: Record<string, Record<string, number>> = {};
  const avgDurationMs: Record<string, number> = {};

  // Parse emitted counters
  Object.entries(counters).forEach(([key, value]) => {
    if (key.startsWith(FRAME_METRICS.FRAMES_EMITTED_TOTAL)) {
      const match = key.match(/event_type="([^"]+)"/);
      if (match) {
        emitted[match[1]] = value as number;
      }
    }
  });

  // Parse failed counters
  Object.entries(counters).forEach(([key, value]) => {
    if (key.startsWith(FRAME_METRICS.FRAMES_FAILED_TOTAL)) {
      const eventMatch = key.match(/event_type="([^"]+)"/);
      const reasonMatch = key.match(/failure_reason="([^"]+)"/);
      if (eventMatch && reasonMatch) {
        const eventType = eventMatch[1];
        const reason = reasonMatch[1];
        if (!failed[eventType]) {
          failed[eventType] = {};
        }
        failed[eventType][reason] = value as number;
      }
    }
  });

  // Calculate average durations from histograms
  Object.entries(histograms).forEach(([key, value]) => {
    if (key.startsWith(FRAME_METRICS.FRAME_EMISSION_DURATION_MS)) {
      const match = key.match(/event_type="([^"]+)"/);
      if (match && typeof value === "object") {
        const histogram = value as any;
        if (histogram.count > 0) {
          avgDurationMs[match[1]] = histogram.sum / histogram.count;
        }
      }
    }
  });

  return {
    emitted: emitted as Record<FrameEventType, number>,
    failed: failed as Record<FrameEventType, Record<FrameFailureReason, number>>,
    avgDurationMs: avgDurationMs as Record<FrameEventType, number>,
  };
}
