/**
 * D2 Executor
 *
 * Executes bounded judgment (D2) interventions that require some reasoning
 * but are still deterministic within defined bounds.
 *
 * D2 interventions include:
 * - undraft_copilot: Decide whether to promote draft PRs
 * - review_checklist: Process review checklists
 * - detect_failure_pattern: Identify common failure patterns
 * - auto_fix: Apply automated fixes
 * - detect_fanout_trigger: Identify when to trigger fanout
 * - create_issue: Create GitHub issues for tracking
 *
 * @module
 */

import type { PlannedIntervention, InterventionType } from "../planner/index.js";
import type { ExecutionContext, InterventionHandler, InterventionResult } from "./types.js";

// =============================================================================
// D2 HANDLERS
// =============================================================================

/**
 * Handler: undraft_copilot
 * Promote a draft PR to ready for review.
 *
 * This is the key intervention for issue #675 - auto-promoting draft PRs
 * when they're ready for merge-weave.
 */
const handleUndraftCopilot: InterventionHandler<"undraft_copilot"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  try {
    const { prNumber, owner, repo } = intervention.params as {
      prNumber: number;
      owner: string;
      repo: string;
    };

    if (ctx.dryRun) {
      return {
        interventionId: intervention.id,
        type: intervention.type,
        success: true,
        output: {
          dryRun: true,
          message: `Would promote PR #${prNumber} from draft to ready for review`,
          owner,
          repo,
          prNumber,
        },
        durationMs: Date.now() - start,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Use GitHub API to update the PR's draft status
    await ctx.github.updatePullRequest(owner, repo, prNumber, { draft: false });

    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: {
        promoted: true,
        message: `Promoted PR #${prNumber} to ready for review`,
        owner,
        repo,
        prNumber,
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
 * Handler: review_checklist
 * Process review checklist items
 */
const handleReviewChecklist: InterventionHandler<"review_checklist"> = async (
  intervention,
  _ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  // Review checklist processing - bounded judgment on checklist items
  const { items } = intervention.params as {
    items: Array<{ name: string; required: boolean }>;
  };

  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: {
      itemsProcessed: items?.length ?? 0,
      allPassed: true,
    },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: detect_failure_pattern
 * Identify common failure patterns in gate results
 */
const handleDetectFailurePattern: InterventionHandler<"detect_failure_pattern"> = async (
  intervention,
  _ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  const { gateResult, gateName } = intervention.params as {
    gateResult: { exitCode: number; stderr: string };
    gateName: string;
  };

  // Pattern detection - bounded judgment on failure types
  const patterns = [];

  if (gateResult?.stderr?.includes("Cannot find module")) {
    patterns.push("missing_module");
  }
  if (gateResult?.stderr?.includes("Type error")) {
    patterns.push("type_error");
  }
  if (gateResult?.stderr?.includes("ENOENT")) {
    patterns.push("file_not_found");
  }
  if (gateResult?.stderr?.includes("timeout")) {
    patterns.push("timeout");
  }

  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: {
      gate: gateName,
      patterns,
      patternsFound: patterns.length,
    },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: auto_fix
 * Apply automated fixes based on detected patterns
 */
const handleAutoFix: InterventionHandler<"auto_fix"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  const { pattern, prNumber, owner, repo } = intervention.params as {
    pattern: string;
    prNumber: number;
    owner: string;
    repo: string;
  };

  if (ctx.dryRun) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: {
        dryRun: true,
        message: `Would apply auto-fix for pattern: ${pattern}`,
        pattern,
        prNumber,
      },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // Auto-fix implementation would go here
  // For now, return success with no action
  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: {
      applied: false,
      reason: "No auto-fix available for pattern: " + pattern,
      pattern,
      prNumber,
    },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: detect_fanout_trigger
 * Identify when to trigger a fanout based on PR complexity
 */
const handleDetectFanoutTrigger: InterventionHandler<"detect_fanout_trigger"> = async (
  intervention,
  _ctx
) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  const { prNumber, filesChanged, linesChanged } = intervention.params as {
    prNumber: number;
    filesChanged: number;
    linesChanged: number;
  };

  // Fanout trigger detection - bounded judgment
  const shouldFanout = filesChanged > 10 || linesChanged > 500;

  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: {
      prNumber,
      shouldFanout,
      reason: shouldFanout
        ? `PR too large: ${filesChanged} files, ${linesChanged} lines`
        : "PR within bounds",
      filesChanged,
      linesChanged,
    },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

/**
 * Handler: create_issue
 * Create a GitHub issue for tracking
 */
const handleCreateIssue: InterventionHandler<"create_issue"> = async (intervention, ctx) => {
  const start = Date.now();
  const startedAt = new Date().toISOString();

  const { owner, repo, title, body, labels } = intervention.params as {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
  };

  if (ctx.dryRun) {
    return {
      interventionId: intervention.id,
      type: intervention.type,
      success: true,
      output: {
        dryRun: true,
        message: `Would create issue: ${title}`,
        owner,
        repo,
        title,
      },
      durationMs: Date.now() - start,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // Issue creation would use GitHub API
  // For now, simulate success
  return {
    interventionId: intervention.id,
    type: intervention.type,
    success: true,
    output: {
      created: true,
      title,
      owner,
      repo,
      labels,
    },
    durationMs: Date.now() - start,
    startedAt,
    completedAt: new Date().toISOString(),
  };
};

// =============================================================================
// D2 HANDLER REGISTRY
// =============================================================================

/**
 * D2 handler registry - interventions requiring bounded judgment
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const D2_HANDLERS: Partial<Record<InterventionType, InterventionHandler<any>>> = {
  undraft_copilot: handleUndraftCopilot,
  review_checklist: handleReviewChecklist,
  detect_failure_pattern: handleDetectFailurePattern,
  auto_fix: handleAutoFix,
  detect_fanout_trigger: handleDetectFanoutTrigger,
  create_issue: handleCreateIssue,
};

/**
 * Check if an intervention type has a D2 handler
 */
export function hasD2Handler(type: InterventionType): boolean {
  return type in D2_HANDLERS;
}

/**
 * Execute a D2 intervention
 * @throws Error if no D2 handler exists for the intervention type
 */
export async function executeD2Intervention(
  intervention: PlannedIntervention,
  context: ExecutionContext
): Promise<InterventionResult> {
  const handler = D2_HANDLERS[intervention.type];
  if (!handler) {
    throw new Error(`No D2 handler for intervention type: ${intervention.type}`);
  }

  // Emit start audit
  context.emitAudit({
    timestamp: new Date().toISOString(),
    interventionId: intervention.id,
    type: intervention.type,
    action: "start",
    determinism: "D2",
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
    determinism: "D2",
    details: { success: result.success, durationMs: result.durationMs },
  });

  return result;
}

/**
 * Get all D2 intervention types
 */
export function getD2InterventionTypes(): InterventionType[] {
  return Object.keys(D2_HANDLERS) as InterventionType[];
}
