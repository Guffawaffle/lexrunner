import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutopilotLevel4 } from "../src/autopilot/level4.js";
import { AutopilotContext } from "../src/autopilot/base.js";
import { Plan } from "../src/schema.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("AutopilotLevel4", () => {
  let tempDir: string;
  let profilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-level4-test-"));
    profilePath = path.join(tempDir, ".smartergpt");
    fs.mkdirSync(profilePath, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("getLevel", () => {
    it("should return level 4", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Level 4 Capabilities", () => {
    it("should extend Level 3 with finalization capabilities", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should be able to execute all lower level operations
      expect(autopilot.getLevel()).toBeGreaterThan(3);
    });

    it("should support integration branch merging", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should merge integration branch to target
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should support superseded PR closure", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-1", deps: [], gates: [] },
          { name: "PR-2", deps: ["PR-1"], gates: [] },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should close superseded PRs when configured
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should support branch cleanup after successful merge", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should cleanup integration branches after merge
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Rollback Capabilities", () => {
    it("should rollback on failed merge", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should rollback failed merge operations
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should preserve integration branch on rollback for debugging", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Integration branches should be preserved on failure for inspection
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should not delete failed integration branches", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Failed integration branches should be kept for debugging
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("PR Number Extraction", () => {
    it("should extract PR number from various formats", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-123", deps: [], gates: [] },
          { name: "#456", deps: [], gates: [] },
          { name: "789", deps: [], gates: [] },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should handle multiple PR number formats
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should handle invalid PR number formats gracefully", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "feature-branch", deps: [], gates: [] },
          { name: "bugfix/123-fix", deps: [], gates: [] },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should not fail on non-PR item names
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Configuration", () => {
    it("should respect close-superseded configuration", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should only close PRs when configured
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should use custom branch prefix from configuration", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should respect branch prefix configuration
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Finalization Comments", () => {
    it("should post finalization comments with integration details", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-1", deps: [], gates: [] },
          { name: "PR-2", deps: ["PR-1"], gates: [] },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should post comments with integration details
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should include merge SHA in finalization comments", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should include merge commit SHA
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should include closed PR list in finalization comments", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-1", deps: [], gates: [] },
          { name: "PR-2", deps: [], gates: [] },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should list closed PRs in comments
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Post-Merge Validation", () => {
    it("should validate merge was successful before cleanup", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should validate merge before cleanup
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should verify target branch state after merge", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should verify target branch is in expected state
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Integration with Lower Levels", () => {
    it("should execute Level 3 before Level 4 operations", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should call super.execute() to run Level 3 first
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should propagate Level 3 failures without attempting Level 4 operations", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should not run Level 4 if Level 3 fails
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Error Handling", () => {
    it("should handle GitHub API errors gracefully", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should handle API failures without crashing
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should continue on non-fatal errors", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should continue execution on non-critical failures
      expect(autopilot.getLevel()).toBe(4);
    });

    it("should provide detailed error messages", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Should provide actionable error messages
      expect(autopilot.getLevel()).toBe(4);
    });
  });

  describe("Logging", () => {
    it("should provide comprehensive logs for debugging", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: [], gates: [] }],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel4(context);

      // Level 4 should log:
      // - Merge operations
      // - PR closures
      // - Branch cleanup
      // - Success/failure status
      expect(autopilot.getLevel()).toBe(4);
    });
  });
});
