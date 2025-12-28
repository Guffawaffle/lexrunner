/**
 * Error Recovery Monitoring Integration
 *
 * Integrates error recovery framework with monitoring and alerting systems
 */

import { ClassifiedError, ErrorType, ErrorSeverity } from "../core/errorRecovery.js";
import { errorAggregator } from "./errors.js";

/**
 * Error recovery event types for monitoring
 */
export enum RecoveryEventType {
  /** Error was classified */
  ErrorClassified = "error_classified",
  /** Retry attempt initiated */
  RetryAttempt = "retry_attempt",
  /** Retry succeeded */
  RetrySuccess = "retry_success",
  /** Retry failed after max attempts */
  RetryFailed = "retry_failed",
  /** Circuit breaker opened */
  CircuitOpened = "circuit_opened",
  /** Circuit breaker closed */
  CircuitClosed = "circuit_closed",
  /** Graceful degradation activated */
  GracefulDegradation = "graceful_degradation",
}

/**
 * Recovery event data
 */
export interface RecoveryEvent {
  type: RecoveryEventType;
  timestamp: string;
  context: string;
  error?: ClassifiedError;
  metadata?: Record<string, any>;
}

/**
 * Error recovery monitor
 */
export class ErrorRecoveryMonitor {
  private events: RecoveryEvent[] = [];
  private alertThresholds: Map<ErrorType, number> = new Map();

  constructor() {
    // Set default alert thresholds
    this.alertThresholds.set(ErrorType.Permanent, 1); // Alert immediately on permanent errors
    this.alertThresholds.set(ErrorType.Transient, 5); // Alert after 5 transient errors
    this.alertThresholds.set(ErrorType.Unknown, 3); // Alert after 3 unknown errors
  }

