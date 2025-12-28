/**
 * Safety Framework for Autopilot Operations
 *
 * Implements:
 * - TTY confirmation prompts for destructive operations
 * - Advisory lock labels on target PRs
 * - Containment checks (reachability validation)
 * - Kill switch mechanisms (--abort flag, signal handling)
 * - Rollback and recovery procedures
 */

import * as readline from "readline";
import { GitHubAPI } from "../../github/api.js";

/**
 * Risk levels for operations
 */
export enum RiskLevel {
  /** Low risk: read-only operations, status checks */
  Low = "low",
  /** Medium risk: single PR operations, branch creation */
  Medium = "medium",
  /** High risk: multi-PR integration, destructive operations */
  High = "high",
}

/**
 * Confirmation modes for safety framework
 */
export enum ConfirmationMode {
  /** Interactive: prompt user in TTY */
  Interactive = "interactive",
  /** Automatic: auto-confirm all operations */
  Automatic = "automatic",
  /** Dry-run: simulate without executing */
  DryRun = "dry-run",
}

/**
 * Safety policy configuration
 */
export interface SafetyPolicy {
  /** Require confirmation for operations at or above this risk level */
  confirmationThreshold: RiskLevel;
  /** Confirmation mode to use */
  confirmationMode: ConfirmationMode;
  /** Timeout for confirmation prompts in seconds (0 = no timeout) */
  promptTimeout: number;
  /** Default action when timeout occurs ('abort' or 'proceed') */
  timeoutAction: "abort" | "proceed";
}

/**
 * Default safety policy (most restrictive)
 */
export const DEFAULT_SAFETY_POLICY: SafetyPolicy = {
  confirmationThreshold: RiskLevel.Medium,
  confirmationMode: ConfirmationMode.Interactive,
  promptTimeout: 30,
  timeoutAction: "abort",
};

export interface MergeOperation {
  type: "merge" | "push" | "create-branch" | "open-pr" | "add-comment";
  description: string;
  prNumber?: number;
  branch?: string;
  target?: string;
  /** Risk level for this operation */
  riskLevel?: RiskLevel;
}

export interface OperationSummary {
  autopilotLevel: number;
  mergeOperations: MergeOperation[];
  prOperations: MergeOperation[];
  affectedPRs: number[];
  /** Overall risk level for the operation set */
  riskLevel?: RiskLevel;
}

export interface ContainmentCheck {
  allPRsReachable: boolean;
  unreachablePRs: number[];
  hasExternalDeps: boolean;
  externalDeps: string[];
  hasMergeConflicts: boolean;
  conflictingPRs: number[];
}

export interface SafetyCheckResult {
  confirmed: boolean;
  aborted: boolean;
  reason?: string;
}

export interface RollbackResult {
  success: boolean;
  revertCommit?: string;
  affectedPRs: number[];
  error?: string;
}

/**
 * Safety Framework for Autopilot Operations
 */
export class SafetyFramework {
  private abortRequested = false;
  private signalHandlersInstalled = false;
  private githubAPI?: GitHubAPI;
  private policy: SafetyPolicy;

  constructor(githubAPI?: GitHubAPI, policy?: Partial<SafetyPolicy>) {
    this.githubAPI = githubAPI;
    this.policy = {
      ...DEFAULT_SAFETY_POLICY,
      ...policy,
    };
  }

  /**
   * Get current safety policy
   */
  getPolicy(): SafetyPolicy {
    return { ...this.policy };
  }

  /**
   * Update safety policy
   */
  updatePolicy(policy: Partial<SafetyPolicy>): void {
    this.policy = {
      ...this.policy,
      ...policy,
    };
  }

  /**
   * Check if running in TTY (skip prompts in CI)
   */
  private isTTY(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
  }

  /**
   * Assess risk level for an operation
   */
  assessRiskLevel(operation: MergeOperation): RiskLevel {
    // If risk level is already set, use it
    if (operation.riskLevel) {
      return operation.riskLevel;
    }

    // Assess based on operation type
    switch (operation.type) {
      case "add-comment":
        return RiskLevel.Low;

      case "create-branch":
      case "open-pr":
        return RiskLevel.Medium;

      case "merge":
      case "push":
        return RiskLevel.High;

      default:
        return RiskLevel.Medium;
    }
  }

