import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  createRunManager,
  StartRunInput,
  StartRunInputSchema,
  GetStatusInput,
  GetStatusInputSchema,
  RunNotFoundError,
  RunManager,
} from "../src/runs/index.js";
import { buildStatusResponse, getDefaultNextOptions } from "../src/runs/statusBuilder.js";
import { RunStateFile } from "../src/runs/types.js";

describe("Run Manager", () => {
  let testDir: string;
  let manager: RunManager;

  beforeEach(() => {
    // Create isolated test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-test-"));
    manager = createRunManager(testDir);
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("startRun", () => {
    it("should create a run with unique runId", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);

      expect(result.runId).toBeDefined();
      expect(result.runId.length).toBeGreaterThan(0);
      expect(result.initialStatus).toBeDefined();
      expect(result.initialStatus.runId).toBe(result.runId);
    });

    it("should persist run state to file", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);
      const runPath = path.join(manager.getRunsDir(), `${result.runId}.json`);

      expect(fs.existsSync(runPath)).toBe(true);

      const content = fs.readFileSync(runPath, "utf-8");
      const savedState = JSON.parse(content);
      expect(savedState.runId).toBe(result.runId);
      expect(savedState.mode).toBe("senior-dev");
      expect(savedState.procedure).toBe("merge-weave-main");
      expect(savedState.repo).toBe("owner/repo");
    });

    it("should set initial state to planning", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);

      expect(result.initialStatus.state).toBe("planning");
    });

    it("should include optional task parameter", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
        task: "Merge all feature branches for release",
      };

      const result = manager.startRun(input);
      const runState = manager.loadRunState(result.runId);

      expect(runState.task).toBe("Merge all feature branches for release");
    });

    it("should include optional params", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
        params: { targetBranch: "release-1.0" },
      };

      const result = manager.startRun(input);
      const runState = manager.loadRunState(result.runId);

      expect(runState.params).toEqual({ targetBranch: "release-1.0" });
    });

    it("should generate unique IDs for multiple runs", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result1 = manager.startRun(input);
      const result2 = manager.startRun(input);

      expect(result1.runId).not.toBe(result2.runId);
    });

    it("should set progress with initial state", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);

      expect(result.initialStatus.progress).toBeDefined();
      // Progress starts with current as null (no step executing yet)
      expect(result.initialStatus.progress?.current).toBeNull();
      // Completed steps is empty initially
      expect(result.initialStatus.progress?.completed).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("should return status for existing run", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const startResult = manager.startRun(input);
      const status = manager.getStatus({ runId: startResult.runId });

      expect(status.runId).toBe(startResult.runId);
      expect(status.mode).toBe("senior-dev");
      expect(status.procedure).toBe("merge-weave-main");
      expect(status.state).toBe("planning");
    });

    it("should throw RunNotFoundError for invalid runId", () => {
      expect(() => {
        manager.getStatus({ runId: "nonexistent-id" });
      }).toThrow(RunNotFoundError);
    });

    it("should include nextOptions in status", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const startResult = manager.startRun(input);
      const status = manager.getStatus({ runId: startResult.runId });

      expect(status.nextOptions).toBeDefined();
      expect(status.nextOptions.length).toBeGreaterThan(0);

      // Planning state should have continue, pause, abort options
      const actions = status.nextOptions.map((opt) => opt.action);
      expect(actions).toContain("continue");
      expect(actions).toContain("pause");
      expect(actions).toContain("abort");
    });

    it("should include summary in status", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const startResult = manager.startRun(input);
      const status = manager.getStatus({ runId: startResult.runId });

      expect(status.summary).toBeDefined();
      expect(status.summary.length).toBeGreaterThan(0);
    });

    it("should include persona snapshot", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const startResult = manager.startRun(input);
      const status = manager.getStatus({ runId: startResult.runId });

      expect(status.persona).toBeDefined();
      expect(status.persona?.mode).toBe("senior-dev");
      expect(status.persona?.forbidden).toContain("force-push");
    });
  });

  describe("runExists", () => {
    it("should return true for existing run", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);
      expect(manager.runExists(result.runId)).toBe(true);
    });

    it("should return false for non-existing run", () => {
      expect(manager.runExists("nonexistent-id")).toBe(false);
    });
  });

  describe("listRuns", () => {
    it("should return empty array when no runs exist", () => {
      expect(manager.listRuns()).toEqual([]);
    });

    it("should list all run IDs", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result1 = manager.startRun(input);
      const result2 = manager.startRun(input);

      const runs = manager.listRuns();
      expect(runs).toContain(result1.runId);
      expect(runs).toContain(result2.runId);
      expect(runs.length).toBe(2);
    });

    it("should return sorted list", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      manager.startRun(input);
      manager.startRun(input);
      manager.startRun(input);

      const runs = manager.listRuns();
      const sorted = [...runs].sort();
      expect(runs).toEqual(sorted);
    });
  });

  describe("updateRunState", () => {
    it("should update run state", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);
      const updated = manager.updateRunState(result.runId, {
        state: "executing",
      });

      expect(updated.state).toBe("executing");
      expect(updated.runId).toBe(result.runId);
    });

    it("should preserve original runId and createdAt", async () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);
      const original = manager.loadRunState(result.runId);

      // Wait a small amount to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = manager.updateRunState(result.runId, {
        state: "executing",
        runId: "different-id", // Should be ignored
      });

      expect(updated.runId).toBe(original.runId);
      expect(updated.createdAt).toBe(original.createdAt);
      // updatedAt should be different or at least not less than original
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(original.updatedAt).getTime()
      );
    });
  });

  describe("deleteRun", () => {
    it("should delete existing run", () => {
      const input: StartRunInput = {
        mode: "senior-dev",
        procedure: "merge-weave-main",
        repo: "owner/repo",
      };

      const result = manager.startRun(input);
      expect(manager.runExists(result.runId)).toBe(true);

      const deleted = manager.deleteRun(result.runId);
      expect(deleted).toBe(true);
      expect(manager.runExists(result.runId)).toBe(false);
    });

    it("should return false for non-existing run", () => {
      expect(manager.deleteRun("nonexistent-id")).toBe(false);
    });
  });
});

