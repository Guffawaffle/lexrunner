/**
 * Dependency Parser Tests
 * Comprehensive test suite for PR description parsing and dependency extraction
 */

import { describe, it, expect } from "vitest";
import {
  parsePRDescription,
  validateDependencies,
  isValidDependencyRef,
  normalizeDependencyRef,
  type ParsedDependency,
} from "../src/planner/dependencyParser.js";

describe("PR Description Parser", () => {
  describe("Dependency Extraction", () => {
    it("should parse Depends-on: footer style", () => {
      const description = `
## Feature Description
This PR implements feature X

## Dependencies
Depends-on: #123, #456
`;
      const result = parsePRDescription(101, description);

      expect(result.prId).toBe("PR-101");
      expect(result.dependencies).toEqual(["#123", "#456"]);
    });

    it("should parse Depends: inline style", () => {
      const description = "Depends: PR-123, PR-456";
      const result = parsePRDescription(101, description);

      expect(result.dependencies).toEqual(["#123", "#456"]);
    });

    it("should parse Requires: alternative syntax", () => {
      const description = "Requires: #789";
      const result = parsePRDescription(101, description);

      expect(result.dependencies).toEqual(["#789"]);
    });

    it("should parse GitHub linking keywords", () => {
      const description = `
Closes: #100
Fixes: #200
Resolves: #300
`;
      const result = parsePRDescription(101, description);

      expect(result.dependencies).toEqual(["#100", "#200", "#300"]);
    });

    it("should handle cross-repo dependencies", () => {
      const description = "Depends-on: owner/repo#123, otherrepo#456";
      const result = parsePRDescription(101, description);

      expect(result.dependencies).toEqual(["otherrepo#456", "owner/repo#123"]);
    });

    it("should handle mixed dependency formats", () => {
      const description = `
Depends-on: #123
Depends: PR-456
Requires: owner/repo#789
Closes: #101
`;
      const result = parsePRDescription(102, description);

      expect(result.dependencies).toEqual(["#101", "#123", "#456", "owner/repo#789"]);
    });

    it("should deduplicate dependencies", () => {
      const description = `
Depends-on: #123, #456
Depends: PR-123
Requires: #123
`;
      const result = parsePRDescription(101, description);

      expect(result.dependencies).toEqual(["#123", "#456"]);
    });

    it("should handle empty PR description", () => {
      const result = parsePRDescription(101, null);

      expect(result.prId).toBe("PR-101");
      expect(result.dependencies).toEqual([]);
    });

    it("should handle PR description with no dependencies", () => {
      const description = "This is a simple PR with no dependencies";
      const result = parsePRDescription(101, description);

      expect(result.dependencies).toEqual([]);
    });
  });

  describe("Gate Overrides Extraction", () => {
    it("should extract skip gates", () => {
      const description = `
## Gates Override
Skip: e2e-tests, integration-tests
`;
      const result = parsePRDescription(101, description);

      expect(result.gates?.skip).toEqual(["e2e-tests", "integration-tests"]);
    });

    it("should extract required gates", () => {
      const description = `
## Gates Override
Required: security-scan, performance-test
`;
      const result = parsePRDescription(101, description);

      expect(result.gates?.required).toEqual(["performance-test", "security-scan"]);
    });

    it("should handle both skip and required gates", () => {
      const description = `
Skip: e2e-tests
Required: security-scan
`;
      const result = parsePRDescription(101, description);

      expect(result.gates?.skip).toEqual(["e2e-tests"]);
      expect(result.gates?.required).toEqual(["security-scan"]);
    });

    it("should use alternate gate syntax", () => {
      const description = `
Skip-gates: test1, test2
Required-gates: gate1, gate2
`;
      const result = parsePRDescription(101, description);

      expect(result.gates?.skip).toEqual(["test1", "test2"]);
      expect(result.gates?.required).toEqual(["gate1", "gate2"]);
    });
  });

  describe("Metadata Extraction", () => {
    it("should extract priority", () => {
      const description = `
Priority: high

This is an important PR
`;
      const result = parsePRDescription(101, description);

      expect(result.metadata?.priority).toBe("high");
    });

    it("should extract labels", () => {
      const description = `
Labels: feature, breaking, api-change
`;
      const result = parsePRDescription(101, description);

      expect(result.metadata?.labels).toEqual(["api-change", "breaking", "feature"]);
    });

    it("should extract multiple metadata fields", () => {
      const description = `
Priority: medium
Labels: bug, hotfix
`;
      const result = parsePRDescription(101, description);

      expect(result.metadata?.priority).toBe("medium");
      expect(result.metadata?.labels).toEqual(["bug", "hotfix"]);
    });
  });

  describe("YAML Front-Matter Parsing", () => {
    it("should parse YAML front-matter", () => {
      const description = `---
priority: critical
epic: user-authentication
story_points: 8
---

## Description
This PR implements authentication
`;
      const result = parsePRDescription(101, description);

      expect(result.metadata?.priority).toBe("critical");
      expect(result.metadata?.epic).toBe("user-authentication");
      expect(result.metadata?.story_points).toBe(8);
    });

    it("should handle invalid YAML gracefully", () => {
      const description = `---
invalid: yaml: structure:
---

Regular content
`;
      const result = parsePRDescription(101, description);

      // Should not throw, just skip invalid YAML
      expect(result.prId).toBe("PR-101");
    });
  });

  describe("Complex PR Description Examples", () => {
    it("should parse comprehensive PR template", () => {
      const description = `---
priority: high
epic: B1-diffgraph-planner
---

## Dependencies
Depends-on: #123, #456
Requires: owner/repo#789

## Gates Override
Skip: e2e-tests
Required: security-scan

## Description
This implements the dependency parser

Priority: high
Labels: feature, breaking
`;
      const result = parsePRDescription(101, description);

      expect(result.prId).toBe("PR-101");
      expect(result.dependencies).toEqual(["#123", "#456", "owner/repo#789"]);
      expect(result.gates?.skip).toEqual(["e2e-tests"]);
      expect(result.gates?.required).toEqual(["security-scan"]);
      expect(result.metadata?.priority).toBe("high");
      expect(result.metadata?.epic).toBe("B1-diffgraph-planner");
      expect(result.metadata?.labels).toEqual(["breaking", "feature"]);
    });
  });

  describe("Partial Extraction Mode", () => {
    it("should continue parsing on minor errors with partialExtraction", () => {
      const description = `
Depends-on: #123, invalid-ref
Requires: #456
`;
      const result = parsePRDescription(101, description, { partialExtraction: true });

      // Should extract what it can
      expect(result.dependencies).toContain("#123");
      expect(result.dependencies).toContain("#456");
    });
  });
});

