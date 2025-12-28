/**
 * Tests for Module Alias Resolver
 *
 * Validates LPR-019: Module aliasing integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveModulePath,
  resolveModulePaths,
  extractCanonicalIds,
  clearResolverCache,
} from "../../src/aliases/resolver.js";

// Mock Lex modules
vi.mock("@smartergpt/lex/aliases", () => ({
  resolveModuleId: vi.fn(async (input: string) => {
    // Simulate Lex's alias resolution
    const aliases: Record<string, string> = {
      "src/cli.ts": "cli/main",
      "src/frames/emitter.ts": "frames/emitter",
      "src/aliases/resolver.ts": "aliases/resolver",
    };

    if (aliases[input]) {
      return {
        canonical: aliases[input],
        original: input,
        source: "alias",
        confidence: 1.0,
      };
    }

    // Exact match
    return {
      canonical: input,
      original: input,
      source: "exact",
      confidence: 1.0,
    };
  }),
  loadAliasTable: vi.fn(() => ({
    aliases: {},
  })),
}));

vi.mock("@smartergpt/lex", () => ({
  loadPolicy: vi.fn(async () => ({
    modules: {
      "cli/main": {},
      "frames/emitter": {},
      "aliases/resolver": {},
    },
  })),
}));

describe("resolveModulePath", () => {
  beforeEach(() => {
    clearResolverCache();
    vi.clearAllMocks();
  });

  it("should pass through PR numbers unchanged", async () => {
    const result = await resolveModulePath("#123");

    expect(result.canonical).toBe("#123");
    expect(result.original).toBe("#123");
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(1.0);
  });

  it("should pass through PR-xxx format unchanged", async () => {
    const result = await resolveModulePath("PR-456");

    expect(result.canonical).toBe("PR-456");
    expect(result.original).toBe("PR-456");
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(1.0);
  });

  it("should resolve file paths through alias system", async () => {
    const result = await resolveModulePath("src/cli.ts");

    expect(result.canonical).toBe("cli/main");
    expect(result.original).toBe("src/cli.ts");
    expect(result.resolved).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it("should handle file paths with slashes", async () => {
    const result = await resolveModulePath("src/frames/emitter.ts");

    expect(result.canonical).toBe("frames/emitter");
    expect(result.original).toBe("src/frames/emitter.ts");
    expect(result.resolved).toBe(true);
  });

  it("should gracefully handle resolution errors", async () => {
    // Mock a resolution error
    const { resolveModuleId } = await import("@smartergpt/lex/aliases");
    vi.mocked(resolveModuleId).mockRejectedValueOnce(new Error("Resolution failed"));

    const result = await resolveModulePath("unknown/path.ts", {
      warnOnUnresolved: false,
    });

    // Should fall back to original path
    expect(result.canonical).toBe("unknown/path.ts");
    expect(result.original).toBe("unknown/path.ts");
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("should respect minimum confidence threshold", async () => {
    // Mock low confidence resolution
    const { resolveModuleId } = await import("@smartergpt/lex/aliases");
    vi.mocked(resolveModuleId).mockResolvedValueOnce({
      canonical: "fuzzy-match",
      original: "fuzzy.ts",
      source: "fuzzy" as const,
      confidence: 0.5,
    });

    const result = await resolveModulePath("fuzzy.ts", {
      minConfidence: 0.9,
      warnOnUnresolved: false,
    });

    // Should fall back to original due to low confidence
    expect(result.canonical).toBe("fuzzy.ts");
    expect(result.original).toBe("fuzzy.ts");
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0.5);
  });
});

describe("resolveModulePaths", () => {
  beforeEach(() => {
    clearResolverCache();
    vi.clearAllMocks();
  });

  it("should resolve multiple paths in parallel", async () => {
    const paths = ["#123", "src/cli.ts", "#456", "src/frames/emitter.ts"];
    const results = await resolveModulePaths(paths);

    expect(results).toHaveLength(4);
    expect(results[0].canonical).toBe("#123"); // PR number
    expect(results[1].canonical).toBe("cli/main"); // File path
    expect(results[2].canonical).toBe("#456"); // PR number
    expect(results[3].canonical).toBe("frames/emitter"); // File path
  });

  it("should handle empty array", async () => {
    const results = await resolveModulePaths([]);
    expect(results).toEqual([]);
  });

  it("should handle mixed paths and identifiers", async () => {
    const paths = ["#100", "PR-200", "src/aliases/resolver.ts", "plain-string"];
    const results = await resolveModulePaths(paths);

    expect(results[0].canonical).toBe("#100");
    expect(results[1].canonical).toBe("PR-200");
    expect(results[2].canonical).toBe("aliases/resolver");
    // plain-string has no slash, treated as identifier
    expect(results[3].canonical).toBe("plain-string");
  });
});

describe("extractCanonicalIds", () => {
  it("should extract canonical IDs from resolutions", async () => {
    const paths = ["#123", "src/cli.ts", "src/frames/emitter.ts"];
    const resolutions = await resolveModulePaths(paths);
    const canonicalIds = extractCanonicalIds(resolutions);

    expect(canonicalIds).toEqual(["#123", "cli/main", "frames/emitter"]);
  });

  it("should handle empty resolutions", () => {
    const canonicalIds = extractCanonicalIds([]);
    expect(canonicalIds).toEqual([]);
  });
});

describe("isFilePath detection", () => {
  it("should detect file paths correctly", async () => {
    // File paths (should be resolved)
    const filePaths = ["src/cli.ts", "path/to/file.js", "file.txt", "deep/nested/path/file.ts"];

    for (const path of filePaths) {
      const result = await resolveModulePath(path);
      // Should attempt resolution (not just pass through)
      expect(result.original).toBe(path);
    }
  });

  it("should detect PR numbers correctly", async () => {
    // PR identifiers (should pass through)
    const prNumbers = ["#123", "PR-456", "#1", "PR-1000"];

    for (const pr of prNumbers) {
      const result = await resolveModulePath(pr);
      expect(result.canonical).toBe(pr);
      expect(result.resolved).toBe(false);
    }
  });
});

describe("caching behavior", () => {
  beforeEach(() => {
    clearResolverCache();
    vi.clearAllMocks();
  });

  it("should cache policy and alias table across calls", async () => {
    const { loadPolicy } = await import("@smartergpt/lex");
    const { loadAliasTable } = await import("@smartergpt/lex/aliases");

    await resolveModulePath("src/cli.ts");
    await resolveModulePath("src/frames/emitter.ts");

    // Should only load once due to caching
    expect(vi.mocked(loadPolicy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadAliasTable)).toHaveBeenCalledTimes(1);
  });

  it("should clear cache when requested", async () => {
    const { loadPolicy } = await import("@smartergpt/lex");

    await resolveModulePath("src/cli.ts");
    clearResolverCache();
    await resolveModulePath("src/frames/emitter.ts");

    // Should load twice due to cache clear
    expect(vi.mocked(loadPolicy)).toHaveBeenCalledTimes(2);
  });
});
