/**
 * Health check endpoint for MCP server and general system health
 */

import { profiler } from "./profiler.js";
import { metrics } from "./metrics.js";
import { errorAggregator } from "./errors.js";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    memory: HealthCheck;
    activeOperations: HealthCheck;
    errorRate: HealthCheck;
  };
  metrics?: {
    memory: NodeJS.MemoryUsage;
    activeProfiles: number;
    errorSummary: {
      totalErrors: number;
      uniqueErrors: number;
    };
  };
}

export interface HealthCheck {
  status: "pass" | "warn" | "fail";
  message?: string;
  value?: any;
}

/**
 * Health checker for system monitoring
 */
export class HealthChecker {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get current health status
   */
  getHealth(includeMetrics: boolean = false): HealthStatus {
    const memoryCheck = this.checkMemory();
    const activeOpsCheck = this.checkActiveOperations();
    const errorRateCheck = this.checkErrorRate();

    const checks = {
      memory: memoryCheck,
      activeOperations: activeOpsCheck,
      errorRate: errorRateCheck,
    };

    // Determine overall status
    const statuses = [memoryCheck.status, activeOpsCheck.status, errorRateCheck.status];
    const overallStatus = statuses.includes("fail")
      ? "unhealthy"
      : statuses.includes("warn")
        ? "degraded"
        : "healthy";

    const health: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      version: "0.1.0", // TODO: Import from package.json
      checks,
    };

    if (includeMetrics) {
      const errorSummary = errorAggregator.getSummary();
      health.metrics = {
        memory: process.memoryUsage(),
        activeProfiles: profiler.getActiveProfiles().length,
        errorSummary: {
          totalErrors: errorSummary.totalErrors,
          uniqueErrors: errorSummary.uniqueErrors,
        },
      };
    }

    return health;
  }

  /**
   * Check memory usage
   */
  private checkMemory(): HealthCheck {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const percentage = (usage.heapUsed / usage.heapTotal) * 100;

    if (percentage > 90) {
      return {
        status: "fail",
        message: `Memory usage critical: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`,
        value: { heapUsedMB, heapTotalMB, percentage },
      };
    } else if (percentage > 75) {
      return {
        status: "warn",
        message: `Memory usage high: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`,
        value: { heapUsedMB, heapTotalMB, percentage },
      };
    }

    return {
      status: "pass",
      message: `Memory usage normal: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`,
      value: { heapUsedMB, heapTotalMB, percentage },
    };
  }

  /**
   * Check active operations
   */
  private checkActiveOperations(): HealthCheck {
    const activeProfiles = profiler.getActiveProfiles();
    const count = activeProfiles.length;

    // Check for long-running operations
    const now = Date.now();
    const longRunning = activeProfiles.filter((p) => now - p.startTime > 300000); // 5 minutes

    if (longRunning.length > 0) {
      return {
        status: "warn",
        message: `${longRunning.length} long-running operation(s) detected`,
        value: { active: count, longRunning: longRunning.length },
      };
    }

    return {
      status: "pass",
      message: `${count} active operation(s)`,
      value: { active: count },
    };
  }

  /**
   * Check error rate
   */
  private checkErrorRate(): HealthCheck {
    const summary = errorAggregator.getSummary();

    if (summary.totalErrors > 100) {
      return {
        status: "warn",
        message: `High error count: ${summary.totalErrors} errors (${summary.uniqueErrors} unique)`,
        value: summary,
      };
    }

    return {
      status: "pass",
      message: `Error count normal: ${summary.totalErrors} errors (${summary.uniqueErrors} unique)`,
      value: summary,
    };
  }
}

/**
 * Global health checker instance
 */
export const healthChecker = new HealthChecker();
