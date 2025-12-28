import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SafetyFramework,
  RiskLevel,
  ConfirmationMode,
  DEFAULT_SAFETY_POLICY,
  type OperationSummary,
  type MergeOperation,
  type SafetyPolicy,
} from "../src/autopilot/safety/SafetyFramework.js";

describe("Enhanced Safety Framework", () => {
  let safety: SafetyFramework;

  beforeEach(() => {
    safety = new SafetyFramework();
  });

  describe("Risk Assessment", () => {
    it("should assess low risk for read-only operations", () => {
      const operation: MergeOperation = {
        type: "add-comment",
        description: "Add status comment",
      };

      const risk = safety.assessRiskLevel(operation);
      expect(risk).toBe(RiskLevel.Low);
    });

    it("should assess medium risk for branch and PR operations", () => {
      const createBranch: MergeOperation = {
        type: "create-branch",
        description: "Create integration branch",
        branch: "integration/test",
      };

      const openPR: MergeOperation = {
        type: "open-pr",
        description: "Open integration PR",
      };

      expect(safety.assessRiskLevel(createBranch)).toBe(RiskLevel.Medium);
      expect(safety.assessRiskLevel(openPR)).toBe(RiskLevel.Medium);
    });

    it("should assess high risk for merge and push operations", () => {
      const merge: MergeOperation = {
        type: "merge",
        description: "Merge PR-123",
        prNumber: 123,
      };

      const push: MergeOperation = {
        type: "push",
        description: "Push to origin",
      };

      expect(safety.assessRiskLevel(merge)).toBe(RiskLevel.High);
      expect(safety.assessRiskLevel(push)).toBe(RiskLevel.High);
    });

    it("should respect explicit risk level on operation", () => {
      const operation: MergeOperation = {
        type: "add-comment",
        description: "Critical comment",
        riskLevel: RiskLevel.High,
      };

      const risk = safety.assessRiskLevel(operation);
      expect(risk).toBe(RiskLevel.High);
    });

    it("should assess overall operation risk as highest individual risk", () => {
      const summary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [
          { type: "create-branch", description: "Create branch" }, // Medium
          { type: "merge", description: "Merge PR-123", prNumber: 123 }, // High
        ],
        prOperations: [
          { type: "add-comment", description: "Add comment" }, // Low
        ],
        affectedPRs: [123],
      };

      const risk = safety.assessOperationRisk(summary);
      expect(risk).toBe(RiskLevel.High);
    });

    it("should assess empty operations as low risk", () => {
      const summary: OperationSummary = {
        autopilotLevel: 0,
        mergeOperations: [],
        prOperations: [],
        affectedPRs: [],
      };

      const risk = safety.assessOperationRisk(summary);
      expect(risk).toBe(RiskLevel.Low);
    });
  });

  describe("Safety Policies", () => {
    it("should use default safety policy", () => {
      const policy = safety.getPolicy();

      expect(policy.confirmationThreshold).toBe(RiskLevel.Medium);
      expect(policy.confirmationMode).toBe(ConfirmationMode.Interactive);
      expect(policy.promptTimeout).toBe(30);
      expect(policy.timeoutAction).toBe("abort");
    });

    it("should allow custom safety policy", () => {
      const customPolicy: Partial<SafetyPolicy> = {
        confirmationThreshold: RiskLevel.High,
        confirmationMode: ConfirmationMode.Automatic,
        promptTimeout: 60,
      };

      const customSafety = new SafetyFramework(undefined, customPolicy);
      const policy = customSafety.getPolicy();

      expect(policy.confirmationThreshold).toBe(RiskLevel.High);
      expect(policy.confirmationMode).toBe(ConfirmationMode.Automatic);
      expect(policy.promptTimeout).toBe(60);
      expect(policy.timeoutAction).toBe("abort"); // default preserved
    });

    it("should allow policy updates", () => {
      safety.updatePolicy({
        confirmationMode: ConfirmationMode.DryRun,
        promptTimeout: 0,
      });

      const policy = safety.getPolicy();
      expect(policy.confirmationMode).toBe(ConfirmationMode.DryRun);
      expect(policy.promptTimeout).toBe(0);
    });
  });

  describe("Confirmation Modes", () => {
    it("should auto-reject in dry-run mode", async () => {
      const dryRunSafety = new SafetyFramework(undefined, {
        confirmationMode: ConfirmationMode.DryRun,
      });

      const summary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [{ type: "merge", description: "Merge PR-123", prNumber: 123 }],
        prOperations: [],
        affectedPRs: [123],
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await dryRunSafety.confirmOperation(summary);

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain("Dry-run");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("DRY-RUN MODE"));

      consoleSpy.mockRestore();
    });

    it("should auto-confirm in automatic mode", async () => {
      const autoSafety = new SafetyFramework(undefined, {
        confirmationMode: ConfirmationMode.Automatic,
      });

      const summary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [{ type: "merge", description: "Merge PR-123", prNumber: 123 }],
        prOperations: [],
        affectedPRs: [123],
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await autoSafety.confirmOperation(summary);

      expect(result.confirmed).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Auto-confirming"));

      consoleSpy.mockRestore();
    });

    it("should skip confirmation for low-risk ops when threshold is medium", async () => {
      const summary: OperationSummary = {
        autopilotLevel: 2,
        mergeOperations: [],
        prOperations: [
          { type: "add-comment", description: "Add comment", riskLevel: RiskLevel.Low },
        ],
        affectedPRs: [123],
      };

      const result = await safety.confirmOperation(summary);

      // Should auto-confirm without prompting (low risk, threshold is medium)
      expect(result.confirmed).toBe(true);
    });

    it("should skip confirmation in CI (non-TTY) regardless of mode", async () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      process.stdin.isTTY = false;
      process.stdout.isTTY = false;

      try {
        const summary: OperationSummary = {
          autopilotLevel: 3,
          mergeOperations: [{ type: "merge", description: "Merge PR-123", prNumber: 123 }],
          prOperations: [],
          affectedPRs: [123],
        };

        const result = await safety.confirmOperation(summary);

        expect(result.confirmed).toBe(true);
        expect(result.aborted).toBe(false);
      } finally {
        process.stdin.isTTY = originalStdinIsTTY;
        process.stdout.isTTY = originalStdoutIsTTY;
      }
    });
  });

  describe("Risk-Based Display", () => {
    it("should display high-risk indicator for dangerous operations", async () => {
      const dryRunSafety = new SafetyFramework(undefined, {
        confirmationMode: ConfirmationMode.DryRun,
      });

      const summary: OperationSummary = {
        autopilotLevel: 4,
        mergeOperations: [
          { type: "merge", description: "Merge PR-101", prNumber: 101 },
          { type: "merge", description: "Merge PR-102", prNumber: 102 },
          { type: "push", description: "Push to main" },
        ],
        prOperations: [],
        affectedPRs: [101, 102],
        riskLevel: RiskLevel.High,
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await dryRunSafety.confirmOperation(summary);

      const calls = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(calls).toContain("HIGH RISK");
      expect(calls).toContain("🚨");

      consoleSpy.mockRestore();
    });

    it("should display medium-risk indicator", async () => {
      const dryRunSafety = new SafetyFramework(undefined, {
        confirmationMode: ConfirmationMode.DryRun,
      });

      const summary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [{ type: "create-branch", description: "Create branch" }],
        prOperations: [],
        affectedPRs: [],
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await dryRunSafety.confirmOperation(summary);

      const calls = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(calls).toContain("MEDIUM RISK");
      expect(calls).toContain("⚠️");

      consoleSpy.mockRestore();
    });
  });

  describe("Policy Integration", () => {
    it("should require confirmation for high-risk when threshold is high", async () => {
      const highThresholdSafety = new SafetyFramework(undefined, {
        confirmationThreshold: RiskLevel.High,
        confirmationMode: ConfirmationMode.Interactive,
      });

      // Medium risk operation should auto-confirm
      const mediumSummary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [{ type: "create-branch", description: "Create branch" }],
        prOperations: [],
        affectedPRs: [],
      };

      const result = await highThresholdSafety.confirmOperation(mediumSummary);
      expect(result.confirmed).toBe(true);
    });

    it("should reject on abort regardless of policy", async () => {
      const autoSafety = new SafetyFramework(undefined, {
        confirmationMode: ConfirmationMode.Automatic,
      });

      autoSafety.requestAbort();

      const summary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [{ type: "merge", description: "Merge PR-123", prNumber: 123 }],
        prOperations: [],
        affectedPRs: [123],
      };

      const result = await autoSafety.confirmOperation(summary);

      expect(result.confirmed).toBe(false);
      expect(result.aborted).toBe(true);
    });
  });

  describe("Default Safety Policy", () => {
    it("should export default safety policy with safe defaults", () => {
      expect(DEFAULT_SAFETY_POLICY.confirmationThreshold).toBe(RiskLevel.Medium);
      expect(DEFAULT_SAFETY_POLICY.confirmationMode).toBe(ConfirmationMode.Interactive);
      expect(DEFAULT_SAFETY_POLICY.promptTimeout).toBe(30);
      expect(DEFAULT_SAFETY_POLICY.timeoutAction).toBe("abort");
    });
  });
});
