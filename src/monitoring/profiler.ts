/**
 * Performance profiling utilities for tracking gate durations and memory usage
 */

import { metrics, METRICS } from "./metrics.js";

export interface PerformanceProfile {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryStart?: NodeJS.MemoryUsage;
  memoryEnd?: NodeJS.MemoryUsage;
  memoryDelta?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Performance profiler for tracking operation duration and memory usage
 */
export class PerformanceProfiler {
  private profiles: Map<string, PerformanceProfile> = new Map();

  /**
   * Start profiling an operation
   */
  start(operationId: string, metadata?: Record<string, any>): void {
    this.profiles.set(operationId, {
      operation: operationId,
      startTime: Date.now(),
      memoryStart: process.memoryUsage(),
      metadata,
    });
  }

  /**
   * End profiling an operation and record metrics
   */
  end(operationId: string, labels?: Record<string, string>): PerformanceProfile | null {
    const profile = this.profiles.get(operationId);
    if (!profile) {
      return null;
    }

    profile.endTime = Date.now();
    profile.duration = (profile.endTime - profile.startTime) / 1000; // Convert to seconds
    profile.memoryEnd = process.memoryUsage();

    if (profile.memoryStart && profile.memoryEnd) {
      profile.memoryDelta = {
        heapUsed: profile.memoryEnd.heapUsed - profile.memoryStart.heapUsed,
        heapTotal: profile.memoryEnd.heapTotal - profile.memoryStart.heapTotal,
        external: profile.memoryEnd.external - profile.memoryStart.external,
        rss: profile.memoryEnd.rss - profile.memoryStart.rss,
      };
    }

    // Record to metrics
    if (profile.duration !== undefined) {
      // Determine metric name based on operation type
      const metricName = this.getMetricName(operationId);
      if (metricName) {
        metrics.observeHistogram(metricName, profile.duration, labels);
      }
    }

    // Record memory usage
    if (profile.memoryEnd) {
      metrics.setGauge(METRICS.MEMORY_USAGE_BYTES, profile.memoryEnd.heapUsed, {
        type: "heap_used",
        ...labels,
      });
    }

    this.profiles.delete(operationId);
    return profile;
  }

  /**
   * Get metric name based on operation type
   */
  private getMetricName(operationId: string): string | null {
    if (operationId.startsWith("plan_")) {
      return METRICS.PLAN_EXECUTION_TIME;
    } else if (operationId.startsWith("gate_")) {
      return METRICS.GATE_EXECUTION_TIME;
    } else if (operationId.startsWith("merge_")) {
      return METRICS.MERGE_EXECUTION_TIME;
    } else if (operationId.startsWith("dependency_")) {
      return METRICS.DEPENDENCY_RESOLUTION_TIME;
    }
    return null;
  }

  /**
   * Get all active profiles
   */
  getActiveProfiles(): PerformanceProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Clear all profiles
   */
  clear(): void {
    this.profiles.clear();
  }
}

/**
 * Global profiler instance
 */
export const profiler = new PerformanceProfiler();

/**
 * Helper to wrap an async operation with profiling
 */
export async function profileAsync<T>(
  operationId: string,
  operation: () => Promise<T>,
  labels?: Record<string, string>
): Promise<T> {
  profiler.start(operationId);
  try {
    const result = await operation();
    profiler.end(operationId, labels);
    return result;
  } catch (error) {
    profiler.end(operationId, labels);
    throw error;
  }
}

/**
 * Helper to wrap a sync operation with profiling
 */
export function profileSync<T>(
  operationId: string,
  operation: () => T,
  labels?: Record<string, string>
): T {
  profiler.start(operationId);
  try {
    const result = operation();
    profiler.end(operationId, labels);
    return result;
  } catch (error) {
    profiler.end(operationId, labels);
    throw error;
  }
}
