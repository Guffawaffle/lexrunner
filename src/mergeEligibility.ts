/**
 * Merge eligibility and decision logic for lexrunner
 * Implements policy-based merge decisions, short-circuiting, and manual overrides
 */

import { Plan, Policy, NodeResult, NodeStatus } from './schema.js';
import { ExecutionState } from './executionState.js';

/**
 * Merge decision result
 */
export interface MergeDecision {
	nodeName: string;
	eligible: boolean;
	reason: string;
	requiresOverride: boolean;
	blockedBy?: string[];
}

/**
 * Override request for manual merge approval
 */
export interface OverrideRequest {
	nodeName: string;
	requestedBy: string;
	reason: string;
	timestamp: string;
}

/**
 * Merge eligibility evaluator
 */
export class MergeEligibilityEvaluator {
	private plan: Plan;
	private policy: Policy;
	private executionState: ExecutionState;
	private overrides: Map<string, OverrideRequest> = new Map();

	constructor(plan: Plan, executionState: ExecutionState) {
		this.plan = plan;
		this.policy = plan.policy || this.getDefaultPolicy();
		this.executionState = executionState;
	}

	/**
	 * Get default policy if none specified
	 */
	private getDefaultPolicy(): Policy {
		return {
			requiredGates: [],
			optionalGates: [],
			maxWorkers: 1,
			retries: {},
			overrides: {},
			blockOn: [],
			mergeRule: { type: "strict-required" }
		};
	}

	/**
	 * Evaluate merge eligibility for all nodes
	 */
	evaluateAllNodes(): Map<string, MergeDecision> {
		const decisions = new Map<string, MergeDecision>();

		for (const item of this.plan.items) {
			const decision = this.evaluateNode(item.name);
			decisions.set(item.name, decision);
		}

		return decisions;
	}

	/**
	 * Evaluate merge eligibility for a specific node
	 */
	evaluateNode(nodeName: string): MergeDecision {
		const nodeResult = this.executionState.getNodeResult(nodeName);
		if (!nodeResult) {
			return {
				nodeName,
				eligible: false,
				reason: "Node not found in execution state",
				requiresOverride: false
			};
		}

		// Check if node has manual override
		const override = this.overrides.get(nodeName);
		if (override && this.isValidOverride(override)) {
			return {
				nodeName,
				eligible: true,
				reason: `Manual override by ${override.requestedBy}: ${override.reason}`,
				requiresOverride: false
			};
		}

		// Apply merge rule based on policy
		switch (this.policy.mergeRule.type) {
			case "strict-required":
				return this.evaluateStrictRequired(nodeResult);
			default:
				return {
					nodeName,
					eligible: false,
					reason: `Unknown merge rule: ${this.policy.mergeRule.type}`,
					requiresOverride: false
				};
		}
	}

	/**
	 * Evaluate strict-required merge rule
	 */
	private evaluateStrictRequired(nodeResult: NodeResult): MergeDecision {
		const nodeName = nodeResult.name;

		// Check if node is blocked by dependencies
		if (nodeResult.status === "blocked") {
			return {
				nodeName,
				eligible: false,
				reason: "Blocked by failed dependencies",
				requiresOverride: true,
				blockedBy: nodeResult.blockedBy
			};
		}

		// Check if node has failed gates
		if (nodeResult.status === "fail") {
			const failedGates = nodeResult.gates
				.filter(gate => gate.status === "fail")
				.map(gate => gate.gate);

			return {
				nodeName,
				eligible: false,
				reason: `Failed required gates: ${failedGates.join(", ")}`,
				requiresOverride: true
			};
		}

		// Check if node is still retrying
		if (nodeResult.status === "retrying") {
			return {
				nodeName,
				eligible: false,
				reason: "Gates still retrying",
				requiresOverride: false
			};
		}

		// Check if all required gates passed
		if (nodeResult.status === "pass" && nodeResult.eligibleForMerge) {
			return {
				nodeName,
				eligible: true,
				reason: "All required gates passed",
				requiresOverride: false
			};
		}

		// Check if dependencies are ready
		const item = this.plan.items.find(i => i.name === nodeName)!;
		const dependencyResults = this.checkDependencyStatus(item.deps);
		if (!dependencyResults.allReady) {
			return {
				nodeName,
				eligible: false,
				reason: `Waiting for dependencies: ${dependencyResults.pending.join(", ")}`,
				requiresOverride: false
			};
		}

		// Default to not eligible if we reach here
		return {
			nodeName,
			eligible: false,
			reason: `Node status: ${nodeResult.status}, not eligible for merge`,
			requiresOverride: false
		};
	}

