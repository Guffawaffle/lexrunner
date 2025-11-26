/**
 * State machine wrapper for procedures
 *
 * Wraps a procedure definition to provide runtime state machine
 * functionality including transition validation and execution.
 */

import type {
	Procedure,
	ProcedureDefinition,
	DecisionPoint,
	RunContext
} from "./types.js";
import type { NextOption } from "../schemas/runCentric.js";

/**
 * State machine implementation of the Procedure interface
 */
export class ProcedureStateMachine implements Procedure {
	private readonly definition: ProcedureDefinition;
	private readonly decisionPointMap: Map<string, DecisionPoint>;
	private readonly terminalStates: Set<string>;

	constructor(definition: ProcedureDefinition) {
		this.definition = definition;

		// Build decision point lookup map
		this.decisionPointMap = new Map();
		if (definition.decisionPoints) {
			for (const dp of definition.decisionPoints) {
				this.decisionPointMap.set(dp.state, dp);
			}
		}

		// Identify terminal states (states with no outgoing transitions)
		this.terminalStates = new Set();
		for (const state of definition.states) {
			const transitions = definition.transitions[state];
			if (!transitions || Object.keys(transitions).length === 0) {
				this.terminalStates.add(state);
			}
		}
	}

	/**
	 * Get procedure id
	 */
	get id(): string {
		return this.definition.id;
	}

	/**
	 * Get procedure name
	 */
	get name(): string {
		return this.definition.name;
	}

	/**
	 * Get procedure description
	 */
	get description(): string {
		return this.definition.description;
	}

	/**
	 * Get the initial state for this procedure
	 */
	getInitialState(): string {
		return this.definition.initialState;
	}

	/**
	 * Get available options for the current state and context
	 */
	getNextOptions(state: string, _context: RunContext): NextOption[] {
		const options: NextOption[] = [];
		const transitions = this.definition.transitions[state];

		if (!transitions) {
			return options;
		}

		// Check if this state has a decision point
		const decisionPoint = this.decisionPointMap.get(state);

		if (decisionPoint) {
			// Return options from decision point
			for (const dpOption of decisionPoint.options) {
				options.push({
					action: dpOption.action,
					description: dpOption.description,
					requiresLLMDecision: decisionPoint.requiresLLMDecision,
					prompt: decisionPoint.prompt,
					riskLevel: dpOption.riskLevel
				});
			}
		} else {
			// Return options based on available transitions
			for (const [event, _toState] of Object.entries(transitions)) {
				options.push({
					action: event,
					description: `Trigger ${event} transition`,
					requiresLLMDecision: false,
					riskLevel: "low"
				});
			}
		}

		// Sort options by action for deterministic ordering
		options.sort((a, b) => a.action.localeCompare(b.action));

		return options;
	}

	/**
	 * Check if a transition is valid
	 */
	canTransition(from: string, event: string): boolean {
		const transitions = this.definition.transitions[from];
		if (!transitions) {
			return false;
		}
		return event in transitions;
	}

	/**
	 * Apply a transition and return the new state
	 * @throws Error if transition is invalid
	 */
	applyTransition(from: string, event: string): string {
		const transitions = this.definition.transitions[from];
		if (!transitions) {
			throw new Error(`No transitions defined for state "${from}"`);
		}

		const toState = transitions[event];
		if (!toState) {
			throw new Error(`Invalid transition: "${event}" from state "${from}"`);
		}

		return toState;
	}

	/**
	 * Check if a state is terminal (no outgoing transitions)
	 */
	isTerminal(state: string): boolean {
		return this.terminalStates.has(state);
	}

	/**
	 * Get the decision point for a state if any
	 */
	getDecisionPoint(state: string): DecisionPoint | null {
		return this.decisionPointMap.get(state) || null;
	}

	/**
	 * Get the list of completion gates
	 */
	getCompletionGates(): string[] {
		return this.definition.completionGates || [];
	}
}
