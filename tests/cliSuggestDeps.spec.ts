/**
 * CLI Suggest Dependencies Tests
 * Tests for --suggest-deps flag functionality
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("CLI --suggest-deps", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-suggest-deps-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Table format", () => {
    it("should format suggestions as table by default", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        {
          from: "PR-103",
          to: "PR-101",
          score: 1.0,
          reason: "explicit-footer",
          evidence: {
            explicit: ["Depends-on: #101"],
          },
        },
        {
          from: "PR-102",
          to: "PR-101",
          score: 0.85,
          reason: "shared-files",
          evidence: {
            files: ["src/auth/api.ts", "src/auth/types.ts"],
          },
        },
      ];

      const output = formatSuggestionsAsTable(suggestions);

      expect(output).toContain("=== Dependency Suggestions ===");
      expect(output).toContain("PR-103 → PR-101");
      expect(output).toContain("[score: 1.00]");
      expect(output).toContain("explicit-footer");
      expect(output).toContain("PR-102 → PR-101");
      expect(output).toContain("[score: 0.85]");
      expect(output).toContain("shared-files");
      expect(output).toContain("Total: 2 suggestions");
    });

    it("should show confidence levels in table format", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        {
          from: "PR-103",
          to: "PR-101",
          score: 0.9,
          reason: "shared-files",
          evidence: { files: ["src/file.ts"] },
        },
        {
          from: "PR-104",
          to: "PR-101",
          score: 0.6,
          reason: "directory-proximity",
          evidence: { files: [] },
        },
        {
          from: "PR-105",
          to: "PR-101",
          score: 0.4,
          reason: "test-overlap",
          evidence: { files: [] },
        },
      ];

      const output = formatSuggestionsAsTable(suggestions);

      expect(output).toContain("Confidence: High");
      expect(output).toContain("Confidence: Medium");
      expect(output).toContain("Confidence: Low");
    });

    it("should handle empty suggestions gracefully", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const output = formatSuggestionsAsTable([]);

      expect(output).toContain("No dependency suggestions found");
    });
  });

  describe("JSON format", () => {
    it("should format suggestions as valid JSON", async () => {
      const { formatSuggestionsAsJSON } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        {
          from: "PR-103",
          to: "PR-101",
          score: 1.0,
          reason: "explicit-footer",
          evidence: {
            explicit: ["Depends-on: #101"],
          },
        },
      ];

      const output = formatSuggestionsAsJSON(suggestions);
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty("suggestions");
      expect(parsed).toHaveProperty("summary");
      expect(parsed.suggestions).toHaveLength(1);
      expect(parsed.suggestions[0].from).toBe("PR-103");
      expect(parsed.suggestions[0].to).toBe("PR-101");
      expect(parsed.suggestions[0].score).toBe(1.0);
      expect(parsed.suggestions[0].confidence).toBe("high");
    });

    it("should include summary in JSON format", async () => {
      const { formatSuggestionsAsJSON } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 0.9, reason: "shared-files", evidence: {} },
        { from: "PR-1", to: "PR-3", score: 0.6, reason: "directory-proximity", evidence: {} },
        { from: "PR-1", to: "PR-4", score: 0.4, reason: "test-overlap", evidence: {} },
      ];

      const output = formatSuggestionsAsJSON(suggestions);
      const parsed = JSON.parse(output);

      expect(parsed.summary.total).toBe(3);
      expect(parsed.summary.highConfidence).toBe(1);
      expect(parsed.summary.mediumConfidence).toBe(1);
      expect(parsed.summary.lowConfidence).toBe(1);
    });
  });

  describe("Markdown format", () => {
    it("should format suggestions as Markdown", async () => {
      const { formatSuggestionsAsMarkdown } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        {
          from: "PR-103",
          to: "PR-101",
          score: 1.0,
          reason: "explicit-footer",
          evidence: {
            explicit: ["Depends-on: #101"],
          },
        },
      ];

      const output = formatSuggestionsAsMarkdown(suggestions);

      expect(output).toContain("# Dependency Suggestions");
      expect(output).toContain("## High Confidence");
      expect(output).toContain("### PR-103 → PR-101 [1.00]");
      expect(output).toContain("**Reason:** explicit-footer");
    });

    it("should group suggestions by confidence in Markdown", async () => {
      const { formatSuggestionsAsMarkdown } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 0.9, reason: "shared-files", evidence: {} },
        { from: "PR-1", to: "PR-3", score: 0.6, reason: "directory-proximity", evidence: {} },
        { from: "PR-1", to: "PR-4", score: 0.4, reason: "test-overlap", evidence: {} },
      ];

      const output = formatSuggestionsAsMarkdown(suggestions);

      expect(output).toContain("## High Confidence");
      expect(output).toContain("## Medium Confidence");
      expect(output).toContain("## Low Confidence");
      expect(output).toContain("**Summary:**");
    });

    it("should handle empty suggestions in Markdown", async () => {
      const { formatSuggestionsAsMarkdown } = await import("../src/cli/formatSuggestions.js");

      const output = formatSuggestionsAsMarkdown([]);

      expect(output).toContain("# Dependency Suggestions");
      expect(output).toContain("No dependency suggestions found");
    });
  });

  describe("Format selection", () => {
    it("should use table format by default", async () => {
      const { formatSuggestions } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 1.0, reason: "explicit-footer", evidence: {} },
      ];

      const output = formatSuggestions(suggestions);

      expect(output).toContain("=== Dependency Suggestions ===");
    });

    it("should use JSON format when specified", async () => {
      const { formatSuggestions } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 1.0, reason: "explicit-footer", evidence: {} },
      ];

      const output = formatSuggestions(suggestions, "json");
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty("suggestions");
    });

    it("should use Markdown format when specified", async () => {
      const { formatSuggestions } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 1.0, reason: "explicit-footer", evidence: {} },
      ];

      const output = formatSuggestions(suggestions, "markdown");

      expect(output).toContain("# Dependency Suggestions");
    });
  });

  describe("Threshold filtering", () => {
    it("should show threshold warning for low-confidence suggestions", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 0.4, reason: "test-overlap", evidence: {} },
      ];

      const output = formatSuggestionsAsTable(suggestions, 0.5);

      expect(output).toContain("below typical threshold");
    });
  });

  describe("Deterministic output", () => {
    it("should produce same output for same inputs (table)", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-103", to: "PR-101", score: 1.0, reason: "explicit-footer", evidence: {} },
        { from: "PR-102", to: "PR-101", score: 0.85, reason: "shared-files", evidence: {} },
      ];

      const output1 = formatSuggestionsAsTable(suggestions);
      const output2 = formatSuggestionsAsTable(suggestions);

      expect(output1).toBe(output2);
    });

    it("should produce same output for same inputs (JSON)", async () => {
      const { formatSuggestionsAsJSON } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-103", to: "PR-101", score: 1.0, reason: "explicit-footer", evidence: {} },
        { from: "PR-102", to: "PR-101", score: 0.85, reason: "shared-files", evidence: {} },
      ];

      const output1 = formatSuggestionsAsJSON(suggestions);
      const output2 = formatSuggestionsAsJSON(suggestions);

      expect(output1).toBe(output2);
    });

    it("should produce same output for same inputs (Markdown)", async () => {
      const { formatSuggestionsAsMarkdown } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-103", to: "PR-101", score: 1.0, reason: "explicit-footer", evidence: {} },
        { from: "PR-102", to: "PR-101", score: 0.85, reason: "shared-files", evidence: {} },
      ];

      const output1 = formatSuggestionsAsMarkdown(suggestions);
      const output2 = formatSuggestionsAsMarkdown(suggestions);

      expect(output1).toBe(output2);
    });
  });

  describe("File output", () => {
    it("should write to file when --output is specified", async () => {
      const { formatSuggestions } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        { from: "PR-1", to: "PR-2", score: 1.0, reason: "explicit-footer", evidence: {} },
      ];

      const output = formatSuggestions(suggestions, "table");
      const outputPath = path.join(tempDir, "suggestions.txt");

      fs.writeFileSync(outputPath, output, "utf-8");

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("=== Dependency Suggestions ===");
    });
  });

  describe("Evidence display", () => {
    it("should show explicit evidence for explicit dependencies", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        {
          from: "PR-103",
          to: "PR-101",
          score: 1.0,
          reason: "explicit-footer",
          evidence: {
            explicit: ["Depends-on: #101", "Depends-on: Guffawaffle/LexRunner#101"],
          },
        },
      ];

      const output = formatSuggestionsAsTable(suggestions);

      expect(output).toContain("Evidence:");
      expect(output).toContain("Depends-on:");
    });

    it("should show file count for shared-files suggestions", async () => {
      const { formatSuggestionsAsTable } = await import("../src/cli/formatSuggestions.js");

      const suggestions = [
        {
          from: "PR-102",
          to: "PR-101",
          score: 0.85,
          reason: "shared-files",
          evidence: {
            files: ["src/auth/api.ts", "src/auth/types.ts", "src/auth/utils.ts"],
          },
        },
      ];

      const output = formatSuggestionsAsTable(suggestions);

      expect(output).toContain("3 shared files");
    });
  });
});