describe("Input Schema Validation", () => {
  it("should validate StartRunInput with required fields", () => {
    const valid = {
      mode: "senior-dev",
      procedure: "merge-weave-main",
      repo: "owner/repo",
    };

    expect(() => StartRunInputSchema.parse(valid)).not.toThrow();
  });

  it("should reject StartRunInput missing required fields", () => {
    const invalid = {
      mode: "senior-dev",
      // Missing procedure and repo
    };

    expect(() => StartRunInputSchema.parse(invalid)).toThrow();
  });

  it("should validate GetStatusInput", () => {
    const valid = { runId: "some-run-id" };
    expect(() => GetStatusInputSchema.parse(valid)).not.toThrow();

    const invalid = {};
    expect(() => GetStatusInputSchema.parse(invalid)).toThrow();
  });
});

describe("Status Builder", () => {
  it("should build status response from run state", () => {
    const runState: RunStateFile = {
      runId: "test-run-id",
      state: "planning",
      mode: "senior-dev",
      procedure: "merge-weave-main",
      repo: "owner/repo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const status = buildStatusResponse(runState);

    expect(status.runId).toBe("test-run-id");
    expect(status.state).toBe("planning");
    expect(status.mode).toBe("senior-dev");
    expect(status.procedure).toBe("merge-weave-main");
    expect(status.nextOptions.length).toBeGreaterThan(0);
  });

  it("should generate appropriate summary for each state", () => {
    const baseState: RunStateFile = {
      runId: "test-run-id",
      state: "planning",
      mode: "senior-dev",
      procedure: "merge-weave-main",
      repo: "owner/repo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Planning state
    let status = buildStatusResponse({ ...baseState, state: "planning" });
    expect(status.summary).toContain("Planning");

    // Executing state
    status = buildStatusResponse({ ...baseState, state: "executing" });
    expect(status.summary).toContain("Executing");

    // Completed state
    status = buildStatusResponse({ ...baseState, state: "completed" });
    expect(status.summary).toContain("completed");

    // Failed state with blocker
    status = buildStatusResponse({
      ...baseState,
      state: "failed",
      blockers: ["lint gate failing"],
    });
    expect(status.summary).toContain("Failed");
  });

  it("should get default next options for each state", () => {
    const planningOptions = getDefaultNextOptions("planning");
    expect(planningOptions.map((o) => o.action)).toContain("continue");
    expect(planningOptions.map((o) => o.action)).toContain("pause");
    expect(planningOptions.map((o) => o.action)).toContain("abort");

    const gatedOptions = getDefaultNextOptions("gated");
    expect(gatedOptions.map((o) => o.action)).toContain("retry");
    expect(gatedOptions.map((o) => o.action)).toContain("skip");

    const completedOptions = getDefaultNextOptions("completed");
    expect(completedOptions.map((o) => o.action)).toContain("restart");
  });
});

describe("Integration: startRun → getStatus", () => {
  let testDir: string;
  let manager: RunManager;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-integration-"));
    manager = createRunManager(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("should start run and verify state with getStatus", () => {
    // Start a run
    const startResult = manager.startRun({
      mode: "senior-dev",
      procedure: "merge-weave-main",
      repo: "owner/repo",
      task: "Test task",
    });

    expect(startResult.runId).toBeDefined();
    expect(startResult.initialStatus.state).toBe("planning");

    // Get status and verify consistency
    const status = manager.getStatus({ runId: startResult.runId });

    expect(status.runId).toBe(startResult.runId);
    expect(status.state).toBe(startResult.initialStatus.state);
    expect(status.mode).toBe(startResult.initialStatus.mode);
    expect(status.procedure).toBe(startResult.initialStatus.procedure);
    expect(status.nextOptions).toEqual(startResult.initialStatus.nextOptions);
  });

  it("should persist state across manager instances", () => {
    // Create run with first manager
    const manager1 = createRunManager(testDir);
    const startResult = manager1.startRun({
      mode: "senior-dev",
      procedure: "merge-weave-main",
      repo: "owner/repo",
    });

    // Get status with new manager instance
    const manager2 = createRunManager(testDir);
    const status = manager2.getStatus({ runId: startResult.runId });

    expect(status.runId).toBe(startResult.runId);
    expect(status.state).toBe("planning");
    expect(status.mode).toBe("senior-dev");
  });
});
