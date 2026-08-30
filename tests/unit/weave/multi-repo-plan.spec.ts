/**
 * Multi-Repo Plan Generator Tests
 *
 * Tests for the multi-repository plan generation functionality.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateMultiRepoPlan, RepoTarget } from "../../../src/core/multiRepoPlan.js";

// Mock the GitHub client and API
vi.mock("../../../src/github/index.js", () => ({
  createGitHubClient: vi.fn(),
}));

import { createGitHubClient } from "../../../src/github/index.js";

describe("Multi-Repo Plan Generator", () => {
  const mockCreateGitHubClient = vi.mocked(createGitHubClient);

  // Mock PR data for each repo
  const mockLexPRs = [
    {
      number: 10,
      title: "Add memory indexing",
      draft: false,
      head: { ref: "feat/memory-index", sha: "abc123" },
      dependencies: [],
      requiredGates: [],
    },
  ];

  const mockLexsonaPRs = [
    {
      number: 20,
      title: "Add constraints derive",
      draft: false,
      head: { ref: "feat/constraints", sha: "def456" },
      dependencies: ["Guffawaffle/lex#10"], // Cross-repo dependency
      requiredGates: [],
    },
  ];

  const mockLexrunnerPRs = [
    {
      number: 30,
      title: "Add multi-repo support",
      draft: false,
      head: { ref: "feat/multi-repo", sha: "ghi789" },
      dependencies: ["Guffawaffle/lexsona#20"], // Cross-repo dependency
      requiredGates: [],
    },
  ];

  function createMockClient(owner: string, repo: string, prs: any[]) {
    return {
      getOwner: () => owner,
      getRepo: () => repo,
      validateRepository: vi.fn().mockResolvedValue({ defaultBranch: "main" }),
      listOpenPRs: vi.fn().mockResolvedValue(prs),
      getPRDetails: vi.fn().mockImplementation((prNum: number) => {
        const pr = prs.find((p) => p.number === prNum);
        return Promise.resolve(pr);
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock clients for each repo
    mockCreateGitHubClient.mockImplementation(async (opts: any) => {
      const { owner, repo } = opts;
      if (owner === "Guffawaffle" && repo === "lex") {
        return createMockClient(owner, repo, mockLexPRs) as any;
      } else if (owner === "Guffawaffle" && repo === "lexsona") {
        return createMockClient(owner, repo, mockLexsonaPRs) as any;
      } else if (owner === "Guffawaffle" && repo === "lexrunner") {
        return createMockClient(owner, repo, mockLexrunnerPRs) as any;
      }
      return createMockClient(owner, repo, []) as any;
    });
  });

  describe("generateMultiRepoPlan", () => {
    it("discovers PRs from multiple repositories", async () => {
      const repos: RepoTarget[] = [
        { owner: "Guffawaffle", repo: "lex", priority: 1 },
        { owner: "Guffawaffle", repo: "lexsona", priority: 2 },
        { owner: "Guffawaffle", repo: "lexrunner", priority: 3 },
      ];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint", "test"] },
      });

      expect(plan.items.length).toBe(3);
      expect(plan.schemaVersion).toBe("1.0.0");
    });

    it("generates item names with owner/repo#PR format", async () => {
      const repos: RepoTarget[] = [{ owner: "Guffawaffle", repo: "lex", priority: 1 }];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint", "test"] },
      });

      expect(plan.items[0].name).toBe("Guffawaffle/lex#PR-10");
    });

    it("resolves cross-repo dependencies", async () => {
      const repos: RepoTarget[] = [
        { owner: "Guffawaffle", repo: "lex", priority: 1 },
        { owner: "Guffawaffle", repo: "lexsona", priority: 2 },
      ];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint", "test"] },
      });

      // Find the lexsona PR
      const lexsonaPR = plan.items.find((item) => item.name.includes("lexsona"));

      expect(lexsonaPR).toBeDefined();
      expect(lexsonaPR!.deps).toContain("Guffawaffle/lex#PR-10");
    });

    it("sorts items by repo priority then PR number", async () => {
      const repos: RepoTarget[] = [
        { owner: "Guffawaffle", repo: "lexrunner", priority: 3 },
        { owner: "Guffawaffle", repo: "lex", priority: 1 },
        { owner: "Guffawaffle", repo: "lexsona", priority: 2 },
      ];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint", "test"] },
      });

      // Should be sorted by priority: lex (1), lexsona (2), lexrunner (3)
      expect(plan.items[0].name).toContain("lex#");
      expect(plan.items[1].name).toContain("lexsona#");
      expect(plan.items[2].name).toContain("lexrunner#");
    });

    it("adds repo context to gate environment variables", async () => {
      const repos: RepoTarget[] = [{ owner: "Guffawaffle", repo: "lex", priority: 1 }];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint"] },
      });

      const lintGate = plan.items[0].gates.find((g) => g.name === "lint");
      expect(lintGate?.env?.REPO_OWNER).toBe("Guffawaffle");
      expect(lintGate?.env?.REPO_NAME).toBe("lex");
    });

    it("pins realistic timeouts only for standard test gates", async () => {
      const repos: RepoTarget[] = [{ owner: "Guffawaffle", repo: "lex", priority: 1 }];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint", "test", "unit", "custom"] },
      });

      const gates = new Map(plan.items[0].gates.map((gate) => [gate.name, gate]));
      expect(gates.get("test")).toMatchObject({
        run: "npm test",
        artifacts: ["test-results.xml", "coverage/"],
        timeoutMs: 300_000,
      });
      expect(gates.get("unit")).toMatchObject({
        run: "npm test",
        artifacts: ["test-results.xml", "coverage/"],
        timeoutMs: 300_000,
      });
      expect(gates.get("lint")?.timeoutMs).toBeUndefined();
      expect(gates.get("custom")?.timeoutMs).toBeUndefined();
    });

    it("returns empty plan when no PRs found", async () => {
      mockCreateGitHubClient.mockImplementation(async (opts: any) => {
        return createMockClient(opts.owner, opts.repo, []) as any;
      });

      const repos: RepoTarget[] = [{ owner: "Guffawaffle", repo: "empty-repo", priority: 1 }];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint", "test"] },
      });

      expect(plan.items.length).toBe(0);
    });

    it("throws error for empty repos array", async () => {
      await expect(generateMultiRepoPlan([], {})).rejects.toThrow(
        "At least one repository is required"
      );
    });

    it("uses default priority of 1 when not specified", async () => {
      const repos: RepoTarget[] = [
        { owner: "Guffawaffle", repo: "lex" }, // No priority specified
      ];

      const plan = await generateMultiRepoPlan(repos, {
        policy: { requiredGates: ["lint"] },
      });

      // Should work without explicit priority
      expect(plan.items.length).toBe(1);
    });

    it("applies label filters across all repos", async () => {
      const repos: RepoTarget[] = [
        { owner: "Guffawaffle", repo: "lex", priority: 1 },
        { owner: "Guffawaffle", repo: "lexsona", priority: 2 },
      ];

      await generateMultiRepoPlan(repos, {
        labels: ["ready-to-merge"],
        policy: { requiredGates: ["lint"] },
      });

      // Verify listOpenPRs was called with labels
      const firstClient = await mockCreateGitHubClient.mock.results[0].value;
      expect(firstClient.listOpenPRs).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ["ready-to-merge"] })
      );
    });

    it("applies policy settings to all items", async () => {
      const repos: RepoTarget[] = [{ owner: "Guffawaffle", repo: "lex", priority: 1 }];

      const plan = await generateMultiRepoPlan(repos, {
        policy: {
          requiredGates: ["lint", "test", "typecheck"],
          maxWorkers: 4,
        },
      });

      expect(plan.policy?.requiredGates).toEqual(["lint", "test", "typecheck"]);
      expect(plan.policy?.maxWorkers).toBe(4);
    });
  });
});
