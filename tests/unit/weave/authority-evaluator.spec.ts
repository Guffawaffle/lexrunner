/**
 * Admin Authority Evaluator Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateAdminAuthority,
  checkEscalationTriggers,
  type PRContext,
} from "../../../src/weave/authority/evaluator.js";
import type { EnhancedAdminAuthorityConfig } from "../../../src/weave/authority/schema.js";

describe("AdminAuthority Evaluator", () => {
  // Common test fixtures using correct PRContext interface
  const basePRContext: PRContext = {
    owner: "test-owner",
    repo: "test-repo",
    number: 123,
    title: "Test PR",
    author: "test-user",
    authorType: "user",
    labels: [],
    files: ["src/test.ts"],
    mergeable: true,
    mergeableState: "clean",
    reviewRequests: { users: [], teams: [] },
    reviews: [],
    ciChecks: [{ name: "ci", status: "completed", conclusion: "success" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("evaluateAdminAuthority", () => {
    it("returns authority_granted when no conditions defined", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [],
      };

      const result = await evaluateAdminAuthority(config, basePRContext);

      expect(result.authority_granted).toBe(true);
      expect(result.condition_results).toEqual([]);
      expect(result.escalation_required).toBe(false);
    });

    it("returns not granted when disabled", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: false,
        conditions: [],
      };

      const result = await evaluateAdminAuthority(config, basePRContext);

      expect(result.authority_granted).toBe(false);
      expect(result.conditions_failed).toContain("admin_authority_disabled");
      expect(result.escalation_required).toBe(true);
    });

    it("evaluates label condition - pass", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "label",
            labels_absent: ["do-not-merge"],
            labels_present: [],
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        labels: ["ready"],
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(true);
      expect(result.condition_results).toHaveLength(1);
      expect(result.condition_results[0].passed).toBe(true);
    });

    it("evaluates label condition - fail on blocked label", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "label",
            labels_absent: ["do-not-merge"],
            labels_present: [],
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        labels: ["do-not-merge"],
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(false);
      expect(result.condition_results).toHaveLength(1);
      expect(result.condition_results[0].passed).toBe(false);
    });

    it("evaluates mergeable condition - pass", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "mergeable",
            require_mergeable: true,
            blocked_states: ["dirty", "blocked"],
            retry_on_unknown: true,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        mergeable: true,
        mergeableState: "clean",
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(true);
    });

    it("evaluates mergeable condition - fail on blocked state", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "mergeable",
            require_mergeable: true,
            blocked_states: ["dirty", "blocked"],
            retry_on_unknown: true,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        mergeable: false,
        mergeableState: "blocked",
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(false);
    });

    it("evaluates ci_status condition - pass", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "ci_status",
            all_checks_pass: true,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        ciChecks: [{ name: "ci", status: "completed", conclusion: "success" }],
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(true);
    });

    it("evaluates ci_status condition - fail", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "ci_status",
            all_checks_pass: true,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        ciChecks: [{ name: "ci", status: "completed", conclusion: "failure" }],
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(false);
    });

    it("evaluates review condition - pass when no pending requests", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "review",
            no_pending_requests: true,
            min_approvals: 0,
            block_on_changes_requested: false,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        reviewRequests: { users: [], teams: [] },
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(true);
    });

    it("evaluates author condition - pass on allowed", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "author",
            allowed_authors: ["test-user", "admin-user"],
            blocked_authors: [],
          },
        ],
      };

      const result = await evaluateAdminAuthority(config, basePRContext);

      expect(result.authority_granted).toBe(true);
    });

    it("evaluates author condition - fail on blocked", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "author",
            allowed_authors: [],
            blocked_authors: ["test-user"],
          },
        ],
      };

      const result = await evaluateAdminAuthority(config, basePRContext);

      expect(result.authority_granted).toBe(false);
    });

    it("evaluates files condition - pass when no blocked patterns match", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "files",
            blocked_patterns: ["**/secrets/**"],
            allowed_patterns: [],
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        files: ["src/test.ts", "docs/readme.md"],
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(true);
    });

    it("evaluates multiple conditions - all must pass", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "label",
            labels_absent: ["wip"],
            labels_present: [],
          },
          {
            type: "mergeable",
            require_mergeable: true,
            blocked_states: ["dirty"],
            retry_on_unknown: true,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        labels: [],
        mergeable: true,
        mergeableState: "clean",
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(true);
      expect(result.condition_results.every((r) => r.passed)).toBe(true);
    });

    it("fails when any condition fails", async () => {
      const config: EnhancedAdminAuthorityConfig = {
        enabled: true,
        conditions: [
          {
            type: "label",
            labels_absent: ["wip"],
            labels_present: [],
          },
          {
            type: "mergeable",
            require_mergeable: true,
            blocked_states: ["dirty"],
            retry_on_unknown: true,
          },
        ],
      };

      const context: PRContext = {
        ...basePRContext,
        labels: ["wip"], // This will fail
        mergeable: true,
        mergeableState: "clean",
      };

      const result = await evaluateAdminAuthority(config, context);

      expect(result.authority_granted).toBe(false);
      expect(result.condition_results.some((r) => !r.passed)).toBe(true);
    });
  });

  describe("checkEscalationTriggers", () => {
    it("returns no escalation when no triggers defined", () => {
      const result = checkEscalationTriggers(undefined, basePRContext);
      expect(result.required).toBe(false);
    });

    it("detects label-based escalation", () => {
      const escalate_if = [
        {
          label_present: "needs-human-review",
          reason: "Human review required",
        },
      ];

      const context: PRContext = {
        ...basePRContext,
        labels: ["needs-human-review", "ready"],
      };

      const result = checkEscalationTriggers(escalate_if, context);

      expect(result.required).toBe(true);
      expect(result.reason).toBe("Human review required");
    });

    it("detects files-based escalation", () => {
      const escalate_if = [
        {
          files_touched_pattern: ["**/security/**"],
          reason: "Security files modified",
        },
      ];

      const context: PRContext = {
        ...basePRContext,
        files: ["src/security/auth.ts"],
      };

      const result = checkEscalationTriggers(escalate_if, context);

      expect(result.required).toBe(true);
      expect(result.reason).toBe("Security files modified");
    });

    it("does not trigger when no match", () => {
      const escalate_if = [
        {
          label_present: "needs-human-review",
          reason: "Human review required",
        },
      ];

      const context: PRContext = {
        ...basePRContext,
        labels: ["ready"],
      };

      const result = checkEscalationTriggers(escalate_if, context);

      expect(result.required).toBe(false);
    });
  });
});
