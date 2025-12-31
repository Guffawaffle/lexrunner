/**
 * Unit tests for D0 Harvest types and schemas
 *
 * Tests Zod schema validation for HarvestBundle and related types.
 */

import { describe, it, expect } from "vitest";
import {
  HarvestBundleSchema,
  HarvestedIssueSchema,
  HarvestedPRSchema,
  SecuritySignalsSchema,
  QueryParamsSchema,
  EvidenceIdSchema,
  parseHarvestBundle,
  safeParseHarvestBundle,
} from "../../../src/fanout/types.js";

describe("Fanout Types", () => {
  describe("EvidenceIdSchema", () => {
    it("should accept valid evidence IDs", () => {
      expect(EvidenceIdSchema.parse("E-ISSUE-001")).toBe("E-ISSUE-001");
      expect(EvidenceIdSchema.parse("E-OVERLAP-042")).toBe("E-OVERLAP-042");
      expect(EvidenceIdSchema.parse("E-HOTSPOT-1234")).toBe("E-HOTSPOT-1234");
    });

    it("should reject invalid evidence IDs", () => {
      expect(() => EvidenceIdSchema.parse("ISSUE-001")).toThrow();
      expect(() => EvidenceIdSchema.parse("E-issue-001")).toThrow(); // lowercase
      expect(() => EvidenceIdSchema.parse("E-ISSUE-01")).toThrow(); // only 2 digits
      expect(() => EvidenceIdSchema.parse("random")).toThrow();
    });
  });

  describe("QueryParamsSchema", () => {
    it("should accept minimal query params", () => {
      const params = { owner: "test", repo: "repo" };
      expect(QueryParamsSchema.parse(params)).toEqual(params);
    });

    it("should accept full query params with filters", () => {
      const params = {
        owner: "test",
        repo: "repo",
        issueFilter: { state: "open" as const, labels: ["bug", "urgent"] },
        prFilter: { state: "all" as const },
      };
      expect(QueryParamsSchema.parse(params)).toEqual(params);
    });

    it("should reject missing required fields", () => {
      expect(() => QueryParamsSchema.parse({ owner: "test" })).toThrow();
      expect(() => QueryParamsSchema.parse({ repo: "repo" })).toThrow();
    });
  });

  describe("HarvestedIssueSchema", () => {
    const validIssue = {
      number: 123,
      nodeId: "I_abc123",
      title: "Test issue",
      body: "Issue body",
      state: "open" as const,
      labels: ["bug"],
      assignees: ["user1"],
      author: "testuser",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      comments: [],
      commentsFetched: true,
      commentsCount: 0,
    };

    it("should accept valid issue", () => {
      expect(HarvestedIssueSchema.parse(validIssue)).toEqual(validIssue);
    });

    it("should accept null body", () => {
      const issue = { ...validIssue, body: null };
      expect(HarvestedIssueSchema.parse(issue).body).toBeNull();
    });

    it("should track commentsFetched separately from comments array", () => {
      const issue = { ...validIssue, commentsFetched: false, commentsCount: 5 };
      const parsed = HarvestedIssueSchema.parse(issue);
      expect(parsed.commentsFetched).toBe(false);
      expect(parsed.commentsCount).toBe(5);
      expect(parsed.comments).toEqual([]);
    });
  });

  describe("HarvestedPRSchema", () => {
    const validPR = {
      number: 456,
      nodeId: "PR_abc456",
      title: "Test PR",
      body: "PR description",
      state: "open" as const,
      labels: ["feature"],
      assignees: [],
      author: "prauthor",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      headSha: "abc123def456",
      baseSha: "def456abc123",
      mergeBaseSha: "111222333444",
      baseBranch: "main",
      headBranch: "feature/test",
      diff: "diff --git a/file.ts b/file.ts\n+added line",
      diffTruncated: false,
      diffBytesCaptured: 42,
      touchedFiles: ["file.ts"],
      reviewComments: [],
      ciStatus: {
        state: "success" as const,
        totalChecks: 3,
        passedChecks: 3,
        failedChecks: 0,
      },
    };

    it("should accept valid PR", () => {
      expect(HarvestedPRSchema.parse(validPR)).toEqual(validPR);
    });

    it("should accept merged state", () => {
      const pr = { ...validPR, state: "merged" as const };
      expect(HarvestedPRSchema.parse(pr).state).toBe("merged");
    });

    it("should accept null mergeBaseSha", () => {
      const pr = { ...validPR, mergeBaseSha: null };
      expect(HarvestedPRSchema.parse(pr).mergeBaseSha).toBeNull();
    });

    it("should track diffTruncated flag", () => {
      const pr = { ...validPR, diffTruncated: true, diffBytesCaptured: 3145728 };
      const parsed = HarvestedPRSchema.parse(pr);
      expect(parsed.diffTruncated).toBe(true);
      expect(parsed.diffBytesCaptured).toBe(3145728);
    });

    it("should accept null diff when fetch failed", () => {
      const pr = { ...validPR, diff: null, diffBytesCaptured: 0 };
      expect(HarvestedPRSchema.parse(pr).diff).toBeNull();
    });

    it("should accept null CI state", () => {
      const pr = {
        ...validPR,
        ciStatus: { state: null, totalChecks: 0, passedChecks: 0, failedChecks: 0 },
      };
      expect(HarvestedPRSchema.parse(pr).ciStatus.state).toBeNull();
    });
  });

  describe("SecuritySignalsSchema", () => {
    it("should distinguish null vulnerabilities (unknown) from empty array (none)", () => {
      // null = unknown/failed
      const unknown = {
        source: "npm_audit" as const,
        fetchedAt: "2025-01-01T00:00:00Z",
        vulnerabilities: null,
        fetchError: "npm audit failed",
      };
      expect(SecuritySignalsSchema.parse(unknown).vulnerabilities).toBeNull();

      // [] = none found
      const none = {
        source: "npm_audit" as const,
        fetchedAt: "2025-01-01T00:00:00Z",
        vulnerabilities: [],
        fetchError: null,
      };
      expect(SecuritySignalsSchema.parse(none).vulnerabilities).toEqual([]);
    });

    it("should accept source: none with null fetchedAt", () => {
      const signals = {
        source: "none" as const,
        fetchedAt: null,
        vulnerabilities: null,
        fetchError: "No workspace root",
      };
      expect(SecuritySignalsSchema.parse(signals).source).toBe("none");
    });

    it("should accept vulnerabilities with details", () => {
      const signals = {
        source: "npm_audit" as const,
        fetchedAt: "2025-01-01T00:00:00Z",
        vulnerabilities: [
          { severity: "high" as const, package: "vulnerable-pkg", fixAvailable: true },
          {
            severity: "moderate" as const,
            package: "another-pkg",
            fixAvailable: false,
            advisory: "https://example.com/advisory",
          },
        ],
        fetchError: null,
      };
      const parsed = SecuritySignalsSchema.parse(signals);
      expect(parsed.vulnerabilities).toHaveLength(2);
      expect(parsed.vulnerabilities![0].severity).toBe("high");
    });
  });

  describe("HarvestBundleSchema", () => {
    const validBundle = {
      schemaVersion: "1.0.0" as const,
      provenance: {
        harvestedAt: "2025-01-01T00:00:00Z",
        toolVersion: "lexrunner@0.8.0",
        inputDigest: "abc123def456789",
      },
      queryParams: { owner: "test", repo: "repo" },
      repoPin: {
        defaultBranch: "main",
        defaultBranchSha: "abc123",
        fetchedAt: "2025-01-01T00:00:00Z",
      },
      issues: [],
      pullRequests: [],
      securitySignals: {
        source: "none" as const,
        fetchedAt: null,
        vulnerabilities: null,
        fetchError: "Skipped",
      },
    };

    it("should accept valid bundle", () => {
      expect(HarvestBundleSchema.parse(validBundle)).toEqual(validBundle);
    });

    it("should reject invalid schema version", () => {
      const bundle = { ...validBundle, schemaVersion: "2.0.0" };
      expect(() => HarvestBundleSchema.parse(bundle)).toThrow();
    });
  });

  describe("parseHarvestBundle", () => {
    it("should parse valid bundle", () => {
      const bundle = {
        schemaVersion: "1.0.0",
        provenance: {
          harvestedAt: "2025-01-01T00:00:00Z",
          toolVersion: "lexrunner@0.8.0",
          inputDigest: "abc",
        },
        queryParams: { owner: "o", repo: "r" },
        repoPin: {
          defaultBranch: "main",
          defaultBranchSha: "sha",
          fetchedAt: "2025-01-01T00:00:00Z",
        },
        issues: [],
        pullRequests: [],
        securitySignals: {
          source: "none",
          fetchedAt: null,
          vulnerabilities: null,
          fetchError: null,
        },
      };
      expect(() => parseHarvestBundle(bundle)).not.toThrow();
    });

    it("should throw on invalid bundle", () => {
      expect(() => parseHarvestBundle({})).toThrow();
    });
  });

  describe("safeParseHarvestBundle", () => {
    it("should return success for valid bundle", () => {
      const bundle = {
        schemaVersion: "1.0.0",
        provenance: {
          harvestedAt: "2025-01-01T00:00:00Z",
          toolVersion: "lexrunner@0.8.0",
          inputDigest: "abc",
        },
        queryParams: { owner: "o", repo: "r" },
        repoPin: {
          defaultBranch: "main",
          defaultBranchSha: "sha",
          fetchedAt: "2025-01-01T00:00:00Z",
        },
        issues: [],
        pullRequests: [],
        securitySignals: {
          source: "none",
          fetchedAt: null,
          vulnerabilities: null,
          fetchError: null,
        },
      };
      const result = safeParseHarvestBundle(bundle);
      expect(result.success).toBe(true);
    });

    it("should return error for invalid bundle", () => {
      const result = safeParseHarvestBundle({ invalid: true });
      expect(result.success).toBe(false);
    });
  });
});
