/**
 * Sequential Merge-Weave Executor
 *
 * Executes merge-weave by sequentially merging PRs via GitHub API
 * with automatic branch updates for remaining PRs.
 *
 * This implements the workflow described in LR-MW-001:
 * - Merge PR N via GitHub API
 * - Auto-update remaining PRs' branches if they're behind
 * - Continue to next PR
 *
 * @module
 */

export interface PR {
  number: number;
  mergeable_state?: string;
  head?: {
    ref: string;
    sha: string;
  };
}

export interface MergeWeaveOptions {
  /**
   * Whether to automatically update PR branches after each merge
   * @default true
   */
  autoUpdateBranches?: boolean;

  /**
   * Merge method to use
   * @default "squash"
   */
  mergeMethod?: "squash" | "merge" | "rebase";

  /**
   * Whether this is a dry run (no actual merges)
   * @default false
   */
  dryRun?: boolean;
}

export interface MergeWeaveResult {
  /**
   * PRs that were successfully merged
   */
  merged: number[];

  /**
   * PRs that failed to merge
   */
  failed: Array<{ number: number; error: string }>;

  /**
   * PRs that were updated
   */
  updated: number[];

  /**
   * PRs that failed to update
   */
  updateFailed: Array<{ number: number; error: string }>;
}

export interface GitHubPROperations {
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PR | null>;
  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    options: { method: "squash" | "merge" | "rebase"; commitTitle?: string }
  ): Promise<boolean>;
  updatePullRequestBranch(owner: string, repo: string, prNumber: number): Promise<void>;
}

/**
 * Check if a PR is behind the base branch
 */
function isPRBehind(pr: PR): boolean {
  // GitHub's mergeable_state can be:
  // - "behind": PR is behind base branch
  // - "clean": PR is up to date and mergeable
  // - "unstable": PR has failing checks
  // - "dirty": PR has conflicts
  // - "unknown": GitHub is still computing
  // - "blocked": PR is blocked by branch protection
  return pr.mergeable_state === "behind";
}

/**
 * Execute sequential merge-weave with automatic branch updates
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prs - List of PRs to merge (in order)
 * @param github - GitHub API operations
 * @param options - Merge-weave options
 * @returns Result with merged, failed, and updated PRs
 */
export async function mergeWeaveSequential(
  owner: string,
  repo: string,
  prs: PR[],
  github: GitHubPROperations,
  options: MergeWeaveOptions = {}
): Promise<MergeWeaveResult> {
  const { autoUpdateBranches = true, mergeMethod = "squash", dryRun = false } = options;

  const result: MergeWeaveResult = {
    merged: [],
    failed: [],
    updated: [],
    updateFailed: [],
  };

  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];

    // Merge current PR
    try {
      if (dryRun) {
        console.log(`[DRY RUN] Would merge PR #${pr.number}`);
        // In dry run, simulate successful merge for auto-update logic
        result.merged.push(pr.number);
      } else {
        const success = await github.mergePullRequest(owner, repo, pr.number, {
          method: mergeMethod,
        });

        if (success) {
          result.merged.push(pr.number);
          console.log(`✓ Merged PR #${pr.number}`);
        } else {
          result.failed.push({
            number: pr.number,
            error: "Merge returned false",
          });
          console.log(`✗ Failed to merge PR #${pr.number}`);
          continue; // Don't update remaining PRs if merge failed
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.failed.push({
        number: pr.number,
        error: errorMessage,
      });
      console.log(`✗ Failed to merge PR #${pr.number}: ${errorMessage}`);
      continue; // Don't update remaining PRs if merge failed
    }

    // Auto-update remaining PRs' branches if enabled
    if (autoUpdateBranches) {
      for (const remainingPR of prs.slice(i + 1)) {
        try {
          // Fetch latest PR state to check if it's behind
          const currentPR = await github.getPullRequest(owner, repo, remainingPR.number);

          if (!currentPR) {
            console.log(`  ⚠ PR #${remainingPR.number} not found, skipping update`);
            continue;
          }

          if (isPRBehind(currentPR)) {
            if (dryRun) {
              console.log(`  [DRY RUN] Would update PR #${remainingPR.number} (behind)`);
            } else {
              await github.updatePullRequestBranch(owner, repo, remainingPR.number);
              result.updated.push(remainingPR.number);
              console.log(`  ✓ Updated PR #${remainingPR.number}`);
            }
          }
        } catch (error) {
          // Log update failures but don't block the weave
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.updateFailed.push({
            number: remainingPR.number,
            error: errorMessage,
          });
          console.log(`  ⚠ Failed to update PR #${remainingPR.number}: ${errorMessage}`);
        }
      }
    }
  }

  return result;
}

/**
 * Execute umbrella merge strategy (all PRs into an umbrella PR first)
 *
 * This is an alternative strategy mentioned in the issue where PRs are
 * merged into an umbrella PR before merging to main.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prs - List of PRs to merge
 * @param umbrellaPR - The umbrella PR that collects all changes
 * @param github - GitHub API operations
 * @param options - Merge-weave options
 * @returns Result with merged, failed, and updated PRs
 */
export async function mergeWeaveUmbrella(
  owner: string,
  repo: string,
  prs: PR[],
  umbrellaPR: PR,
  github: GitHubPROperations,
  options: MergeWeaveOptions = {}
): Promise<MergeWeaveResult> {
  const { autoUpdateBranches = true, mergeMethod = "squash", dryRun = false } = options;

  const result: MergeWeaveResult = {
    merged: [],
    failed: [],
    updated: [],
    updateFailed: [],
  };

  // NOTE: Full umbrella strategy would require modifying PR base branches dynamically
  // to target the umbrella PR's branch instead of main. Current implementation merges
  // PRs to main and updates umbrella PR after each merge as a simplified approach.
  // TODO: Implement true umbrella merge with dynamic base branch retargeting

  // Update umbrella PR after each merge
  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];

    try {
      if (dryRun) {
        console.log(`[DRY RUN] Would merge PR #${pr.number} to main`);
        // In dry run, simulate successful merge for auto-update logic
        result.merged.push(pr.number);
      } else {
        const success = await github.mergePullRequest(owner, repo, pr.number, {
          method: mergeMethod,
        });

        if (success) {
          result.merged.push(pr.number);
          console.log(`✓ Merged PR #${pr.number}`);
        } else {
          result.failed.push({
            number: pr.number,
            error: "Merge returned false",
          });
          continue;
        }
      }

      // Update umbrella PR branch after each merge
      if (autoUpdateBranches) {
        try {
          if (dryRun) {
            console.log(`  [DRY RUN] Would update umbrella PR #${umbrellaPR.number}`);
          } else {
            await github.updatePullRequestBranch(owner, repo, umbrellaPR.number);
            result.updated.push(umbrellaPR.number);
            console.log(`  ✓ Updated umbrella PR #${umbrellaPR.number}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.updateFailed.push({
            number: umbrellaPR.number,
            error: errorMessage,
          });
          console.log(`  ⚠ Failed to update umbrella PR: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.failed.push({
        number: pr.number,
        error: errorMessage,
      });
      console.log(`✗ Failed to merge PR #${pr.number}: ${errorMessage}`);
    }
  }

  return result;
}
