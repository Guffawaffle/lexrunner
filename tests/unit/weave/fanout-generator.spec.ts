/**
 * Fanout Generator Tests
 */

import { describe, it, expect } from "vitest";
import {
  substituteTemplate,
  buildSubstitutionContext,
  generateIssue,
  generateIssues,
  formatIssuePreview,
  type SubstitutionContext,
} from "../../../src/weave/fanout/generator.js";
import type {
  FanoutTemplate,
  FanoutTemplates,
  TriggerMatch,
} from "../../../src/weave/fanout/schema.js";

describe("Fanout Generator", () => {
  describe("substituteTemplate", () => {
    it("replaces placeholders with values", () => {
      const template = "Issue for {tool_name} in {repo_name}";
      const values = { tool_name: "my_tool", repo_name: "lexrunner" };

      const result = substituteTemplate(template, values);
      expect(result).toBe("Issue for my_tool in lexrunner");
    });

    it("leaves unmatched placeholders unchanged", () => {
      const template = "Issue for {known} and {unknown}";
      const values = { known: "value" };

      const result = substituteTemplate(template, values);
      expect(result).toBe("Issue for value and {unknown}");
    });

    it("handles empty values", () => {
      const template = "Empty: {empty}";
      const values = { empty: "" };

      const result = substituteTemplate(template, values);
      expect(result).toBe("Empty: ");
    });

    it("handles multiple occurrences", () => {
      const template = "{name} and {name} again";
      const values = { name: "test" };

      const result = substituteTemplate(template, values);
      expect(result).toBe("test and test again");
    });
  });

  describe("buildSubstitutionContext", () => {
    const basePrInfo: Partial<SubstitutionContext> = {
      pr_number: "123",
      pr_title: "Test PR",
      pr_url: "https://example.com/pr/123",
      pr_author: "testuser",
      repo_owner: "owner",
      repo_name: "repo",
      branch_name: "feature/test",
    };

    it("includes PR info in context", () => {
      const match: TriggerMatch = {
        templateId: "test",
        matchedFile: "src/file.ts",
        lineNumber: 42,
        matchedText: "matched text",
        captures: {},
        requiresJudgment: false,
      };

      const context = buildSubstitutionContext(match, basePrInfo);

      expect(context.pr_number).toBe("123");
      expect(context.pr_title).toBe("Test PR");
      expect(context.repo_owner).toBe("owner");
    });

    it("includes match info in context", () => {
      const match: TriggerMatch = {
        templateId: "test",
        matchedFile: "src/tools.ts",
        lineNumber: 99,
        matchedText: 'name: "my_tool"',
        captures: {},
        requiresJudgment: false,
      };

      const context = buildSubstitutionContext(match, basePrInfo);

      expect(context.matched_file).toBe("src/tools.ts");
      expect(context.matched_line).toBe("99");
      expect(context.matched_text).toBe('name: "my_tool"');
    });

    it("includes captures from match", () => {
      const match: TriggerMatch = {
        templateId: "test",
        matchedFile: "file.ts",
        lineNumber: 1,
        matchedText: "text",
        captures: { tool_name: "my_tool", group1: "extracted" },
        requiresJudgment: false,
      };

      const context = buildSubstitutionContext(match, basePrInfo);

      expect(context.tool_name).toBe("my_tool");
      expect(context.group1).toBe("extracted");
    });

    it("includes date in ISO format", () => {
      const match: TriggerMatch = {
        templateId: "test",
        matchedFile: "file.ts",
        lineNumber: 1,
        matchedText: "text",
        captures: {},
        requiresJudgment: false,
      };

      const context = buildSubstitutionContext(match, basePrInfo);

      expect(context.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("generateIssue", () => {
    const template: FanoutTemplate = {
      id: "test-template",
      trigger: {
        pattern: "test",
        files: ["**/*"],
        requires_judgment: false,
      },
      issue: {
        title: "Issue for {tool_name}",
        labels: ["testing", "{label_dynamic}"],
        assignees: ["{pr_author}"],
        body: "Body for PR #{pr_number}",
        repo: "same",
      },
      priority: 100,
      enabled: true,
    };

    const match: TriggerMatch = {
      templateId: "test-template",
      matchedFile: "file.ts",
      lineNumber: 10,
      matchedText: "test",
      captures: { tool_name: "awesome_tool", label_dynamic: "auto" },
      requiresJudgment: false,
    };

    const context: SubstitutionContext = {
      pr_number: "456",
      pr_title: "Add feature",
      pr_url: "https://github.com/owner/repo/pull/456",
      pr_author: "developer",
      repo_owner: "owner",
      repo_name: "repo",
      branch_name: "main",
      date: "2024-01-15",
      tool_name: "awesome_tool",
      label_dynamic: "auto",
      matched_file: "file.ts",
      matched_line: "10",
      matched_text: "test",
    };

    it("generates issue with substituted title", () => {
      const issue = generateIssue(template, match, context);
      expect(issue.title).toBe("Issue for awesome_tool");
    });

    it("generates issue with substituted body", () => {
      const issue = generateIssue(template, match, context);
      expect(issue.body).toBe("Body for PR #456");
    });

    it("substitutes labels", () => {
      const issue = generateIssue(template, match, context);
      expect(issue.labels).toEqual(["testing", "auto"]);
    });

    it("substitutes assignees", () => {
      const issue = generateIssue(template, match, context);
      expect(issue.assignees).toEqual(["developer"]);
    });

    it("resolves 'same' repo to current repo", () => {
      const issue = generateIssue(template, match, context);
      expect(issue.repo).toBe("owner/repo");
    });

    it("uses explicit repo when specified", () => {
      const templateWithRepo: FanoutTemplate = {
        ...template,
        issue: { ...template.issue, repo: "other/repo" },
      };
      const issue = generateIssue(templateWithRepo, match, context);
      expect(issue.repo).toBe("other/repo");
    });

    it("sets requiresConfirmation from match", () => {
      const judgmentMatch: TriggerMatch = {
        ...match,
        requiresJudgment: true,
      };
      const issue = generateIssue(template, judgmentMatch, context);
      expect(issue.requiresConfirmation).toBe(true);
    });
  });

  describe("generateIssues", () => {
    it("generates issues for all matches", () => {
      const templates: FanoutTemplates = {
        version: 1,
        templates: [
          {
            id: "template-a",
            trigger: {
              pattern: "a",
              files: ["**/*"],
              requires_judgment: false,
            },
            issue: {
              title: "Issue A",
              labels: [],
              body: "Body A",
              repo: "same",
            },
            priority: 100,
            enabled: true,
          },
          {
            id: "template-b",
            trigger: {
              pattern: "b",
              files: ["**/*"],
              requires_judgment: false,
            },
            issue: {
              title: "Issue B",
              labels: [],
              body: "Body B",
              repo: "same",
            },
            priority: 100,
            enabled: true,
          },
        ],
      };

      const matches: TriggerMatch[] = [
        {
          templateId: "template-a",
          matchedFile: "a.ts",
          lineNumber: 1,
          matchedText: "a",
          captures: {},
          requiresJudgment: false,
        },
        {
          templateId: "template-b",
          matchedFile: "b.ts",
          lineNumber: 2,
          matchedText: "b",
          captures: {},
          requiresJudgment: false,
        },
      ];

      const issues = generateIssues(templates, matches, {
        repo_owner: "owner",
        repo_name: "repo",
      });

      expect(issues).toHaveLength(2);
      expect(issues[0].title).toBe("Issue A");
      expect(issues[1].title).toBe("Issue B");
    });

    it("skips matches with missing templates", () => {
      const templates: FanoutTemplates = {
        version: 1,
        templates: [],
      };

      const matches: TriggerMatch[] = [
        {
          templateId: "nonexistent",
          matchedFile: "file.ts",
          lineNumber: 1,
          matchedText: "text",
          captures: {},
          requiresJudgment: false,
        },
      ];

      const issues = generateIssues(templates, matches, {});
      expect(issues).toHaveLength(0);
    });
  });

  describe("formatIssuePreview", () => {
    it("formats issue for display", () => {
      const issue = {
        templateId: "test",
        match: {
          templateId: "test",
          matchedFile: "src/file.ts",
          lineNumber: 42,
          matchedText: "matched",
          captures: {},
          requiresJudgment: false,
        },
        title: "Test Issue",
        body: "Issue body content",
        labels: ["label1", "label2"],
        assignees: ["user1"],
        repo: "owner/repo",
        requiresConfirmation: false,
      };

      const preview = formatIssuePreview(issue);

      expect(preview).toContain("## Issue: Test Issue");
      expect(preview).toContain("**Repo:** owner/repo");
      expect(preview).toContain("**Labels:** label1, label2");
      expect(preview).toContain("**Assignees:** user1");
      expect(preview).toContain("File: `src/file.ts`");
      expect(preview).toContain("Line: 42");
      expect(preview).toContain("Issue body content");
    });

    it("shows requires confirmation for D2/D3", () => {
      const issue = {
        templateId: "test",
        match: {
          templateId: "test",
          matchedFile: "file.ts",
          lineNumber: 1,
          matchedText: "text",
          captures: {},
          requiresJudgment: true,
        },
        title: "Test",
        body: "Body",
        labels: [],
        assignees: [],
        repo: "repo",
        requiresConfirmation: true,
      };

      const preview = formatIssuePreview(issue);
      expect(preview).toContain("**Requires Confirmation:** Yes");
    });
  });
});
