/**
 * Compliance Policy Enforcement
 *
 * Enforces organizational policies for:
 * - Approval requirements
 * - Review policies
 * - Branch protection
 * - Merge restrictions
 */

import { AuthContext } from "./authentication.js";
import { Permission } from "./authorization.js";

/**
 * Approval requirement configuration
 */
export interface ApprovalRequirement {
  /** Minimum number of approvals required */
  minApprovals: number;
  /** Required reviewer roles */
  requiredReviewers?: string[];
  /** Require approval from code owners */
  requireCodeOwners: boolean;
  /** Dismiss stale approvals on new commits */
  dismissStaleApprovals: boolean;
}

/**
 * Review policy configuration
 */
export interface ReviewPolicy {
  /** Require review before merge */
  requireReview: boolean;
  /** Approval requirements */
  approvalRequirement: ApprovalRequirement;
  /** Allow self-approval */
  allowSelfApproval: boolean;
  /** Require conversation resolution */
  requireConversationResolution: boolean;
}

/**
 * Branch protection configuration
 */
export interface BranchProtection {
  /** Protected branch pattern */
  pattern: string;
  /** Require status checks */
  requireStatusChecks: boolean;
  /** Required status check names */
  requiredChecks: string[];
  /** Require up-to-date branches */
  requireUpToDate: boolean;
  /** Restrict who can push */
  restrictPushers: boolean;
  /** Allowed pushers (roles/users) */
  allowedPushers: string[];
}

/**
 * Merge restriction configuration
 */
export interface MergeRestriction {
  /** Allowed merge strategies */
  allowedStrategies: ("merge" | "squash" | "rebase")[];
  /** Require linear history */
  requireLinearHistory: boolean;
  /** Require signed commits */
  requireSignedCommits: boolean;
  /** Block force pushes */
  blockForcePush: boolean;
}

/**
 * Compliance policy configuration
 */
export interface CompliancePolicy {
  /** Review policy */
  reviewPolicy: ReviewPolicy;
  /** Branch protections */
  branchProtections: BranchProtection[];
  /** Merge restrictions */
  mergeRestrictions: MergeRestriction;
  /** Require security scanning */
  requireSecurityScan: boolean;
  /** Maximum allowed vulnerability severity */
  maxVulnerabilitySeverity: "critical" | "high" | "medium" | "low";
}

/**
 * Default compliance policy
 */
export const DEFAULT_COMPLIANCE_POLICY: CompliancePolicy = {
  reviewPolicy: {
    requireReview: true,
    approvalRequirement: {
      minApprovals: 1,
      requireCodeOwners: false,
      dismissStaleApprovals: true,
    },
    allowSelfApproval: false,
    requireConversationResolution: true,
  },
  branchProtections: [
    {
      pattern: "main",
      requireStatusChecks: true,
      requiredChecks: ["ci/test", "ci/lint"],
      requireUpToDate: true,
      restrictPushers: true,
      allowedPushers: ["admin", "release-manager"],
    },
  ],
  mergeRestrictions: {
    allowedStrategies: ["merge", "squash"],
    requireLinearHistory: false,
    requireSignedCommits: false,
    blockForcePush: true,
  },
  requireSecurityScan: true,
  maxVulnerabilitySeverity: "high",
};

/**
 * Policy enforcement result
 */
export interface EnforcementResult {
  /** Whether policy is satisfied */
  allowed: boolean;
  /** Violations found */
  violations: string[];
  /** Warnings (non-blocking) */
  warnings: string[];
}

/**
 * PR approval status
 */
export interface PRApprovalStatus {
  prNumber: number;
  approvals: Array<{
    reviewer: string;
    timestamp: Date;
  }>;
  requestedReviewers: string[];
  hasCodeOwnerApproval: boolean;
}

/**
 * Compliance Policy Enforcement Service
 */
export class CompliancePolicyService {
  private policy: CompliancePolicy;

  constructor(policy?: Partial<CompliancePolicy>) {
    this.policy = { ...DEFAULT_COMPLIANCE_POLICY, ...policy };
  }