  /**
   * Record error classification event
   */
  recordClassification(classified: ClassifiedError, context: string): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.ErrorClassified,
      timestamp: new Date().toISOString(),
      context,
      error: classified,
    };

    this.events.push(event);

    // Also record in error aggregator for grouping
    errorAggregator.recordError(classified.error, {
      type: classified.type,
      severity: classified.severity,
      code: classified.code,
      context,
    });

    // Check if we should alert
    this.checkAlertThreshold(classified);
  }

  /**
   * Record retry attempt
   */
  recordRetryAttempt(attempt: number, classified: ClassifiedError, delayMs: number): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.RetryAttempt,
      timestamp: new Date().toISOString(),
      context: `Retry attempt ${attempt}`,
      error: classified,
      metadata: { attempt, delayMs },
    };

    this.events.push(event);
  }

  /**
   * Record retry success
   */
  recordRetrySuccess(attemptCount: number, context: string): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.RetrySuccess,
      timestamp: new Date().toISOString(),
      context,
      metadata: { totalAttempts: attemptCount },
    };

    this.events.push(event);
  }

  /**
   * Record retry failure
   */
  recordRetryFailure(attemptCount: number, classified: ClassifiedError): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.RetryFailed,
      timestamp: new Date().toISOString(),
      context: `Retry failed after ${attemptCount} attempts`,
      error: classified,
      metadata: { totalAttempts: attemptCount },
    };

    this.events.push(event);
  }

  /**
   * Record circuit breaker open
   */
  recordCircuitOpen(serviceName: string, failureCount: number): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.CircuitOpened,
      timestamp: new Date().toISOString(),
      context: `Circuit breaker opened for ${serviceName}`,
      metadata: { serviceName, failureCount },
    };

    this.events.push(event);
  }

  /**
   * Record circuit breaker close
   */
  recordCircuitClose(serviceName: string): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.CircuitClosed,
      timestamp: new Date().toISOString(),
      context: `Circuit breaker closed for ${serviceName}`,
      metadata: { serviceName },
    };

    this.events.push(event);
  }

  /**
   * Record graceful degradation
   */
  recordGracefulDegradation(feature: string, reason: string): void {
    const event: RecoveryEvent = {
      type: RecoveryEventType.GracefulDegradation,
      timestamp: new Date().toISOString(),
      context: `Graceful degradation: ${feature}`,
      metadata: { feature, reason },
    };

    this.events.push(event);
  }

  /**
   * Check if alert threshold is reached
   */
  private checkAlertThreshold(classified: ClassifiedError): void {
    const threshold = this.alertThresholds.get(classified.type) || 10;
    const recentErrors = this.events.filter(
      (e) =>
        e.type === RecoveryEventType.ErrorClassified &&
        e.error?.type === classified.type &&
        new Date(e.timestamp).getTime() > Date.now() - 300000 // Last 5 minutes
    );

    if (recentErrors.length >= threshold) {
      this.triggerAlert(classified.type, recentErrors.length);
    }
  }

  /**
   * Trigger alert (placeholder - integrate with actual alerting system)
   */
  private triggerAlert(errorType: ErrorType, count: number): void {
    console.warn(`🚨 ALERT: ${count} ${errorType} errors in the last 5 minutes`);
    // TODO: Integrate with actual alerting system (PagerDuty, Slack, etc.)
  }

  /**
   * Set custom alert threshold for error type
   */
  setAlertThreshold(errorType: ErrorType, threshold: number): void {
    this.alertThresholds.set(errorType, threshold);
  }

  /**
   * Get all events
   */
  getEvents(): RecoveryEvent[] {
    return [...this.events];
  }

  /**
   * Get events by type
   */
  getEventsByType(type: RecoveryEventType): RecoveryEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get error summary
   */
  getErrorSummary(): {
    total: number;
    byType: Record<ErrorType, number>;
    bySeverity: Record<ErrorSeverity, number>;
    retrySuccessRate: number;
  } {
    const classificationEvents = this.events.filter(
      (e) => e.type === RecoveryEventType.ErrorClassified
    );

    const byType: Record<string, number> = {
      [ErrorType.Transient]: 0,
      [ErrorType.Permanent]: 0,
      [ErrorType.Unknown]: 0,
    };

    const bySeverity: Record<string, number> = {
      [ErrorSeverity.Critical]: 0,
      [ErrorSeverity.High]: 0,
      [ErrorSeverity.Medium]: 0,
      [ErrorSeverity.Low]: 0,
    };

    for (const event of classificationEvents) {
      if (event.error) {
        byType[event.error.type]++;
        bySeverity[event.error.severity]++;
      }
    }

    const retryAttempts = this.events.filter(
      (e) => e.type === RecoveryEventType.RetryAttempt
    ).length;
    const retrySuccesses = this.events.filter(
      (e) => e.type === RecoveryEventType.RetrySuccess
    ).length;
    const retrySuccessRate = retryAttempts > 0 ? (retrySuccesses / retryAttempts) * 100 : 0;

    return {
      total: classificationEvents.length,
      byType: byType as Record<ErrorType, number>,
      bySeverity: bySeverity as Record<ErrorSeverity, number>,
      retrySuccessRate,
    };
  }

  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics(): {
    totalOpens: number;
    totalCloses: number;
    currentlyOpen: number;
  } {
    const opens = this.events.filter((e) => e.type === RecoveryEventType.CircuitOpened);
    const closes = this.events.filter((e) => e.type === RecoveryEventType.CircuitClosed);

    // Calculate currently open circuits (simplified - tracks unique service names)
    const openServices = new Set<string>();
    const closedServices = new Set<string>();

    for (const event of this.events) {
      const serviceName = event.metadata?.serviceName;
      if (!serviceName) continue;

      if (event.type === RecoveryEventType.CircuitOpened) {
        openServices.add(serviceName);
      } else if (event.type === RecoveryEventType.CircuitClosed) {
        closedServices.add(serviceName);
      }
    }

    // Remove closed from open
    for (const service of closedServices) {
      openServices.delete(service);
    }

    return {
      totalOpens: opens.length,
      totalCloses: closes.length,
      currentlyOpen: openServices.size,
    };
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(): {
    errorSummary: {
      total: number;
      byType: Record<ErrorType, number>;
      bySeverity: Record<ErrorSeverity, number>;
      retrySuccessRate: number;
    };
    circuitBreakerMetrics: {
      totalOpens: number;
      totalCloses: number;
      currentlyOpen: number;
    };
    events: RecoveryEvent[];
  } {
    return {
      errorSummary: this.getErrorSummary(),
      circuitBreakerMetrics: this.getCircuitBreakerMetrics(),
      events: this.getEvents(),
    };
  }

  /**
   * Clear all events (for testing or reset)
   */
  clear(): void {
    this.events = [];
  }
}

/**
 * Global error recovery monitor instance
 */
export const errorRecoveryMonitor = new ErrorRecoveryMonitor();
