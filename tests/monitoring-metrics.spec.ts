import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector, METRICS } from "../src/monitoring/metrics";

describe("Monitoring - Metrics", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe("Counter Metrics", () => {
    it("should increment counter", () => {
      metrics.incrementCounter("test_counter", undefined, 1);
      metrics.incrementCounter("test_counter", undefined, 2);

      const prometheus = metrics.exportPrometheus();
      expect(prometheus).toContain("test_counter 3");
    });

    it("should track counters with labels", () => {
      metrics.incrementCounter("gate_success", { gateType: "lint" }, 1);
      metrics.incrementCounter("gate_success", { gateType: "test" }, 1);
      metrics.incrementCounter("gate_success", { gateType: "lint" }, 1);

      const json = metrics.exportJSON();
      expect(json.counters['gate_success{gateType="lint"}']).toBe(2);
      expect(json.counters['gate_success{gateType="test"}']).toBe(1);
    });
  });

  describe("Gauge Metrics", () => {
    it("should set gauge value", () => {
      metrics.setGauge("memory_usage", 1024);
      metrics.setGauge("memory_usage", 2048);

      const prometheus = metrics.exportPrometheus();
      expect(prometheus).toContain("memory_usage 2048");
    });

    it("should track gauges with labels", () => {
      metrics.setGauge("active_workers", 5, { worker_type: "gate" });
      metrics.setGauge("active_workers", 3, { worker_type: "merge" });

      const json = metrics.exportJSON();
      expect(json.gauges['active_workers{worker_type="gate"}']).toBe(5);
      expect(json.gauges['active_workers{worker_type="merge"}']).toBe(3);
    });
  });

  describe("Histogram Metrics", () => {
    it("should observe histogram values", () => {
      metrics.observeHistogram("execution_time", 0.5);
      metrics.observeHistogram("execution_time", 1.5);
      metrics.observeHistogram("execution_time", 3.0);

      const json = metrics.exportJSON();
      const histogram = json.histograms["execution_time"];

      expect(histogram.count).toBe(3);
      expect(histogram.sum).toBe(5.0);
    });

    it("should calculate percentiles correctly", () => {
      // Add values: 1, 2, 3, 4, 5
      for (let i = 1; i <= 5; i++) {
        metrics.observeHistogram("test_duration", i, undefined, [1, 2, 3, 4, 5, 10]);
      }

      const p50 = metrics.calculatePercentile("test_duration", 0.5);
      const p95 = metrics.calculatePercentile("test_duration", 0.95);

      // p50 should be around bucket 3 (median)
      expect(p50).toBeGreaterThanOrEqual(2);
      // p95 should be at upper bucket (95% of 5 items = 4.75, rounds up to bucket 5 or higher)
      expect(p95).toBeGreaterThanOrEqual(3);
    });

    it("should handle custom buckets", () => {
      const customBuckets = [0.1, 1, 10, 100];
      metrics.observeHistogram("custom_metric", 5, undefined, customBuckets);
      metrics.observeHistogram("custom_metric", 50, undefined, customBuckets);

      const json = metrics.exportJSON();
      const histogram = json.histograms["custom_metric"];

      expect(histogram.buckets["10"]).toBe(1); // 5 <= 10
      expect(histogram.buckets["100"]).toBe(2); // both 5 and 50 <= 100
    });
  });

  describe("Prometheus Export", () => {
    it("should export metrics in Prometheus format", () => {
      metrics.incrementCounter(METRICS.GATE_SUCCESS_TOTAL, { gateType: "lint" }, 5);
      metrics.setGauge(METRICS.MEMORY_USAGE_BYTES, 1048576);
      metrics.observeHistogram(METRICS.GATE_EXECUTION_TIME, 2.5, { gateType: "test" });

      const prometheus = metrics.exportPrometheus();

      expect(prometheus).toContain("# TYPE lex_pr_gate_success_total counter");
      expect(prometheus).toContain("# TYPE lex_pr_memory_usage_bytes gauge");
      expect(prometheus).toContain("# TYPE lex_pr_gate_execution_seconds histogram");
    });

    it("should format labels correctly in Prometheus export", () => {
      metrics.incrementCounter("test_metric", { label1: "value1", label2: "value2" }, 1);

      const prometheus = metrics.exportPrometheus();
      expect(prometheus).toContain('test_metric{label1="value1",label2="value2"} 1');
    });
  });

  describe("JSON Export", () => {
    it("should export all metrics as JSON", () => {
      metrics.incrementCounter("counter1", undefined, 5);
      metrics.setGauge("gauge1", 100);
      metrics.observeHistogram("histogram1", 1.5);

      const json = metrics.exportJSON();

      expect(json).toHaveProperty("counters");
      expect(json).toHaveProperty("gauges");
      expect(json).toHaveProperty("histograms");
      expect(json.counters["counter1"]).toBe(5);
      expect(json.gauges["gauge1"]).toBe(100);
    });
  });

  describe("Reset", () => {
    it("should clear all metrics on reset", () => {
      metrics.incrementCounter("test_counter", undefined, 5);
      metrics.setGauge("test_gauge", 100);
      metrics.observeHistogram("test_histogram", 1.5);

      metrics.reset();

      const json = metrics.exportJSON();
      expect(Object.keys(json.counters).length).toBe(0);
      expect(Object.keys(json.gauges).length).toBe(0);
      expect(Object.keys(json.histograms).length).toBe(0);
    });
  });

  describe("Predefined Metrics", () => {
    it("should have all required metric names", () => {
      expect(METRICS.PLAN_EXECUTION_TIME).toBeTruthy();
      expect(METRICS.GATE_EXECUTION_TIME).toBeTruthy();
      expect(METRICS.MERGE_EXECUTION_TIME).toBeTruthy();
      expect(METRICS.GATE_SUCCESS_TOTAL).toBeTruthy();
      expect(METRICS.GATE_FAILURE_TOTAL).toBeTruthy();
      expect(METRICS.MERGE_SUCCESS_TOTAL).toBeTruthy();
      expect(METRICS.MERGE_FAILURE_TOTAL).toBeTruthy();
      expect(METRICS.MEMORY_USAGE_BYTES).toBeTruthy();
      expect(METRICS.ACTIVE_WORKERS).toBeTruthy();
      expect(METRICS.DEPENDENCY_RESOLUTION_TIME).toBeTruthy();
      expect(METRICS.DEPENDENCY_ACCURACY).toBeTruthy();
    });
  });
});
