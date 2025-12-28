import { describe, it, expect, beforeEach } from "vitest";
import {
  CompliancePolicyService,
  DEFAULT_COMPLIANCE_POLICY,
  PRApprovalStatus,
  EnforcementResult,
} from "../src/security/policy";
import { AuthContext } from "../src/security/authentication";

describe("Security - Policy Enforcement", () => {
  let policyService: CompliancePolicyService;

  beforeEach(() => {
    policyService = new CompliancePolicyService();
  });

  describe("Default Policy", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_COMPLIANCE_POLICY.reviewPolicy.requireReview).toBe(true);
      expect(DEFAULT_COMPLIANCE_POLICY.reviewPolicy.approvalRequirement.minApprovals).toBe(1);
      expect(DEFAULT_COMPLIANCE_POLICY.mergeRestrictions.blockForcePush).toBe(true);
    });

    it("should allow policy updates", () => {
      policyService.updatePolicy({
        reviewPolicy: {
          ...DEFAULT_COMPLIANCE_POLICY.reviewPolicy,
          approvalRequirement: {
            ...DEFAULT_COMPLIANCE_POLICY.reviewPolicy.approvalRequirement,
            minApprovals: 2,
          },
        },
      });

      const policy = policyService.getPolicy();
      expect(policy.reviewPolicy.approvalRequirement.minApprovals).toBe(2);
    });
  });

  describe("Approval Policy", () => {
    it("should pass with sufficient approvals", () => {
      const status: PRApprovalStatus = {
        prNumber: 101,
        approvals: [{ reviewer: "reviewer1", timestamp: new Date() }],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const authContext: AuthContext = {
        user: "author",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkApprovalPolicy(status, authContext);
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should fail with insufficient approvals", () => {
      const status: PRApprovalStatus = {
        prNumber: 101,
        approvals: [],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const authContext: AuthContext = {
        user: "author",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkApprovalPolicy(status, authContext);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Insufficient approvals: 0/1 required");
    });

    it("should block self-approval when disabled", () => {
      const status: PRApprovalStatus = {
        prNumber: 101,
        approvals: [{ reviewer: "author", timestamp: new Date() }],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const authContext: AuthContext = {
        user: "author",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkApprovalPolicy(status, authContext);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("Self-approval"))).toBe(true);
    });

    it("should require code owner approval when configured", () => {
      policyService.updatePolicy({
        reviewPolicy: {
          ...DEFAULT_COMPLIANCE_POLICY.reviewPolicy,
          approvalRequirement: {
            ...DEFAULT_COMPLIANCE_POLICY.reviewPolicy.approvalRequirement,
            requireCodeOwners: true,
          },
        },
      });

      const status: PRApprovalStatus = {
        prNumber: 101,
        approvals: [{ reviewer: "reviewer1", timestamp: new Date() }],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const authContext: AuthContext = {
        user: "author",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkApprovalPolicy(status, authContext);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Code owner approval required");
    });
  });

  describe("Branch Protection", () => {
    it("should allow push to unprotected branch", () => {
      const authContext: AuthContext = {
        user: "developer",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkBranchProtection("feature/test", authContext);
      expect(result.allowed).toBe(true);
    });

    it("should block unauthorized push to protected branch", () => {
      const authContext: AuthContext = {
        user: "developer",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkBranchProtection("main", authContext);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("not authorized"))).toBe(true);
    });

    it("should allow authorized push to protected branch", () => {
      const authContext: AuthContext = {
        user: "admin",
        method: "token",
        roles: ["admin"],
      };

      const result = policyService.checkBranchProtection("main", authContext);
      expect(result.allowed).toBe(true);
    });

    it("should match branch patterns correctly", () => {
      policyService.updatePolicy({
        branchProtections: [
          {
            pattern: "release/*",
            requireStatusChecks: true,
            requiredChecks: [],
            requireUpToDate: true,
            restrictPushers: true,
            allowedPushers: ["release-manager"],
          },
        ],
      });

      const authContext: AuthContext = {
        user: "developer",
        method: "token",
        roles: ["developer"],
      };

      const result = policyService.checkBranchProtection("release/v1.0", authContext);
      expect(result.allowed).toBe(false);
    });
  });

  describe("Merge Strategy", () => {
    it("should allow configured merge strategy", () => {
      const result = policyService.checkMergeStrategy("merge");
      expect(result.allowed).toBe(true);
    });

    it("should block non-configured merge strategy", () => {
      policyService.updatePolicy({
        mergeRestrictions: {
          ...DEFAULT_COMPLIANCE_POLICY.mergeRestrictions,
          allowedStrategies: ["squash"],
        },
      });

      const result = policyService.checkMergeStrategy("merge");
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("not allowed"))).toBe(true);
    });
  });

  describe("Force Push", () => {
    it("should block force push when configured", () => {
      const result = policyService.checkForcePush();
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Force push blocked by policy");
    });

    it("should allow force push when not blocked", () => {
      policyService.updatePolicy({
        mergeRestrictions: {
          ...DEFAULT_COMPLIANCE_POLICY.mergeRestrictions,
          blockForcePush: false,
        },
      });

      const result = policyService.checkForcePush();
      expect(result.allowed).toBe(true);
    });
  });

  describe("Comprehensive Merge Check", () => {
    it("should pass all checks for valid merge", () => {
      const prStatus: PRApprovalStatus = {
        prNumber: 101,
        approvals: [{ reviewer: "reviewer1", timestamp: new Date() }],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const authContext: AuthContext = {
        user: "release-manager",
        method: "token",
        roles: ["release-manager"],
      };

      const result = policyService.checkMergeOperation(prStatus, "main", "merge", authContext);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should aggregate violations from multiple checks", () => {
      const prStatus: PRApprovalStatus = {
        prNumber: 101,
        approvals: [],
        requestedReviewers: [],
        hasCodeOwnerApproval: false,
      };

      const authContext: AuthContext = {
        user: "developer",
        method: "token",
        roles: ["developer"],
      };

      policyService.updatePolicy({
        mergeRestrictions: {
          ...DEFAULT_COMPLIANCE_POLICY.mergeRestrictions,
          allowedStrategies: ["squash"],
        },
      });

      const result = policyService.checkMergeOperation(prStatus, "main", "merge", authContext);

      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe("Policy Report", () => {
    it("should generate policy report", () => {
      const report = policyService.generatePolicyReport();

      expect(report).toContain("Compliance Policy Report");
      expect(report).toContain("Review Policy");
      expect(report).toContain("Branch Protections");
      expect(report).toContain("Merge Restrictions");
    });

    it("should include all policy settings in report", () => {
      const report = policyService.generatePolicyReport();

      expect(report).toContain("Minimum Approvals");
      expect(report).toContain("Allowed Strategies");
      expect(report).toContain("Block Force Push");
    });
  });
});
