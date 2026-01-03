/**
 * Unit tests for agent stall detection monitor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentMonitor,
  MonitorConfig,
  calculateStatus,
  shouldNudge,
  MonitorSummary,
} from "../../../src/fanout/monitor.js";

describe("Agent Monitor", () => {
  describe("calculateStatus", () => {
    const config: MonitorConfig = {
      warningThresholdMinutes: 10,
      stallThresholdMinutes: 20,
      autoNudge: false,
      autoEscalate: false,
    };

    it("should return complete for ready_for_review PRs", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "ready_for_review",
      };

      const status = calculateStatus(monitor, config);
      expect(status).toBe("complete");
    });

    it("should return active for recent activity (< stall threshold)", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 min ago
        lastCommitAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      const status = calculateStatus(monitor, config);
      expect(status).toBe("active");
    });

    it("should return stalled for old activity (>= stall threshold)", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 60 min ago
        lastCommitAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 min ago
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      const status = calculateStatus(monitor, config);
      expect(status).toBe("stalled");
    });

    it("should use assignedAt when lastCommitAt is null", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 min ago
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      const status = calculateStatus(monitor, config);
      expect(status).toBe("stalled");
    });

    it("should use custom now time for testing", () => {
      const assignedAt = new Date("2025-01-01T10:00:00Z");
      const now = new Date("2025-01-01T10:25:00Z"); // 25 min later

      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: assignedAt.toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      const status = calculateStatus(monitor, config, now);
      expect(status).toBe("stalled");
    });
  });

  describe("shouldNudge", () => {
    const config: MonitorConfig = {
      warningThresholdMinutes: 10,
      stallThresholdMinutes: 20,
      autoNudge: false,
      autoEscalate: false,
    };

    it("should return false for complete PRs", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "complete",
        author: "testuser",
        prState: "ready_for_review",
      };

      expect(shouldNudge(monitor, config)).toBe(false);
    });

    it("should return false for stalled PRs", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "stalled",
        author: "testuser",
        prState: "open",
      };

      expect(shouldNudge(monitor, config)).toBe(false);
    });

    it("should return false for recent activity (< warning threshold)", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      expect(shouldNudge(monitor, config)).toBe(false);
    });

    it("should return true for activity >= warning threshold", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      expect(shouldNudge(monitor, config)).toBe(true);
    });

    it("should use lastCommitAt when available", () => {
      const now = new Date("2025-01-01T10:30:00Z");
      const assignedAt = new Date("2025-01-01T09:00:00Z"); // 90 min ago
      const lastCommitAt = new Date("2025-01-01T10:25:00Z"); // 5 min ago

      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: assignedAt.toISOString(),
        lastCommitAt: lastCommitAt.toISOString(),
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      expect(shouldNudge(monitor, config, now)).toBe(false);
    });
  });

  describe("MonitorSummary", () => {
    it("should correctly count PR statuses", () => {
      const summary: MonitorSummary = {
        timestamp: new Date().toISOString(),
        totalPRs: 4,
        activePRs: 2,
        stalledPRs: 1,
        completePRs: 1,
        monitors: [
          {
            prNumber: 1,
            title: "PR 1",
            assignedAt: new Date().toISOString(),
            lastCommitAt: null,
            stallThresholdMinutes: 20,
            status: "active",
            author: "user1",
            prState: "open",
          },
          {
            prNumber: 2,
            title: "PR 2",
            assignedAt: new Date().toISOString(),
            lastCommitAt: null,
            stallThresholdMinutes: 20,
            status: "active",
            author: "user2",
            prState: "draft",
          },
          {
            prNumber: 3,
            title: "PR 3",
            assignedAt: new Date().toISOString(),
            lastCommitAt: null,
            stallThresholdMinutes: 20,
            status: "stalled",
            author: "user3",
            prState: "open",
          },
          {
            prNumber: 4,
            title: "PR 4",
            assignedAt: new Date().toISOString(),
            lastCommitAt: null,
            stallThresholdMinutes: 20,
            status: "complete",
            author: "user4",
            prState: "ready_for_review",
          },
        ],
      };

      expect(summary.totalPRs).toBe(4);
      expect(summary.activePRs).toBe(2);
      expect(summary.stalledPRs).toBe(1);
      expect(summary.completePRs).toBe(1);
    });
  });

  describe("Edge cases", () => {
    const config: MonitorConfig = {
      warningThresholdMinutes: 10,
      stallThresholdMinutes: 20,
      autoNudge: false,
      autoEscalate: false,
    };

    it("should handle exact threshold boundary", () => {
      const now = new Date("2025-01-01T10:20:00Z");
      const assignedAt = new Date("2025-01-01T10:00:00Z"); // exactly 20 min ago

      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: assignedAt.toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "open",
      };

      const status = calculateStatus(monitor, config, now);
      expect(status).toBe("stalled");
    });

    it("should handle draft PRs", () => {
      const monitor: AgentMonitor = {
        prNumber: 123,
        title: "Test PR",
        assignedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        lastCommitAt: null,
        stallThresholdMinutes: 20,
        status: "active",
        author: "testuser",
        prState: "draft",
      };

      const status = calculateStatus(monitor, config);
      expect(status).toBe("active");
    });
  });
});