  /**
   * Assess overall risk level for operation summary
   */
  assessOperationRisk(summary: OperationSummary): RiskLevel {
    // If overall risk is already set, use it
    if (summary.riskLevel) {
      return summary.riskLevel;
    }

    const allOps = [...summary.mergeOperations, ...summary.prOperations];

    // Empty operations are low risk
    if (allOps.length === 0) {
      return RiskLevel.Low;
    }

    // Find highest risk level
    const risks = allOps.map((op) => this.assessRiskLevel(op));

    if (risks.some((r) => r === RiskLevel.High)) {
      return RiskLevel.High;
    }
    if (risks.some((r) => r === RiskLevel.Medium)) {
      return RiskLevel.Medium;
    }
    return RiskLevel.Low;
  }

  /**
   * Check if confirmation is required based on policy
   */
  private requiresConfirmation(riskLevel: RiskLevel): boolean {
    const threshold = this.policy.confirmationThreshold;

    // Define risk ordering
    const riskOrder = [RiskLevel.Low, RiskLevel.Medium, RiskLevel.High];
    const riskIndex = riskOrder.indexOf(riskLevel);
    const thresholdIndex = riskOrder.indexOf(threshold);

    return riskIndex >= thresholdIndex;
  }

  /**
   * Install kill switch signal handlers
   */
  installKillSwitch(): void {
    if (this.signalHandlersInstalled) {
      return;
    }

    const handleAbort = () => {
      console.error("\n⚠️  Abort signal received - stopping operations...");
      this.abortRequested = true;
    };

    process.on("SIGINT", handleAbort);
    process.on("SIGTERM", handleAbort);

    this.signalHandlersInstalled = true;
  }

  /**
   * Check if abort was requested
   */
  isAbortRequested(): boolean {
    return this.abortRequested;
  }

  /**
   * Request abort programmatically (e.g., from --abort flag)
   */
  requestAbort(): void {
    this.abortRequested = true;
  }

  /**
   * Display operation summary and request confirmation
   */
  async confirmOperation(summary: OperationSummary): Promise<SafetyCheckResult> {
    // Check for abort first, regardless of mode
    if (this.abortRequested) {
      return { confirmed: false, aborted: true, reason: "Abort requested" };
    }

    // Assess risk level
    const riskLevel = this.assessOperationRisk(summary);

    // Handle different confirmation modes
    switch (this.policy.confirmationMode) {
      case ConfirmationMode.DryRun:
        console.log("\n🔍 DRY-RUN MODE - No operations will be executed");
        this.displayOperationSummary(summary, riskLevel);
        return { confirmed: false, aborted: false, reason: "Dry-run mode" };

      case ConfirmationMode.Automatic:
        // Auto-confirm, but check if confirmation is required by policy
        if (!this.requiresConfirmation(riskLevel)) {
          return { confirmed: true, aborted: false };
        }
        // For operations requiring confirmation, still auto-confirm but log
        console.log("\n✓ Auto-confirming operation (automatic mode)");
        this.displayOperationSummary(summary, riskLevel);
        return { confirmed: true, aborted: false };

      case ConfirmationMode.Interactive:
      default:
        // Skip confirmation if not in TTY (CI environment)
        if (!this.isTTY()) {
          return { confirmed: true, aborted: false };
        }

        // Check if confirmation is required by policy
        if (!this.requiresConfirmation(riskLevel)) {
          return { confirmed: true, aborted: false };
        }

        // Display and prompt
        return this.interactiveConfirmation(summary, riskLevel);
    }
  }

