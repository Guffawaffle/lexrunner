/**
 * Audit trail for immutable logging of decisions and actions
 */

export interface AuditEntry {
  timestamp: string;
  correlationId?: string;
  operation: string;
  decision: string;
  actor?: string;
  metadata: Record<string, any>;
}

/**
 * Audit trail logger for compliance and troubleshooting
 */
export class AuditTrail {
  private entries: AuditEntry[] = [];

  /**
   * Log an audit entry
   */
  log(
    operation: string,
    decision: string,
    metadata: Record<string, any> = {},
    correlationId?: string
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      operation,
      decision,
      metadata,
    };

    if (correlationId) {
      entry.correlationId = correlationId;
    }

    // Add actor if available from environment
    if (process.env.GITHUB_ACTOR) {
      entry.actor = process.env.GITHUB_ACTOR;
    }

    this.entries.push(entry);

    // Also log to console for real-time visibility
    const logLine = `[AUDIT] ${JSON.stringify(entry)}`;
    console.log(logLine);
  }

  /**
   * Get all audit entries
   */
  getEntries(): AuditEntry[] {
    return [...this.entries]; // Return copy to maintain immutability
  }

  /**
   * Get entries for a specific correlation ID
   */
  getEntriesByCorrelationId(correlationId: string): AuditEntry[] {
    return this.entries.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Get entries for a specific operation
   */
  getEntriesByOperation(operation: string): AuditEntry[] {
    return this.entries.filter((e) => e.operation === operation);
  }

  /**
   * Export audit trail as JSON
   */
  exportJSON(): AuditEntry[] {
    return this.getEntries();
  }

  /**
   * Export audit trail in JSONL format (one entry per line)
   */
  exportJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n");
  }

  /**
   * Clear audit trail (use with caution - for testing only)
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Global audit trail instance
 */
export const auditTrail = new AuditTrail();
