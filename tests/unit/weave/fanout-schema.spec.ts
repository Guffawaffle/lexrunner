/**
 * Fanout Schema Tests
 */

import { describe, it, expect } from "vitest";
import {
  parseFanoutTemplates,
  safeParseFanoutTemplates,
  validateTemplateIds,
  type FanoutTemplates,
} from "../../../src/weave/fanout/schema.js";

describe("FanoutTemplates Schema", () => {
  describe("parseFanoutTemplates", () => {
    it("parses valid minimal templates", () => {
      const input = {
        version: 1,
        templates: [],
      };

      const result = parseFanoutTemplates(input);
      expect(result.version).toBe(1);
      expect(result.templates).toEqual([]);
    });

    it("parses template with all fields", () => {
      const input = {
        version: 1,
        templates: [
          {
            id: "test-template",
            description: "Test description",
            trigger: {
              pattern: "test\\.(\\w+)",
              files: ["**/*.ts"],
              captures: { name: "$1" },
              requires_judgment: true,
            },
            issue: {
              title: "Test issue for {name}",
              labels: ["test"],
              assignees: ["user1"],
              body: "Body text",
              repo: "same",
            },
            priority: 50,
            enabled: true,
          },
        ],
      };

      const result = parseFanoutTemplates(input);
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].id).toBe("test-template");
      expect(result.templates[0].trigger.requires_judgment).toBe(true);
    });

    it("applies default values", () => {
      const input = {
        version: 1,
        templates: [
          {
            id: "minimal",
            trigger: {
              pattern: "test",
            },
            issue: {
              title: "Test",
              body: "Body",
            },
          },
        ],
      };

      const result = parseFanoutTemplates(input);
      const template = result.templates[0];

      expect(template.trigger.files).toEqual(["**/*"]);
      expect(template.trigger.requires_judgment).toBe(false);
      expect(template.issue.labels).toEqual([]);
      expect(template.issue.repo).toBe("same");
      expect(template.priority).toBe(100);
      expect(template.enabled).toBe(true);
    });

    it("rejects empty template ID", () => {
      const input = {
        version: 1,
        templates: [
          {
            id: "",
            trigger: { pattern: "test" },
            issue: { title: "T", body: "B" },
          },
        ],
      };

      expect(() => parseFanoutTemplates(input)).toThrow();
    });

    it("rejects empty pattern", () => {
      const input = {
        version: 1,
        templates: [
          {
            id: "test",
            trigger: { pattern: "" },
            issue: { title: "T", body: "B" },
          },
        ],
      };

      expect(() => parseFanoutTemplates(input)).toThrow();
    });
  });

  describe("safeParseFanoutTemplates", () => {
    it("returns success for valid input", () => {
      const input = { version: 1, templates: [] };
      const result = safeParseFanoutTemplates(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
      }
    });

    it("returns error for invalid input", () => {
      const input = { version: "invalid" };
      const result = safeParseFanoutTemplates(input);

      expect(result.success).toBe(false);
    });
  });

  describe("validateTemplateIds", () => {
    it("passes for unique IDs", () => {
      const templates: FanoutTemplates = {
        version: 1,
        templates: [
          {
            id: "a",
            trigger: {
              pattern: "x",
              files: ["*"],
              requires_judgment: false,
            },
            issue: {
              title: "T",
              labels: [],
              body: "B",
              repo: "same",
            },
            priority: 100,
            enabled: true,
          },
          {
            id: "b",
            trigger: {
              pattern: "y",
              files: ["*"],
              requires_judgment: false,
            },
            issue: {
              title: "T",
              labels: [],
              body: "B",
              repo: "same",
            },
            priority: 100,
            enabled: true,
          },
        ],
      };

      expect(() => validateTemplateIds(templates)).not.toThrow();
    });

    it("throws for duplicate IDs", () => {
      const templates: FanoutTemplates = {
        version: 1,
        templates: [
          {
            id: "same-id",
            trigger: {
              pattern: "x",
              files: ["*"],
              requires_judgment: false,
            },
            issue: {
              title: "T",
              labels: [],
              body: "B",
              repo: "same",
            },
            priority: 100,
            enabled: true,
          },
          {
            id: "same-id",
            trigger: {
              pattern: "y",
              files: ["*"],
              requires_judgment: false,
            },
            issue: {
              title: "T",
              labels: [],
              body: "B",
              repo: "same",
            },
            priority: 100,
            enabled: true,
          },
        ],
      };

      expect(() => validateTemplateIds(templates)).toThrow("Duplicate template ID: same-id");
    });
  });
});
