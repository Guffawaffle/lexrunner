/**
 * Intervention Planner
 *
 * Computes the sequence of interventions needed for a merge-weave run.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import type { MergeWeavePolicy, RepoConfig } from "../policy/index.js";
import {
  type BaseIntervention,
  type DiscoveredPR,
  type InterventionPlan,
  type InterventionType,
  INTERVENTION_DETERMINISM,
  type PlannedIntervention,
  type PlanningContext,
} from "./types.js";

// =============================================================================
// PLANNER
// =============================================================================

/**
 * Create a base intervention
 */
function createIntervention(
  type: InterventionType,
  phase: BaseIntervention["phase"],
  target: string | undefined,
  dependsOn: string[],
  params: Record<string, unknown> = {}
): BaseIntervention {
  return {
    id: `${type}-${target ?? "base"}-${randomUUID().slice(0, 8)}`,
    type,
    determinism: INTERVENTION_DETERMINISM[type],
    phase,
    target,
    dependsOn,
    params,
  };
}

/**
 * Plan discovery phase interventions
 */
function planDiscoveryPhase(policy: MergeWeavePolicy, prs: DiscoveredPR[]): BaseIntervention[] {
  const interventions: BaseIntervention[] = [];

  // 1. Discover PRs for each repo (already done if prs provided, but we track it)
  for (const repo of policy.discovery.repos) {
    interventions.push(
      createIntervention("discover_prs", "discovery", `${repo.owner}/${repo.name}`, [], {
        owner: repo.owner,
        name: repo.name,
        filters: policy.discovery.filters,
      })
    );
  }

  // 2. Filter drafts based on policy
  const discoverIds = interventions.map((i) => i.id);
  interventions.push(
    createIntervention("filter_drafts", "discovery", undefined, discoverIds, {
      draftPolicy: policy.discovery.draft_policy,
    })
  );
  const filterDraftsId = interventions[interventions.length - 1].id;

  // 3. Undraft Copilot PRs if policy allows
  if (policy.discovery.draft_policy?.undraft_copilot_prs) {
    const copilotDrafts = prs.filter((pr) => pr.isDraft && pr.isCopilot);
    for (const pr of copilotDrafts) {
      interventions.push(
        createIntervention(
          "undraft_copilot",
          "discovery",
          `${pr.owner}/${pr.repo}#${pr.number}`,
          [filterDraftsId],
          { prNumber: pr.number, owner: pr.owner, repo: pr.repo }
        )
      );
    }
  }

  // 4. Parse dependencies
  const prependIds = interventions.map((i) => i.id);
  interventions.push(
    createIntervention("parse_dependencies", "discovery", undefined, prependIds, {
      resolution: policy.dependencies?.resolution,
    })
  );

  return interventions;
}

/**
 * Plan gate phase interventions
 */
function planGatesPhase(
  policy: MergeWeavePolicy,
  prs: DiscoveredPR[],
  lastDiscoveryId: string
): BaseIntervention[] {
  const interventions: BaseIntervention[] = [];

  // Base branch gates (run once) - skip if not configured
  const baseBranchGates = policy.gates?.base_branch?.required ?? [];
  for (const gate of baseBranchGates) {
    interventions.push(
      createIntervention("run_base_gate", "gates", gate.name, [lastDiscoveryId], {
        command: gate.command,
        timeout: gate.timeout_seconds,
      })
    );
  }

  const baseGateIds = interventions.map((i) => i.id);

  // Per-PR gates - skip if not configured
  const perPrGates = policy.gates?.per_pr;
  if (!perPrGates) {
    return interventions;
  }

  for (const pr of prs) {
    const prTarget = `${pr.owner}/${pr.repo}#${pr.number}`;

    // CI status check
    if (perPrGates.require_ci_green) {
      interventions.push(
        createIntervention("check_ci_status", "gates", prTarget, baseGateIds, {
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.number,
        })
      );
    }

    // Review checklist
    interventions.push(
      createIntervention("review_checklist", "gates", prTarget, baseGateIds, {
        checklist: perPrGates.review_checklist,
        prNumber: pr.number,
      })
    );

    // Quality assessment (D3 - only if enabled)
    if (perPrGates.quality_assessment?.enabled) {
      interventions.push(
        createIntervention("quality_assessment", "gates", prTarget, baseGateIds, {
          criteria: perPrGates.quality_assessment.criteria,
          action: perPrGates.quality_assessment.action_on_concern,
        })
      );
    }
  }

  return interventions;
}

/**
 * Plan merge phase interventions
 */
function planMergePhase(
  policy: MergeWeavePolicy,
  prs: DiscoveredPR[],
  gateInterventionIds: string[]
): BaseIntervention[] {
  const interventions: BaseIntervention[] = [];

  // Compute merge order (topological sort)
  interventions.push(
    createIntervention("compute_merge_order", "merge", undefined, gateInterventionIds, {
      onCycle: policy.dependencies?.on_cycle,
    })
  );
  const computeOrderId = interventions[0].id;

  // For each PR, plan merge execution
  let prevMergeId = computeOrderId;
  const mergeConfig = policy.merge;
  for (const pr of prs) {
    const prTarget = `${pr.owner}/${pr.repo}#${pr.number}`;

    // Check admin authority
    if (mergeConfig?.admin_authority?.enabled) {
      interventions.push(
        createIntervention("check_admin_authority", "merge", prTarget, [prevMergeId], {
          conditions: mergeConfig.admin_authority.conditions,
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.number,
        })
      );
    }

    // Execute merge
    interventions.push(
      createIntervention("execute_merge", "merge", prTarget, [prevMergeId], {
        method: mergeConfig?.method,
        commitTitle: mergeConfig?.commit_title,
        owner: pr.owner,
        repo: pr.repo,
        prNumber: pr.number,
      })
    );
    prevMergeId = interventions[interventions.length - 1].id;
  }

  return interventions;
}

