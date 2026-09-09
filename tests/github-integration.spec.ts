/**
 * GitHub API integration tests
 * Tests GitHub client functionality with mocked API responses
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClientImpl } from "../src/github/client.js";
import { generatePlanFromGitHub } from "../src/core/githubPlan.js";
import { PullRequest, PullRequestDetails } from "../src/github/index.js";

// Mock Octokit
const mockOctokit = {
  rest: {
    repos: {
      get: vi.fn(),
    },
    pulls: {
      list: vi.fn(),
      get: vi.fn(),
      listFiles: vi.fn(),
    },
  },
};

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    return mockOctokit;
  }),
}));

describe("GitHub Integration", () => {
  let client: GitHubClientImpl;

  beforeEach(() => {
    vi.clearAllMocks();

    client = new GitHubClientImpl({
      owner: "testowner",
      repo: "testrepo",
    });
  });

  describe("GitHubClient", () => {
    it("should validate repository successfully", async () => {
      mockOctokit.rest.repos.get.mockResolvedValue({
        data: {
          default_branch: "main",
          html_url: "https://github.com/testowner/testrepo",
        },
      });

      const repoInfo = await client.validateRepository();

      expect(repoInfo).toEqual({
        owner: "testowner",
        repo: "testrepo",
        defaultBranch: "main",
        url: "https://github.com/testowner/testrepo",
      });
    });

    it("should normalize repository name with different casing", async () => {
      // Client is created with lowercase repo name
      const clientWithLowercase = new GitHubClientImpl({
        owner: "guffawaffle",
        repo: "lexrunner",
      });

      // Mock GitHub API response with canonical casing
      mockOctokit.rest.repos.get.mockResolvedValueOnce({
        data: {
          owner: { login: "Guffawaffle" },
          name: "LexRunner",
          default_branch: "main",
          html_url: "https://github.com/Guffawaffle/LexRunner",
        },
      });

      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });

      // When listing PRs, the client should normalize to canonical casing
      await clientWithLowercase.listOpenPRs();

      // Verify that repos.get was called for normalization
      expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({
        owner: "guffawaffle",
        repo: "lexrunner",
      });

      // Verify that pulls.list was called with normalized casing
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: "Guffawaffle",
        repo: "LexRunner",
        state: "open",
        sort: "created",
        direction: "desc",
        per_page: 30,
        page: 1,
      });

      // Verify getOwner and getRepo return normalized values
      expect(clientWithLowercase.getOwner()).toBe("Guffawaffle");
      expect(clientWithLowercase.getRepo()).toBe("LexRunner");
    });

    it("should list open PRs with default options", async () => {
      const mockPRs = [
        {
          number: 123,
          title: "Feature A",
          body: "Implements feature A",
          head: { ref: "feature-a", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [{ name: "enhancement", color: "0052cc" }],
          draft: false,
          user: { login: "developer1" },
          created_at: "2023-01-01T00:00:00Z",
          updated_at: "2023-01-02T00:00:00Z",
        },
      ];

      mockOctokit.rest.pulls.list.mockResolvedValue({ data: mockPRs });

      const prs = await client.listOpenPRs();

      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(123);
      expect(prs[0].title).toBe("Feature A");
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: "testowner",
        repo: "testrepo",
        state: "open",
        sort: "created",
        direction: "desc",
        per_page: 30,
        page: 1,
      });
    });

    it("should parse PR dependencies from body", async () => {
      const mockPR: PullRequest = {
        number: 123,
        title: "Feature B",
        body: "Implements feature B\n\nDepends-on: #456, #789\n\nMore description",
        head: { ref: "feature-b", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
        state: "open",
        labels: [],
        draft: false,
        mergeable: true,
        user: { login: "developer1" },
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-02T00:00:00Z",
      };

      const dependencies = await client.getPRDependencies(mockPR);

      expect(dependencies).toEqual(["testowner/testrepo#456", "testowner/testrepo#789"]);
    });

    it("should handle complex dependency formats", async () => {
      const mockPR: PullRequest = {
        number: 123,
        title: "Feature C",
        body: "Depends-on: #456\nDepends-on: otherowner/otherrepo#789, #101",
        head: { ref: "feature-c", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
        state: "open",
        labels: [],
        draft: false,
        mergeable: true,
        user: { login: "developer1" },
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-02T00:00:00Z",
      };

      const dependencies = await client.getPRDependencies(mockPR);

      expect(dependencies).toEqual([
        "otherowner/otherrepo#789",
        "testowner/testrepo#101",
        "testowner/testrepo#456",
      ]);
    });

    it("should return empty dependencies for PR without dependencies", async () => {
      const mockPR: PullRequest = {
        number: 123,
        title: "Independent Feature",
        body: "This feature has no dependencies",
        head: { ref: "independent", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
        state: "open",
        labels: [],
        draft: false,
        mergeable: true,
        user: { login: "developer1" },
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-02T00:00:00Z",
      };

      const dependencies = await client.getPRDependencies(mockPR);

      expect(dependencies).toEqual([]);
    });

    it("should get PR details with all metadata", async () => {
      const mockPRData = {
        number: 123,
        title: "Feature with Gates",
        body: "Feature description\n\nDepends-on: #456\nRequired-gates: lint, test, custom",
        head: { ref: "feature", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
        state: "open",
        labels: [
          { name: "stack:feature", color: "0052cc" },
          { name: "gate:typecheck", color: "ff0000" },
        ],
        draft: false,
        user: { login: "developer1" },
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2023-01-02T00:00:00Z",
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({ data: mockPRData });

      const prDetails = await client.getPRDetails(123);

      expect(prDetails.number).toBe(123);
      expect(prDetails.dependencies).toEqual(["testowner/testrepo#456"]);
      expect(prDetails.tags).toEqual(["feature"]);
      expect(prDetails.requiredGates).toEqual(["custom", "lint", "test", "typecheck"]);
    });
  });

  describe("GitHub Plan Generation", () => {
    it("should generate plan from GitHub PRs", async () => {
      // Mock repository validation
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 123,
            title: "Feature A",
            body: "Base feature",
            head: { ref: "feature-a", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
          {
            number: 456,
            title: "Feature B",
            body: "Depends on A\n\nDepends-on: #123",
            head: { ref: "feature-b", sha: "def789" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev2" },
            createdAt: "2023-01-03T00:00:00Z",
            updatedAt: "2023-01-04T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn(),
      };

      // Mock PR details calls
      mockClient.getPRDetails
        .mockResolvedValueOnce({
          number: 123,
          title: "Feature A",
          body: "Base feature",
          head: { ref: "feature-a", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev1" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        })
        .mockResolvedValueOnce({
          number: 456,
          title: "Feature B",
          body: "Depends on A\n\nDepends-on: #123",
          head: { ref: "feature-b", sha: "def789" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev2" },
          createdAt: "2023-01-03T00:00:00Z",
          updatedAt: "2023-01-04T00:00:00Z",
          dependencies: ["testowner/testrepo#123"],
          tags: [],
          requiredGates: [],
        });

      const plan = await generatePlanFromGitHub(mockClient as any, {
        policy: {
          requiredGates: ["build", "lint", "test", "unit"],
          maxWorkers: 2,
        },
      });

      expect(plan.schemaVersion).toBe("1.0.0");
      expect(plan.target).toBe("main");
      expect(plan.items).toHaveLength(2);

      // Check items are sorted by name
      expect(plan.items[0].name).toBe("PR-123");
      expect(plan.items[1].name).toBe("PR-456");

      // Check dependencies
      expect(plan.items[0].deps).toEqual([]);
      expect(plan.items[1].deps).toEqual(["PR-123"]);

      // Check gates
      expect(plan.items[0].gates).toHaveLength(4);
      expect(plan.items[0].gates.map((g) => g.name)).toEqual(["build", "lint", "test", "unit"]);
      expect(plan.items[0].gates.find((gate) => gate.name === "test")?.timeoutMs).toBe(300_000);
      expect(plan.items[0].gates.find((gate) => gate.name === "unit")?.timeoutMs).toBe(300_000);
      expect(plan.items[0].gates.find((gate) => gate.name === "lint")?.timeoutMs).toBeUndefined();
      expect(plan.items[0].gates.find((gate) => gate.name === "build")?.run).toBe("npm run build");

      // Check policy
      expect(plan.policy).toBeDefined();
      expect(plan.policy?.requiredGates).toEqual(["build", "lint", "test", "unit"]);
      expect(plan.policy?.maxWorkers).toBe(2);
    });

    it("should generate empty plan when no PRs found", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([]),
      };

      const plan = await generatePlanFromGitHub(mockClient as any);

      expect(plan.schemaVersion).toBe("1.0.0");
      expect(plan.target).toBe("main");
      expect(plan.items).toHaveLength(0);
    });

    it("should filter out draft PRs when includeDrafts is false", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 123,
            title: "Draft PR",
            body: "Work in progress",
            head: { ref: "draft", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: true,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
        ]),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        includeDrafts: false,
      });

      expect(plan.items).toHaveLength(0);
    });

    it("should exclude specific PRs when excludePRs is provided", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 123,
            title: "Feature A",
            body: "Base feature",
            head: { ref: "feature-a", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
          {
            number: 154,
            title: "Integration PR",
            body: "Integration branch",
            head: { ref: "integration", sha: "int123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev2" },
            createdAt: "2023-01-02T00:00:00Z",
            updatedAt: "2023-01-03T00:00:00Z",
          },
          {
            number: 456,
            title: "Feature B",
            body: "Another feature",
            head: { ref: "feature-b", sha: "def789" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev3" },
            createdAt: "2023-01-04T00:00:00Z",
            updatedAt: "2023-01-05T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn(),
      };

      // Mock PR details for non-excluded PRs only
      mockClient.getPRDetails
        .mockResolvedValueOnce({
          number: 123,
          title: "Feature A",
          body: "Base feature",
          head: { ref: "feature-a", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev1" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        })
        .mockResolvedValueOnce({
          number: 456,
          title: "Feature B",
          body: "Another feature",
          head: { ref: "feature-b", sha: "def789" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev3" },
          createdAt: "2023-01-04T00:00:00Z",
          updatedAt: "2023-01-05T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        });

      const plan = await generatePlanFromGitHub(mockClient as any, {
        excludePRs: [154],
        policy: {
          requiredGates: ["lint", "test"],
          maxWorkers: 2,
        },
      });

      expect(plan.items).toHaveLength(2);
      expect(plan.items[0].name).toBe("PR-123");
      expect(plan.items[1].name).toBe("PR-456");
      // Verify PR-154 is not in the plan
      expect(plan.items.find((item) => item.name === "PR-154")).toBeUndefined();
    });

    it("should exclude multiple PRs when excludePRs contains multiple numbers", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 100,
            title: "PR 100",
            body: "Feature",
            head: { ref: "pr-100", sha: "sha100" },
            base: { ref: "main", sha: "mainsha" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
          {
            number: 101,
            title: "PR 101",
            body: "Feature",
            head: { ref: "pr-101", sha: "sha101" },
            base: { ref: "main", sha: "mainsha" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev2" },
            createdAt: "2023-01-02T00:00:00Z",
            updatedAt: "2023-01-03T00:00:00Z",
          },
          {
            number: 102,
            title: "PR 102",
            body: "Feature",
            head: { ref: "pr-102", sha: "sha102" },
            base: { ref: "main", sha: "mainsha" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev3" },
            createdAt: "2023-01-03T00:00:00Z",
            updatedAt: "2023-01-04T00:00:00Z",
          },
          {
            number: 103,
            title: "PR 103",
            body: "Feature",
            head: { ref: "pr-103", sha: "sha103" },
            base: { ref: "main", sha: "mainsha" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev4" },
            createdAt: "2023-01-04T00:00:00Z",
            updatedAt: "2023-01-05T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn(),
      };

      // Mock PR details for non-excluded PRs only (100 and 102)
      mockClient.getPRDetails
        .mockResolvedValueOnce({
          number: 100,
          title: "PR 100",
          body: "Feature",
          head: { ref: "pr-100", sha: "sha100" },
          base: { ref: "main", sha: "mainsha" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev1" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        })
        .mockResolvedValueOnce({
          number: 102,
          title: "PR 102",
          body: "Feature",
          head: { ref: "pr-102", sha: "sha102" },
          base: { ref: "main", sha: "mainsha" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev3" },
          createdAt: "2023-01-03T00:00:00Z",
          updatedAt: "2023-01-04T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        });

      const plan = await generatePlanFromGitHub(mockClient as any, {
        excludePRs: [101, 103],
      });

      expect(plan.items).toHaveLength(2);
      expect(plan.items[0].name).toBe("PR-100");
      expect(plan.items[1].name).toBe("PR-102");
      expect(plan.items.find((item) => item.name === "PR-101")).toBeUndefined();
      expect(plan.items.find((item) => item.name === "PR-103")).toBeUndefined();
    });

    it("should handle excludePRs with empty array", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 123,
            title: "Feature A",
            body: "Base feature",
            head: { ref: "feature-a", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn().mockResolvedValue({
          number: 123,
          title: "Feature A",
          body: "Base feature",
          head: { ref: "feature-a", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev1" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        }),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        excludePRs: [],
      });

      expect(plan.items).toHaveLength(1);
      expect(plan.items[0].name).toBe("PR-123");
    });
  });

  describe("GitHub Plan with File Analysis", () => {
    it("should analyze file changes for GitHub PRs", async () => {
      // Reset and setup mock
      vi.resetAllMocks();

      const localMockOctokit = {
        rest: {
          pulls: {
            listFiles: vi.fn(),
          },
        },
      };

      // Mock file changes implementation
      localMockOctokit.rest.pulls.listFiles.mockImplementation(async ({ pull_number }: any) => {
        if (pull_number === 201) {
          return {
            data: [
              {
                filename: "src/shared.ts",
                status: "modified",
                additions: 20,
                deletions: 10,
                changes: 30,
              },
            ],
          };
        } else if (pull_number === 202) {
          return {
            data: [
              {
                filename: "src/shared.ts",
                status: "modified",
                additions: 15,
                deletions: 8,
                changes: 23,
              },
            ],
          };
        }
        return { data: [] };
      });

      // Mock client with required methods
      const mockClient = {
        listOpenPRs: vi.fn(),
        getPRDetails: vi.fn(),
        getPRDependencies: vi.fn(),
        validateRepository: vi.fn(),
        getOctokit: vi.fn(() => localMockOctokit),
        getOwner: vi.fn(() => "testowner"),
        getRepo: vi.fn(() => "testrepo"),
      };

      // Mock PR details
      const pr1: PullRequestDetails = {
        number: 201,
        title: "Feature A",
        body: "Implements feature A",
        head: { ref: "feature-a", sha: "sha201" },
        base: { ref: "main", sha: "main-sha" },
        state: "open",
        labels: [],
        draft: false,
        mergeable: true,
        user: { login: "dev1" },
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-02T00:00:00Z",
        dependencies: [],
        tags: [],
        requiredGates: [],
      };

      const pr2: PullRequestDetails = {
        number: 202,
        title: "Feature B",
        body: "Implements feature B",
        head: { ref: "feature-b", sha: "sha202" },
        base: { ref: "main", sha: "main-sha" },
        state: "open",
        labels: [],
        draft: false,
        mergeable: true,
        user: { login: "dev2" },
        createdAt: "2023-01-03T00:00:00Z",
        updatedAt: "2023-01-04T00:00:00Z",
        dependencies: [],
        tags: [],
        requiredGates: [],
      };

      const { analyzeGitHubPRFiles } = await import("../src/core/githubPlan.js");
      const analysis = await analyzeGitHubPRFiles(mockClient as any, [pr1, pr2]);

      expect(analysis.fileIntersections).toHaveLength(1);
      expect(analysis.fileIntersections[0].prs).toEqual(["PR-201", "PR-202"]);
      expect(analysis.fileIntersections[0].files).toEqual(["src/shared.ts"]);
      expect(analysis.suggestions).toHaveLength(1);
      expect(analysis.conflicts).toHaveLength(1);
    });
  });
});
