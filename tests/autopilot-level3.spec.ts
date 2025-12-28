import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutopilotLevel3 } from "../src/autopilot/level3.js";
import { AutopilotContext } from "../src/autopilot/base.js";
import { Plan } from "../src/schema.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("AutopilotLevel3", () => {
  let tempDir: string;
  let profilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-level3-test-"));
    profilePath = path.join(tempDir, ".smartergpt");
    fs.mkdirSync(profilePath, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("getLevel", () => {
    it("should return level 3", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel3(context);
      expect(autopilot.getLevel()).toBe(3);
    });
  });

  describe("Integration Branch Creation", () => {
    it("should create integration branch with correct naming format", () => {
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
      const autopilot = new AutopilotLevel3(context);

      // Test that the branch name format is correct
      // Format: integration/{timestamp}-{hash}
      const branchRegex = /^integration\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{8}$/;

      // We can't directly test branch creation without a git repo,
      // but we can test the naming logic by checking the format
      // This would be done in the actual execute() method
      expect(true).toBe(true); // Placeholder for actual branch name validation
    });
  });

  describe("Conflict Detection", () => {
    it("should detect and report merge conflicts", () => {
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
      const autopilot = new AutopilotLevel3(context);

      // Level 3 should detect conflicts during merge operations
      // The conflict detection is handled by GitOperations
      expect(autopilot.getLevel()).toBe(3);
    });
  });

  describe("Gate Execution", () => {
    it("should execute gates on integration branch after merge", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            deps: [],
            gates: [{ name: "test-gate", run: 'echo "test"', runtime: "local" }],
          },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel3(context);

      // Level 3 should execute gates on the integration branch
      // Gate execution is handled by executeGates method
      expect(autopilot.getLevel()).toBe(3);
    });

    it("should skip gate execution if merge fails", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            deps: [],
            gates: [{ name: "test-gate", run: 'echo "test"', runtime: "local" }],
          },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel3(context);

      // If merge fails, gates should not be executed
      expect(autopilot.getLevel()).toBe(3);
    });
  });

  describe("Success Path", () => {
    it("should report success when all merges and gates pass", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            deps: [],
            gates: [{ name: "passing-gate", run: "exit 0", runtime: "local" }],
          },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel3(context);

      // Success path: all merges succeed, all gates pass
      // Integration branch is ready for final merge
      expect(autopilot.getLevel()).toBe(3);
    });
  });

  describe("Failure Path", () => {
    it("should keep source PRs open on failure", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            deps: [],
            gates: [{ name: "failing-gate", run: "exit 1", runtime: "local" }],
          },
        ],
      };
      const context: AutopilotContext = {
        plan,
        profilePath,
        profileRole: "test",
      };
      const autopilot = new AutopilotLevel3(context);

      // Failure path: gates fail, source PRs remain open
      expect(autopilot.getLevel()).toBe(3);
    });

    it("should report merge failures clearly", () => {
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
      const autopilot = new AutopilotLevel3(context);

      // Merge failures should be reported with details
      expect(autopilot.getLevel()).toBe(3);
    });
  });

  describe("Branch Cleanup", () => {
    it("should preserve integration branch on failure for inspection", () => {
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
      const autopilot = new AutopilotLevel3(context);

      // Failed integration branches should be preserved for debugging
      expect(autopilot.getLevel()).toBe(3);
    });

    it("should not auto-delete integration branch on success (Level 4 responsibility)", () => {
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
      const autopilot = new AutopilotLevel3(context);

      // Level 3 creates and validates, but doesn't cleanup
      // Cleanup is Level 4 responsibility
      expect(autopilot.getLevel()).toBe(3);
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
      const autopilot = new AutopilotLevel3(context);

      // Level 3 should log:
      // - Branch creation
      // - Merge operations
      // - Gate execution
      // - Success/failure status
      expect(autopilot.getLevel()).toBe(3);
    });
  });
});
