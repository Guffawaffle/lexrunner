/**
 * Project Schemas Tests
 * Tests for Feature Spec v0 and Execution Plan v1 schemas
 */

import { describe, it, expect } from "vitest";
import {
  FeatureSpecV0Schema,
  ExecutionPlanV1Schema,
  SubIssueSchema,
  EpicSchema,
} from "../../src/schemas/project.js";

describe("Project Schemas", () => {
  describe("FeatureSpecV0Schema", () => {
    it("should validate valid Feature Spec v0", () => {
      const validSpec = {
        title: "Test Feature",
        description: "A test feature description",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        repo: "owner/repo",
      };

      const result = FeatureSpecV0Schema.parse(validSpec);
      expect(result.title).toBe(validSpec.title);
      expect(result.description).toBe(validSpec.description);
      expect(result.repo).toBe(validSpec.repo);
    });

    it("should apply default values", () => {
      const minimalSpec = {
        title: "Test Feature",
        description: "A test feature description",
        acceptanceCriteria: ["Criterion 1"],
        repo: "owner/repo",
      };

      const result = FeatureSpecV0Schema.parse(minimalSpec);
      expect(result.schemaVersion).toBe("0.1.0");
      expect(result.labels).toEqual([]);
      expect(result.priority).toBe("medium");
    });

    it("should reject invalid repo format", () => {
      const invalidSpec = {
        title: "Test Feature",
        description: "A test feature description",
        acceptanceCriteria: ["Criterion 1"],
        repo: "invalid-repo-format",
      };

      expect(() => FeatureSpecV0Schema.parse(invalidSpec)).toThrow();
    });

    it("should reject missing required fields", () => {
      const invalidSpec = {
        title: "Test Feature",
        // Missing description, acceptanceCriteria, repo
      };

      expect(() => FeatureSpecV0Schema.parse(invalidSpec)).toThrow();
    });

    it("should validate priority values", () => {
      const validPriorities = ["low", "medium", "high", "critical"];

      for (const priority of validPriorities) {
        const spec = {
          title: "Test Feature",
          description: "Test",
          acceptanceCriteria: ["Test"],
          repo: "owner/repo",
          priority,
        };

        const result = FeatureSpecV0Schema.parse(spec);
        expect(result.priority).toBe(priority);
      }
    });

    it("should reject empty acceptance criteria array", () => {
      const invalidSpec = {
        title: "Test Feature",
        description: "Test",
        acceptanceCriteria: [],
        repo: "owner/repo",
      };

      expect(() => FeatureSpecV0Schema.parse(invalidSpec)).toThrow();
    });
  });

  describe("SubIssueSchema", () => {
    it("should validate valid sub-issue", () => {
      const validSubIssue = {
        id: "test-1",
        title: "Test Sub-Issue",
        description: "Description",
        type: "feature",
        acceptanceCriteria: ["AC1", "AC2"],
      };

      const result = SubIssueSchema.parse(validSubIssue);
      expect(result.id).toBe(validSubIssue.id);
      expect(result.type).toBe("feature");
      expect(result.dependsOn).toEqual([]);
    });

    it("should validate all sub-issue types", () => {
      const validTypes = ["feature", "testing", "docs", "refactor", "bugfix"];

      for (const type of validTypes) {
        const subIssue = {
          id: "test-1",
          title: "Test",
          description: "Test",
          type,
          acceptanceCriteria: ["AC1"],
        };

        const result = SubIssueSchema.parse(subIssue);
        expect(result.type).toBe(type);
      }
    });

    it("should validate dependencies", () => {
      const subIssue = {
        id: "test-1",
        title: "Test",
        description: "Test",
        type: "feature",
        acceptanceCriteria: ["AC1"],
        dependsOn: ["dep-1", "dep-2"],
      };

      const result = SubIssueSchema.parse(subIssue);
      expect(result.dependsOn).toEqual(["dep-1", "dep-2"]);
    });
  });

  describe("EpicSchema", () => {
    it("should validate valid epic", () => {
      const validEpic = {
        title: "Test Epic",
        description: "Epic description",
        acceptanceCriteria: ["AC1", "AC2"],
      };

      const result = EpicSchema.parse(validEpic);
      expect(result.title).toBe(validEpic.title);
      expect(result.description).toBe(validEpic.description);
      expect(result.acceptanceCriteria).toEqual(validEpic.acceptanceCriteria);
    });

    it("should reject empty acceptance criteria", () => {
      const invalidEpic = {
        title: "Test Epic",
        description: "Epic description",
        acceptanceCriteria: [],
      };

      expect(() => EpicSchema.parse(invalidEpic)).toThrow();
    });
  });

  describe("ExecutionPlanV1Schema", () => {
    it("should validate valid Execution Plan v1", () => {
      const validPlan = {
        sourceSpec: {
          title: "Test Feature",
          description: "Test",
          acceptanceCriteria: ["AC1"],
          repo: "owner/repo",
        },
        epic: {
          title: "Epic Title",
          description: "Epic Description",
          acceptanceCriteria: ["AC1"],
        },
        subIssues: [
          {
            id: "sub-1",
            title: "Sub-Issue 1",
            description: "Description",
            type: "feature",
            acceptanceCriteria: ["AC1"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const result = ExecutionPlanV1Schema.parse(validPlan);
      expect(result.schemaVersion).toBe("1.0.0");
      expect(result.epic.title).toBe(validPlan.epic.title);
      expect(result.subIssues).toHaveLength(1);
    });

    it("should reject empty sub-issues array", () => {
      const invalidPlan = {
        sourceSpec: {
          title: "Test Feature",
          description: "Test",
          acceptanceCriteria: ["AC1"],
          repo: "owner/repo",
        },
        epic: {
          title: "Epic Title",
          description: "Epic Description",
          acceptanceCriteria: ["AC1"],
        },
        subIssues: [],
        createdAt: new Date().toISOString(),
      };

      expect(() => ExecutionPlanV1Schema.parse(invalidPlan)).toThrow();
    });

    it("should validate datetime format", () => {
      const validPlan = {
        sourceSpec: {
          title: "Test Feature",
          description: "Test",
          acceptanceCriteria: ["AC1"],
          repo: "owner/repo",
        },
        epic: {
          title: "Epic Title",
          description: "Epic Description",
          acceptanceCriteria: ["AC1"],
        },
        subIssues: [
          {
            id: "sub-1",
            title: "Sub-Issue 1",
            description: "Description",
            type: "feature",
            acceptanceCriteria: ["AC1"],
          },
        ],
        createdAt: "2025-11-09T12:00:00.000Z",
      };

      const result = ExecutionPlanV1Schema.parse(validPlan);
      expect(result.createdAt).toBe(validPlan.createdAt);
    });
  });
});
