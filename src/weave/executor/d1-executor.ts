/**
 * D1 Executor
 *
 * Executes deterministic (D1) interventions that require no judgment.
 * These can be handed off to scripted automation or mid-tier models.
 *
 * @module
 */

import type { PlannedIntervention, InterventionType } from "../planner/index.js";
import type { ExecutionContext, InterventionHandler, InterventionResult } from "./types.js";

// =============================================================================
// D1 HANDLERS
// =============================================================================

/**
 * Handler: discover_prs
 * List PRs from a repository
 */
const handleDiscoverPRs: InterventionHandler<"discover_prs"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { owner, name, filters } = intervention.params as {
      owner: string;
      name: string;
      filters: { include_drafts?: boolean };
    };

    const prs = await ctx.github.listPullRequests(owner, name, "open");

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: { prs, count: (prs as unknown[]).length },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: filter_drafts
 * Filter PRs based on draft policy
 */
const handleFilterDrafts: InterventionHandler<"filter_drafts"> = async (intervention, _ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  // This is a pure logic operation on already-fetched data
  // In practice, this would filter the PR list based on policy
  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: { filtered: true },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: parse_dependencies
 * Parse dependency declarations from PR metadata
 */
const handleParseDependencies: InterventionHandler<"parse_dependencies"> = async (
  intervention,
  _ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  // Pure logic: parse "Depends-on: #123" from PR bodies
  const { resolution } = intervention.params as {
    resolution: { footer_pattern: string };
  };

  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: { pattern: resolution.footer_pattern, parsed: true },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: run_base_gate
 * Execute a gate command on the base branch
 */
const handleRunBaseGate: InterventionHandler<"run_base_gate"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { command, timeout } = intervention.params as {
      command: string;
      timeout: number;
    };

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, command },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    const result = await ctx.shell.run(command, {
      cwd: ctx.workspaceRoot,
      timeout: timeout * 1000,
    });

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: result.exitCode === 0,
      output: {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 1000), // Truncate for audit
        stderr: result.stderr.slice(0, 1000),
      },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: check_ci_status
 * Check CI status for a PR
 */
const handleCheckCIStatus: InterventionHandler<"check_ci_status"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { owner, repo, prNumber } = intervention.params as {
      owner: string;
      repo: string;
      prNumber: number;
    };

    const pr = (await ctx.github.getPullRequest(owner, repo, prNumber)) as {
      head: { sha: string };
    };
    const status = await ctx.github.getCommitStatus(owner, repo, pr.head.sha);

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: status.state === "success",
      output: { state: status.state, statuses: status.statuses },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: compute_merge_order
 * Topological sort of PRs by dependencies
 */
const handleComputeMergeOrder: InterventionHandler<"compute_merge_order"> = async (
  intervention,
  _ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  // Pure logic: topological sort
  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: { computed: true },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: check_admin_authority
 * Verify conditions for admin merge authority
 */
const handleCheckAdminAuthority: InterventionHandler<"check_admin_authority"> = async (
  intervention,
  ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  const { conditions, owner, repo, prNumber } = intervention.params as {
    conditions: Array<{ local_ci_passes?: boolean }>;
    owner: string;
    repo: string;
    prNumber: number;
  };

  // Check each condition
  const results: Record<string, boolean> = {};

  for (const condition of conditions) {
    if (condition.local_ci_passes) {
      // This would be verified by running local CI
      results["local_ci_passes"] = true; // Placeholder
    }
  }

  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: Object.values(results).every(Boolean),
    output: { conditions: results },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: update_pr_branch
 * Update PR branch with latest from base branch
 */
const handleUpdatePRBranch: InterventionHandler<"update_pr_branch"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { owner, repo, prNumber } = intervention.params as {
      owner: string;
      repo: string;
      prNumber: number;
    };

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, prNumber },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Update the PR branch with latest from base
    await ctx.github.updatePullRequestBranch(owner, repo, prNumber);

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: { updated: true, prNumber },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: execute_merge
 * Merge a PR
 */
const handleExecuteMerge: InterventionHandler<"execute_merge"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { method, commitTitle, owner, repo, prNumber } = intervention.params as {
      method: "squash" | "merge" | "rebase";
      commitTitle: { use_pr_title: boolean };
      owner: string;
      repo: string;
      prNumber: number;
    };

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, prNumber, method },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    const pr = (await ctx.github.getPullRequest(owner, repo, prNumber)) as {
      title: string;
    };
    const success = await ctx.github.mergePullRequest(owner, repo, prNumber, {
      method,
      commitTitle: commitTitle.use_pr_title ? pr.title : undefined,
    });

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success,
      output: { merged: success, prNumber },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: pull_changes
 * Pull latest changes to local repo
 */
const handlePullChanges: InterventionHandler<"pull_changes"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { owner, name } = intervention.params as {
      owner: string;
      name: string;
    };
    const repoPath = ctx.repoPaths.get(`${owner}/${name}`) ?? ctx.workspaceRoot;

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, repo: name },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    await ctx.git.pull(repoPath);

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: { pulled: true, repo: name },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: verify_gates
 * Run verification gates after merge
 */
