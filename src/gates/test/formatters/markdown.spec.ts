/**
 * Tests for Markdown output formatter
 */

import { describe, it, expect } from "vitest";
import { formatAsMarkdown, type MarkdownOptions } from "./markdown.js";
import {
  createAXTestResult,
  createAXTestFailure,
  type AXTestResult,
  type AXTestFailure,
} from "../schema.js";

describe("Markdown Formatter", () => {
  describe("formatAsMarkdown", () => {
    it("should format basic test result with summary", () => {
      const result = createAXTestResult({
        summary: {
          total: 123,
          passed: 120,
          failed: 3,
          skipped: 0,
          durationMs: 4500,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("## 🧪 Test Results");
      expect(markdown).toContain("**123 tests**");
      expect(markdown).toContain("✅ 120 passed");
      expect(markdown).toContain("❌ 3 failed");
      expect(markdown).toContain("⏱️ 4.5s");
    });

    it("should format test result with skipped tests", () => {
      const result = createAXTestResult({
        summary: {
          total: 50,
          passed: 40,
          failed: 5,
          skipped: 5,
          durationMs: 2000,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("⏭️ 5 skipped");
    });

    it("should hide passing summary when includePassingSummary is false", () => {
      const result = createAXTestResult({
        summary: {
          total: 100,
          passed: 95,
          failed: 5,
          skipped: 0,
          durationMs: 1000,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { includePassingSummary: false });

      expect(markdown).not.toContain("✅ 95 passed");
      expect(markdown).toContain("❌ 5 failed");
    });

    it("should format failures with collapsible details by default", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "tests/unit/handlers.spec.ts",
        line: 42,
        name: "handleActivate throws when persona not found",
        error: {
          message: "Expected LexSonaError but got TypeError",
          type: "TypeError",
        },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("### ❌ Failed Tests");
      expect(markdown).toContain("<details>");
      expect(markdown).toContain("<summary>");
      expect(markdown).toContain("tests/unit/handlers.spec.ts:42");
      expect(markdown).toContain("handleActivate throws when persona not found");
      expect(markdown).toContain("</details>");
    });

    it("should format failures without collapsible when collapsible is false", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "tests/unit/handlers.spec.ts",
        line: 42,
        name: "test name",
        error: { message: "Error message" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { collapsible: false });

      expect(markdown).not.toContain("<details>");
      expect(markdown).toContain("####");
      expect(markdown).toContain("tests/unit/handlers.spec.ts:42");
    });

    it("should format failure with diff", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "tests/unit/test.spec.ts",
        line: 10,
        name: "assertion failure",
        error: { message: "Values do not match" },
        diff: {
          expected: "LexSonaError",
          actual: "TypeError: Cannot read property 'id' of undefined",
        },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("```diff");
      expect(markdown).toContain("- Expected: LexSonaError");
      expect(markdown).toContain("+ Actual: TypeError: Cannot read property 'id' of undefined");
      expect(markdown).toContain("```");
    });

    it("should format next actions as strings", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "tests/unit/test.spec.ts",
        line: 10,
        name: "test",
        error: { message: "error" },
        nextActions: [
          "Check persona loader for null handling",
          "Add guard clause before accessing persona.id",
        ],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("**Suggested Actions:**");
      expect(markdown).toContain("- Check persona loader for null handling");
      expect(markdown).toContain("- Add guard clause before accessing persona.id");
    });

    it("should format structured next actions", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "tests/unit/test.spec.ts",
        line: 10,
        name: "test",
        error: { message: "error" },
        nextActions: [
          {
            kind: "rerun",
            cmd: 'vitest run -t "handleActivate throws when persona not found"',
            note: "Rerun the failing test",
          },
          {
            kind: "inspect",
            note: "Check persona loader for null handling",
          },
          {
            kind: "fix",
            note: "Add guard clause before accessing persona.id",
          },
        ],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("🔄");
      // Command is escaped, so checking for the escaped version
      expect(markdown).toContain('vitest run \\-t "handleActivate throws when persona not found"');
      expect(markdown).toContain("Rerun the failing test");
      expect(markdown).toContain("🔍");
      expect(markdown).toContain("Check persona loader for null handling");
      expect(markdown).toContain("🔧");
      expect(markdown).toContain("Add guard clause before accessing persona.id");
    });

    it("should format coverage table", () => {
      const result = createAXTestResult({
        summary: {
          total: 100,
          passed: 100,
          failed: 0,
          skipped: 0,
          durationMs: 1000,
        },
        failures: [],
        coverage: {
          linesPct: 87.3,
          branchesPct: 72.1,
          functionsPct: 91.2,
        },
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("### 📊 Coverage");
      expect(markdown).toContain("| Metric | Coverage |");
      expect(markdown).toContain("| Lines | 87.3% |");
      expect(markdown).toContain("| Branches | 72.1% |");
      expect(markdown).toContain("| Functions | 91.2% |");
    });

    it("should include statements coverage if available", () => {
      const result = createAXTestResult({
        summary: {
          total: 100,
          passed: 100,
          failed: 0,
          skipped: 0,
          durationMs: 1000,
        },
        failures: [],
        coverage: {
          linesPct: 87.3,
          branchesPct: 72.1,
          functionsPct: 91.2,
          statementsPct: 88.5,
        },
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("| Statements | 88.5% |");
    });

    it("should hide coverage when includeCoverage is false", () => {
      const result = createAXTestResult({
        summary: {
          total: 100,
          passed: 100,
          failed: 0,
          skipped: 0,
          durationMs: 1000,
        },
        failures: [],
        coverage: {
          linesPct: 87.3,
          branchesPct: 72.1,
          functionsPct: 91.2,
        },
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { includeCoverage: false });

      expect(markdown).not.toContain("📊 Coverage");
    });

    it("should limit failures to maxFailures", () => {
      const failures = Array.from({ length: 20 }, (_, i) =>
        createAXTestFailure({
          failureId: `fail-${i}`,
          file: `test-${i}.spec.ts`,
          line: i + 1,
          name: `test ${i}`,
          error: { message: `error ${i}` },
          nextActions: [],
        })
      );

      const result = createAXTestResult({
        summary: {
          total: 20,
          passed: 0,
          failed: 20,
          skipped: 0,
          durationMs: 1000,
        },
        failures,
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { maxFailures: 5 });

      // Should show 5 failures
      expect(markdown).toContain("test-0.spec.ts");
      expect(markdown).toContain("test-4.spec.ts");
      expect(markdown).not.toContain("test-5.spec.ts");
      expect(markdown).toContain("<!-- 15 more failures omitted -->");
    });

    it("should handle singular failure count in omitted message", () => {
      const failures = Array.from({ length: 11 }, (_, i) =>
        createAXTestFailure({
          failureId: `fail-${i}`,
          file: `test-${i}.spec.ts`,
          line: i + 1,
          name: `test ${i}`,
          error: { message: `error ${i}` },
          nextActions: [],
        })
      );

      const result = createAXTestResult({
        summary: {
          total: 11,
          passed: 0,
          failed: 11,
          skipped: 0,
          durationMs: 1000,
        },
        failures,
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { maxFailures: 10 });

      expect(markdown).toContain("<!-- 1 more failure omitted -->");
    });

    it("should format GitHub file links", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "src/handlers.ts",
        line: 42,
        column: 10,
        name: "test",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, {
        linkFormat: "github",
        repository: "owner/repo",
        ref: "main",
      });

      expect(markdown).toContain(
        "[src/handlers.ts:42](https://github.com/owner/repo/blob/main/src/handlers.ts#L42C10)"
      );
    });

    it("should format GitHub file links without column", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "src/handlers.ts",
        line: 42,
        name: "test",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, {
        linkFormat: "github",
        repository: "owner/repo",
        ref: "develop",
      });

      expect(markdown).toContain(
        "[src/handlers.ts:42](https://github.com/owner/repo/blob/develop/src/handlers.ts#L42)"
      );
    });

    it("should format GitLab file links", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "src/handlers.ts",
        line: 42,
        name: "test",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, {
        linkFormat: "gitlab",
        repository: "owner/repo",
        ref: "main",
      });

      expect(markdown).toContain(
        "[src/handlers.ts:42](https://gitlab.com/owner/repo/-/blob/main/src/handlers.ts#L42)"
      );
    });

    it("should format plain file links", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "src/handlers.ts",
        line: 42,
        column: 10,
        name: "test",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { linkFormat: "plain" });

      expect(markdown).toContain("src/handlers.ts:42:10");
    });

    it("should fallback to plain when GitHub link has no repository", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "src/handlers.ts",
        line: 42,
        name: "test",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result, { linkFormat: "github" });

      expect(markdown).toContain("src/handlers.ts:42");
      expect(markdown).not.toContain("https://github.com");
    });
  });

  describe("Duration formatting", () => {
    it("should format milliseconds", () => {
      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: 500,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);
      expect(markdown).toContain("⏱️ 500ms");
    });

    it("should format seconds", () => {
      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: 5500,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);
      expect(markdown).toContain("⏱️ 5.5s");
    });

    it("should format minutes", () => {
      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: 150000,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);
      expect(markdown).toContain("⏱️ 2.5m");
    });

    it("should format hours", () => {
      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: 7200000,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);
      expect(markdown).toContain("⏱️ 2.0h");
    });
  });

  describe("Markdown escaping", () => {
    it("should escape special characters in test names", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "test.spec.ts",
        line: 1,
        name: "test with *asterisks* and _underscores_ and [brackets]",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("\\*asterisks\\*");
      expect(markdown).toContain("\\_underscores\\_");
      expect(markdown).toContain("\\[brackets\\]");
    });

    it("should escape special characters in error messages", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "test.spec.ts",
        line: 1,
        name: "test",
        error: { message: "Expected `value` to be > 10" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      // Backticks are not escaped, they remain as inline code markers
      expect(markdown).toContain("`value`");
    });

    it("should escape special characters in next actions", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "test.spec.ts",
        line: 1,
        name: "test",
        error: { message: "error" },
        nextActions: ["Check `config.value` in _settings_"],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      // Backticks are not escaped, underscores are escaped
      expect(markdown).toContain("`config.value`");
      expect(markdown).toContain("\\_settings\\_");
    });
  });

  describe("Edge cases", () => {
    it("should handle zero failures", () => {
      const result = createAXTestResult({
        summary: {
          total: 100,
          passed: 100,
          failed: 0,
          skipped: 0,
          durationMs: 1000,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("## 🧪 Test Results");
      expect(markdown).not.toContain("### ❌ Failed Tests");
    });

    it("should handle result with no coverage", () => {
      const result = createAXTestResult({
        summary: {
          total: 100,
          passed: 100,
          failed: 0,
          skipped: 0,
          durationMs: 1000,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).not.toContain("📊 Coverage");
    });

    it("should handle failure with no next actions", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "test.spec.ts",
        line: 1,
        name: "test",
        error: { message: "error" },
        nextActions: [],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).not.toContain("**Suggested Actions:**");
    });

    it("should handle all action kinds", () => {
      const failure = createAXTestFailure({
        failureId: "abc123",
        file: "test.spec.ts",
        line: 1,
        name: "test",
        error: { message: "error" },
        nextActions: [
          { kind: "rerun", note: "Rerun test" },
          { kind: "inspect", note: "Inspect code" },
          { kind: "fix", note: "Fix issue" },
          { kind: "doc", note: "Update docs" },
        ],
      });

      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: 100,
        },
        failures: [failure],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);

      expect(markdown).toContain("🔄");
      expect(markdown).toContain("🔍");
      expect(markdown).toContain("🔧");
      expect(markdown).toContain("📖");
    });

    it("should handle zero duration", () => {
      const result = createAXTestResult({
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: 0,
        },
        failures: [],
        adapter: {
          name: "vitest-json",
          version: "1.0.0",
          source: "test-results.json",
        },
      });

      const markdown = formatAsMarkdown(result);
      expect(markdown).toContain("⏱️ 0ms");
    });
  });
});
