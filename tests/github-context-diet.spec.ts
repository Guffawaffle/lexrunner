import { describe, it, expect } from "vitest";
import {
  buildMinimalContext,
  buildMinimalPRContext,
  formatCompleteContext,
  exportMetrics,
} from "../src/github/contextDiet.js";
import type { PullRequest } from "../src/github/types.js";

describe("Context Diet Integration", () => {
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

  describe("buildMinimalContext", () => {
    it("should build minimal context with only PR metadata", async () => {
      const prs = [createMockPR()];

      const result = await buildMinimalContext(prs);

      expect(result.prMetadata.prs).toHaveLength(1);
      expect(result.diffContext).toBeUndefined();
      expect(result.symbolMaps).toBeUndefined();
      expect(result.metrics.totalSize).toBeGreaterThan(0);
      expect(result.metrics.prCount).toBe(1);
    });

    it("should include diff context when provided", async () => {
      const prs = [createMockPR()];
      const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,3 @@
 function test() {
-  console.log('old');
+  console.log('new');
   return true;
 }
`;

      const result = await buildMinimalContext(prs, { diff });

      expect(result.diffContext).toBeDefined();
      expect(result.diffContext?.fileCount).toBe(1);
      expect(result.diffContext?.files[0].path).toBe("src/test.ts");
      expect(result.metrics.diffSize).toBeGreaterThan(0);
      expect(result.metrics.fileCount).toBe(1);
    });

    it("should include symbol maps when files provided", async () => {
      const prs = [createMockPR()];
      const files = [
        {
          path: "src/test.ts",
          content: "export function testFunc() { return true; }",
        },
      ];

      const result = await buildMinimalContext(prs, { files });

      expect(result.symbolMaps).toBeDefined();
      expect(result.symbolMaps?.files).toHaveLength(1);
      expect(result.symbolMaps?.symbolCount).toBeGreaterThan(0);
      expect(result.metrics.symbolMapSize).toBeGreaterThan(0);
      expect(result.metrics.symbolCount).toBeGreaterThan(0);
    });

    it("should build complete context with all components", async () => {
      const prs = [createMockPR()];
      const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 export function test() {
-  return false;
+  console.log('testing');
+  return true;
 }
`;
      const files = [
        {
          path: "src/test.ts",
          content: 'export function test() { console.log("testing"); return true; }',
        },
      ];

      const result = await buildMinimalContext(prs, { diff, files });

      expect(result.prMetadata).toBeDefined();
      expect(result.diffContext).toBeDefined();
      expect(result.symbolMaps).toBeDefined();
      expect(result.metrics.totalSize).toBeGreaterThan(0);
      expect(result.metrics.totalSize).toBe(
        result.metrics.prMetadataSize! + result.metrics.diffSize! + result.metrics.symbolMapSize!
      );
    });

    it("should calculate accurate size metrics", async () => {
      const prs = [createMockPR({ number: 1 }), createMockPR({ number: 2 })];
      const diff = "a".repeat(1000);

      const result = await buildMinimalContext(prs, { diff });

      expect(result.metrics.totalSize).toBeGreaterThan(0);
      expect(result.metrics.estimatedOriginalSize).toBeGreaterThan(result.metrics.totalSize);
      expect(result.metrics.reductionPercent).toBeGreaterThan(0);
    });

    it("should track PR count correctly", async () => {
      const prs = [
        createMockPR({ number: 1 }),
        createMockPR({ number: 2 }),
        createMockPR({ number: 3 }),
      ];

      const result = await buildMinimalContext(prs);

      expect(result.metrics.prCount).toBe(3);
    });

    it("should track PRs with body correctly", async () => {
      const prs = [
        createMockPR({
          number: 1,
          labels: [{ name: "needs-context", color: "blue" }],
        }),
        createMockPR({ number: 2 }),
      ];

      const result = await buildMinimalContext(prs);

      expect(result.metrics.prWithBodyCount).toBe(1);
    });

    it("should optimize diff hunks", async () => {
      const prs = [createMockPR()];
      // Create a large diff with 50 lines
      const largeDiff = `diff --git a/src/large.ts b/src/large.ts
index 1234567..abcdefg 100644
--- a/src/large.ts
+++ b/src/large.ts
@@ -1,50 +1,50 @@
${Array(50)
  .fill(0)
  .map((_, i) => ` line ${i + 1}`)
  .join("\n")}
`;

      const result = await buildMinimalContext(prs, { diff: largeDiff });

      // Hunks should be optimized (split if too large)
      expect(result.diffContext).toBeDefined();
      expect(result.diffContext!.hunkCount).toBeGreaterThanOrEqual(1);

      // Check that hunks are within size constraints
      for (const file of result.diffContext!.files) {
        for (const hunk of file.hunks) {
          const lineCount = hunk.content.split("\n").length;
          expect(lineCount).toBeLessThanOrEqual(40);
        }
      }
    });
  });

  describe("buildMinimalPRContext", () => {
    it("should build context for a single PR", async () => {
      const pr = createMockPR();

      const result = await buildMinimalPRContext(pr);

      expect(result.prMetadata.prs).toHaveLength(1);
      expect(result.prMetadata.prs[0].number).toBe(1);
    });

    it("should include diff for single PR", async () => {
      const pr = createMockPR();
      const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
-old
+new
`;

      const result = await buildMinimalPRContext(pr, diff);

      expect(result.diffContext).toBeDefined();
      expect(result.diffContext?.fileCount).toBe(1);
    });

    it("should include symbols for single PR", async () => {
      const pr = createMockPR();
      const files = [
        {
          path: "src/test.ts",
          content: "function test() {}",
        },
      ];

      const result = await buildMinimalPRContext(pr, undefined, files);

      expect(result.symbolMaps).toBeDefined();
      expect(result.symbolMaps?.files).toHaveLength(1);
    });
  });

  describe("formatCompleteContext", () => {
    it("should format context as readable text", async () => {
      const prs = [createMockPR()];
      const context = await buildMinimalContext(prs);

      const formatted = formatCompleteContext(context);

      expect(formatted).toContain("Minimal Context Package");
      expect(formatted).toContain("Metrics");
      expect(formatted).toContain("Total size");
      expect(formatted).toContain("Pull Requests");
    });

    it("should include diff section when present", async () => {
      const prs = [createMockPR()];
      const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
-old
+new
`;
      const context = await buildMinimalContext(prs, { diff });

      const formatted = formatCompleteContext(context);

      expect(formatted).toContain("Diff Context");
      expect(formatted).toContain("src/test.ts");
    });

    it("should include symbol maps section when present", async () => {
      const prs = [createMockPR()];
      const files = [
        {
          path: "src/test.ts",
          content: "export function test() {}",
        },
      ];
      const context = await buildMinimalContext(prs, { files });

      const formatted = formatCompleteContext(context);

      expect(formatted).toContain("Symbol Maps");
      expect(formatted).toContain("src/test.ts");
    });

    it("should show all metrics", async () => {
      const prs = [
        createMockPR({ number: 1 }),
        createMockPR({
          number: 2,
          labels: [{ name: "needs-context", color: "blue" }],
        }),
      ];
      const diff = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-old
+new
`;
      const files = [
        {
          path: "test.ts",
          content: "function f() {}",
        },
      ];

      const context = await buildMinimalContext(prs, { diff, files });
      const formatted = formatCompleteContext(context);

      expect(formatted).toContain("PRs: 2 (1 with body)");
      expect(formatted).toContain("Files: 1");
      expect(formatted).toContain("Hunks:");
      expect(formatted).toContain("Symbols:");
      expect(formatted).toContain("Reduction:");
    });
  });

  describe("exportMetrics", () => {
    it("should export metrics as JSON", async () => {
      const prs = [createMockPR()];
      const context = await buildMinimalContext(prs);

      const json = exportMetrics(context);
      const parsed = JSON.parse(json);

      expect(parsed.totalSize).toBeDefined();
      expect(parsed.prMetadataSize).toBeDefined();
      expect(parsed.estimatedOriginalSize).toBeDefined();
      expect(parsed.reductionPercent).toBeDefined();
      expect(parsed.prCount).toBe(1);
    });

    it("should export all metrics when available", async () => {
      const prs = [createMockPR()];
      const diff = "test";
      const files = [{ path: "test.ts", content: "code" }];
      const context = await buildMinimalContext(prs, { diff, files });

      const json = exportMetrics(context);
      const parsed = JSON.parse(json);

      expect(parsed.diffSize).toBeDefined();
      expect(parsed.symbolMapSize).toBeDefined();
      expect(parsed.fileCount).toBeDefined();
      expect(parsed.hunkCount).toBeDefined();
      expect(parsed.symbolCount).toBeDefined();
    });

    it("should be valid JSON", async () => {
      const prs = [createMockPR()];
      const context = await buildMinimalContext(prs);

      const json = exportMetrics(context);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should format numbers correctly", async () => {
      const prs = [createMockPR()];
      const context = await buildMinimalContext(prs);

      const json = exportMetrics(context);
      const parsed = JSON.parse(json);

      // All numeric fields should be numbers
      expect(typeof parsed.totalSize).toBe("number");
      expect(typeof parsed.prMetadataSize).toBe("number");
      expect(typeof parsed.reductionPercent).toBe("number");
      expect(typeof parsed.prCount).toBe("number");
    });
  });

  describe("snapshot tests for payload size", () => {
    it("should demonstrate significant size reduction", async () => {
      // Create PRs with large bodies
      const prs = [
        createMockPR({
          number: 1,
          body: "A".repeat(5000), // 5KB body
        }),
        createMockPR({
          number: 2,
          body: "B".repeat(5000),
        }),
        createMockPR({
          number: 3,
          body: "C".repeat(5000),
        }),
      ];

      const context = await buildMinimalContext(prs);

      // Should achieve significant reduction by filtering bodies
      expect(context.metrics.reductionPercent).toBeGreaterThan(50);
      expect(context.metrics.totalSize).toBeLessThan(context.metrics.estimatedOriginalSize);
    });

    it("should keep size minimal when bodies are included", async () => {
      const prs = [
        createMockPR({
          number: 1,
          body: "Small body",
          labels: [{ name: "needs-context", color: "blue" }],
        }),
      ];

      const context = await buildMinimalContext(prs);

      // Even with body included, should be reasonably small
      expect(context.metrics.totalSize).toBeLessThan(2000);
    });

    it("should demonstrate diff hunk optimization", async () => {
      const prs = [createMockPR()];

      // Large diff (1000 lines)
      const largeDiff = `diff --git a/src/large.ts b/src/large.ts
index 1234567..abcdefg 100644
--- a/src/large.ts
+++ b/src/large.ts
@@ -1,1000 +1,1000 @@
${Array(1000)
  .fill(0)
  .map((_, i) => ` line ${i + 1}`)
  .join("\n")}
`;

      const context = await buildMinimalContext(prs, { diff: largeDiff });

      // Optimized diff should be significantly smaller than raw
      expect(context.metrics.diffSize!).toBeLessThan(context.metrics.estimatedOriginalSize);
      expect(context.metrics.reductionPercent).toBeGreaterThan(0);
    });

    it("should keep total context under reasonable size", async () => {
      const prs = [
        createMockPR({ number: 1 }),
        createMockPR({ number: 2 }),
        createMockPR({ number: 3 }),
      ];
      const diff = `diff --git a/src/test.ts b/src/test.ts
@@ -1,5 +1,5 @@
 line 1
-old line 2
+new line 2
 line 3
`;
      const files = [{ path: "src/test.ts", content: "export function test() { return 1; }" }];

      const context = await buildMinimalContext(prs, { diff, files });

      // Total context should be reasonable (under 10KB for this example)
      expect(context.metrics.totalSize).toBeLessThan(10000);
    });
  });
});
