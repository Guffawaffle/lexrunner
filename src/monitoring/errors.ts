/**
 * Error aggregation and grouping for better error tracking
 */

export interface ErrorGroup {
  errorType: string;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  stackTrace?: string;
  context: Record<string, any>[];
}

/**
 * Error aggregator for grouping similar errors
 */
export class ErrorAggregator {
  private errors: Map<string, ErrorGroup> = new Map();

  /**
   * Record an error with context
   */
  recordError(error: Error | unknown, context: Record<string, any> = {}): void {
    const errorType = error instanceof Error ? error.constructor.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;

    const key = this.getErrorKey(errorType, message);
    const existing = this.errors.get(key);

    const now = new Date().toISOString();

    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      existing.context.push({ ...context, timestamp: now });
    } else {
      this.errors.set(key, {
        errorType,
        message,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        stackTrace,
        context: [{ ...context, timestamp: now }],
      });
    }
  }

  /**
   * Generate error key for grouping
   */
  private getErrorKey(errorType: string, message: string): string {
    // Normalize message to group similar errors
    const normalized = message
      .replace(/\d+/g, "N") // Replace numbers with N
      .replace(/["'].*?["']/g, "STR") // Replace string literals
      .replace(/\/[^\s]+/g, "PATH"); // Replace paths

    return `${errorType}:${normalized}`;
  }

  /**
   * Get all error groups sorted by count
   */
  getErrorGroups(): ErrorGroup[] {
    return Array.from(this.errors.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Get error summary
   */
  getSummary(): {
    totalErrors: number;
    uniqueErrors: number;
    topErrors: ErrorGroup[];
  } {
    const groups = this.getErrorGroups();
    return {
      totalErrors: groups.reduce((sum, g) => sum + g.count, 0),
      uniqueErrors: groups.length,
      topErrors: groups.slice(0, 5),
    };
  }

  /**
   * Export errors as JSON
   */
  exportJSON(): ErrorGroup[] {
    return this.getErrorGroups();
  }

  /**
   * Clear all recorded errors
   */
  clear(): void {
    this.errors.clear();
  }
}

/**
 * Global error aggregator instance
 */
export const errorAggregator = new ErrorAggregator();
