/**
 * Status builder for constructing StatusResponse from run state
 *
 * Derives nextOptions from current state and builds rich context for model orientation.
 */

import type { StatusResponse, NextOption, PersonaSnapshot } from "../schemas/runCentric.js";
import type { RunState, RunStateFile } from "./types.js";
import { getViolations, generateViolationRiskFlags } from "./enforcement.js";

/**
 * Input type for statusBuilder - accepts both RunState and lenient RunStateFile
 */
type StatusBuilderInput = RunState | RunStateFile;

/**
 * RunState state field values
 */
type StateValue =
  | "planning"
  | "gated"
  | "executing"
  | "completed"
  | "failed"
  | "paused"
  | "aborted";

/**
 * Default next options by state
 */
const DEFAULT_OPTIONS_BY_STATE: Record<StateValue, NextOption[]> = {
  planning: [
    { action: "continue", description: "Continue with planning phase." },
    { action: "pause", description: "Pause the run for later resumption." },
    {
      action: "abort",
      description: "Abort the run entirely.",
      riskLevel: "medium",
    },
  ],
  gated: [
    { action: "continue", description: "Continue after gate passes." },
    { action: "retry", description: "Retry the failing gate." },
    {
      action: "skip",
      description: "Skip the current gate.",
      requiresLLMDecision: true,
      riskLevel: "medium",
    },
    { action: "pause", description: "Pause the run for later resumption." },
    {
      action: "abort",
      description: "Abort the run entirely.",
      riskLevel: "medium",
    },
  ],
  executing: [
    { action: "continue", description: "Continue execution." },
    { action: "pause", description: "Pause the run for later resumption." },
    {
      action: "abort",
      description: "Abort the run entirely.",
      riskLevel: "medium",
    },
  ],
  completed: [
    {
      action: "restart",
      description: "Start a new run with same parameters.",
    },
  ],
  failed: [
    { action: "retry", description: "Retry the failed operation." },
    {
      action: "restart",
      description: "Start a new run with same parameters.",
    },
    {
      action: "abort",
      description: "Mark the run as permanently failed.",
      riskLevel: "low",
    },
  ],
  paused: [
    { action: "resume", description: "Resume the paused run." },
    {
      action: "abort",
      description: "Abort the paused run.",
      riskLevel: "medium",
    },
  ],
  aborted: [
    {
      action: "restart",
      description: "Start a new run with same parameters.",
    },
  ],
};

/**
 * Generate a summary string for the current state
 */
function generateSummary(runState: StatusBuilderInput): string {
  const { state, procedure, repo, currentStep, completedSteps = [] } = runState;

  switch (state) {
    case "planning":
      return `Planning ${procedure} for ${repo}.`;
    case "gated":
      if (currentStep) {
        return `Running gate: ${currentStep}.`;
      }
      return `Waiting for gates to pass on ${repo}.`;
    case "executing":
      if (currentStep) {
        return `Executing step: ${currentStep}.`;
      }
      return `Executing ${procedure} on ${repo}.`;
    case "completed":
      return `Successfully completed ${procedure} for ${repo}. ${completedSteps.length} steps completed.`;
    case "failed":
      return `Failed to complete ${procedure} for ${repo}.`;
    case "paused":
      return `Paused ${procedure} for ${repo}.`;
    case "aborted":
      return `Aborted ${procedure} for ${repo}.`;
    default:
      return `${procedure} for ${repo} is in state: ${state}.`;
  }
}

/**
 * Build a persona snapshot from mode or existing persona
 */
function buildPersonaSnapshot(runState: StatusBuilderInput): PersonaSnapshot {
  // If persona is already defined on the run, use it
  if ("persona" in runState && runState.persona) {
    return runState.persona as PersonaSnapshot;
  }

  // Default persona configuration based on mode
  const personaConfigs: Record<string, Partial<PersonaSnapshot>> = {
    "senior-dev": {
      forbidden: ["force-push", "delete-branch", "bypass-ci"],
      completionGates: ["lint", "test", "build"],
      decisionStyle: {
        preferSmallDiffs: true,
        requireRationaleForSkips: true,
        escalateSecurityFindings: true,
      },
    },
    "eager-pm": {
      forbidden: ["force-push"],
      completionGates: ["lint"],
      decisionStyle: {
        preferSmallDiffs: false,
        requireRationaleForSkips: false,
        escalateSecurityFindings: false,
      },
    },
  };

  const config = personaConfigs[runState.mode] || {
    forbidden: [],
    completionGates: [],
    decisionStyle: {},
  };

  return {
    mode: runState.mode,
    forbidden: config.forbidden || [],
    completionGates: config.completionGates || [],
    decisionStyle: config.decisionStyle,
  };
}

/**
 * Build progress from RunState
 */
function buildProgress(
  runState: StatusBuilderInput
): { completed: string[]; current: string | null; remaining: string[] } | undefined {
  return {
    completed: runState.completedSteps || [],
    current: runState.currentStep || null,
    remaining: [], // Can be populated from procedure definition later
  };
}

/**
 * Build a StatusResponse from run state
 */
export function buildStatusResponse(
  runState: StatusBuilderInput,
  options?: { baseDir?: string }
): StatusResponse {
  const stateValue = runState.state as StateValue;
  const nextOptions = DEFAULT_OPTIONS_BY_STATE[stateValue] || [];

  // Build risk flags from violations if baseDir is provided
  let riskFlags: string[] | undefined;
  if (options?.baseDir) {
    try {
      const violations = getViolations(runState.runId, options.baseDir);
      const violationFlags = generateViolationRiskFlags(violations);
      if (violationFlags.length > 0) {
        riskFlags = violationFlags;
      }
    } catch {
      // Ignore errors reading violations - run may not have any logged yet
    }
  }

  return {
    runId: runState.runId,
    state: runState.state,
    mode: runState.mode,
    procedure: runState.procedure,
    summary: generateSummary(runState),
    progress: buildProgress(runState),
    nextOptions,
    context: runState.metadata,
    persona: buildPersonaSnapshot(runState),
    riskFlags,
  };
}

/**
 * Get default next options for a given state
 */
export function getDefaultNextOptions(state: StateValue): NextOption[] {
  return DEFAULT_OPTIONS_BY_STATE[state] || [];
}
