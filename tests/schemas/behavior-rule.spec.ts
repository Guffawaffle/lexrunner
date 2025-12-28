/**
 * Behavior Rule Schema Tests
 * Tests for the behavior rule Zod schema and validation
 */

import { describe, it, expect } from "vitest";
import {
  BehaviorRuleSchema,
  type BehaviorRule,
  type BehaviorRuleItem,
  type RuleScope,
} from "../../.smartergpt/schemas/behavior-rule.schema.js";

describe("Behavior Rule Schema", () => {
  describe("BehaviorRuleSchema", () => {
    it("should validate valid behavior rules configuration", () => {
      const validConfig: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "code-review-required",
            title: "Code Review Required",
            description: "All code changes must be reviewed before merge",
            content:
              "Before merging any pull request, ensure at least one peer review has been completed.",
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(validConfig);
      expect(result.version).toBe("1.0.0");
      expect(result.rules).toHaveLength(1);
      expect(result.rules![0].id).toBe("code-review-required");
    });

    it("should validate empty rules array", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [],
      };

      const result = BehaviorRuleSchema.parse(config);
      expect(result.rules).toEqual([]);
    });

    it("should validate minimal configuration without version", () => {
      const config = {
        rules: [
          {
            id: "test-rule",
            title: "Test Rule",
            description: "Test description",
            content: "Test content",
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      expect(result.version).toBeUndefined();
      expect(result.rules).toHaveLength(1);
    });

    it("should reject rules with missing required fields", () => {
      const invalidConfig = {
        version: "1.0.0",
        rules: [
          {
            id: "incomplete-rule",
            title: "Incomplete Rule",
            // Missing description and content
          },
        ],
      };

      expect(() => BehaviorRuleSchema.parse(invalidConfig)).toThrow();
    });

    it("should reject additional properties on rules", () => {
      const invalidConfig = {
        version: "1.0.0",
        rules: [
          {
            id: "test-rule",
            title: "Test Rule",
            description: "Description",
            content: "Content",
            unknownField: "should fail",
          },
        ],
      };

      expect(() => BehaviorRuleSchema.parse(invalidConfig)).toThrow();
    });

    it("should reject additional properties at root level", () => {
      const invalidConfig = {
        version: "1.0.0",
        rules: [],
        extraField: "should fail",
      };

      expect(() => BehaviorRuleSchema.parse(invalidConfig)).toThrow();
    });
  });

  describe("Rule priority validation", () => {
    it("should validate rules with priority", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "high-priority",
            title: "High Priority Rule",
            description: "This is a high priority rule",
            content: "Important content",
            priority: 100,
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      expect(result.rules![0].priority).toBe(100);
    });

    it("should accept priority of 0", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "zero-priority",
            title: "Zero Priority Rule",
            description: "This rule has zero priority",
            content: "Content",
            priority: 0,
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      expect(result.rules![0].priority).toBe(0);
    });

    it("should reject negative priority", () => {
      const invalidConfig = {
        version: "1.0.0",
        rules: [
          {
            id: "negative-priority",
            title: "Negative Priority Rule",
            description: "This rule has negative priority",
            content: "Content",
            priority: -1,
          },
        ],
      };

      expect(() => BehaviorRuleSchema.parse(invalidConfig)).toThrow();
    });

    it("should reject non-integer priority", () => {
      const invalidConfig = {
        version: "1.0.0",
        rules: [
          {
            id: "float-priority",
            title: "Float Priority Rule",
            description: "This rule has float priority",
            content: "Content",
            priority: 1.5,
          },
        ],
      };

      expect(() => BehaviorRuleSchema.parse(invalidConfig)).toThrow();
    });
  });

  describe("Rule scope validation", () => {
    it("should validate rules with full scope", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "scoped-rule",
            title: "Scoped Rule",
            description: "This rule has a scope",
            content: "Scoped content",
            scope: {
              environment: "production",
              project: "lexrunner",
              agentFamily: "copilot",
            },
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      const scope = result.rules![0].scope;
      expect(scope?.environment).toBe("production");
      expect(scope?.project).toBe("lexrunner");
      expect(scope?.agentFamily).toBe("copilot");
    });

    it("should validate rules with partial scope", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "partial-scope",
            title: "Partial Scope Rule",
            description: "This rule has partial scope",
            content: "Content",
            scope: {
              environment: "development",
            },
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      const scope = result.rules![0].scope;
      expect(scope?.environment).toBe("development");
      expect(scope?.project).toBeUndefined();
      expect(scope?.agentFamily).toBeUndefined();
    });

    it("should validate rules with empty scope", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "empty-scope",
            title: "Empty Scope Rule",
            description: "This rule has an empty scope object",
            content: "Content",
            scope: {},
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      expect(result.rules![0].scope).toEqual({});
    });

    it("should reject scope with additional properties", () => {
      const invalidConfig = {
        version: "1.0.0",
        rules: [
          {
            id: "invalid-scope",
            title: "Invalid Scope Rule",
            description: "This rule has invalid scope",
            content: "Content",
            scope: {
              environment: "production",
              unknownField: "should fail",
            },
          },
        ],
      };

      expect(() => BehaviorRuleSchema.parse(invalidConfig)).toThrow();
    });
  });

  describe("Multiple rules validation", () => {
    it("should validate multiple rules with different configurations", () => {
      const config: BehaviorRule = {
        version: "1.0.0",
        rules: [
          {
            id: "rule-1",
            title: "Rule One",
            description: "First rule",
            content: "Content one",
            priority: 100,
          },
          {
            id: "rule-2",
            title: "Rule Two",
            description: "Second rule",
            content: "Content two",
            scope: {
              environment: "production",
            },
          },
          {
            id: "rule-3",
            title: "Rule Three",
            description: "Third rule",
            content: "Content three",
            priority: 50,
            scope: {
              agentFamily: "claude",
              project: "test-project",
            },
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(config);
      expect(result.rules).toHaveLength(3);
      expect(result.rules![0].priority).toBe(100);
      expect(result.rules![1].scope?.environment).toBe("production");
      expect(result.rules![2].scope?.agentFamily).toBe("claude");
    });
  });

  describe("JSON schema examples validation", () => {
    it("should validate example 1 from JSON schema", () => {
      const example1 = {
        version: "1.0.0",
        rules: [
          {
            id: "code-review-required",
            title: "Code Review Required",
            description: "All code changes must be reviewed before merge",
            content:
              "Before merging any pull request, ensure at least one peer review has been completed. Reviewers should check for correctness, style, and security issues.",
            priority: 10,
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(example1);
      expect(result.rules).toHaveLength(1);
      expect(result.rules![0].id).toBe("code-review-required");
    });

    it("should validate example 2 from JSON schema", () => {
      const example2 = {
        version: "1.0.0",
        rules: [
          {
            id: "no-force-push",
            title: "No Force Push to Main",
            description: "Prevent force pushing to protected branches",
            content:
              "Never use git push --force on main, master, or release branches. Always use git push --force-with-lease if force pushing is absolutely necessary on feature branches.",
            scope: {
              environment: "production",
            },
            priority: 100,
          },
          {
            id: "test-coverage-minimum",
            title: "Minimum Test Coverage",
            description: "Maintain minimum test coverage thresholds",
            content:
              "All new code must include tests. Aim for at least 80% line coverage and 70% branch coverage.",
            scope: {
              agentFamily: "copilot",
              project: "lexrunner",
            },
            priority: 50,
          },
        ],
      };

      const result = BehaviorRuleSchema.parse(example2);
      expect(result.rules).toHaveLength(2);
      expect(result.rules![0].priority).toBe(100);
      expect(result.rules![1].scope?.project).toBe("lexrunner");
    });
  });
});