describe("Dependency Validation", () => {
  describe("Circular Dependency Detection", () => {
    it("should detect simple circular dependency", () => {
      const prs: ParsedDependency[] = [
        { prId: "PR-1", dependencies: ["#2"] },
        { prId: "PR-2", dependencies: ["#1"] },
      ];

      expect(() => validateDependencies(prs)).toThrow(/Circular dependency/);
    });

    it("should detect complex circular dependency", () => {
      const prs: ParsedDependency[] = [
        { prId: "PR-1", dependencies: ["#2"] },
        { prId: "PR-2", dependencies: ["#3"] },
        { prId: "PR-3", dependencies: ["#1"] },
      ];

      expect(() => validateDependencies(prs)).toThrow(/Circular dependency/);
    });

    it("should pass validation for valid dependency chain", () => {
      const prs: ParsedDependency[] = [
        { prId: "PR-1", dependencies: [] },
        { prId: "PR-2", dependencies: ["#1"] },
        { prId: "PR-3", dependencies: ["#2"] },
      ];

      expect(() => validateDependencies(prs)).not.toThrow();
    });

    it("should handle diamond dependencies without cycle", () => {
      const prs: ParsedDependency[] = [
        { prId: "PR-1", dependencies: [] },
        { prId: "PR-2", dependencies: ["#1"] },
        { prId: "PR-3", dependencies: ["#1"] },
        { prId: "PR-4", dependencies: ["#2", "#3"] },
      ];

      expect(() => validateDependencies(prs)).not.toThrow();
    });
  });

  describe("Dependency Reference Validation", () => {
    it("should validate simple PR reference", () => {
      expect(isValidDependencyRef("#123")).toBe(true);
      expect(isValidDependencyRef("PR-123")).toBe(true);
    });

    it("should validate cross-repo references", () => {
      expect(isValidDependencyRef("owner/repo#123")).toBe(true);
      expect(isValidDependencyRef("repo#456")).toBe(true);
    });

    it("should reject invalid references", () => {
      expect(isValidDependencyRef("invalid")).toBe(false);
      expect(isValidDependencyRef("123")).toBe(false);
      expect(isValidDependencyRef("#")).toBe(false);
    });
  });

  describe("Dependency Normalization", () => {
    it("should normalize simple references", () => {
      expect(normalizeDependencyRef("#123")).toBe("#123");
      expect(normalizeDependencyRef("PR-123")).toBe("#123");
    });

    it("should normalize with repository context", () => {
      expect(normalizeDependencyRef("#123", "owner/repo")).toBe("owner/repo#123");
      expect(normalizeDependencyRef("PR-456", "owner/repo")).toBe("owner/repo#456");
    });

    it("should preserve full references", () => {
      expect(normalizeDependencyRef("owner/repo#123")).toBe("owner/repo#123");
      expect(normalizeDependencyRef("repo#456")).toBe("repo#456");
    });
  });
});

describe("Edge Cases and Error Handling", () => {
  it("should handle whitespace variations", () => {
    const description = `
Depends-on:    #123  ,   #456   
Requires:  #789
`;
    const result = parsePRDescription(101, description);

    expect(result.dependencies).toEqual(["#123", "#456", "#789"]);
  });

  it("should handle case-insensitive PR format", () => {
    const description = "Depends: pr-123, PR-456, Pr-789";
    const result = parsePRDescription(101, description);

    expect(result.dependencies).toEqual(["#123", "#456", "#789"]);
  });

  it("should handle multiline descriptions", () => {
    const description = `
This is a long description
that spans multiple lines

Depends-on: #123

More content here
`;
    const result = parsePRDescription(101, description);

    expect(result.dependencies).toEqual(["#123"]);
  });

  it("should handle dependencies in different sections", () => {
    const description = `
## Overview
Some text

## Dependencies  
Depends-on: #100

## More Info
Additional content

Requires: #200
`;
    const result = parsePRDescription(101, description);

    expect(result.dependencies).toEqual(["#100", "#200"]);
  });
});
