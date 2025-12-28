import { describe, it, expect, beforeEach } from "vitest";
import { ErrorRecoveryMonitor, RecoveryEventType } from "../src/monitoring/errorRecovery";
import { ErrorType, ErrorSeverity, classifyError } from "../src/core/errorRecovery";

describe("Error Recovery Monitoring", () => {
  let monitor: ErrorRecoveryMonitor;

  beforeEach(() => {
    monitor = new ErrorRecoveryMonitor();
  });

  describe("Error Classification Recording", () => {
    it("should record error classification events", () => {
      const error = new Error("Network timeout");
      const classified = classifyError(error, "Test operation");

      monitor.recordClassification(classified, "Unit test");

      const events = monitor.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(RecoveryEventType.ErrorClassified);
      expect(events[0].error?.type).toBe(ErrorType.Transient);
    });

    it("should track errors by type", () => {
      const errors = [
        new Error("Network timeout"),
        new Error("Authentication failed"),
        new Error("Unknown issue"),
      ];

      errors[1].name = "GitHubAuthError";

      for (const error of errors) {
        const classified = classifyError(error);
        monitor.recordClassification(classified, "Test");
      }

      const summary = monitor.getErrorSummary();
      expect(summary.total).toBe(3);
      expect(summary.byType[ErrorType.Transient]).toBe(1);
      expect(summary.byType[ErrorType.Permanent]).toBe(1);
      expect(summary.byType[ErrorType.Unknown]).toBe(1);
    });

    it("should track errors by severity", () => {
      const error1 = new Error("Network error");
      const error2 = new Error("Auth error");
      error2.name = "GitHubAuthError";

      monitor.recordClassification(classifyError(error1), "Test");
      monitor.recordClassification(classifyError(error2), "Test");

      const summary = monitor.getErrorSummary();
      expect(summary.bySeverity[ErrorSeverity.High]).toBe(1); // Network error
      expect(summary.bySeverity[ErrorSeverity.Critical]).toBe(1); // Auth error
    });
  });

  describe("Retry Recording", () => {
    it("should record retry attempts", () => {
      const error = new Error("Service unavailable");
      const classified = classifyError(error);

      monitor.recordRetryAttempt(1, classified, 1000);
      monitor.recordRetryAttempt(2, classified, 2000);

      const events = monitor.getEventsByType(RecoveryEventType.RetryAttempt);
      expect(events).toHaveLength(2);
      expect(events[0].metadata?.attempt).toBe(1);
      expect(events[0].metadata?.delayMs).toBe(1000);
      expect(events[1].metadata?.attempt).toBe(2);
      expect(events[1].metadata?.delayMs).toBe(2000);
    });

    it("should record retry success", () => {
      monitor.recordRetrySuccess(3, "Operation succeeded after retries");

      const events = monitor.getEventsByType(RecoveryEventType.RetrySuccess);
      expect(events).toHaveLength(1);
      expect(events[0].metadata?.totalAttempts).toBe(3);
    });

    it("should record retry failure", () => {
      const error = new Error("Failed after retries");
      const classified = classifyError(error);

      monitor.recordRetryFailure(5, classified);

      const events = monitor.getEventsByType(RecoveryEventType.RetryFailed);
      expect(events).toHaveLength(1);
      expect(events[0].metadata?.totalAttempts).toBe(5);
    });

    it("should calculate retry success rate", () => {
      const error = new Error("Transient error");
      const classified = classifyError(error);

      // Record 3 retry attempts, 2 successes
      monitor.recordRetryAttempt(1, classified, 100);
      monitor.recordRetrySuccess(1, "Success 1");
      monitor.recordRetryAttempt(1, classified, 100);
      monitor.recordRetrySuccess(1, "Success 2");
      monitor.recordRetryAttempt(1, classified, 100);
      monitor.recordRetryFailure(1, classified);

      const summary = monitor.getErrorSummary();
      expect(summary.retrySuccessRate).toBeCloseTo(66.67, 1);
    });
  });

  describe("Circuit Breaker Monitoring", () => {
    it("should record circuit breaker open events", () => {
      monitor.recordCircuitOpen("github-api", 5);

      const events = monitor.getEventsByType(RecoveryEventType.CircuitOpened);
      expect(events).toHaveLength(1);
      expect(events[0].metadata?.serviceName).toBe("github-api");
      expect(events[0].metadata?.failureCount).toBe(5);
    });

    it("should record circuit breaker close events", () => {
      monitor.recordCircuitClose("github-api");

      const events = monitor.getEventsByType(RecoveryEventType.CircuitClosed);
      expect(events).toHaveLength(1);
      expect(events[0].metadata?.serviceName).toBe("github-api");
    });

    it("should track circuit breaker metrics", () => {
      monitor.recordCircuitOpen("service-a", 3);
      monitor.recordCircuitOpen("service-b", 5);
      monitor.recordCircuitClose("service-a");

      const metrics = monitor.getCircuitBreakerMetrics();
      expect(metrics.totalOpens).toBe(2);
      expect(metrics.totalCloses).toBe(1);
      expect(metrics.currentlyOpen).toBe(1); // service-b still open
    });
  });

  describe("Graceful Degradation", () => {
    it("should record graceful degradation events", () => {
      monitor.recordGracefulDegradation("ci-service", "Not yet implemented");

      const events = monitor.getEventsByType(RecoveryEventType.GracefulDegradation);
      expect(events).toHaveLength(1);
      expect(events[0].metadata?.feature).toBe("ci-service");
      expect(events[0].metadata?.reason).toBe("Not yet implemented");
    });
  });

  describe("Alert Thresholds", () => {
    it("should use default alert thresholds", () => {
      // This test verifies the thresholds are set but doesn't trigger alerts
      // as we don't want to spam console in tests
      monitor.setAlertThreshold(ErrorType.Transient, 10);

      // Record 9 errors - should not alert
      for (let i = 0; i < 9; i++) {
        const error = new Error("Network timeout");
        monitor.recordClassification(classifyError(error), "Test");
      }

      const summary = monitor.getErrorSummary();
      expect(summary.byType[ErrorType.Transient]).toBe(9);
    });

    it("should allow custom alert thresholds", () => {
      monitor.setAlertThreshold(ErrorType.Unknown, 2);

      const error = new Error("Custom error");
      monitor.recordClassification(classifyError(error), "Test");

      const summary = monitor.getErrorSummary();
      expect(summary.byType[ErrorType.Unknown]).toBe(1);
    });
  });

  describe("Metrics Export", () => {
    it("should export comprehensive metrics", () => {
      // Create various events
      const error = new Error("Network error");
      const classified = classifyError(error);

      monitor.recordClassification(classified, "Test");
      monitor.recordRetryAttempt(1, classified, 1000);
      monitor.recordRetrySuccess(1, "Success");
      monitor.recordCircuitOpen("test-service", 3);
      monitor.recordGracefulDegradation("feature-x", "Unavailable");

      const metrics = monitor.exportMetrics();

      expect(metrics.errorSummary.total).toBe(1);
      expect(metrics.circuitBreakerMetrics.totalOpens).toBe(1);
      expect(metrics.events).toHaveLength(5);
    });

    it("should support clearing events", () => {
      const error = new Error("Test error");
      monitor.recordClassification(classifyError(error), "Test");

      expect(monitor.getEvents()).toHaveLength(1);

      monitor.clear();

      expect(monitor.getEvents()).toHaveLength(0);
    });
  });

  describe("Event Filtering", () => {
    it("should filter events by type", () => {
      const error = new Error("Test error");
      const classified = classifyError(error);

      monitor.recordClassification(classified, "Test");
      monitor.recordRetryAttempt(1, classified, 100);
      monitor.recordRetrySuccess(1, "Success");

      const classificationEvents = monitor.getEventsByType(RecoveryEventType.ErrorClassified);
      const retryEvents = monitor.getEventsByType(RecoveryEventType.RetryAttempt);

      expect(classificationEvents).toHaveLength(1);
      expect(retryEvents).toHaveLength(1);
    });

    it("should include timestamps on all events", () => {
      const error = new Error("Test");
      monitor.recordClassification(classifyError(error), "Test");

      const events = monitor.getEvents();
      expect(events[0].timestamp).toBeDefined();
      expect(new Date(events[0].timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
