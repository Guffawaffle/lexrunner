/**
 * Integration test for MCP plan.create with scope.yml auto-detection
 * Tests end-to-end behavior of GitHub mode auto-detection from scope.yml
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generatePlanFromGitHub } from "../src/core/githubPlan.js";
import { detectGitHubMode } from "../src/core/inputs.js";

describe("MCP Plan.Create with Scope.yml Auto-Detection", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-mcp-test-"));
    fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Integration: scope.yml with GitHub discovery", () => {
    it("should auto-detect GitHub mode and discover PRs when scope.yml has labels", async () => {
      // Setup: Create scope.yml with label filters
      const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: ["ready-merge"]
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
      fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), scopeContent);

      // Verify detection
      const detection = detectGitHubMode(tempDir);
      expect(detection.shouldUseGitHub).toBe(true);
      expect(detection.scopeConfig?.labels).toEqual(["ready-merge"]);

      // Mock GitHub client
      const mockClient = {
        getBranchHead: vi.fn().mockResolvedValue("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 101,
            title: "Feature PR",
            body: "Ready to merge",
            head: { ref: "feature-101", sha: "bd9a944306b6a41cb61302f67ffac4f26ee38088" },
            base: { ref: "main", sha: "0b3d8b29493059afd7f9912106279c4643ac4939" },
            state: "open",
            labels: ["ready-merge"],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
          {
            number: 102,
            title: "Another PR",
            body: "Also ready",
            head: { ref: "feature-102", sha: "91ae0b1b64ca2b8cbaa6c9ba90ae17a861c3afe8" },
            base: { ref: "main", sha: "0b3d8b29493059afd7f9912106279c4643ac4939" },
            state: "open",
            labels: ["ready-merge"],
            draft: false,
            mergeable: true,
            user: { login: "dev2" },
            createdAt: "2023-01-03T00:00:00Z",
            updatedAt: "2023-01-04T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn().mockImplementation((prNumber: number) => {
          if (prNumber === 101) {
            return Promise.resolve({
              number: 101,
              title: "Feature PR",
              body: "Ready to merge",
              head: { ref: "feature-101", sha: "bd9a944306b6a41cb61302f67ffac4f26ee38088" },
              base: { ref: "main", sha: "0b3d8b29493059afd7f9912106279c4643ac4939" },
              state: "open",
              labels: ["ready-merge"],
              draft: false,
              mergeable: true,
              user: { login: "dev1" },
              createdAt: "2023-01-01T00:00:00Z",
              updatedAt: "2023-01-02T00:00:00Z",
              dependencies: [],
              tags: [],
              requiredGates: [],
            });
          } else if (prNumber === 102) {
            return Promise.resolve({
              number: 102,
              title: "Another PR",
              body: "Also ready",
              head: { ref: "feature-102", sha: "91ae0b1b64ca2b8cbaa6c9ba90ae17a861c3afe8" },
              base: { ref: "main", sha: "0b3d8b29493059afd7f9912106279c4643ac4939" },
              state: "open",
              labels: ["ready-merge"],
              draft: false,
              mergeable: true,
              user: { login: "dev2" },
              createdAt: "2023-01-03T00:00:00Z",
              updatedAt: "2023-01-04T00:00:00Z",
              dependencies: [],
              tags: [],
              requiredGates: [],
            });
          }
          throw new Error(`Unexpected PR number: ${prNumber}`);
        }),
        getOwner: vi.fn().mockReturnValue("testowner"),
        getRepo: vi.fn().mockReturnValue("testrepo"),
      };

      // Generate plan using detected config
      const plan = await generatePlanFromGitHub(mockClient as any, {
        labels: detection.scopeConfig?.labels,
        target: detection.scopeConfig?.target,
        policy: {
          requiredGates: ["lint", "typecheck", "test"],
          maxWorkers: 2,
        },
      });

      // Verify plan was generated correctly
      expect(plan.items).toHaveLength(2);
      expect(plan.items[0].name).toBe("PR-101");
      expect(plan.items[1].name).toBe("PR-102");
      expect(plan.target).toBe("main");
      expect(plan.schemaVersion).toBe("1.0.1");
    });

    it("should auto-detect GitHub mode with query from scope.yml", async () => {
      // Setup: Create scope.yml with query
      const scopeContent = `version: 1
target: staging
sources:
  - query: "is:open label:stack:*"
selectors:
  include_labels: []
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: staging
pin_commits: false
`;
      fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), scopeContent);

      // Verify detection
      const detection = detectGitHubMode(tempDir);
      expect(detection.shouldUseGitHub).toBe(true);
      expect(detection.scopeConfig?.query).toBe("is:open label:stack:*");
      expect(detection.scopeConfig?.target).toBe("staging");
    });

    it("should NOT auto-detect when scope.yml has no filters", async () => {
      // Setup: Create scope.yml without filters
      const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: []
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
      fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), scopeContent);

      // Verify NO detection
      const detection = detectGitHubMode(tempDir);
      expect(detection.shouldUseGitHub).toBe(false);
    });

    it("should handle empty plan when no PRs match scope.yml filters", async () => {
      // Setup: Create scope.yml with label filters
      const scopeContent = `version: 1
target: main
sources: []
selectors:
  include_labels: ["ready-merge"]
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
      fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), scopeContent);

      // Verify detection
      const detection = detectGitHubMode(tempDir);
      expect(detection.shouldUseGitHub).toBe(true);

      // Mock GitHub client with NO matching PRs
      const mockClient = {
        getBranchHead: vi.fn().mockResolvedValue("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([]),
        getPRDetails: vi.fn(),
        getOwner: vi.fn().mockReturnValue("testowner"),
        getRepo: vi.fn().mockReturnValue("testrepo"),
      };

      // Generate plan using detected config
      const plan = await generatePlanFromGitHub(mockClient as any, {
        labels: detection.scopeConfig?.labels,
        target: detection.scopeConfig?.target,
      });

      // Verify empty plan
      expect(plan.items).toHaveLength(0);
      expect(plan.target).toBe("main");
      expect(plan.schemaVersion).toBe("1.0.1");
    });

    it("should merge scope.yml filters with explicit parameters (explicit takes precedence)", async () => {
      // Setup: Create scope.yml with label filters
      const scopeContent = `version: 1
target: main
sources:
  - query: "is:open label:stack:*"
selectors:
  include_labels: ["ready-merge"]
  exclude_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`;
      fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), scopeContent);

      const detection = detectGitHubMode(tempDir);
      expect(detection.shouldUseGitHub).toBe(true);

      // Simulate MCP call with explicit parameters that override scope.yml
      const explicitLabels = ["priority:high"];
      const explicitTarget = "develop";

      // Mock GitHub client
      const mockClient = {
        getBranchHead: vi.fn().mockResolvedValue("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 201,
            title: "High priority PR",
            body: "Urgent fix",
            head: { ref: "hotfix-201", sha: "aed2378902405ce12c433d3225416dcc91be5519" },
            base: { ref: "develop", sha: "31a28f6a184782b392d17310fadfa6880605184b" },
            state: "open",
            labels: ["priority:high"],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn().mockResolvedValue({
          number: 201,
          title: "High priority PR",
          body: "Urgent fix",
          head: { ref: "hotfix-201", sha: "aed2378902405ce12c433d3225416dcc91be5519" },
          base: { ref: "develop", sha: "31a28f6a184782b392d17310fadfa6880605184b" },
          state: "open",
          labels: ["priority:high"],
          draft: false,
          mergeable: true,
          user: { login: "dev1" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        }),
        getOwner: vi.fn().mockReturnValue("testowner"),
        getRepo: vi.fn().mockReturnValue("testrepo"),
      };

      // Explicit parameters override scope.yml
      const plan = await generatePlanFromGitHub(mockClient as any, {
        labels: explicitLabels, // Overrides scope.yml's ["ready-merge"]
        target: explicitTarget, // Overrides scope.yml's "main"
      });

      // Verify explicit parameters were used
      expect(plan.items).toHaveLength(1);
      expect(plan.items[0].name).toBe("PR-201");
      expect(plan.target).toBe("develop");
    });
  });
});
