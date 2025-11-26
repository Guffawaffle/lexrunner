/**
 * Status builder for constructing StatusResponse from run state
 * 
 * Derives nextOptions from current state and builds rich context for model orientation.
 */

import type { StatusResponse, NextOption, PersonaSnapshot } from "../schemas/runCentric.js";
import type { RunStateFile, RunState } from "./types.js";

/**
 * Default next options by state
 */
const DEFAULT_OPTIONS_BY_STATE: Record<RunState, NextOption[]> = {
	planning: [
		{ action: "continue", description: "Continue with planning phase." },
		{ action: "pause", description: "Pause the run for later resumption." },
		{ action: "abort", description: "Abort the run entirely.", riskLevel: "medium" }
	],
	gated: [
		{ action: "continue", description: "Continue after gate passes." },
		{ action: "retry", description: "Retry the failing gate." },
		{ action: "skip", description: "Skip the current gate.", requiresLLMDecision: true, riskLevel: "medium" },
		{ action: "pause", description: "Pause the run for later resumption." },
		{ action: "abort", description: "Abort the run entirely.", riskLevel: "medium" }
	],
	executing: [
		{ action: "continue", description: "Continue execution." },
		{ action: "pause", description: "Pause the run for later resumption." },
		{ action: "abort", description: "Abort the run entirely.", riskLevel: "medium" }
	],
	completed: [
		{ action: "restart", description: "Start a new run with same parameters." }
	],
	failed: [
		{ action: "retry", description: "Retry the failed operation." },
		{ action: "restart", description: "Start a new run with same parameters." },
		{ action: "abort", description: "Mark the run as permanently failed.", riskLevel: "low" }
	],
	paused: [
		{ action: "resume", description: "Resume the paused run." },
		{ action: "abort", description: "Abort the paused run.", riskLevel: "medium" }
	],
	aborted: [
		{ action: "restart", description: "Start a new run with same parameters." }
	]
};

/**
 * Generate a summary string for the current state
 */
function generateSummary(runState: RunStateFile): string {
	const { state, procedure, repo, progress, blockers } = runState;
	
	switch (state) {
		case "planning":
			return `Planning ${procedure} for ${repo}.`;
		case "gated":
			if (blockers && blockers.length > 0) {
				return `Waiting for gate: ${blockers[0]}.`;
			}
			return `Waiting for gates to pass on ${repo}.`;
		case "executing":
			if (progress?.current) {
				return `Executing step: ${progress.current}.`;
			}
			return `Executing ${procedure} on ${repo}.`;
		case "completed":
			return `Successfully completed ${procedure} for ${repo}.`;
		case "failed":
			if (blockers && blockers.length > 0) {
				return `Failed: ${blockers[0]}.`;
			}
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
 * Build a persona snapshot from mode
 */
function buildPersonaSnapshot(mode: string): PersonaSnapshot {
	// Default persona configuration based on mode
	const personaConfigs: Record<string, Partial<PersonaSnapshot>> = {
		"senior-dev": {
			forbidden: ["force-push", "delete-branch", "bypass-ci"],
			completionGates: ["lint", "test", "build"],
			decisionStyle: {
				preferSmallDiffs: true,
				requireRationaleForSkips: true,
				escalateSecurityFindings: true
			}
		},
		"eager-pm": {
			forbidden: ["force-push"],
			completionGates: ["lint"],
			decisionStyle: {
				preferSmallDiffs: false,
				requireRationaleForSkips: false,
				escalateSecurityFindings: false
			}
		}
	};
	
	const config = personaConfigs[mode] || {
		forbidden: [],
		completionGates: [],
		decisionStyle: {}
	};
	
	return {
		mode,
		forbidden: config.forbidden || [],
		completionGates: config.completionGates || [],
		decisionStyle: config.decisionStyle
	};
}

/**
 * Build a StatusResponse from run state
 */
export function buildStatusResponse(runState: RunStateFile): StatusResponse {
	const state = runState.state as RunState;
	const nextOptions = DEFAULT_OPTIONS_BY_STATE[state] || [];
	
	return {
		runId: runState.runId,
		state: runState.state,
		mode: runState.mode,
		procedure: runState.procedure,
		summary: generateSummary(runState),
		progress: runState.progress,
		nextOptions,
		context: runState.context,
		riskFlags: runState.riskFlags,
		blockers: runState.blockers,
		persona: buildPersonaSnapshot(runState.mode)
	};
}

/**
 * Get default next options for a given state
 */
export function getDefaultNextOptions(state: RunState): NextOption[] {
	return DEFAULT_OPTIONS_BY_STATE[state] || [];
}
