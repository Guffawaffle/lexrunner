import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProgressReporter } from "../src/util/progress.js";

describe("Progress Indicators", () => {
  describe("ProgressReporter", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should show level start/complete in human mode", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: true });
      reporter.levelStart(1, ["item-a", "item-b"]);
      reporter.levelComplete(1);

      console.log = originalLog;

      expect(logs.some((log) => log.includes("Level 1: Starting"))).toBe(true);
      expect(logs.some((log) => log.includes("[item-a, item-b]"))).toBe(true);
    });

    it("should show node start in human mode", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: true });
      reporter.nodeStart("my-node");

      console.log = originalLog;

      expect(logs.some((log) => log.includes("my-node: Starting"))).toBe(true);
    });

    it("should show node completion tick for operations >2s", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: true });
      reporter.nodeStart("slow-node");

      // Use 2500ms delay to ensure we're well above the 2000ms threshold
      // accounting for event loop jitter and timing uncertainty
      vi.advanceTimersByTime(2500);
      reporter.nodeComplete("slow-node", true);

      console.log = originalLog;

      expect(logs.some((log) => log.includes("slow-node: Starting"))).toBe(true);
      expect(logs.some((log) => log.includes("slow-node: Completed"))).toBe(true);
    });
    it("should NOT show node completion tick for operations <2s", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: true });
      reporter.nodeStart("fast-node");

      // Simulate a delay <2s
      vi.advanceTimersByTime(1000);
      reporter.nodeComplete("fast-node", true);

      console.log = originalLog;

      expect(logs.some((log) => log.includes("fast-node: Starting"))).toBe(true);
      expect(logs.some((log) => log.includes("fast-node: Completed"))).toBe(false);
    });

    it("should NOT show any progress when disabled", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: false });
      reporter.levelStart(1, ["item-a"]);
      reporter.nodeStart("my-node");
      reporter.nodeComplete("my-node", true);
      reporter.levelComplete(1);

      console.log = originalLog;

      expect(logs.length).toBe(0);
    });

    it("should format durations correctly", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: true });

      // Test seconds formatting (2.1s)
      reporter.nodeStart("node-seconds");
      vi.advanceTimersByTime(2100);
      reporter.nodeComplete("node-seconds", true);

      console.log = originalLog;

      const completionLog = logs.find((log) => log.includes("node-seconds: Completed"));
      expect(completionLog).toBeDefined();
      expect(completionLog).toMatch(/\d+\.\d+s/); // Should show seconds with decimal
    });

    it("should show success/failure icons correctly", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(" "));

      const reporter = new ProgressReporter({ enabled: true });

      // Test success
      reporter.nodeStart("success-node");
      vi.advanceTimersByTime(2100);
      reporter.nodeComplete("success-node", true);

      // Test failure
      reporter.nodeStart("fail-node");
      vi.advanceTimersByTime(2100);
      reporter.nodeComplete("fail-node", false);

      console.log = originalLog;

      const successLog = logs.find((log) => log.includes("success-node: Completed"));
      const failLog = logs.find((log) => log.includes("fail-node: Completed"));

      expect(successLog).toContain("✅");
      expect(failLog).toContain("❌");
    });
  });
});
