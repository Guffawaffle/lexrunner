/**
 * Autopilot Level 4 - Full Automation
 * Extends Level 3 with finalization, PR merging, cleanup, and superseded PR closure
 *
 * @experimental This module is experimental and may change significantly in future versions.
 * The API is not stable and should not be relied upon by external consumers.
 */

import { AutopilotLevel3 } from "./level3.js";
import { AutopilotResult } from "./base.js";
import { GitOperations, createGitOperations } from "../git/operations.js";
import { createGitHubClient, GitHubClient } from "../github/index.js";
import * as path from "path";

/**
 * Level 4 autopilot - Full automation
 * Merges integration PR to target, closes superseded PRs, performs cleanup
 *
 * @experimental This class is experimental and subject to breaking changes.
 */
export class AutopilotLevel4 extends AutopilotLevel3 {
  getLevel(): number {
    return 4;
  }

  async execute(): Promise<AutopilotResult> {
    try {
      // Execute Level 3 first to create and validate integration branch
      const level3Result = await super.execute();
      if (!level3Result.success) {
        return level3Result; // Propagate Level 3 failure
      }

      // Level 3 succeeded - now perform Level 4 finalization
      console.log("\nLevel 4: Starting finalization workflow");

      const plan = this.context.plan;
      const gitOps = createGitOperations();

      // Get integration branch name (Level 3 created it)
      const currentBranch = await gitOps.getCurrentBranch();

      // Get expected branch prefix from parent class method
      const branchPrefix = process.env.LEX_BRANCH_PREFIX || "integration/";

      if (!currentBranch.startsWith(branchPrefix)) {
        // Not on an integration branch - Level 3 might have failed earlier
        return {
          level: 4,
          success: false,
          message: "Level 4: Not on integration branch - cannot finalize",
          artifacts: level3Result.artifacts,
        };
      }

      const integrationBranch = currentBranch;
      const targetBranch = plan.target || "main";

      // Step 1: Merge integration branch to target
      console.log(`Level 4: Merging ${integrationBranch} to ${targetBranch}`);
      const mergeResult = await this.mergeIntegrationBranch(
        gitOps,
        integrationBranch,
        targetBranch
      );

      if (!mergeResult.success) {
        // Merge failed - rollback if needed
        const rollbackResult = await this.rollbackFailedMerge(
          gitOps,
          integrationBranch,
          targetBranch,
          mergeResult.error || "Unknown error"
        );

        return {
          level: 4,
          success: false,
          message: [
            level3Result.message,
            "",
            "Level 4: Integration merge failed ❌",
            `  • Target: ${targetBranch}`,
            `  • Error: ${mergeResult.error}`,
            "",
            rollbackResult.success
              ? "✓ Rollback completed successfully"
              : `✗ Rollback failed: ${rollbackResult.error}`,
            "Integration branch preserved for inspection",
          ].join("\n"),
          artifacts: level3Result.artifacts,
        };
      }

      console.log(`Level 4: Successfully merged to ${targetBranch}`);

      // Step 2: Close superseded PRs (if enabled via config)
      const closeSuperseded = this.shouldCloseSuperseded();
      let closedPRs: number[] = [];

      if (closeSuperseded) {
        console.log("Level 4: Closing superseded PRs");
        closedPRs = await this.closeSupersededPRs(plan);
        console.log(`Level 4: Closed ${closedPRs.length} PRs`);
      }

      // Step 3: Post finalization comment
      await this.postFinalizationComment(plan, integrationBranch, mergeResult.sha, closedPRs);

      // Step 4: Cleanup integration branch
      console.log(`Level 4: Cleaning up integration branch ${integrationBranch}`);
      const cleanupResult = await this.cleanupIntegrationBranch(
        gitOps,
        integrationBranch,
        targetBranch
      );

      if (!cleanupResult.success) {
        console.warn(`Level 4: Branch cleanup failed: ${cleanupResult.error}`);
        // Non-fatal - continue with success
      }

      // Success!
      const message = [
        level3Result.message,
        "",
        "Level 4: Full automation complete ✅",
        `  • Merged to: ${targetBranch}`,
        `  • Merge SHA: ${mergeResult.sha?.substring(0, 8)}`,
        closeSuperseded
          ? `  • Closed PRs: ${closedPRs.length}`
          : "  • Superseded PRs: kept open (--close-superseded not set)",
        cleanupResult.success
          ? `  • Cleaned up: ${integrationBranch}`
          : `  • Branch cleanup: failed (${cleanupResult.error})`,
        "",
        "Merge-weave execution complete! 🎉",
      ].join("\n");

      return {
        level: 4,
        success: true,
        message,
        artifacts: level3Result.artifacts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        level: 4,
        success: false,
        message: `Level 4 execution failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Merge integration branch to target branch
   */
  private async mergeIntegrationBranch(
    gitOps: GitOperations,
    integrationBranch: string,
    targetBranch: string
  ): Promise<{ success: boolean; sha?: string; error?: string }> {
    try {
      // Checkout target branch
      await gitOps["git"].checkout(targetBranch);

      // Pull latest changes
      try {
        await gitOps["git"].pull("origin", targetBranch);
      } catch (pullError) {
        console.warn(`Warning: Could not pull ${targetBranch}:`, pullError);
      }

      // Merge integration branch
      const mergeResult = await gitOps["git"].merge([integrationBranch]);

      // Get current SHA
      const log = await gitOps["git"].log(["-1"]);
      const sha = log.latest?.hash;

      return {
        success: true,
        sha,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Rollback failed merge attempt
   */
  private async rollbackFailedMerge(
    gitOps: GitOperations,
    integrationBranch: string,
    targetBranch: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`Level 4: Rolling back failed merge - ${reason}`);

      // Abort merge if in progress
      try {
        await gitOps["git"].merge(["--abort"]);
      } catch (abortError) {
        // Merge might not be in progress - that's okay
      }

      // Reset to origin/target to clean state
      try {
        await gitOps["git"].reset(["--hard", `origin/${targetBranch}`]);
      } catch (resetError) {
        console.warn("Could not reset to origin:", resetError);
      }

      // Return to integration branch for inspection
      await gitOps["git"].checkout(integrationBranch);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close superseded PRs with finalization comment
   */
  private async closeSupersededPRs(plan: any): Promise<number[]> {
    const closedPRs: number[] = [];

    try {
      // Get GitHub client
      const github = await createGitHubClient();
      const octokit = github.getOctokit();
      const owner = github.getOwner();
      const repo = github.getRepo();

      // Close each PR that was part of the integration
      for (const item of plan.items) {
        // Extract PR number from item name (assuming format like "PR-123" or "#123")
        const prNumber = this.extractPRNumber(item.name);
        if (!prNumber) {
          console.warn(`Could not extract PR number from item: ${item.name}`);
          continue;
        }

        try {
          // Post closing comment
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: [
              "✅ This PR was successfully integrated via merge-weave automation.",
              "",
              `Integrated into: \`${plan.target || "main"}\``,
              "",
              "<!-- lex-pr:finalization:v1:closed -->",
            ].join("\n"),
          });