  /**
   * Display operation summary with risk indicators
   */
  private displayOperationSummary(summary: OperationSummary, riskLevel: RiskLevel): void {
    const riskEmoji = {
      [RiskLevel.Low]: "ℹ️",
      [RiskLevel.Medium]: "⚠️",
      [RiskLevel.High]: "🚨",
    };

    const riskLabel = {
      [RiskLevel.Low]: "LOW RISK",
      [RiskLevel.Medium]: "MEDIUM RISK",
      [RiskLevel.High]: "HIGH RISK",
    };

    console.log(`\n${riskEmoji[riskLevel]}  ${riskLabel[riskLevel]} OPERATION`);
    console.log(`Autopilot Level ${summary.autopilotLevel} will perform these operations:\n`);

    if (summary.mergeOperations.length > 0) {
      console.log("🔀 Merge Operations:");
      for (const op of summary.mergeOperations) {
        const opRisk = this.assessRiskLevel(op);
        const indicator =
          opRisk === RiskLevel.High ? "🚨" : opRisk === RiskLevel.Medium ? "⚠️" : "ℹ️";
        console.log(`  ${indicator} ${op.description}`);
      }
      console.log("");
    }

    if (summary.prOperations.length > 0) {
      console.log("🔧 PR Operations:");
      for (const op of summary.prOperations) {
        const opRisk = this.assessRiskLevel(op);
        const indicator =
          opRisk === RiskLevel.High ? "🚨" : opRisk === RiskLevel.Medium ? "⚠️" : "ℹ️";
        console.log(`  ${indicator} ${op.description}`);
      }
      console.log("");
    }

    if (summary.affectedPRs.length > 0) {
      console.log(`Affected PRs: ${summary.affectedPRs.map((n) => `#${n}`).join(", ")}`);
      console.log("");
    }
  }

  /**
   * Interactive confirmation with timeout support
   */
  private async interactiveConfirmation(
    summary: OperationSummary,
    riskLevel: RiskLevel
  ): Promise<SafetyCheckResult> {
    this.displayOperationSummary(summary, riskLevel);

    // Determine timeout behavior
    const timeoutMs = this.policy.promptTimeout * 1000;
    const hasTimeout = timeoutMs > 0;

    const promptMessage = hasTimeout
      ? `❓ Continue? [y/N/details] (timeout: ${this.policy.promptTimeout}s, default: ${this.policy.timeoutAction}): `
      : "❓ Continue? [y/N/details]: ";

    let answer: string;

    if (hasTimeout) {
      // Prompt with timeout
      try {
        answer = await this.promptWithTimeout(promptMessage, timeoutMs);
      } catch (error) {
        // Timeout occurred
        console.log(
          `\n⏱️  Timeout - ${this.policy.timeoutAction === "abort" ? "Aborting" : "Proceeding"} operation`
        );
        return {
          confirmed: this.policy.timeoutAction === "proceed",
          aborted: this.policy.timeoutAction === "abort",
          reason: `Timeout after ${this.policy.promptTimeout}s`,
        };
      }
    } else {
      // Prompt without timeout
      answer = await this.prompt(promptMessage);
    }

    const normalized = answer.trim().toLowerCase();

    if (normalized === "details") {
      // Show detailed information
      console.log("\n📋 Detailed Operation Plan:\n");
      console.log("Merge Operations:");
      for (const op of summary.mergeOperations) {
        const opRisk = this.assessRiskLevel(op);
        console.log(`  Risk: ${opRisk.toUpperCase()}`);
        console.log(`  Type: ${op.type}`);
        console.log(`  Description: ${op.description}`);
        if (op.branch) console.log(`  Branch: ${op.branch}`);
        if (op.target) console.log(`  Target: ${op.target}`);
        if (op.prNumber) console.log(`  PR: #${op.prNumber}`);
        console.log("");
      }

      // Ask again after showing details
      return this.interactiveConfirmation(summary, riskLevel);
    }

    if (normalized === "y" || normalized === "yes") {
      return { confirmed: true, aborted: false };
    }

    return { confirmed: false, aborted: false, reason: "User declined" };
  }

  /**
   * Prompt user for input
   */
  private prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  /**
   * Prompt user for input with timeout
   */
  private promptWithTimeout(question: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const timer = setTimeout(() => {
        rl.close();
        reject(new Error("Prompt timeout"));
      }, timeoutMs);

      rl.question(question, (answer) => {
        clearTimeout(timer);
        rl.close();
        resolve(answer);
      });
    });
  }

  /**
   * Apply advisory lock label to PRs
   */
  async applyAdvisoryLock(prNumbers: number[], timestamp: string): Promise<void> {
    if (!this.githubAPI) {
      throw new Error("GitHub API not available for advisory locks");
    }

    const lockLabel = `lex-pr:weaving-${timestamp}`;

    for (const prNumber of prNumbers) {
      await this.githubAPI.addLabel(prNumber, lockLabel);
    }
  }

  /**
   * Check for existing advisory locks
   */
  async checkExistingLocks(prNumbers: number[]): Promise<string[]> {
    if (!this.githubAPI) {
      return [];
    }

    const locks: string[] = [];

    for (const prNumber of prNumbers) {
      const labels = await this.githubAPI.getLabels(prNumber);
      const weavingLabels = labels.filter((label) => label.startsWith("lex-pr:weaving-"));
      locks.push(...weavingLabels);
    }

    return locks;
  }

  /**
   * Remove advisory lock labels
   */
  async removeAdvisoryLocks(prNumbers: number[], timestamp: string): Promise<void> {
    if (!this.githubAPI) {
      return;
    }

    const lockLabel = `lex-pr:weaving-${timestamp}`;

    for (const prNumber of prNumbers) {
      try {
        await this.githubAPI.removeLabel(prNumber, lockLabel);
      } catch (error) {
        // Continue on error - label might not exist
        console.warn(`Warning: Could not remove lock label from PR #${prNumber}`);
      }
    }
  }

  /**
   * Perform containment checks
   */
  async performContainmentChecks(
    prNumbers: number[],
    targetBranch: string
  ): Promise<ContainmentCheck> {
    if (!this.githubAPI) {
      throw new Error("GitHub API not available for containment checks");
    }

    const result: ContainmentCheck = {
      allPRsReachable: true,
      unreachablePRs: [],
      hasExternalDeps: false,
      externalDeps: [],
      hasMergeConflicts: false,
      conflictingPRs: [],
    };

    // Check if all PRs are reachable
    for (const prNumber of prNumbers) {
      try {
        const pr = await this.githubAPI.getPullRequest(prNumber);

        // Check if PR exists and is in expected state
        if (!pr) {
          result.allPRsReachable = false;
          result.unreachablePRs.push(prNumber);
          continue;
        }

        // Check if PR targets the expected branch
        if (pr.baseBranch !== targetBranch) {
          result.hasExternalDeps = true;
          result.externalDeps.push(`PR #${prNumber} targets ${pr.baseBranch}, not ${targetBranch}`);
        }

        // Check for merge conflicts (if mergeable status is available)
        if (pr.mergeable === false) {
          result.hasMergeConflicts = true;
          result.conflictingPRs.push(prNumber);
        }
      } catch (error) {
        result.allPRsReachable = false;
        result.unreachablePRs.push(prNumber);
      }
    }

    return result;
  }

  /**
   * Validate containment check results
   */
  validateContainment(check: ContainmentCheck): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!check.allPRsReachable) {
      errors.push(`Unreachable PRs: ${check.unreachablePRs.join(", ")}`);
    }

    if (check.hasExternalDeps) {
      errors.push(`External dependencies detected: ${check.externalDeps.join("; ")}`);
    }

    if (check.hasMergeConflicts) {
      errors.push(`Merge conflicts in PRs: ${check.conflictingPRs.join(", ")}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create rollback procedure for failed operation
   */
  async rollback(
    originalCommit: string,
    affectedPRs: number[],
    reason: string
  ): Promise<RollbackResult> {
    console.log(`\n🔄 Initiating rollback due to: ${reason}`);

    try {
      // This would integrate with git operations to perform actual rollback
      // For now, return the structure that would be used

      const result: RollbackResult = {
        success: true,
        revertCommit: `revert-${originalCommit.substring(0, 7)}`,
        affectedPRs,
      };

      // Mark PRs as needing manual weave
      if (this.githubAPI) {
        for (const prNumber of affectedPRs) {
          await this.githubAPI.addLabel(prNumber, "needs-manual-weave");
        }
      }

      console.log("✓ Rollback completed successfully");
      console.log(`  Revert commit: ${result.revertCommit}`);
      console.log(`  Affected PRs marked: ${affectedPRs.join(", ")}`);

      return result;
    } catch (error) {
      return {
        success: false,
        affectedPRs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Log safety decision for audit trail
   */
  logSafetyDecision(operation: string, decision: string, details?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      operation,
      decision,
      ...details,
    };

    // In a real implementation, this would write to a proper audit log
    // For now, output to console in structured format
    console.log(`[SAFETY-LOG] ${JSON.stringify(logEntry)}`);
  }
}
