import { describe, it, expect } from "vitest";
import {
  shouldIncludeBody,
  filterPRMetadata,
  filterPRsWithMetrics,
  formatMinimalPR,
  markNeedsContext,
  extractEssentialData,
} from "../src/github/minimalContext.js";
import type { PullRequest } from "../src/github/types.js";

describe("Minimal Context Filtering", () => {
  const createMockPR = (overrides?: Partial<PullRequest>): PullRequest => ({
    number: 1,
    title: "Test PR",
    body: "This is a test PR body with detailed information.",
    head: { ref: "feature", sha: "abc123" },
    base: { ref: "main", sha: "def456" },
    state: "open",
    labels: [],
    draft: false,
    mergeable: true,
    user: { login: "testuser" },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    ...overrides,
  });

  describe("shouldIncludeBody", () => {
    it("should include body when needs-context label is present", () => {
      const labels = [{ name: "needs-context" }];
      expect(shouldIncludeBody(labels)).toBe(true);
    });

    it("should include body when needs-body label is present", () => {
      const labels = [{ name: "needs-body" }];
      expect(shouldIncludeBody(labels)).toBe(true);
    });

    it("should include body when full-context label is present", () => {
      const labels = [{ name: "full-context" }];
      expect(shouldIncludeBody(labels)).toBe(true);
    });

    it("should be case insensitive", () => {
      const labels = [{ name: "NEEDS-CONTEXT" }];
      expect(shouldIncludeBody(labels)).toBe(true);
    });

    it("should not include body when no context labels are present", () => {
      const labels = [{ name: "bug" }, { name: "enhancement" }];
      expect(shouldIncludeBody(labels)).toBe(false);
    });

    it("should not include body when labels array is empty", () => {
      expect(shouldIncludeBody([])).toBe(false);
    });

    it("should include body if any context label is present", () => {
      const labels = [{ name: "bug" }, { name: "needs-context" }, { name: "enhancement" }];
      expect(shouldIncludeBody(labels)).toBe(true);
    });
  });

  describe("filterPRMetadata", () => {
    it("should filter PR to minimal metadata without body", () => {
      const pr = createMockPR();
      const result = filterPRMetadata(pr);

      expect(result.number).toBe(1);
      expect(result.title).toBe("Test PR");
      expect(result.body).toBeUndefined();
      expect(result.bodyIncluded).toBe(false);
      expect(result.labels).toEqual([]);
      expect(result.head.ref).toBe("feature");
      expect(result.base.ref).toBe("main");
      expect(result.author).toBe("testuser");
    });

    it("should include body when needs-context label is present", () => {
      const pr = createMockPR({
        labels: [{ name: "needs-context", color: "blue" }],
      });
      const result = filterPRMetadata(pr);

      expect(result.body).toBe("This is a test PR body with detailed information.");
      expect(result.bodyIncluded).toBe(true);
    });

    it("should preserve labels", () => {
      const pr = createMockPR({
        labels: [
          { name: "bug", color: "red" },
          { name: "priority", color: "orange" },
        ],
      });
      const result = filterPRMetadata(pr);

      expect(result.labels).toHaveLength(2);
      expect(result.labels[0].name).toBe("bug");
      expect(result.labels[1].name).toBe("priority");
    });

    it("should preserve essential branch info", () => {
      const pr = createMockPR({
        head: { ref: "feature-branch", sha: "abc123def456" },
        base: { ref: "development", sha: "xyz789" },
      });
      const result = filterPRMetadata(pr);

      expect(result.head.ref).toBe("feature-branch");
      expect(result.head.sha).toBe("abc123def456");
      expect(result.base.ref).toBe("development");
      expect(result.base.sha).toBe("xyz789");
    });

    it("should preserve timestamps", () => {
      const pr = createMockPR({
        createdAt: "2024-01-01T12:00:00Z",
        updatedAt: "2024-01-05T18:30:00Z",
      });
      const result = filterPRMetadata(pr);

      expect(result.createdAt).toBe("2024-01-01T12:00:00Z");
      expect(result.updatedAt).toBe("2024-01-05T18:30:00Z");
    });
  });

  describe("filterPRsWithMetrics", () => {
    it("should filter multiple PRs and calculate metrics", () => {
      const prs = [
        createMockPR({ number: 1 }),
        createMockPR({ number: 2 }),
        createMockPR({
          number: 3,
          labels: [{ name: "needs-context", color: "blue" }],
        }),
      ];

      const result = filterPRsWithMetrics(prs);

      expect(result.prs).toHaveLength(3);
      expect(result.withBodyCount).toBe(1);
      expect(result.totalSize).toBeGreaterThan(0);
      expect(result.originalSize).toBeGreaterThan(result.totalSize);
      expect(result.reductionPercent).toBeGreaterThan(0);
    });

    it("should calculate correct withBodyCount", () => {
      const prs = [
        createMockPR({
          number: 1,
          labels: [{ name: "needs-context", color: "blue" }],
        }),
        createMockPR({
          number: 2,
          labels: [{ name: "needs-body", color: "green" }],
        }),
        createMockPR({ number: 3 }),
      ];

      const result = filterPRsWithMetrics(prs);

      expect(result.withBodyCount).toBe(2);
    });

    it("should calculate size reduction", () => {
      const prs = [
        createMockPR({
          number: 1,
          body: "A".repeat(1000), // Large body
        }),
        createMockPR({
          number: 2,
          body: "B".repeat(1000),
        }),
      ];

      const result = filterPRsWithMetrics(prs);

      // Without needs-context label, bodies should be filtered out
      expect(result.reductionPercent).toBeGreaterThan(0);
    });

    it("should handle empty PR list", () => {
      const result = filterPRsWithMetrics([]);

      expect(result.prs).toHaveLength(0);
      expect(result.withBodyCount).toBe(0);
      expect(result.totalSize).toBeGreaterThan(0); // JSON overhead
      expect(result.reductionPercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe("formatMinimalPR", () => {
    it("should format PR as readable text", () => {
      const pr = filterPRMetadata(createMockPR());
      const formatted = formatMinimalPR(pr);

      expect(formatted).toContain("PR #1");
      expect(formatted).toContain("Test PR");
      expect(formatted).toContain("Author: testuser");
      expect(formatted).toContain("State: open");
      expect(formatted).toContain("Branch: feature -> main");
      expect(formatted).toContain("SHA: abc123");
    });

    it("should include body when present", () => {
      const pr = filterPRMetadata(
        createMockPR({
          labels: [{ name: "needs-context", color: "blue" }],
        })
      );
      const formatted = formatMinimalPR(pr);

      expect(formatted).toContain("Description");
      expect(formatted).toContain("This is a test PR body");
    });

    it("should not include body section when not present", () => {
      const pr = filterPRMetadata(createMockPR());
      const formatted = formatMinimalPR(pr);

      expect(formatted).not.toContain("Description");
    });

    it("should format labels", () => {
      const pr = filterPRMetadata(
        createMockPR({
          labels: [
            { name: "bug", color: "red" },
            { name: "priority", color: "orange" },
          ],
        })
      );
      const formatted = formatMinimalPR(pr);

      expect(formatted).toContain("Labels: bug, priority");
    });
  });

  describe("markNeedsContext", () => {
    it("should add needs-context label to PR", () => {
      const pr = createMockPR();
      const marked = markNeedsContext(pr);

      expect(marked.labels).toHaveLength(1);
      expect(marked.labels[0].name).toBe("needs-context");
    });

    it("should not duplicate needs-context label", () => {
      const pr = createMockPR({
        labels: [{ name: "needs-context", color: "blue" }],
      });
      const marked = markNeedsContext(pr);

      expect(marked.labels).toHaveLength(1);
    });

    it("should preserve existing labels", () => {
      const pr = createMockPR({
        labels: [{ name: "bug", color: "red" }],
      });
      const marked = markNeedsContext(pr);

      expect(marked.labels).toHaveLength(2);
      expect(marked.labels.find((l) => l.name === "bug")).toBeDefined();
      expect(marked.labels.find((l) => l.name === "needs-context")).toBeDefined();
    });

    it("should recognize other context labels", () => {
      const pr = createMockPR({
        labels: [{ name: "full-context", color: "purple" }],
      });
      const marked = markNeedsContext(pr);

      // Should not add needs-context since full-context is already present
      expect(marked.labels).toHaveLength(1);
      expect(marked.labels[0].name).toBe("full-context");
    });
  });

  describe("extractEssentialData", () => {
    it("should extract minimal essential fields from PR", () => {
      const pr = createMockPR({
        number: 42,
        title: "Important Fix",
        labels: [
          { name: "bug", color: "red" },
          { name: "critical", color: "orange" },
        ],
        head: { ref: "fix-branch", sha: "abc123def456" },
      });

      const essential = extractEssentialData(pr);

      expect(essential.number).toBe(42);
      expect(essential.title).toBe("Important Fix");
      expect(essential.labels).toEqual(["bug", "critical"]);
      expect(essential.branch).toBe("fix-branch");
      expect(essential.sha).toBe("abc123d"); // 7 chars
      expect(essential.state).toBe("open");
    });

    it("should work with MinimalPRMetadata", () => {
      const pr = createMockPR();
      const minimal = filterPRMetadata(pr);
      const essential = extractEssentialData(minimal);

      expect(essential.number).toBe(1);
      expect(essential.title).toBe("Test PR");
    });

    it("should truncate SHA to 7 characters", () => {
      const pr = createMockPR({
        head: { ref: "branch", sha: "1234567890abcdef" },
      });

      const essential = extractEssentialData(pr);

      expect(essential.sha).toBe("1234567");
      expect(essential.sha).toHaveLength(7);
    });

    it("should extract label names only", () => {
      const pr = createMockPR({
        labels: [
          { name: "label1", color: "red" },
          { name: "label2", color: "blue" },
        ],
      });

      const essential = extractEssentialData(pr);

      expect(essential.labels).toEqual(["label1", "label2"]);
    });
  });
});