          // Close the PR
          await octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: prNumber,
            state: "closed",
          });

          closedPRs.push(prNumber);
          console.log(`Level 4: Closed PR #${prNumber}`);
        } catch (error) {
          console.warn(`Failed to close PR #${prNumber}:`, error);
          // Continue with other PRs
        }
      }
    } catch (error) {
      console.warn("Level 4: Failed to close superseded PRs:", error);
      // Non-fatal - return what we closed so far
    }

    return closedPRs;
  }

  /**
   * Post finalization comment on integration PR (if exists) or target PR
   */
  private async postFinalizationComment(
    plan: any,
    integrationBranch: string,
    mergeSha: string | undefined,
    closedPRs: number[]
  ): Promise<void> {
    try {
      const github = await createGitHubClient();
      const octokit = github.getOctokit();
      const owner = github.getOwner();
      const repo = github.getRepo();

      // Look for integration PR (if one was opened by Level 3)
      // For now, we'll post comments on the superseded PRs
      // This is a placeholder for future integration PR support

      const comment = [
        "🎉 Merge-weave finalization complete!",
        "",
        `**Integration Branch:** \`${integrationBranch}\``,
        mergeSha ? `**Merge SHA:** \`${mergeSha.substring(0, 8)}\`` : "",
        `**Target:** \`${plan.target || "main"}\``,
        "",
        "**Integrated PRs:**",
        ...plan.items.map((item: any) => `- ${item.name}`),
        "",
        closedPRs.length > 0 ? `**Closed PRs:** ${closedPRs.map((n) => `#${n}`).join(", ")}` : "",
        "",
        "<!-- lex-pr:finalization:v1:complete -->",
      ]
        .filter((line) => line !== "")
        .join("\n");

      // Could post to a tracking issue or integration PR if available
      console.log("Level 4: Finalization comment prepared (no target PR specified)");
    } catch (error) {
      console.warn("Level 4: Failed to post finalization comment:", error);
      // Non-fatal
    }
  }

  /**
   * Cleanup integration branch after successful merge
   */
  private async cleanupIntegrationBranch(
    gitOps: GitOperations,
    integrationBranch: string,
    targetBranch: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure we're on target branch
      await gitOps["git"].checkout(targetBranch);

      // Delete local integration branch
      await gitOps["git"].deleteLocalBranch(integrationBranch, true);

      // Try to delete remote integration branch if it exists
      try {
        await gitOps["git"].push(["origin", "--delete", integrationBranch]);
      } catch (pushError) {
        // Remote branch might not exist - that's okay
        console.log("Remote integration branch not found or already deleted");
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract PR number from item name
   */
  private extractPRNumber(itemName: string): number | null {
    // Try various formats: "PR-123", "#123", "123"
    const patterns = [/PR-(\d+)/i, /#(\d+)/, /^(\d+)$/];

    for (const pattern of patterns) {
      const match = itemName.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    return null;
  }

  /**
   * Check if we should close superseded PRs
   */
  private shouldCloseSuperseded(): boolean {
    // This would come from AutopilotConfig in a real implementation
    // For now, check environment variable
    return process.env.LEX_CLOSE_SUPERSEDED === "true";
  }
}
