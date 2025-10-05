/**
 * Autopilot Level 3 - Integration Branches
 * Extends Level 2 with branch creation, merge operations, and gate execution
 */

import { AutopilotLevel2 } from "./level2.js";
import { AutopilotResult } from "./base.js";
import { GitOperations, createGitOperations, WeaveExecutionResult } from "../git/operations.js";
import { createGitHubClient } from "../github/index.js";
import { executeItemGates } from "../gates.js";
import { ExecutionState } from "../executionState.js";
import * as crypto from "crypto";
import * as path from "path";

/**
 * Level 3 autopilot - Integration branches
 * Creates integration branches, performs multi-PR merges, runs gates
 */
export class AutopilotLevel3 extends AutopilotLevel2 {
	getLevel(): number {
		return 3;
	}

	async execute(customDeliverablesDir?: string): Promise<AutopilotResult> {
		try {
			// Execute Level 2 first to generate artifacts and annotations
			const level2Result = await super.execute(customDeliverablesDir);
			if (!level2Result.success) {
				return level2Result; // Propagate Level 2 failure
			}

			// Initialize git operations
			const gitOps = createGitOperations();

			// Check git repository is clean
			const isClean = await gitOps.isClean();
			if (!isClean) {
				return {
					level: 3,
					success: false,
					message: "Level 3: Git repository is not clean - commit or stash changes before proceeding",
					artifacts: level2Result.artifacts
				};
			}

			const plan = this.context.plan;
			const mergeOrder = this.computeMergeOrder();

			// Generate integration branch name with timestamp and hash
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const hash = this.generateShortHash(plan);
			const branchPrefix = this.getBranchPrefix();
			const integrationBranch = `${branchPrefix}${timestamp}-${hash}`;

			console.log(`Level 3: Creating integration branch: ${integrationBranch}`);

			// Create integration branch
			const baseBranch = plan.target || 'main';
			const createdBranch = await this.createIntegrationBranch(gitOps, baseBranch, integrationBranch);

			console.log(`Level 3: Successfully created branch: ${createdBranch}`);

			// Execute multi-PR merge
			const weaveResult = await this.executeMergeWeave(gitOps, plan, mergeOrder);

			// Execute gates on integration branch
			const gateResults = await this.executeGates(plan, weaveResult);

			// Determine success/failure
			const allGatesPassed = gateResults.every(r => r.status === 'pass');
			const allMergesSucceeded = weaveResult.failed === 0 && weaveResult.conflicts === 0;

			if (allGatesPassed && allMergesSucceeded) {
				// Success path - report success (Level 4 will handle actual merge to main)
				const message = [
					level2Result.message,
					"",
					"Level 3: Integration branch validation complete ✅",
					`  • Branch: ${createdBranch}`,
					`  • Merged: ${weaveResult.successful} PRs successfully`,
					`  • Gates: All ${gateResults.length} gates passed`,
					"",
					"Next steps:",
					"  - Integration branch is ready for final merge",
					"  - Use Level 4 for automatic merge to main and PR cleanup"
				].join("\n");

				return {
					level: 3,
					success: true,
					message,
					artifacts: level2Result.artifacts
				};
			} else {
				// Failure path - report results, keep source PRs open
				const failedMerges = weaveResult.operations.filter(op => !op.success);
				const failedGates = gateResults.filter(r => r.status === 'fail');

				const message = [
					level2Result.message,
					"",
					"Level 3: Integration branch validation failed ❌",
					`  • Branch: ${createdBranch}`,
					`  • Merged: ${weaveResult.successful} PRs successfully`,
					`  • Failed merges: ${failedMerges.length}`,
					`  • Failed gates: ${failedGates.length}`,
					"",
					"Failed operations:",
					...failedMerges.map(op => `  - ${op.item.name}: ${op.message || 'Unknown error'}`),
					...failedGates.map(g => `  - Gate ${g.gate}: ${g.error || 'Failed'}`),
					"",
					"Source PRs remain open for fixes",
					"Integration branch preserved for inspection"
				].join("\n");

				return {
					level: 3,
					success: false,
					message,
					artifacts: level2Result.artifacts
				};
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				level: 3,
				success: false,
				message: `Level 3 execution failed: ${errorMessage}`
			};
		}
	}

	/**
	 * Create integration branch with custom naming
	 */
	private async createIntegrationBranch(
		gitOps: GitOperations,
		baseBranch: string,
		branchName: string
	): Promise<string> {
		try {
			// Get current branch to restore later if needed
			const currentBranch = await gitOps.getCurrentBranch();

			// Checkout base branch
			await gitOps['git'].checkout(baseBranch);

			// Pull latest changes
			try {
				await gitOps['git'].pull('origin', baseBranch);
			} catch (pullError) {
				// Pull might fail if tracking not set up - that's okay
				console.warn(`Warning: Could not pull ${baseBranch}:`, pullError);
			}

			// Create new branch
			await gitOps['git'].checkoutLocalBranch(branchName);

			return branchName;
		} catch (error) {
			throw new Error(`Failed to create integration branch: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Execute multi-PR merge using weave strategy
	 */
	private async executeMergeWeave(
		gitOps: GitOperations,
		plan: any,
		mergeOrder: string[][]
	): Promise<WeaveExecutionResult> {
		console.log(`Level 3: Executing merge weave with ${mergeOrder.length} levels`);

		// Use the git operations executeWeave method
		const result = await gitOps.executeWeave(plan, mergeOrder);

		console.log(`Level 3: Merge weave complete - ${result.successful} succeeded, ${result.failed} failed, ${result.conflicts} conflicts`);

		return result;
	}

	/**
	 * Execute gates on integration branch
	 */
	private async executeGates(plan: any, weaveResult: WeaveExecutionResult): Promise<any[]> {
		// Only execute gates if all merges succeeded
		if (weaveResult.failed > 0 || weaveResult.conflicts > 0) {
			console.log("Level 3: Skipping gate execution due to merge failures");
			return [];
		}

		console.log("Level 3: Executing gates on integration branch");

		// Create execution state
		const executionState = new ExecutionState(plan);

		// Get artifact directory from profile
		const artifactDir = path.join(this.context.profilePath, 'runner', 'gate-results');

		// Get policy from plan
		const policy = plan.policy || { 
			requiredGates: [], 
			optionalGates: [], 
			maxWorkers: 1,
			retries: {},
			overrides: {},
			blockOn: [],
			mergeRule: { type: "strict-required" }
		};

		// Execute gates for all items and aggregate results
		const allResults: any[] = [];
		for (const item of plan.items) {
			const itemResults = await executeItemGates(
				item,
				policy,
				executionState,
				artifactDir
			);
			allResults.push(...itemResults);
		}

		console.log(`Level 3: Gate execution complete - ${allResults.filter(r => r.status === 'pass').length} passed, ${allResults.filter(r => r.status === 'fail').length} failed`);

		return allResults;
	}

	/**
	 * Generate short hash for branch naming
	 */
	private generateShortHash(plan: any): string {
		const content = JSON.stringify({
			target: plan.target,
			items: plan.items.map((i: any) => i.name)
		});
		return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
	}

	/**
	 * Get branch prefix from config or default
	 */
	private getBranchPrefix(): string {
		// This would come from AutopilotConfig in a real implementation
		// For now, use default from environment or hardcoded
		return process.env.LEX_BRANCH_PREFIX || 'integration/';
	}
}
