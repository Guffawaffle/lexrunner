/**
 * Tests for token expansion utilities
 */

import { describe, it, expect } from "vitest";
import { expandTokens, getGitContext, type MissingTokenMode } from "../../src/utils/tokens";
import path from "path";

describe("expandTokens", () => {
  it("expands all tokens with single braces", () => {
    const result = expandTokens("idea-{timestamp}/{repo}/{user}/{branch}", {
      timestamp: "2025-11-09T12-00-00",
      repo: "owner/repo",
      user: "alice",
      branch: "main",
    });
    expect(result).toBe("idea-2025-11-09T12-00-00/owner/repo/alice/main");
  });

  it("expands all tokens with double braces", () => {
    const result = expandTokens("idea-{{timestamp}}/{{repo}}/{{user}}/{{branch}}", {
      timestamp: "2025-11-09T12-00-00",
      repo: "owner/repo",
      user: "alice",
      branch: "main",
    });
    expect(result).toBe("idea-2025-11-09T12-00-00/owner/repo/alice/main");
  });

  it("expands commit and author tokens", () => {
    const result = expandTokens("{{commit}}-{{author}}", {
      commit: "abc123",
      author: "Alice Smith",
    });
    expect(result).toBe("abc123-Alice Smith");
  });

  it("handles mixed single and double braces", () => {
    const result = expandTokens("{repo}/{{branch}}", { repo: "owner/repo", branch: "main" });
    expect(result).toBe("owner/repo/main");
  });

  it("handles missing tokens in default mode (empty string)", () => {
    const result = expandTokens("{{repo}}/{{missing}}", { repo: "owner/repo" });
    expect(result).toBe("owner/repo/");
  });

  it("handles missing tokens in skip mode (keeps token)", () => {
    const result = expandTokens("{{repo}}/{{missing}}", { repo: "owner/repo" }, { mode: "skip" });
    expect(result).toBe("owner/repo/{{missing}}");
  });

  it("throws error for missing tokens in error mode", () => {
    expect(() =>
      expandTokens("{{repo}}/{{missing}}", { repo: "owner/repo" }, { mode: "error" })
    ).toThrow("Missing required token: missing");
  });

  it("expands timestamp token with default when not provided", () => {
    const result = expandTokens("{{timestamp}}", {});
    // Should be ISO format with colons and dots replaced
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });

  it("expands date token with default when not provided", () => {
    const result = expandTokens("{{date}}", {});
    // Should be YYYY-MM-DD format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses provided timestamp over default", () => {
    const result = expandTokens("{{timestamp}}", { timestamp: "2025-01-01T00-00-00" });
    expect(result).toBe("2025-01-01T00-00-00");
  });

  it("uses provided date over default", () => {
    const result = expandTokens("{{date}}", { date: "2025-01-01" });
    expect(result).toBe("2025-01-01");
  });

  it("extracts owner from repo when owner not provided", () => {
    const result = expandTokens("{{owner}}/{{repo}}", { repo: "myowner/myrepo" });
    expect(result).toBe("myowner/myowner/myrepo");
  });

  it("uses explicit owner over derived owner", () => {
    const result = expandTokens("{{owner}}", { owner: "explicit", repo: "derived/repo" });
    expect(result).toBe("explicit");
  });

  it("handles empty string for missing tokens in default mode", () => {
    const result = expandTokens("{{repo}}{{user}}{{branch}}", {});
    expect(result).toBe("");
  });

  it("expands multiple instances of same token", () => {
    const result = expandTokens("{{repo}}/{{repo}}/{{repo}}", { repo: "test/repo" });
    expect(result).toBe("test/repo/test/repo/test/repo");
  });

  it("handles complex template with all tokens", () => {
    const result = expandTokens(
      "projects/{{owner}}/{{repo}}/ideas/{{date}}/{{timestamp}}-{{user}}-{{branch}}.json",
      {
        owner: "myorg",
        repo: "myorg/myrepo",
        date: "2025-11-09",
        timestamp: "2025-11-09T12-30-45",
        user: "alice",
        branch: "feature/new-idea",
      }
    );
    expect(result).toBe(
      "projects/myorg/myorg/myrepo/ideas/2025-11-09/2025-11-09T12-30-45-alice-feature/new-idea.json"
    );
  });

  it("does not modify text outside of tokens", () => {
    const result = expandTokens("prefix-{{repo}}-suffix", { repo: "test/repo" });
    expect(result).toBe("prefix-test/repo-suffix");
  });

  it("handles adjacent tokens", () => {
    const result = expandTokens("{{repo}}{{branch}}", { repo: "test", branch: "main" });
    expect(result).toBe("testmain");
  });

  it("handles template with no tokens", () => {
    const result = expandTokens("static/path/file.txt", { repo: "test/repo" });
    expect(result).toBe("static/path/file.txt");
  });
});

describe("getGitContext", () => {
  it("returns git context with branch for valid repo", async () => {
    // Use current repo for testing
    const cwd = path.resolve(__dirname, "../../");
    const context = await getGitContext(cwd);

    // Should have branch property
    expect(context).toHaveProperty("branch");

    // If in a git repo, branch should be a non-empty string
    if (context.branch) {
      expect(typeof context.branch).toBe("string");
      expect(context.branch.length).toBeGreaterThan(0);
    }
  });

  it("returns commit SHA when available", async () => {
    const cwd = path.resolve(__dirname, "../../");
    const context = await getGitContext(cwd);

    // Should have commit property
    if (context.commit) {
      expect(typeof context.commit).toBe("string");
      expect(context.commit.length).toBe(7); // Short SHA
      expect(context.commit).toMatch(/^[a-f0-9]{7}$/);
    }
  });

  it("returns author when available", async () => {
    const cwd = path.resolve(__dirname, "../../");
    const context = await getGitContext(cwd);

    // Should have author property
    if (context.author) {
      expect(typeof context.author).toBe("string");
      expect(context.author.length).toBeGreaterThan(0);
    }
  });

  it("returns repo and owner when remote is configured", async () => {
    const cwd = path.resolve(__dirname, "../../");
    const context = await getGitContext(cwd);

    // Should have repo and owner if remote is configured
    if (context.repo) {
      expect(typeof context.repo).toBe("string");
      expect(context.repo).toContain("/");
      expect(context.owner).toBe(context.repo.split("/")[0]);
    }
  });

  it("returns user when git user is configured", async () => {
    const cwd = path.resolve(__dirname, "../../");
    const context = await getGitContext(cwd);

    // Should have user property if git user is configured
    if (context.user) {
      expect(typeof context.user).toBe("string");
      expect(context.user.length).toBeGreaterThan(0);
    }
  });

  it("returns empty object for non-git directory", async () => {
    const cwd = "/tmp/not-a-git-repo";
    const context = await getGitContext(cwd);

    // Should return empty object on error
    expect(typeof context).toBe("object");
  });

  it("handles relative paths", async () => {
    const context = await getGitContext(".");

    // Should not throw and return object
    expect(typeof context).toBe("object");
  });
});
