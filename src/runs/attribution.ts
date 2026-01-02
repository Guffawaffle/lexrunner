/**
 * Constraint Attribution Tracking
 *
 * Implements LR-TSF-001: Execution Trace → Constraint Attribution
 * Tracks which constraints/rules drove specific decisions during execution.
 */

/**
 * Source of a constraint
 */
export type ConstraintSource = "baseline" | "persona" | "learned";

/**
 * Attribution record for a single constraint application
 */
export interface ConstraintAttribution {
  /** Unique constraint identifier (e.g., "merge-gates-required") */
  constraintId: string;
  /** Human-readable rule statement */
  statement: string;
  /** Source of the constraint */
  source: ConstraintSource;
  /** When the constraint influenced a decision (ISO 8601) */
  appliedAt: string;
  /** What action it governed */
  action: string;
  /** Optional target (e.g., "PR-123", "gate:lint") */
  target?: string;
}

/**
 * Attribution log entry for NDJSON storage
 */
export interface AttributionLogEntry {
  /** Timestamp of the attribution */
  timestamp: string;
  /** Constraint identifier */
  constraintId: string;
  /** Action that was governed */
  action: string;
  /** Target of the action */
  target?: string;
  /** Source of the constraint */
  source: ConstraintSource;
  /** Statement of the constraint */
  statement: string;
}

/**
 * Simplified attribution for frame metadata
 */
export interface FrameAttribution {
  /** Constraint identifier */
  constraintId: string;
  /** Source of the constraint */
  source: ConstraintSource;
  /** Action that was governed */
  action: string;
}

/**
 * Attribution tracker for execution context
 */
export class AttributionTracker {
  private attributions: ConstraintAttribution[] = [];

  /**
   * Log a constraint attribution
   */
  logAttribution(
    constraintId: string,
    statement: string,
    source: ConstraintSource,
    action: string,
    target?: string
  ): void {
    this.attributions.push({
      constraintId,
      statement,
      source,
      appliedAt: new Date().toISOString(),
      action,
      target,
    });
  }

  /**
   * Get all attributions
   */
  getAttributions(): ConstraintAttribution[] {
    return [...this.attributions];
  }

  /**
   * Get attributions for frame metadata (simplified format)
   */
  getFrameAttributions(): FrameAttribution[] {
    return this.attributions.map((attr) => ({
      constraintId: attr.constraintId,
      source: attr.source,
      action: attr.action,
    }));
  }

  /**
   * Get attributions as log entries for NDJSON storage
   */
  getLogEntries(): AttributionLogEntry[] {
    return this.attributions.map((attr) => ({
      timestamp: attr.appliedAt,
      constraintId: attr.constraintId,
      action: attr.action,
      target: attr.target,
      source: attr.source,
      statement: attr.statement,
    }));
  }

  /**
   * Clear all attributions
   */
  clear(): void {
    this.attributions = [];
  }
}

/**
 * Create a new attribution tracker
 */
export function createAttributionTracker(): AttributionTracker {
  return new AttributionTracker();
}