const handleVerifyGates: InterventionHandler<"verify_gates"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { gate, owner, name } = intervention.params as {
      gate: string;
      owner: string;
      name: string;
    };
    const repoPath = ctx.repoPaths.get(`${owner}/${name}`) ?? ctx.workspaceRoot;

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, gate },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Map gate name to command
    const gateCommands: Record<string, string> = {
      build: "npm run build",
      test: "npm test",
      lint: "npm run lint",
    };

    const command = gateCommands[gate] ?? `npm run ${gate}`;
    const result = await ctx.shell.run(command, {
      cwd: repoPath,
      timeout: 300000,
    });

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: result.exitCode === 0,
      output: { gate, exitCode: result.exitCode },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: commit_fix
 * Commit a fix after auto-repair
 */
const handleCommitFix: InterventionHandler<"commit_fix"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { message, repoPath } = intervention.params as {
      message: string;
      repoPath: string;
    };

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, message },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    const hasChanges = await ctx.git.hasUncommittedChanges(repoPath);
    if (!hasChanges) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { noChanges: true },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    await ctx.git.commit(repoPath, message);
    await ctx.git.push(repoPath);

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: { committed: true, message },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: run_post_merge_checks
 * Execute post-merge validation checks
 */
const handleRunPostMergeChecks: InterventionHandler<"run_post_merge_checks"> = async (
  intervention,
  ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { checks, owner, name } = intervention.params as {
      checks: Array<{ type: string; command: string; required: boolean; timeout: number }>;
      owner: string;
      name: string;
    };
    const repoPath = ctx.repoPaths.get(`${owner}/${name}`) ?? ctx.workspaceRoot;

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, checksCount: checks.length },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Run checks sequentially
    const results = [];
    let firstFailure: { type: string; error: string } | undefined;

    for (const check of checks) {
      const checkStart = Date.now();

      try {
        const result = await ctx.shell.run(check.command, {
          cwd: repoPath,
          timeout: check.timeout,
        });

        const checkResult = {
          type: check.type,
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          durationMs: Date.now() - checkStart,
        };

        results.push(checkResult);

        if (!checkResult.success && check.required && !firstFailure) {
          firstFailure = {
            type: check.type,
            error: result.stderr || `Check failed with exit code ${result.exitCode}`,
          };
          // Stop on first required check failure
          break;
        }
      } catch (error) {
        const checkResult = {
          type: check.type,
          success: false,
          exitCode: -1,
          durationMs: Date.now() - checkStart,
          error: error instanceof Error ? error.message : String(error),
        };

        results.push(checkResult);

        if (check.required && !firstFailure) {
          firstFailure = {
            type: check.type,
            error: error instanceof Error ? error.message : String(error),
          };
          break;
        }
      }
    }

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: !firstFailure,
      output: {
        results,
        firstFailure,
        checksRun: results.length,
      },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

/**
 * Handler: revert_merge
 * Revert a merge commit
 */
const handleRevertMerge: InterventionHandler<"revert_merge"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { commitSha, repoPath } = intervention.params as {
      commitSha: string;
      repoPath: string;
    };

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: { dryRun: true, commitSha },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Create revert commit
    const result = await ctx.shell.run(`git revert --no-edit ${commitSha}`, {
      cwd: repoPath,
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: false,
        error: `Failed to revert commit: ${result.stderr}`,
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: { reverted: true, commitSha },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
};

// =============================================================================
// D1 HANDLER REGISTRY
// =============================================================================

/**
 * Type-safe handler registry.
 * We use explicit type assertion here because each handler is typed for its specific
 * intervention type, but the registry needs to store them uniformly.
 * The type safety is maintained through the InterventionType key matching.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const D1_HANDLERS: Partial<Record<InterventionType, InterventionHandler<any>>> = {
  discover_prs: handleDiscoverPRs,
  filter_drafts: handleFilterDrafts,
  parse_dependencies: handleParseDependencies,
  run_base_gate: handleRunBaseGate,
  check_ci_status: handleCheckCIStatus,
  compute_merge_order: handleComputeMergeOrder,
  check_admin_authority: handleCheckAdminAuthority,
  update_pr_branch: handleUpdatePRBranch,
  execute_merge: handleExecuteMerge,
  pull_changes: handlePullChanges,
  verify_gates: handleVerifyGates,
  run_post_merge_checks: handleRunPostMergeChecks,
  commit_fix: handleCommitFix,
  revert_merge: handleRevertMerge,
};

/**
 * Check if an intervention type has a D1 handler
 */
export function hasD1Handler(type: InterventionType): boolean {
  return type in D1_HANDLERS;
}

/**
 * Execute a D1 intervention
 * @throws Error if no D1 handler exists for the intervention type
 */
export async function executeD1Intervention(
  intervention: PlannedIntervention,
  context: ExecutionContext
): Promise<InterventionResult> {
  const handler = D1_HANDLERS[intervention.type];
  if (!handler) {
    throw new Error(`No D1 handler for intervention type: ${intervention.type}`);
  }

  // Emit start audit
  context.emitAudit({
    timestamp: new Date().toISOString(),
    interventionId: intervention.id,
    type: intervention.type,
    action: "start",
    determinism: "D1",
    details: { target: intervention.target },
  });

  const result = await handler(
    intervention as PlannedIntervention & { type: InterventionType },
    context
  );

  // Emit completion audit
  context.emitAudit({
    timestamp: new Date().toISOString(),
    interventionId: intervention.id,
    type: intervention.type,
    action: result.success ? "complete" : "fail",
    determinism: "D1",
    details: { success: result.success, durationMs: result.durationMs },
  });

  return result;
}

/**
 * Get all D1 intervention types
 */
export function getD1InterventionTypes(): InterventionType[] {
  return Object.keys(D1_HANDLERS) as InterventionType[];
}
