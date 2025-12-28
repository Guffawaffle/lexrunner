/**
 * Admin Authority Condition Evaluator
 *
 * Evaluates machine-verifiable conditions for admin merge authority.
 * All evaluations are deterministic (D1) with explicit rules.
 *
 * @module
 */

import { minimatch } from "minimatch";
import type {
  AuthorityCondition,
  AuthorityEvaluationResult,
  ConditionResult,
  EnhancedAdminAuthorityConfig,
  EscalationTrigger,
} from "./schema.js";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * PR information for condition evaluation
 */
export interface PRContext {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  authorType: "user" | "bot";
  labels: string[];
  files: string[];
  mergeable: boolean | null;
  mergeableState: string;
  reviewRequests: { users: string[]; teams: string[] };
  reviews: Array<{ state: string; user: string }>;
  ciChecks: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
}

/**
 * Abstracted interfaces for testability
 */
export interface CommandExecutor {
  execute(
    command: string,
    options: { cwd?: string; timeout?: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface GitHubAPIClient {
  request(method: string, endpoint: string, options?: Record<string, unknown>): Promise<unknown>;
}

// =============================================================================
// CONDITION EVALUATORS
// =============================================================================

type ConditionEvaluator = (
  condition: AuthorityCondition,
  context: PRContext,
  deps: EvaluatorDeps
) => Promise<ConditionResult>;

interface EvaluatorDeps {
  commandExecutor?: CommandExecutor;
  githubClient?: GitHubAPIClient;
}

/**
 * Evaluate a command condition
 */
async function evaluateCommandCondition(
  condition: AuthorityCondition & { type: "command" },
  _context: PRContext,
  deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  if (!deps.commandExecutor) {
    return {
      type: "command",
      passed: false,
      message: "Command executor not available",
      duration_ms: Date.now() - start,
    };
  }

  try {
    const result = await deps.commandExecutor.execute(condition.command, {
      cwd: condition.cwd,
      timeout: condition.timeout_seconds * 1000,
    });

    const passed = result.exitCode === condition.success_exit_code;
    return {
      type: "command",
      passed,
      message: passed
        ? `Command succeeded with exit code ${result.exitCode}`
        : `Command failed with exit code ${result.exitCode} (expected ${condition.success_exit_code})`,
      details: {
        command: condition.command,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 500),
        stderr: result.stderr.slice(0, 500),
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      type: "command",
      passed: false,
      message: `Command execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * Evaluate a label condition
 */
async function evaluateLabelCondition(
  condition: AuthorityCondition & { type: "label" },
  context: PRContext,
  _deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();
  const prLabels = new Set(context.labels.map((l) => l.toLowerCase()));

  // Check labels that must be absent
  if (condition.labels_absent) {
    for (const label of condition.labels_absent) {
      if (prLabels.has(label.toLowerCase())) {
        return {
          type: "label",
          passed: false,
          message: `Blocking label present: ${label}`,
          details: {
            blocking_label: label,
            pr_labels: context.labels,
          },
          duration_ms: Date.now() - start,
        };
      }
    }
  }

  // Check labels that must be present
  if (condition.labels_present) {
    for (const label of condition.labels_present) {
      if (!prLabels.has(label.toLowerCase())) {
        return {
          type: "label",
          passed: false,
          message: `Required label missing: ${label}`,
          details: {
            required_label: label,
            pr_labels: context.labels,
          },
          duration_ms: Date.now() - start,
        };
      }
    }
  }

  return {
    type: "label",
    passed: true,
    message: "Label conditions satisfied",
    details: { pr_labels: context.labels },
    duration_ms: Date.now() - start,
  };
}

/**
 * Evaluate an author condition
 */
async function evaluateAuthorCondition(
  condition: AuthorityCondition & { type: "author" },
  context: PRContext,
  _deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  // Check allowed authors
  if (condition.allowed_authors) {
    const isAllowed = condition.allowed_authors.some(
      (a) => a.toLowerCase() === context.author.toLowerCase()
    );
    if (!isAllowed) {
      return {
        type: "author",
        passed: false,
        message: `Author ${context.author} not in allowed list`,
        details: {
          author: context.author,
          allowed: condition.allowed_authors,
        },
        duration_ms: Date.now() - start,
      };
    }
  }

  // Check allowed types
  if (condition.allowed_types) {
    if (!condition.allowed_types.includes(context.authorType)) {
      return {
        type: "author",
        passed: false,
        message: `Author type ${context.authorType} not allowed`,
        details: {
          authorType: context.authorType,
          allowedTypes: condition.allowed_types,
        },
        duration_ms: Date.now() - start,
      };
    }
  }

  return {
    type: "author",
    passed: true,
    message: "Author conditions satisfied",
    details: { author: context.author, authorType: context.authorType },
    duration_ms: Date.now() - start,
  };
}

/**
 * Evaluate a files condition
 */
async function evaluateFilesCondition(
  condition: AuthorityCondition & { type: "files" },
  context: PRContext,
  _deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  // Check for escalation patterns
  if (condition.escalate_patterns) {
    for (const pattern of condition.escalate_patterns) {
      for (const file of context.files) {
        if (minimatch(file, pattern, { matchBase: true })) {
          return {
            type: "files",
            passed: false,
            message: `File ${file} matches escalation pattern ${pattern}`,
            details: {
              matched_file: file,
              pattern,
              requires_escalation: true,
            },
            duration_ms: Date.now() - start,
          };
        }
      }
    }
  }

  return {
    type: "files",
    passed: true,
    message: "File conditions satisfied",
    details: { files_count: context.files.length },
    duration_ms: Date.now() - start,
  };
}

/**
 * Evaluate a CI status condition
 */
async function evaluateCIStatusCondition(
  condition: AuthorityCondition & { type: "ci_status" },
  context: PRContext,
  _deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  // Check specific required checks
  if (condition.required_checks && condition.required_checks.length > 0) {
    for (const checkName of condition.required_checks) {
      const check = context.ciChecks.find((c) => c.name === checkName);
      if (!check) {
        return {
          type: "ci_status",
          passed: false,
          message: `Required check not found: ${checkName}`,
          duration_ms: Date.now() - start,
        };
      }
      if (check.status !== "completed" || check.conclusion !== "success") {
        if (!condition.allow_pending || check.status === "completed") {
          return {
            type: "ci_status",
            passed: false,
            message: `Check ${checkName} not successful: ${check.conclusion ?? check.status}`,
            details: { check },
            duration_ms: Date.now() - start,
          };
        }
      }
    }
  }

  // Check all checks must pass
  if (condition.all_checks_pass) {
    const failedChecks = context.ciChecks.filter(
      (c) => c.status === "completed" && c.conclusion !== "success" && c.conclusion !== "skipped"
    );
    if (failedChecks.length > 0) {
      return {
        type: "ci_status",
        passed: false,
        message: `${failedChecks.length} CI checks failed`,
        details: { failed_checks: failedChecks.map((c) => c.name) },
        duration_ms: Date.now() - start,
      };
    }
  }

  return {
    type: "ci_status",
    passed: true,
    message: "CI status conditions satisfied",
    details: { checks_count: context.ciChecks.length },
    duration_ms: Date.now() - start,
  };
}

/**
 * Evaluate a mergeable condition
 */
async function evaluateMergeableCondition(
  condition: AuthorityCondition & { type: "mergeable" },
  context: PRContext,
  _deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  // Check mergeable state
  if (condition.require_mergeable && context.mergeable !== true) {
    if (context.mergeable === null && condition.retry_on_unknown) {
      return {
        type: "mergeable",
        passed: false,
        message: "Mergeable state unknown, retry required",
        details: {
          mergeable: context.mergeable,
          mergeableState: context.mergeableState,
          retry_suggested: true,
        },
        duration_ms: Date.now() - start,
      };
    }
    return {
      type: "mergeable",
      passed: false,
      message: `PR is not mergeable: ${context.mergeableState}`,
      details: {
        mergeable: context.mergeable,
        mergeableState: context.mergeableState,
      },
      duration_ms: Date.now() - start,
    };
  }

  // Check blocked states
  if (condition.blocked_states.includes(context.mergeableState)) {
    return {
      type: "mergeable",
      passed: false,
      message: `Mergeable state is blocked: ${context.mergeableState}`,
      details: {
        mergeableState: context.mergeableState,
        blocked_states: condition.blocked_states,
      },
      duration_ms: Date.now() - start,
    };
  }

  return {
    type: "mergeable",
    passed: true,
    message: "Mergeable conditions satisfied",
    details: {
      mergeable: context.mergeable,
      mergeableState: context.mergeableState,
    },
    duration_ms: Date.now() - start,
  };
}

/**
 * Evaluate a review condition
 */
async function evaluateReviewCondition(
  condition: AuthorityCondition & { type: "review" },
  context: PRContext,
  _deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  // Check no pending requests
  if (condition.no_pending_requests) {
    const pendingCount = context.reviewRequests.users.length + context.reviewRequests.teams.length;
    if (pendingCount > 0) {
      return {
        type: "review",
        passed: false,
        message: `${pendingCount} pending review requests`,
        details: { reviewRequests: context.reviewRequests },
        duration_ms: Date.now() - start,
      };
    }
  }

  // Check minimum approvals
  if (condition.min_approvals > 0) {
    const approvals = context.reviews.filter((r) => r.state === "APPROVED").length;
    if (approvals < condition.min_approvals) {
      return {
        type: "review",
        passed: false,
        message: `Need ${condition.min_approvals} approvals, have ${approvals}`,
        details: { approvals, required: condition.min_approvals },
        duration_ms: Date.now() - start,
      };
    }
  }

  // Check for changes requested
  if (condition.block_on_changes_requested) {
    const changesRequested = context.reviews.some((r) => r.state === "CHANGES_REQUESTED");
    if (changesRequested) {
      return {
        type: "review",
        passed: false,
        message: "Changes have been requested",
        duration_ms: Date.now() - start,
      };
    }
  }

  return {
    type: "review",
    passed: true,
    message: "Review conditions satisfied",
    duration_ms: Date.now() - start,
  };
}

/**
 * Evaluate an API condition (generic)
 */
async function evaluateApiCondition(
  condition: AuthorityCondition & { type: "api" },
  context: PRContext,
  deps: EvaluatorDeps
): Promise<ConditionResult> {
  const start = Date.now();

  if (!deps.githubClient) {
    return {
      type: "api",
      passed: false,
      message: "GitHub client not available",
      duration_ms: Date.now() - start,
    };
  }

  try {
    // Substitute placeholders in endpoint
    const endpoint = condition.endpoint
      .replace("{owner}", context.owner)
      .replace("{repo}", context.repo)
      .replace("{pr}", String(context.number));

    const response = await deps.githubClient.request(condition.method, endpoint);

    // Evaluate condition expression
    // Note: Using Function constructor for simple expression evaluation
    // In production, consider a safer expression evaluator
    const evalFn = new Function("response", `return ${condition.condition}`);
    const passed = evalFn(response);

    return {
      type: "api",
      passed: Boolean(passed),
      message: passed ? "API condition passed" : "API condition failed",
      details: { endpoint, condition: condition.condition },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      type: "api",
      passed: false,
      message: `API evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - start,
    };
  }
}

// Evaluator registry
const EVALUATORS: Record<AuthorityCondition["type"], ConditionEvaluator> = {
  command: evaluateCommandCondition as ConditionEvaluator,
  api: evaluateApiCondition as ConditionEvaluator,
  label: evaluateLabelCondition as ConditionEvaluator,
  author: evaluateAuthorCondition as ConditionEvaluator,
  files: evaluateFilesCondition as ConditionEvaluator,
  ci_status: evaluateCIStatusCondition as ConditionEvaluator,
  mergeable: evaluateMergeableCondition as ConditionEvaluator,
  review: evaluateReviewCondition as ConditionEvaluator,
};

// =============================================================================
// ESCALATION CHECKER
// =============================================================================

/**
 * Check if any escalation triggers match
 */
export function checkEscalationTriggers(
  triggers: EscalationTrigger[] | undefined,
  context: PRContext
): { required: boolean; reason?: string } {
  if (!triggers || triggers.length === 0) {
    return { required: false };
  }

  for (const trigger of triggers) {
    // Check label present
    if (trigger.label_present) {
      if (context.labels.some((l) => l.toLowerCase() === trigger.label_present?.toLowerCase())) {
        return {
          required: true,
          reason: trigger.reason ?? `Label ${trigger.label_present} requires escalation`,
        };
      }
    }

    // Check author not in list
    if (trigger.author_not_in) {
      if (!trigger.author_not_in.some((a) => a.toLowerCase() === context.author.toLowerCase())) {
        return {
          required: true,
          reason: trigger.reason ?? `Author ${context.author} requires escalation`,
        };
      }
    }

    // Check file patterns
    if (trigger.files_touched_pattern) {
      for (const pattern of trigger.files_touched_pattern) {
        for (const file of context.files) {
          if (minimatch(file, pattern, { matchBase: true })) {
            return {
              required: true,
              reason: trigger.reason ?? `File ${file} matches escalation pattern`,
            };
          }
        }
      }
    }
  }

  return { required: false };
}

// =============================================================================
// MAIN EVALUATOR
// =============================================================================

/**
 * Evaluate all conditions for admin authority
 */
export async function evaluateAdminAuthority(
  config: EnhancedAdminAuthorityConfig,
  context: PRContext,
  deps: EvaluatorDeps = {}
): Promise<AuthorityEvaluationResult> {
  const start = Date.now();

  // If disabled, return immediately
  if (!config.enabled) {
    return {
      authority_granted: false,
      conditions_met: [],
      conditions_failed: ["admin_authority_disabled"],
      escalation_required: true,
      escalation_reason: "Admin authority is disabled",
      condition_results: [],
      total_duration_ms: Date.now() - start,
      evaluated_at: new Date().toISOString(),
    };
  }

  // Check escalation triggers first
  const escalation = checkEscalationTriggers(config.escalate_if, context);
  if (escalation.required) {
    return {
      authority_granted: false,
      conditions_met: [],
      conditions_failed: [],
      escalation_required: true,
      escalation_reason: escalation.reason,
      condition_results: [],
      total_duration_ms: Date.now() - start,
      evaluated_at: new Date().toISOString(),
    };
  }

  // Evaluate all conditions
  const results: ConditionResult[] = [];
  const conditionsMet: string[] = [];
  const conditionsFailed: string[] = [];

  for (const condition of config.conditions) {
    const evaluator = EVALUATORS[condition.type];
    if (!evaluator) {
      results.push({
        type: condition.type,
        passed: false,
        message: `Unknown condition type: ${condition.type}`,
        duration_ms: 0,
      });
      conditionsFailed.push(condition.type);
      continue;
    }

    const result = await evaluator(condition, context, deps);
    results.push(result);

    if (result.passed) {
      conditionsMet.push(condition.type);
    } else {
      conditionsFailed.push(condition.type);
    }
  }

  const allPassed = conditionsFailed.length === 0;

  return {
    authority_granted: allPassed,
    conditions_met: conditionsMet,
    conditions_failed: conditionsFailed,
    escalation_required: !allPassed,
    escalation_reason: allPassed ? undefined : `Conditions failed: ${conditionsFailed.join(", ")}`,
    condition_results: results,
    total_duration_ms: Date.now() - start,
    evaluated_at: new Date().toISOString(),
  };
}
