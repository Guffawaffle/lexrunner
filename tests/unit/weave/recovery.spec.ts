/**
 * Recovery Module Tests
 *
 * Tests for weave recovery operations (resume, revert, abort).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  revertLastMerge,
  validateResume,
  resumeWeave,
  abortWeave,
} from "../../../src/weave/recovery.js";
import { WeaveState, type WeaveContext } from "../../../src/weave/types.js";
import type { GitOperations } from "../../../src/weave/executor/types.js";

describe("Recovery Module", () => {
  // Mock git operations
  const mockGit: GitOperations = {
    pull: vi.fn(),
    getCurrentBranch: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
  };

  const createContext = (overrides?: Partial<WeaveContext>): WeaveContext => ({
    runId: "test-run-123",
    state: WeaveState.PAUSED,
    plan: { items: [], target: "main" },
    prHeads: [],
    batches: [
      {
        batchNumber: 0,
        items: ["feature-1"],
        state: "completed",
        mergeSha: "abc123",
        startedAt: "2024-01-01T10:00:00Z",
        completedAt: "2024-01-01T10:05:00Z",
      },
      {
        batchNumber: 1,
        items: ["feature-2"],
        state: "completed",
        mergeSha: "def456",
        startedAt: "2024-01-01T10:10:00Z",
        completedAt: "2024-01-01T10:15:00Z",
      },
    ],
    currentBatchIndex: 2,
    startedAt: "2024-01-01T10:00:00Z",
    lastUpdatedAt: "2024-01-01T10:15:00Z",
    successfulMerges: 2,
    failedMerges: 0,
    metadata: {
      planHash: "hash123",
      targetBranch: "main",
      dryRun: false,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("revertLastMerge", () => {
    it("reverts the last completed merge", async () => {
      const context = createContext();

      const result = await revertLastMerge(context, mockGit, "/test/workspace");

      expect(result.success).toBe(true);
      expect(result.itemReverted).toBe("feature-2");
      expect(result.revertCommitSha).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it("returns error when no completed merges exist", async () => {
      const context = createContext({
        batches: [
          {
            batchNumber: 0,
            items: ["feature-1"],
            state: "pending",
          },
        ],
      });

      const result = await revertLastMerge(context, mockGit, "/test/workspace");

      expect(result.success).toBe(false);
      expect(result.error).toBe("No completed merges to revert");
    });

    it("returns error when last batch has no merge SHA", async () => {
      const context = createContext({
        batches: [
          {
            batchNumber: 0,
            items: ["feature-1"],
            state: "completed",
            // No mergeSha
          },
        ],
      });

      const result = await revertLastMerge(context, mockGit, "/test/workspace");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Last batch has no merge SHA recorded");
    });

    it("handles multiple items in last batch", async () => {
      const context = createContext({
        batches: [
          {
            batchNumber: 0,
            items: ["feature-1", "feature-2", "feature-3"],
            state: "completed",
            mergeSha: "multi123",
          },
        ],
      });

      const result = await revertLastMerge(context, mockGit, "/test/workspace");

      expect(result.success).toBe(true);
      expect(result.itemReverted).toBe("feature-1, feature-2, feature-3");
    });
  });

  describe("validateResume", () => {
    it("validates successfully when context is paused and clean", async () => {
      const context = createContext({ state: WeaveState.PAUSED });

      vi.mocked(mockGit.hasUncommittedChanges).mockResolvedValue(false);

      const result = await validateResume(context, mockGit, "/test/workspace");

      expect(result.canResume).toBe(true);
      expect(result.context).toEqual(context);
      expect(result.reason).toBeUndefined();
    });

    it("rejects when state is not paused", async () => {
      const context = createContext({ state: WeaveState.MERGING });

      const result = await validateResume(context, mockGit, "/test/workspace");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("Cannot resume from state 'merging'");
    });

    it("rejects when working directory has uncommitted changes", async () => {
      const context = createContext({ state: WeaveState.PAUSED });

      vi.mocked(mockGit.hasUncommittedChanges).mockResolvedValue(true);

      const result = await validateResume(context, mockGit, "/test/workspace");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("uncommitted changes");
    });

    it("handles git operation errors gracefully", async () => {
      const context = createContext({ state: WeaveState.PAUSED });

      vi.mocked(mockGit.hasUncommittedChanges).mockRejectedValue(new Error("Git command failed"));

      const result = await validateResume(context, mockGit, "/test/workspace");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("Failed to check working directory");
      expect(result.reason).toContain("Git command failed");
    });
  });

  describe("resumeWeave", () => {
    it("resumes weave from paused state successfully", async () => {
      const context = createContext({ state: WeaveState.PAUSED });

      vi.mocked(mockGit.hasUncommittedChanges).mockResolvedValue(false);

      const result = await resumeWeave(context, mockGit, "/test/workspace");

      expect(result.canResume).toBe(true);
      expect(result.context).toBeDefined();
      expect(result.context?.state).toBe(WeaveState.READY);
      expect(result.context?.lastUpdatedAt).toBeDefined();
    });

    it("fails to resume when validation fails", async () => {
      const context = createContext({ state: WeaveState.COMPLETED });

      const result = await resumeWeave(context, mockGit, "/test/workspace");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("Cannot resume from state 'completed'");
      expect(result.context).toBeUndefined();
    });

    it("preserves context data when resuming", async () => {
      const context = createContext({
        state: WeaveState.PAUSED,
        runId: "special-run-456",
        successfulMerges: 5,
      });

      vi.mocked(mockGit.hasUncommittedChanges).mockResolvedValue(false);

      const result = await resumeWeave(context, mockGit, "/test/workspace");

      expect(result.context?.runId).toBe("special-run-456");
      expect(result.context?.successfulMerges).toBe(5);
    });
  });

  describe("abortWeave", () => {
    it("aborts weave without reverting merges", async () => {
      const context = createContext();

      const result = await abortWeave(context, mockGit, "/test/workspace");

      expect(result.success).toBe(true);
      expect(result.mergesReverted).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("aborts weave and reverts merges when requested", async () => {
      const context = createContext({
        batches: [
          {
            batchNumber: 0,
            items: ["feature-1"],
            state: "completed",
            mergeSha: "abc123",
          },
          {
            batchNumber: 1,
            items: ["feature-2"],
            state: "completed",
            mergeSha: "def456",
          },
          {
            batchNumber: 2,
            items: ["feature-3"],
            state: "pending",
          },
        ],
      });

      const result = await abortWeave(context, mockGit, "/test/workspace", {
        revertMerges: true,
      });

      expect(result.success).toBe(true);
      expect(result.mergesReverted).toBe(2); // Only completed batches
    });

    it("counts only batches with merge SHA when reverting", async () => {
      const context = createContext({
        batches: [
          {
            batchNumber: 0,
            items: ["feature-1"],
            state: "completed",
            mergeSha: "abc123",
          },
          {
            batchNumber: 1,
            items: ["feature-2"],
            state: "completed",
            // No mergeSha
          },
        ],
      });

      const result = await abortWeave(context, mockGit, "/test/workspace", {
        revertMerges: true,
      });

      expect(result.success).toBe(true);
      expect(result.mergesReverted).toBe(1); // Only one has mergeSha
    });

    it("handles abort with no completed batches", async () => {
      const context = createContext({
        batches: [
          {
            batchNumber: 0,
            items: ["feature-1"],
            state: "pending",
          },
        ],
      });

      const result = await abortWeave(context, mockGit, "/test/workspace", {
        revertMerges: true,
      });

      expect(result.success).toBe(true);
      expect(result.mergesReverted).toBe(0);
    });
  });
});