/**
 * Plan post-merge phase interventions
 */
function planPostMergePhase(
  policy: MergeWeavePolicy,
  repos: RepoConfig[],
  lastMergeId: string
): BaseIntervention[] {
  const interventions: BaseIntervention[] = [];
  const postMerge = policy.post_merge;

  // Skip if post_merge not configured
  if (!postMerge) {
    return interventions;
  }

  // Pull and verify for each repo
  for (const repo of repos) {
    const repoTarget = `${repo.owner}/${repo.name}`;

    if (postMerge.pull_and_verify?.enabled) {
      interventions.push(
        createIntervention("pull_changes", "post_merge", repoTarget, [lastMergeId], {
          owner: repo.owner,
          name: repo.name,
        })
      );
      const pullId = interventions[interventions.length - 1].id;

      const gates = postMerge.pull_and_verify.gates ?? [];
      for (const gate of gates) {
        interventions.push(
          createIntervention("verify_gates", "post_merge", `${repoTarget}:${gate}`, [pullId], {
            gate,
            owner: repo.owner,
            name: repo.name,
          })
        );
      }
    }
  }

  // Auto-fix patterns (prepared but not executed until failure detected)
  if (postMerge.auto_fix?.enabled) {
    const verifyIds = interventions.filter((i) => i.type === "verify_gates").map((i) => i.id);
    interventions.push(
      createIntervention("detect_failure_pattern", "post_merge", undefined, verifyIds, {
        patterns: postMerge.auto_fix.patterns,
      })
    );
  }

  return interventions;
}

/**
 * Convert base interventions to planned interventions with status
 */
function toPlannedInterventions(
  interventions: BaseIntervention[],
  completedIds: Set<string>
): PlannedIntervention[] {
  const planned: PlannedIntervention[] = [];
  const idToPlanned = new Map<string, PlannedIntervention>();

  for (const intervention of interventions) {
    const status: PlannedIntervention["status"] = completedIds.has(intervention.id)
      ? "completed"
      : intervention.dependsOn.length === 0
        ? "ready"
        : "pending";

    const p: PlannedIntervention = { ...intervention, status };
    planned.push(p);
    idToPlanned.set(p.id, p);
  }

  // Mark ready those whose dependencies are all completed
  for (const p of planned) {
    if (p.status === "pending") {
      const allDepsCompleted = p.dependsOn.every((depId) => {
        const dep = idToPlanned.get(depId);
        return dep && dep.status === "completed";
      });
      if (allDepsCompleted) {
        p.status = "ready";
      }
    }
  }

  return planned;
}

/**
 * Compute intervention statistics
 */
function computeStats(interventions: PlannedIntervention[]): InterventionPlan["stats"] {
  const byDeterminism: Record<string, number> = { D1: 0, D2: 0, D3: 0 };
  const byPhase: Record<string, number> = {};

  for (const i of interventions) {
    byDeterminism[i.determinism] = (byDeterminism[i.determinism] || 0) + 1;
    byPhase[i.phase] = (byPhase[i.phase] || 0) + 1;
  }

  return {
    total: interventions.length,
    byDeterminism: byDeterminism as Record<"D1" | "D2" | "D3", number>,
    byPhase,
  };
}

/**
 * Create an intervention plan from context
 */
export function createInterventionPlan(context: PlanningContext): InterventionPlan {
  const { policy, prs, completedInterventionIds = [] } = context;
  const completedSet = new Set(completedInterventionIds);

  // Build all phases
  const discoveryInterventions = planDiscoveryPhase(policy, prs);
  const lastDiscoveryId = discoveryInterventions[discoveryInterventions.length - 1]?.id ?? "";

  const gatesInterventions = planGatesPhase(policy, prs, lastDiscoveryId);
  const gateIds = gatesInterventions.map((i) => i.id);

  const mergeInterventions = planMergePhase(policy, prs, gateIds);
  const lastMergeId = mergeInterventions[mergeInterventions.length - 1]?.id ?? "";

  const postMergeInterventions = planPostMergePhase(policy, policy.discovery.repos, lastMergeId);

  // Combine all
  const allInterventions = [
    ...discoveryInterventions,
    ...gatesInterventions,
    ...mergeInterventions,
    ...postMergeInterventions,
  ];

  const planned = toPlannedInterventions(allInterventions, completedSet);

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    policyVersion: policy.schemaVersion,
    interventions: planned,
    stats: computeStats(planned),
  };
}

/**
 * Get next ready interventions (can be executed in parallel)
 */
export function getReadyInterventions(plan: InterventionPlan): PlannedIntervention[] {
  return plan.interventions.filter((i) => i.status === "ready");
}

/**
 * Get interventions by determinism level
 */
export function getInterventionsByDeterminism(
  plan: InterventionPlan,
  level: "D1" | "D2" | "D3"
): PlannedIntervention[] {
  return plan.interventions.filter((i) => i.determinism === level);
}