  /**
   * Update policy configuration
   */
  updatePolicy(policy: Partial<CompliancePolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  /**
   * Get current policy
   */
  getPolicy(): CompliancePolicy {
    return { ...this.policy };
  }

  /**
   * Check if merge is allowed based on approval policy
   */
  checkApprovalPolicy(status: PRApprovalStatus, authContext: AuthContext): EnforcementResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (!this.policy.reviewPolicy.requireReview) {
      return { allowed: true, violations, warnings };
    }

    const { approvalRequirement, allowSelfApproval } = this.policy.reviewPolicy;

    // Check minimum approvals
    if (status.approvals.length < approvalRequirement.minApprovals) {
      violations.push(
        `Insufficient approvals: ${status.approvals.length}/${approvalRequirement.minApprovals} required`
      );
    }

    // Check self-approval
    if (!allowSelfApproval) {
      const selfApproval = status.approvals.some((a) => a.reviewer === authContext.user);
      if (selfApproval) {
        violations.push("Self-approval not allowed by policy");
      }
    }

    // Check code owner approval
    if (approvalRequirement.requireCodeOwners && !status.hasCodeOwnerApproval) {
      violations.push("Code owner approval required");
    }

    // Check required reviewers
    if (approvalRequirement.requiredReviewers) {
      const approverRoles = status.approvals.map((a) => a.reviewer);
      const missingReviewers = approvalRequirement.requiredReviewers.filter(
        (role) => !approverRoles.includes(role)
      );

      if (missingReviewers.length > 0) {
        violations.push(`Missing required reviewers: ${missingReviewers.join(", ")}`);
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      warnings,
    };
  }

  /**
   * Check if branch is protected
   */
  checkBranchProtection(branchName: string, authContext: AuthContext): EnforcementResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Find matching protection
    const protection = this.policy.branchProtections.find((p) =>
      this.matchesBranchPattern(branchName, p.pattern)
    );

    if (!protection) {
      return { allowed: true, violations, warnings };
    }

    // Check if user can push to protected branch
    if (protection.restrictPushers) {
      const canPush = protection.allowedPushers.some((role) => authContext.roles.includes(role));

      if (!canPush) {
        violations.push(
          `User '${authContext.user}' not authorized to push to protected branch '${branchName}'`
        );
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      warnings,
    };
  }

  /**
   * Check if merge strategy is allowed
   */
  checkMergeStrategy(strategy: "merge" | "squash" | "rebase"): EnforcementResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (!this.policy.mergeRestrictions.allowedStrategies.includes(strategy)) {
      violations.push(
        `Merge strategy '${strategy}' not allowed. Allowed: ${this.policy.mergeRestrictions.allowedStrategies.join(", ")}`
      );
    }

    return {
      allowed: violations.length === 0,
      violations,
      warnings,
    };
  }

  /**
   * Check if force push is allowed
   */
  checkForcePush(): EnforcementResult {
    const violations: string[] = [];

    if (this.policy.mergeRestrictions.blockForcePush) {
      violations.push("Force push blocked by policy");
    }

    return {
      allowed: violations.length === 0,
      violations: violations,
      warnings: [],
    };
  }

  /**
   * Comprehensive policy check for merge operation
   */
  checkMergeOperation(
    prStatus: PRApprovalStatus,
    targetBranch: string,
    mergeStrategy: "merge" | "squash" | "rebase",
    authContext: AuthContext
  ): EnforcementResult {
    const results: EnforcementResult[] = [
      this.checkApprovalPolicy(prStatus, authContext),
      this.checkBranchProtection(targetBranch, authContext),
      this.checkMergeStrategy(mergeStrategy),
    ];

    // Aggregate results
    const allViolations = results.flatMap((r) => r.violations);
    const allWarnings = results.flatMap((r) => r.warnings);

    return {
      allowed: allViolations.length === 0,
      violations: allViolations,
      warnings: allWarnings,
    };
  }

  /**
   * Match branch name against pattern
   */
  private matchesBranchPattern(branchName: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return regex.test(branchName);
  }

  /**
   * Generate policy report
   */
  generatePolicyReport(): string {
    const lines: string[] = [];

    lines.push("# Compliance Policy Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    // Review policy
    lines.push("## Review Policy");
    lines.push("");
    lines.push(`- Require Review: ${this.policy.reviewPolicy.requireReview ? "Yes" : "No"}`);
    lines.push(`- Minimum Approvals: ${this.policy.reviewPolicy.approvalRequirement.minApprovals}`);
    lines.push(
      `- Require Code Owners: ${this.policy.reviewPolicy.approvalRequirement.requireCodeOwners ? "Yes" : "No"}`
    );
    lines.push(
      `- Allow Self-Approval: ${this.policy.reviewPolicy.allowSelfApproval ? "Yes" : "No"}`
    );
    lines.push("");

    // Branch protections
    lines.push("## Branch Protections");
    lines.push("");
    for (const protection of this.policy.branchProtections) {
      lines.push(`### Pattern: ${protection.pattern}`);
      lines.push(`- Require Status Checks: ${protection.requireStatusChecks ? "Yes" : "No"}`);
      if (protection.requireStatusChecks) {
        lines.push(`- Required Checks: ${protection.requiredChecks.join(", ")}`);
      }
      lines.push(`- Restrict Pushers: ${protection.restrictPushers ? "Yes" : "No"}`);
      if (protection.restrictPushers) {
        lines.push(`- Allowed Pushers: ${protection.allowedPushers.join(", ")}`);
      }
      lines.push("");
    }

    // Merge restrictions
    lines.push("## Merge Restrictions");
    lines.push("");
    lines.push(
      `- Allowed Strategies: ${this.policy.mergeRestrictions.allowedStrategies.join(", ")}`
    );
    lines.push(
      `- Require Linear History: ${this.policy.mergeRestrictions.requireLinearHistory ? "Yes" : "No"}`
    );
    lines.push(
      `- Require Signed Commits: ${this.policy.mergeRestrictions.requireSignedCommits ? "Yes" : "No"}`
    );
    lines.push(
      `- Block Force Push: ${this.policy.mergeRestrictions.blockForcePush ? "Yes" : "No"}`
    );
    lines.push("");

    // Security requirements
    lines.push("## Security Requirements");
    lines.push("");
    lines.push(`- Require Security Scan: ${this.policy.requireSecurityScan ? "Yes" : "No"}`);
    lines.push(
      `- Max Vulnerability Severity: ${this.policy.maxVulnerabilitySeverity.toUpperCase()}`
    );
    lines.push("");

    return lines.join("\n");
  }
}
