/**
 * Unit tests for D0 Harvest module
 *
 * Tests the harvest functions with mocked GitHub client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeInputDigest, computeBundleDigest } from "../../../src/fanout/harvest.js";
import type { QueryParams, HarvestBundle } from "../../../src/fanout/types.js";

describe("Harvest Module", () => {
  describe("computeInputDigest", () => {
    it("should produce deterministic digest for same params", () => {
      const params: QueryParams = { owner: "test", repo: "repo" };
      const digest1 = computeInputDigest(params);
      const digest2 = computeInputDigest(params);
      expect(digest1).toBe(digest2);
    });

    it("should produce different digest for different params", () => {
      const params1: QueryParams = { owner: "test", repo: "repo1" };
      const params2: QueryParams = { owner: "test", repo: "repo2" };
      expect(computeInputDigest(params1)).not.toBe(computeInputDigest(params2));
    });

    it("should produce same digest regardless of key order", () => {
      // Object key order shouldn't matter due to canonical JSON
      const params1 = { owner: "test", repo: "repo" };
      const params2 = { repo: "repo", owner: "test" };
      expect(computeInputDigest(params1)).toBe(computeInputDigest(params2));
    });

    it("should include filters in digest", () => {
      const base: QueryParams = { owner: "test", repo: "repo" };
      const withFilter: QueryParams = {
        owner: "test",
        repo: "repo",
        issueFilter: { state: "open" },
      };
      expect(computeInputDigest(base)).not.toBe(computeInputDigest(withFilter));
    });

    it("should return hex string", () => {
      const params: QueryParams = { owner: "test", repo: "repo" };
      const digest = computeInputDigest(params);
      expect(digest).toMatch(/^[a-f0-9]{64}$/); // SHA256 = 64 hex chars
    });
  });

  describe("computeBundleDigest", () => {
    const minimalBundle: HarvestBundle = {
      schemaVersion: "1.0.0",
      provenance: {
        harvestedAt: "2025-01-01T00:00:00Z",
        toolVersion: "lexrunner@0.8.0",
        inputDigest: "abc123",
      },
      queryParams: { owner: "test", repo: "repo" },
      repoPin: {
        defaultBranch: "main",
        defaultBranchSha: "sha123",
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

    it("should produce deterministic digest for same bundle", () => {
      const digest1 = computeBundleDigest(minimalBundle);
      const digest2 = computeBundleDigest(minimalBundle);
      expect(digest1).toBe(digest2);
    });

    it("should produce different digest when bundle changes", () => {
      const modified = {
        ...minimalBundle,
        provenance: { ...minimalBundle.provenance, harvestedAt: "2025-01-02T00:00:00Z" },
      };
      expect(computeBundleDigest(minimalBundle)).not.toBe(computeBundleDigest(modified));
    });

    it("should return hex string", () => {
      const digest = computeBundleDigest(minimalBundle);
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
