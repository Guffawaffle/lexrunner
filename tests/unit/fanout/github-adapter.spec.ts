/**
 * Unit tests for HarvestGitHubAdapter
 *
 * Tests the adapter that wraps GitHubClient for harvest-specific operations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HarvestGitHubAdapter } from "../../../src/fanout/github-adapter.js";
import type { GitHubClient } from "../../../src/github/client.js";

describe("HarvestGitHubAdapter", () => {
  // Mock Octokit
  const mockOctokit = {
    rest: {
      repos: {
        get: vi.fn(),
        getBranch: vi.fn(),
        getCombinedStatusForRef: vi.fn(),
        compareCommits: vi.fn(),
      },
      issues: {
        listForRepo: vi.fn(),
        listComments: vi.fn(),
      },
      pulls: {
        list: vi.fn(),
        get: vi.fn(),
        listFiles: vi.fn(),
        listReviewComments: vi.fn(),
      },
    },
  };

  // Mock GitHubClient
  const mockClient: GitHubClient = {
    getOctokit: () => mockOctokit,
    getOwner: () => "testowner",
    getRepo: () => "testrepo",
    listOpenPRs: vi.fn(),
    getPRDetails: vi.fn(),
    getPRDependencies: vi.fn(),
    validateRepository: vi.fn(),
    listIssues: vi.fn(),
    getPRDiff: vi.fn(),
    getPRFiles: vi.fn(),
  };

  let adapter: HarvestGitHubAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new HarvestGitHubAdapter(mockClient);
  });

  describe("getRepository", () => {
    it("should return default branch", async () => {
      mockOctokit.rest.repos.get.mockResolvedValue({
        data: { default_branch: "main" },
      });

      const result = await adapter.getRepository();
      expect(result.default_branch).toBe("main");
      expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
      });
    });
  });

  describe("getBranch", () => {
    it("should return branch commit SHA", async () => {
      mockOctokit.rest.repos.getBranch.mockResolvedValue({
        data: { commit: { sha: "abc123" } },
      });

      const result = await adapter.getBranch("main");
      expect(result.commit.sha).toBe("abc123");
      expect(mockOctokit.rest.repos.getBranch).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        branch: "main",
      });
    });
  });

  describe("listIssues", () => {
    it("should list issues with default options", async () => {
      mockOctokit.rest.issues.listForRepo.mockResolvedValue({
        data: [{ number: 1, title: "Test issue" }],
      });

      const result = await adapter.listIssues();
      expect(result).toHaveLength(1);
      expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        state: "open",
        labels: undefined,
        per_page: 100,
      });
    });

    it("should pass filter options", async () => {
      mockOctokit.rest.issues.listForRepo.mockResolvedValue({ data: [] });

      await adapter.listIssues({ state: "closed", labels: "bug,urgent", per_page: 50 });
      expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        state: "closed",
        labels: "bug,urgent",
        per_page: 50,
      });
    });
  });

  describe("listIssueComments", () => {
    it("should list comments for an issue", async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{ id: 1, body: "Comment 1" }],
      });

      const result = await adapter.listIssueComments(123);
      expect(result).toHaveLength(1);
      expect(mockOctokit.rest.issues.listComments).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        issue_number: 123,
        per_page: 100,
      });
    });
  });

  describe("listPullRequests", () => {
    it("should list PRs with default options", async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 1, title: "Test PR" }],
      });

      const result = await adapter.listPullRequests();
      expect(result).toHaveLength(1);
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        state: "open",
        per_page: 100,
      });
    });
  });

  describe("getPullRequest", () => {
    it("should get single PR details", async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { number: 456, title: "PR 456", head: { sha: "abc" }, base: { sha: "def" } },
      });

      const result = await adapter.getPullRequest(456);
      expect(result.number).toBe(456);
    });
  });

  describe("listPullRequestFiles", () => {
    it("should list files changed in PR", async () => {
      mockOctokit.rest.pulls.listFiles.mockResolvedValue({
        data: [
          { filename: "src/file1.ts", status: "modified" },
          { filename: "src/file2.ts", status: "added" },
        ],
      });

      const result = await adapter.listPullRequestFiles(123);
      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe("src/file1.ts");
    });
  });

  describe("getCombinedStatus", () => {
    it("should get combined status for a SHA", async () => {
      mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({
        data: {
          state: "success",
          total_count: 3,
          statuses: [{ state: "success" }, { state: "success" }, { state: "success" }],
        },
      });

      const result = await adapter.getCombinedStatus("sha123");
      expect(result.state).toBe("success");
      expect(result.total_count).toBe(3);
    });
  });

  describe("compareCommits", () => {
    it("should compare commits and return merge base", async () => {
      mockOctokit.rest.repos.compareCommits.mockResolvedValue({
        data: { merge_base_commit: { sha: "mergebase123" } },
      });

      const result = await adapter.compareCommits("base", "head");
      expect(result.merge_base_commit?.sha).toBe("mergebase123");
    });
  });
});
