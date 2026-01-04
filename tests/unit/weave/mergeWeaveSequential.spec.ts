/**
 * Tests for Sequential Merge-Weave Executor
 *
 * Tests the auto-update PR branch functionality during merge-weave.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mergeWeaveSequential,
  mergeWeaveUmbrella,
  type PR,
  type GitHubPROperations,
  type MergeWeaveResult,
} from "../../../src/weave/mergeWeaveSequential.js";

describe("Sequential Merge-Weave Executor", () => {
  let mockGitHub: GitHubPROperations;
  let consoleSpy: any;

  beforeEach(() => {
    // Mock GitHub API
    mockGitHub = {
      getPullRequest: vi.fn(),
      mergePullRequest: vi.fn(),
      updatePullRequestBranch: vi.fn(),
    };

    // Spy on console.log to verify output
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("mergeWeaveSequential", () => {
    it("should merge PRs sequentially and update remaining PRs", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "behind" },
        { number: 3, mergeable_state: "behind" },
      ];

      // Mock successful merges
      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);

      // Mock getPullRequest to return PRs in 'behind' state
      (mockGitHub.getPullRequest as any).mockImplementation((_, __, prNumber) => {
        return Promise.resolve({
          number: prNumber,
          mergeable_state: "behind",
        });
      });

      // Mock successful branch updates
      (mockGitHub.updatePullRequestBranch as any).mockResolvedValue(undefined);

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub);

      // All PRs should be merged
      expect(result.merged).toEqual([1, 2, 3]);
      expect(result.failed).toEqual([]);

      // PRs 2 and 3 should be updated after PR 1 merges
      // PR 3 should be updated after PR 2 merges
      expect(result.updated.length).toBeGreaterThan(0);
      expect(mockGitHub.updatePullRequestBranch).toHaveBeenCalled();
    });

    it("should not update PRs when autoUpdateBranches is false", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "behind" },
      ];

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub, {
        autoUpdateBranches: false,
      });

      expect(result.merged).toEqual([1, 2]);
      expect(result.updated).toEqual([]);
      expect(mockGitHub.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    it("should handle merge failures gracefully", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "clean" },
        { number: 3, mergeable_state: "clean" },
      ];

      // PR 2 fails to merge
      (mockGitHub.mergePullRequest as any).mockImplementation((_, __, prNumber) => {
        if (prNumber === 2) {
          throw new Error("Merge conflict");
        }
        return Promise.resolve(true);
      });

      (mockGitHub.getPullRequest as any).mockImplementation((_, __, prNumber) => {
        return Promise.resolve({
          number: prNumber,
          mergeable_state: "behind",
        });
      });

      (mockGitHub.updatePullRequestBranch as any).mockResolvedValue(undefined);

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub);

      expect(result.merged).toEqual([1, 3]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].number).toBe(2);
      expect(result.failed[0].error).toContain("Merge conflict");
    });

    it("should handle PR branch update failures without blocking", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "behind" },
      ];

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);

      (mockGitHub.getPullRequest as any).mockImplementation((_, __, prNumber) => {
        return Promise.resolve({
          number: prNumber,
          mergeable_state: "behind",
        });
      });

      // Update fails
      (mockGitHub.updatePullRequestBranch as any).mockRejectedValue(
        new Error("Update branch failed")
      );

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub);

      // Merge should still succeed
      expect(result.merged).toEqual([1, 2]);

      // Update failure should be logged
      expect(result.updateFailed).toHaveLength(1);
      expect(result.updateFailed[0].number).toBe(2);
      expect(result.updateFailed[0].error).toContain("Update branch failed");
    });

    it("should only update PRs that are behind", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "clean" },
        { number: 3, mergeable_state: "behind" },
      ];

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);

      (mockGitHub.getPullRequest as any).mockImplementation((_, __, prNumber) => {
        return Promise.resolve({
          number: prNumber,
          mergeable_state: prNumber === 3 ? "behind" : "clean",
        });
      });

      (mockGitHub.updatePullRequestBranch as any).mockResolvedValue(undefined);

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub);

      expect(result.merged).toEqual([1, 2, 3]);

      // Only PR 3 should be updated (when it's behind after PR 1 and PR 2 merge)
      expect(mockGitHub.updatePullRequestBranch).toHaveBeenCalled();

      // Verify that updatePullRequestBranch was called only for PR 3
      const updateCalls = (mockGitHub.updatePullRequestBranch as any).mock.calls;
      const updatedPRNumbers = updateCalls.map((call: any) => call[2]);
      expect(updatedPRNumbers).toContain(3);
      expect(updatedPRNumbers).not.toContain(2);
    });

    it("should work in dry-run mode", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "behind" },
      ];

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub, {
        dryRun: true,
      });

      // No actual API calls should be made
      expect(mockGitHub.mergePullRequest).not.toHaveBeenCalled();
      expect(mockGitHub.updatePullRequestBranch).not.toHaveBeenCalled();

      // But dry run should show what would happen
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[DRY RUN]"));
    });

    it("should handle missing PRs gracefully", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "clean" },
      ];

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);

      // PR 2 not found
      (mockGitHub.getPullRequest as any).mockResolvedValue(null);

      const result = await mergeWeaveSequential("owner", "repo", prs, mockGitHub);

      expect(result.merged).toEqual([1, 2]);

      // Update should be skipped for missing PR
      expect(mockGitHub.updatePullRequestBranch).not.toHaveBeenCalled();
    });
  });

  describe("mergeWeaveUmbrella", () => {
    it("should merge PRs into umbrella and update it", async () => {
      const prs: PR[] = [
        { number: 1, mergeable_state: "clean" },
        { number: 2, mergeable_state: "clean" },
      ];

      const umbrellaPR: PR = { number: 100, mergeable_state: "clean" };

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);
      (mockGitHub.updatePullRequestBranch as any).mockResolvedValue(undefined);

      const result = await mergeWeaveUmbrella("owner", "repo", prs, umbrellaPR, mockGitHub);

      expect(result.merged).toEqual([1, 2]);

      // Umbrella PR should be updated after each merge
      expect(result.updated).toContain(100);
      expect(mockGitHub.updatePullRequestBranch).toHaveBeenCalledWith("owner", "repo", 100);
    });

    it("should not update umbrella when autoUpdateBranches is false", async () => {
      const prs: PR[] = [{ number: 1, mergeable_state: "clean" }];
      const umbrellaPR: PR = { number: 100, mergeable_state: "clean" };

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);

      const result = await mergeWeaveUmbrella("owner", "repo", prs, umbrellaPR, mockGitHub, {
        autoUpdateBranches: false,
      });

      expect(result.merged).toEqual([1]);
      expect(result.updated).toEqual([]);
      expect(mockGitHub.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    it("should handle umbrella update failures gracefully", async () => {
      const prs: PR[] = [{ number: 1, mergeable_state: "clean" }];
      const umbrellaPR: PR = { number: 100, mergeable_state: "clean" };

      (mockGitHub.mergePullRequest as any).mockResolvedValue(true);
      (mockGitHub.updatePullRequestBranch as any).mockRejectedValue(
        new Error("Umbrella update failed")
      );

      const result = await mergeWeaveUmbrella("owner", "repo", prs, umbrellaPR, mockGitHub);

      expect(result.merged).toEqual([1]);
      expect(result.updateFailed).toHaveLength(1);
      expect(result.updateFailed[0].number).toBe(100);
    });
  });
});