	/**
	 * Check status of all dependencies
	 */
	private checkDependencyStatus(dependencies: string[]): {
		allReady: boolean;
		pending: string[];
		failed: string[];
	} {
		const pending: string[] = [];
		const failed: string[] = [];

		for (const depName of dependencies) {
			const depResult = this.executionState.getNodeResult(depName);
			if (!depResult) {
				pending.push(depName);
				continue;
			}

			switch (depResult.status) {
				case "pass":
					// Dependency is ready
					break;
				case "fail":
				case "blocked":
					failed.push(depName);
					break;
				default:
					pending.push(depName);
					break;
			}
		}

		return {
			allReady: pending.length === 0 && failed.length === 0,
			pending,
			failed
		};
	}

	/**
	 * Request manual override for a node
	 */
	requestOverride(nodeName: string, requestedBy: string, reason: string): boolean {
		// Check if admin overrides are allowed by policy
		const adminConfig = this.policy.overrides.adminGreen;
		if (!adminConfig) {
			return false; // Admin overrides not configured
		}

		// Check if user is authorized for overrides
		if (adminConfig.allowedUsers && !adminConfig.allowedUsers.includes(requestedBy)) {
			return false; // User not authorized
		}

		// Check if reason is required and provided
		if (adminConfig.requireReason && (!reason || reason.trim().length === 0)) {
			return false; // Reason required but not provided
		}

		// Record the override request
		this.overrides.set(nodeName, {
			nodeName,
			requestedBy,
			reason: reason || "Manual override requested",
			timestamp: new Date().toISOString()
		});

		return true;
	}

	/**
	 * Check if an override is valid
	 */
	private isValidOverride(override: OverrideRequest): boolean {
		const adminConfig = this.policy.overrides.adminGreen;
		if (!adminConfig) {
			return false;
		}

		// Check user authorization
		if (adminConfig.allowedUsers && !adminConfig.allowedUsers.includes(override.requestedBy)) {
			return false;
		}

		// Check reason requirement
		if (adminConfig.requireReason && (!override.reason || override.reason.trim().length === 0)) {
			return false;
		}

		return true;
	}

	/**
	 * Get nodes ready for merge (eligible and all dependencies merged)
	 */
	getNodesReadyForMerge(): string[] {
		const ready: string[] = [];
		const decisions = this.evaluateAllNodes();
		const merged = new Set<string>(); // Track already merged nodes

		// Multiple passes to handle dependency chains
		let progress = true;
		while (progress) {
			progress = false;

			for (const [nodeName, decision] of decisions) {
				if (merged.has(nodeName) || !decision.eligible) {
					continue;
				}

				// Check if all dependencies are already merged
				const item = this.plan.items.find(i => i.name === nodeName)!;
				const allDepsMerged = item.deps.every(dep => merged.has(dep));

				if (allDepsMerged) {
					ready.push(nodeName);
					merged.add(nodeName);
					progress = true;
				}
			}
		}

		return ready;
	}

	/**
	 * Get merge summary for reporting
	 */
	getMergeSummary(): {
		eligible: string[];
		blocked: string[];
		pending: string[];
		failed: string[];
		overrides: OverrideRequest[];
	} {
		const decisions = this.evaluateAllNodes();
		const eligible: string[] = [];
		const blocked: string[] = [];
		const pending: string[] = [];
		const failed: string[] = [];

		for (const [nodeName, decision] of decisions) {
			if (decision.eligible) {
				eligible.push(nodeName);
			} else if (decision.requiresOverride) {
				if (decision.reason.includes("Blocked") || decision.reason.includes("Failed")) {
					failed.push(nodeName);
				} else {
					blocked.push(nodeName);
				}
			} else {
				pending.push(nodeName);
			}
		}

		return {
			eligible,
			blocked,
			pending,
			failed,
			overrides: Array.from(this.overrides.values())
		};
	}

	/**
	 * Clear all overrides (for testing or reset)
	 */
	clearOverrides(): void {
		this.overrides.clear();
	}
}
