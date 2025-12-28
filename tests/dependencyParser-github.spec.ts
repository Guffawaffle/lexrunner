/**
 * Additional tests for GitHub integration with dependency parser
 */

import { describe, it, expect } from "vitest";
import { parsePRDescription } from "../src/planner/dependencyParser.js";

describe("GitHub PR Description Examples", () => {
  it("should parse real-world PR template with all features", () => {
    const description = `---
priority: high
epic: B1-diffgraph-planner
story_points: 5
assignee: developer1
---

## Description
Implement PR description parser for dependency extraction

## Dependencies
Depends-on: #75
Requires: #80

## Gates Override
Skip: e2e-tests
Required: security-scan, performance-test

## Testing
- Unit tests added
- Integration tests passing

Labels: feature, breaking-change, needs-review
`;

    const result = parsePRDescription(101, description);

    expect(result.prId).toBe("PR-101");
    expect(result.dependencies).toEqual(["#75", "#80"]);
    expect(result.gates?.skip).toEqual(["e2e-tests"]);
    expect(result.gates?.required).toEqual(["performance-test", "security-scan"]);
    expect(result.metadata?.priority).toBe("high"); // Front-matter priority
    expect(result.metadata?.epic).toBe("B1-diffgraph-planner");
    expect(result.metadata?.story_points).toBe(5);
    expect(result.metadata?.labels).toEqual(["breaking-change", "feature", "needs-review"]);
  });

  it("should handle GitHub issue linking patterns", () => {
    const description = `
This PR fixes several issues:

Closes: #100
Fixes: #200, #300
Resolves: #400

Also depends on:
Depends-on: #500
`;

    const result = parsePRDescription(101, description);

    expect(result.dependencies).toEqual(["#100", "#200", "#300", "#400", "#500"]);
  });

  it("should handle cross-repository dependencies", () => {
    const description = `
## Cross-repo dependencies
Depends-on: upstream/core#123, downstream/api#456
Requires: sibling-repo#789
`;

    const result = parsePRDescription(101, description);

    expect(result.dependencies).toEqual([
      "downstream/api#456",
      "sibling-repo#789",
      "upstream/core#123",
    ]);
  });

  it("should handle stack-based workflow PR", () => {
    const description = `
**Stack Position**: 3/5

**Depends on**:
Depends-on: #101, #102

**Changes**:
- Feature implementation
- Tests added

Required: lint, typecheck, test
Skip: deploy
`;

    const result = parsePRDescription(103, description);

    expect(result.prId).toBe("PR-103");
    expect(result.dependencies).toEqual(["#101", "#102"]);
    expect(result.gates?.skip).toEqual(["deploy"]);
    expect(result.gates?.required).toEqual(["lint", "test", "typecheck"]);
  });

  it("should handle minimal PR with just dependencies", () => {
    const description = "Depends-on: #42";
    const result = parsePRDescription(50, description);

    expect(result.prId).toBe("PR-50");
    expect(result.dependencies).toEqual(["#42"]);
    expect(result.gates).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it("should handle PR with only gate overrides", () => {
    const description = `
Skip-gates: flaky-test, slow-integration
Required-gates: critical-security-scan
`;
    const result = parsePRDescription(60, description);

    expect(result.dependencies).toEqual([]);
    expect(result.gates?.skip).toEqual(["flaky-test", "slow-integration"]);
    expect(result.gates?.required).toEqual(["critical-security-scan"]);
  });

  it("should handle PR with embedded checklist", () => {
    const description = `
## Checklist
- [x] Tests added
- [x] Docs updated
- [ ] Security review

## Dependencies
Depends: PR-100, PR-200

## Tasks
- [x] Implementation
- [ ] Deployment
`;

    const result = parsePRDescription(70, description);

    expect(result.dependencies).toEqual(["#100", "#200"]);
  });

  it("should handle PR with code blocks and dependencies", () => {
    const description = `
## Implementation

\`\`\`typescript
function example() {
  // Depends-on: #999 (this should NOT be parsed)
  return "code";
}
\`\`\`

## Real Dependencies
Depends-on: #123
`;

    const result = parsePRDescription(80, description);

    // Should only find the dependency outside code block
    expect(result.dependencies).toEqual(["#123"]);
  });

  it("should handle dependencies with mixed formats in same line", () => {
    const description = "Depends-on: #123, PR-456, owner/repo#789";
    const result = parsePRDescription(90, description);

    expect(result.dependencies).toEqual(["#123", "#456", "owner/repo#789"]);
  });

  it("should handle multi-line gate specifications", () => {
    const description = `
## Gates Configuration

Skip: lint, typecheck, unit-tests

Required: integration-tests, e2e-tests, security-scan
`;

    const result = parsePRDescription(95, description);

    expect(result.gates?.skip).toEqual(["lint", "typecheck", "unit-tests"]);
    expect(result.gates?.required).toEqual(["e2e-tests", "integration-tests", "security-scan"]);
  });
});

describe("Parser Output Format Validation", () => {
  it("should produce output matching expected JSON format from problem statement", () => {
    const description = `
## Dependencies
Depends-on: #123, #456

## Gates Override
Skip: e2e-tests
Required: security-scan

Priority: high
Labels: feature, breaking
`;

    const result = parsePRDescription(101, description);

    // Verify output format matches the problem statement example
    expect(result).toMatchObject({
      prId: "PR-101",
      dependencies: ["#123", "#456"],
      gates: {
        skip: ["e2e-tests"],
        required: ["security-scan"],
      },
      metadata: {
        priority: "high",
        labels: ["breaking", "feature"],
      },
    });
  });

  it("should omit empty fields from output", () => {
    const description = "Simple PR description";
    const result = parsePRDescription(101, description);

    expect(result.prId).toBe("PR-101");
    expect(result.dependencies).toEqual([]);
    expect(result.gates).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it("should maintain deterministic ordering", () => {
    const description = `
Depends-on: #999, #100, #500, #200
Labels: zebra, alpha, beta
Skip: z-gate, a-gate, m-gate
`;

    const result = parsePRDescription(101, description);

    // All arrays should be sorted
    expect(result.dependencies).toEqual(["#100", "#200", "#500", "#999"]);
    expect(result.metadata?.labels).toEqual(["alpha", "beta", "zebra"]);
    expect(result.gates?.skip).toEqual(["a-gate", "m-gate", "z-gate"]);
  });
});
