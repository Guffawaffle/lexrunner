import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseIssueRef, parseIssueRefs, batchGetIssues } from "../../../src/github/batch-ops.js";
import type { GitHubClient } from "../../../src/github/client.js";
import type { GitHubIssue } from "../../../src/github/types.js";

describe("parseIssueRef", () => {
  it("parses simple issue reference with current repo", () => {
    const refs = parseIssueRef("#123", "owner", "repo");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      owner: "owner",
      repo: "repo",
      number: 123,
      key: "owner/repo#123",
    });
  });

  it("parses issue reference with repo only", () => {
    const refs = parseIssueRef("myrepo#456", "owner", "defaultrepo");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      owner: "owner",
      repo: "myrepo",
      number: 456,
      key: "owner/myrepo#456",
    });
  });

  it("parses full issue reference", () => {
    const refs = parseIssueRef("otherowner/otherrepo#789", "owner", "repo");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      owner: "otherowner",
      repo: "otherrepo",
      number: 789,
      key: "otherowner/otherrepo#789",
    });
  });

  it("parses issue range with current repo", () => {
    const refs = parseIssueRef("#100-103", "owner", "repo");
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({
      owner: "owner",
      repo: "repo",
      number: 100,
      key: "owner/repo#100",
    });
    expect(refs[3]).toEqual({
      owner: "owner",
      repo: "repo",
      number: 103,
      key: "owner/repo#103",
    });
  });

  it("parses issue range with repo only", () => {
    const refs = parseIssueRef("myrepo#200-202", "owner", "defaultrepo");
    expect(refs).toHaveLength(3);
    expect(refs[0].key).toBe("owner/myrepo#200");
    expect(refs[2].key).toBe("owner/myrepo#202");
  });

  it("throws error for invalid format", () => {
    expect(() => parseIssueRef("invalid", "owner", "repo")).toThrow(
      "Invalid issue reference format"
    );
  });
});

describe("parseIssueRefs", () => {
  it("parses multiple issue references", () => {
    const refs = parseIssueRefs(
      ["#123", "repo#456", "owner/repo#789"],
      "defaultowner",
      "defaultrepo"
    );
    expect(refs).toHaveLength(3);
    expect(refs[0].key).toBe("defaultowner/defaultrepo#123");
    expect(refs[1].key).toBe("defaultowner/repo#456");
    expect(refs[2].key).toBe("owner/repo#789");
  });

  it("expands ranges in multiple references", () => {
    const refs = parseIssueRefs(["#100-102", "#200"], "owner", "repo");
    expect(refs).toHaveLength(4);
    expect(refs[0].key).toBe("owner/repo#100");
    expect(refs[1].key).toBe("owner/repo#101");
    expect(refs[2].key).toBe("owner/repo#102");
    expect(refs[3].key).toBe("owner/repo#200");
  });
});

describe("batchGetIssues", () => {
  let mockClient: GitHubClient;
  let mockIssues: Map<string, GitHubIssue>;

  beforeEach(() => {
    mockIssues = new Map([
      [
        "owner/repo#1",
        {
          number: 1,
          title: "Test Issue 1",
          body: "Description 1",
          state: "open" as const,
          labels: [],
          user: { login: "user1" },
          assignees: [],
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
      [
        "owner/repo#2",
        {
          number: 2,
          title: "Test Issue 2",
          body: "Description 2",
          state: "closed" as const,
          labels: [],
          user: { login: "user2" },
          assignees: [],
          createdAt: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ],
    ]);

    mockClient = {
      getOctokit: vi.fn().mockReturnValue({
        rest: {
          issues: {
            get: vi.fn().mockImplementation(({ issue_number }: { issue_number: number }) => {
              const key = `owner/repo#${issue_number}`;
              const issue = mockIssues.get(key);
              if (!issue) {
                const error: any = new Error("Not found");
                error.status = 404;
                throw error;
              }
              return { data: issue };
            }),
          },
        },
      }),
      getOwner: vi.fn().mockReturnValue("owner"),
      getRepo: vi.fn().mockReturnValue("repo"),
    } as any;
  });

  it("fetches multiple issues in parallel", async () => {
    const refs = parseIssueRefs(["#1", "#2"], "owner", "repo");
    const result = await batchGetIssues(mockClient, refs);

    expect(result.issues.size).toBe(2);
    expect(result.issues.get("owner/repo#1")?.title).toBe("Test Issue 1");
    expect(result.issues.get("owner/repo#2")?.title).toBe("Test Issue 2");
    expect(result.errors.size).toBe(0);
  });

  it("handles missing issues gracefully", async () => {
    const refs = parseIssueRefs(["#1", "#999"], "owner", "repo");
    const result = await batchGetIssues(mockClient, refs);

    expect(result.issues.size).toBe(1);
    expect(result.issues.get("owner/repo#1")?.title).toBe("Test Issue 1");
    expect(result.issues.has("owner/repo#999")).toBe(false);
  });

  it("calculates timing correctly", async () => {
    const refs = parseIssueRefs(["#1", "#2"], "owner", "repo");
    const result = await batchGetIssues(mockClient, refs);

    expect(result.timing.parallel).toBeGreaterThanOrEqual(0);
    expect(result.timing.sequential).toBe(400); // 2 issues * 200ms
    expect(result.timing.parallel).toBeLessThanOrEqual(result.timing.sequential);
  });
});
