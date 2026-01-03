import { describe, it, expect } from "vitest";
import {
  convertCheckRunToGateResult,
  convertCheckRunsToGateResults,
} from "../src/gates/checkRunConverter.js";
import type { GitHubCheckRun } from "../src/github/types.js";
import type { GateMappingConfig } from "../src/schema/gateMapping.js";

describe("Check Run Converter", () => {
  const testConfig: GateMappingConfig = {
    version: "1.0.0",
    mappings: [
      { pattern: "CI / build", gate: "build" },
      { pattern: "CI / test", gate: "test" },
      { pattern: "lint", gate: "lint" },
      { pattern: "typecheck", gate: "typecheck" },
    ],
  };

  describe("convertCheckRunToGateResult", () => {
    it("converts successful check run to pass gate result", () => {
      const checkRun: GitHubCheckRun = {
        id: 1,
        name: "CI / build",
        status: "completed",
        conclusion: "success",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:05:00Z",
        html_url: "https://github.com/owner/repo/runs/1",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.gate).toBe("build");
      expect(result?.status).toBe("pass");
      expect(result?.exitCode).toBe(0);
      expect(result?.duration).toBe(5 * 60 * 1000); // 5 minutes in ms
      expect(result?.artifacts).toContain("https://github.com/owner/repo/runs/1");
    });

    it("converts failed check run to fail gate result", () => {
      const checkRun: GitHubCheckRun = {
        id: 2,
        name: "CI / test",
        status: "completed",
        conclusion: "failure",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:10:00Z",
        html_url: "https://github.com/owner/repo/runs/2",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.gate).toBe("test");
      expect(result?.status).toBe("fail");
      expect(result?.exitCode).toBe(1);
      expect(result?.stderr).toContain("Check failed");
    });

    it("converts skipped check run to skipped gate result", () => {
      const checkRun: GitHubCheckRun = {
        id: 3,
        name: "lint",
        status: "completed",
        conclusion: "skipped",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:00:01Z",
        html_url: "https://github.com/owner/repo/runs/3",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.gate).toBe("lint");
      expect(result?.status).toBe("skipped");
    });

    it("converts neutral check run to skipped gate result", () => {
      const checkRun: GitHubCheckRun = {
        id: 4,
        name: "typecheck",
        status: "completed",
        conclusion: "neutral",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:00:01Z",
        html_url: "https://github.com/owner/repo/runs/4",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("skipped");
    });

    it("converts timed out check run to fail gate result", () => {
      const checkRun: GitHubCheckRun = {
        id: 5,
        name: "CI / test",
        status: "completed",
        conclusion: "timed_out",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T11:00:00Z",
        html_url: "https://github.com/owner/repo/runs/5",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("fail");
    });

    it("converts cancelled check run to fail gate result", () => {
      const checkRun: GitHubCheckRun = {
        id: 6,
        name: "CI / build",
        status: "completed",
        conclusion: "cancelled",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:02:00Z",
        html_url: "https://github.com/owner/repo/runs/6",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("fail");
    });

    it("returns null for incomplete check runs", () => {
      const checkRun: GitHubCheckRun = {
        id: 7,
        name: "CI / build",
        status: "in_progress",
        conclusion: null,
        started_at: "2024-01-01T10:00:00Z",
        completed_at: null,
        html_url: "https://github.com/owner/repo/runs/7",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).toBeNull();
    });

    it("returns null for unmapped check names", () => {
      const checkRun: GitHubCheckRun = {
        id: 8,
        name: "unknown-check",
        status: "completed",
        conclusion: "success",
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:05:00Z",
        html_url: "https://github.com/owner/repo/runs/8",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).toBeNull();
    });

    it("calculates duration when timestamps are available", () => {
      const checkRun: GitHubCheckRun = {
        id: 9,
        name: "CI / build",
        status: "completed",
        conclusion: "success",
        started_at: "2024-01-01T10:00:00.000Z",
        completed_at: "2024-01-01T10:00:10.000Z",
        html_url: "https://github.com/owner/repo/runs/9",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.duration).toBe(10000); // 10 seconds in ms
    });

    it("handles missing timestamps gracefully", () => {
      const checkRun: GitHubCheckRun = {
        id: 10,
        name: "CI / build",
        status: "completed",
        conclusion: "success",
        started_at: null,
        completed_at: "2024-01-01T10:00:00Z",
        html_url: "https://github.com/owner/repo/runs/10",
        app: { name: "GitHub Actions" },
      };

      const result = convertCheckRunToGateResult(checkRun, testConfig);

      expect(result).not.toBeNull();
      expect(result?.duration).toBeUndefined();
    });
  });

  describe("convertCheckRunsToGateResults", () => {
    it("converts multiple check runs to gate results", () => {
      const checkRuns: GitHubCheckRun[] = [
        {
          id: 1,
          name: "CI / build",
          status: "completed",
          conclusion: "success",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:05:00Z",
          html_url: "https://github.com/owner/repo/runs/1",
          app: { name: "GitHub Actions" },
        },
        {
          id: 2,
          name: "CI / test",
          status: "completed",
          conclusion: "failure",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:10:00Z",
          html_url: "https://github.com/owner/repo/runs/2",
          app: { name: "GitHub Actions" },
        },
        {
          id: 3,
          name: "lint",
          status: "completed",
          conclusion: "success",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:01:00Z",
          html_url: "https://github.com/owner/repo/runs/3",
          app: { name: "GitHub Actions" },
        },
      ];

      const results = convertCheckRunsToGateResults(checkRuns, testConfig);

      expect(results).toHaveLength(3);
      expect(results[0].gate).toBe("build");
      expect(results[0].status).toBe("pass");
      expect(results[1].gate).toBe("test");
      expect(results[1].status).toBe("fail");
      expect(results[2].gate).toBe("lint");
      expect(results[2].status).toBe("pass");
    });

    it("filters out incomplete check runs", () => {
      const checkRuns: GitHubCheckRun[] = [
        {
          id: 1,
          name: "CI / build",
          status: "in_progress",
          conclusion: null,
          started_at: "2024-01-01T10:00:00Z",
          completed_at: null,
          html_url: "https://github.com/owner/repo/runs/1",
          app: { name: "GitHub Actions" },
        },
        {
          id: 2,
          name: "CI / test",
          status: "completed",
          conclusion: "success",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:10:00Z",
          html_url: "https://github.com/owner/repo/runs/2",
          app: { name: "GitHub Actions" },
        },
      ];

      const results = convertCheckRunsToGateResults(checkRuns, testConfig);

      expect(results).toHaveLength(1);
      expect(results[0].gate).toBe("test");
    });

    it("filters out unmapped check runs", () => {
      const checkRuns: GitHubCheckRun[] = [
        {
          id: 1,
          name: "unknown-check",
          status: "completed",
          conclusion: "success",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:05:00Z",
          html_url: "https://github.com/owner/repo/runs/1",
          app: { name: "GitHub Actions" },
        },
        {
          id: 2,
          name: "CI / build",
          status: "completed",
          conclusion: "success",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:05:00Z",
          html_url: "https://github.com/owner/repo/runs/2",
          app: { name: "GitHub Actions" },
        },
      ];

      const results = convertCheckRunsToGateResults(checkRuns, testConfig);

      expect(results).toHaveLength(1);
      expect(results[0].gate).toBe("build");
    });

    it("handles duplicate gate names (keeps first)", () => {
      const checkRuns: GitHubCheckRun[] = [
        {
          id: 1,
          name: "CI / build",
          status: "completed",
          conclusion: "success",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:05:00Z",
          html_url: "https://github.com/owner/repo/runs/1",
          app: { name: "GitHub Actions" },
        },
        {
          id: 2,
          name: "build", // Maps to same gate
          status: "completed",
          conclusion: "failure",
          started_at: "2024-01-01T10:00:00Z",
          completed_at: "2024-01-01T10:05:00Z",
          html_url: "https://github.com/owner/repo/runs/2",
          app: { name: "GitHub Actions" },
        },
      ];

      const config: GateMappingConfig = {
        version: "1.0.0",
        mappings: [
          { pattern: "CI / build", gate: "build" },
          { pattern: "build", gate: "build" },
        ],
      };

      const results = convertCheckRunsToGateResults(checkRuns, config);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("pass"); // First result is kept
    });

    it("returns empty array for empty input", () => {
      const results = convertCheckRunsToGateResults([], testConfig);
      expect(results).toEqual([]);
    });
  });
});
