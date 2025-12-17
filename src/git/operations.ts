/**
 * Git operations for merge pyramid execution
 * Implements weave strategy and conflict detection
 */

import { simpleGit, SimpleGit, MergeResult as GitMergeResult } from "simple-git";
import { Plan, PlanItem } from "../schema.js";
import { metrics, METRICS } from "../monitoring/metrics.js";
import { profiler } from "../monitoring/profiler.js";
import { ProgressReporter } from "../util/progress.js";
import { emitActionReceipt, emitFailureReceipt } from "../receipts/emit.js";

export interface MergeOperation {
	item: PlanItem;
	targetBranch: string;
	strategy: "rebase-weave" | "merge-weave" | "squash-weave";
}

export interface WeaveResult {
	success: boolean;
	item: PlanItem;
	conflicts?: string[];
	sha?: string;
	message?: string;
}

export interface WeaveExecutionResult {
	operations: WeaveResult[];
	successful: number;
	failed: number;
	conflicts: number;
	totalOperations: number;
}

/**
 * Git operations manager for merge pyramid execution
 */
export class GitOperations {
	private git: SimpleGit;
	private workingDir: string;

	constructor(workingDir: string = process.cwd()) {
		this.workingDir = workingDir;
		this.git = simpleGit(workingDir);
	}

	/**
	 * Check if git repository is in a clean state
	 */
	async isClean(): Promise<boolean> {
		try {
			const status = await this.git.status();
			return status.files.length === 0;
		} catch (error) {
			throw new GitOperationError(`Failed to check git status: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		try {
			const status = await this.git.status();
			return status.current || 'HEAD';
		} catch (error) {
			throw new GitOperationError(`Failed to get current branch: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get commit SHA for a branch
	 */
	async getBranchHead(branchName: string): Promise<string | null> {
		try {
			// Fetch latest changes for the branch
			await this.git.fetch('origin', branchName);
			
			// Get the commit SHA for the remote branch
			const log = await this.git.log([`origin/${branchName}`, '-1']);
			return log.latest?.hash || null;
		} catch (error) {
			// Branch might not exist or fetch failed
			return null;
		}
	}

	/**
	 * Get list of conflicted files using git diff
	 * This captures files with unmerged status (UU, AA, DU, UD, etc.)
	 */
	async getConflictedFiles(): Promise<string[]> {
		try {
			// Use git diff to find unmerged files
			const result = await this.git.raw(['diff', '--name-only', '--diff-filter=U']);
			const files = result.trim().split('\n').filter(f => f.length > 0);
			
			// Also check git status for conflicted files
			const status = await this.git.status();
			const conflictedFromStatus = status.conflicted || [];
			
			// Combine and deduplicate
			const allConflicts = [...new Set([...files, ...conflictedFromStatus])];
			return allConflicts;
		} catch (error) {
			// If command fails, fall back to status.conflicted
			try {
				const status = await this.git.status();
				return status.conflicted || [];
			} catch {
				return [];
			}
		}
	}

	/**
	 * Create and checkout a new branch for weave operations
	 */
	async createWeaveBranch(baseBranch: string = 'main'): Promise<string> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const branchName = `weave/integration-${timestamp}`;

		try {
			// Ensure we're on the base branch and it's up to date
			await this.git.checkout(baseBranch);
			await this.git.pull('origin', baseBranch);

			// Create new branch
			await this.git.checkoutLocalBranch(branchName);

			return branchName;
		} catch (error) {
			throw new GitOperationError(`Failed to create weave branch: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Execute a single merge operation with conflict detection
	 */
	async executeMergeOperation(operation: MergeOperation): Promise<WeaveResult> {
		const operationId = `merge_${operation.item.name}`;
		profiler.start(operationId, { item: operation.item.name, strategy: operation.strategy });

		// Capture current HEAD for rollback path (declared outside try for catch block access)
		let previousHead = 'HEAD';

		try {
			const { item, strategy } = operation;
			const branchName = item.name; // Assuming item.name is the branch name

			// Get actual commit hash for rollback
			const premergeLog = await this.git.log(['-1']);
			previousHead = premergeLog.latest?.hash || 'HEAD';

			// Check if branch exists
			const branches = await this.git.branch(['-a']);
			const branchExists = branches.all.some(branch =>
				branch === branchName ||
				branch === `origin/${branchName}` ||
				branch === `remotes/origin/${branchName}`
			);

			if (!branchExists) {
				profiler.end(operationId);
				metrics.incrementCounter(METRICS.MERGE_FAILURE_TOTAL, { reason: 'branch_not_found' });
				return {
					success: false,
					item,
					message: `Branch ${branchName} not found`,
				};
			}

			// Fetch latest changes
			await this.git.fetch('origin', branchName);

			let gitMergeResult: any;
			let sha: string | undefined;
			let mergeError: Error | null = null;

			try {
				switch (strategy) {
					case "merge-weave":
						gitMergeResult = await this.git.merge([`origin/${branchName}`, '--no-ff']);
						break;
					
					case "squash-weave":
						gitMergeResult = await this.git.merge([`origin/${branchName}`, '--squash']);
						if (gitMergeResult && !gitMergeResult.failed) {
							// For squash merges, we need to commit manually
							await this.git.commit(`Squash merge: ${item.name}`);
						}
						break;
					
					case "rebase-weave":
						// For rebase weave, we actually merge with --ff-only after rebasing
						try {
							await this.git.rebase([`origin/${branchName}`]);
							gitMergeResult = await this.git.merge([`origin/${branchName}`, '--ff-only']);
						} catch (rebaseError) {
							// Get conflicted files for rebase
							const conflictedFiles = await this.getConflictedFiles();
							profiler.end(operationId);
							metrics.incrementCounter(METRICS.MERGE_FAILURE_TOTAL, { reason: 'rebase_conflict' });
							return {
								success: false,
								item,
								conflicts: conflictedFiles.length > 0 ? conflictedFiles : ['Rebase conflicts detected'],
								message: `Rebase failed: ${rebaseError instanceof Error ? rebaseError.message : String(rebaseError)}`,
							};
						}
						break;
				}
			} catch (error) {
				// Merge command threw an error - likely due to conflicts
				mergeError = error instanceof Error ? error : new Error(String(error));
			}

			// Check for conflicts more thoroughly
			// 1. Check if merge result indicates failure
			// 2. Check if there was a merge error
			// 3. Check actual git status for unmerged files
			const hasMergeFailure = gitMergeResult?.failed || mergeError !== null;
			const conflictedFiles = await this.getConflictedFiles();

			if (hasMergeFailure || conflictedFiles.length > 0) {
				profiler.end(operationId, { item: operation.item.name, status: 'conflict' });
				metrics.incrementCounter(METRICS.MERGE_FAILURE_TOTAL, { reason: 'conflict' });

				// Format message to include conflict summary
				let message = 'Merge conflicts detected';
				if (conflictedFiles.length > 0) {
					message = `CONFLICTS: ${conflictedFiles.join(', ')}`;
				}
				if (mergeError) {
					message += ` (${mergeError.message})`;
				}

				// Emit failure receipt for merge conflict (Disciplined Failure Pattern)
				emitFailureReceipt({
					action: `merge ${branchName} to ${operation.targetBranch}`,
					rationale: message,
					confidence: 'high',
					reversibility: 'reversible',
					rollbackPath: 'Abort merge and reset to previous state',
					rollbackCommand: `git merge --abort || git reset --hard ${previousHead}`,
					uncertaintyNotes: conflictedFiles.length > 0 ? [`Conflicted files: ${conflictedFiles.join(', ')}`] : undefined,
					nextActions: [
						'Resolve conflicts manually',
						'Rebase branch and retry merge',
						`Rollback: git reset --hard ${previousHead}`,
					],
					escalationRequired: true,
					escalationReason: 'Merge conflict requires manual resolution',
					phase: 'apply',
				}, { log: false }); // Don't log to avoid cluttering output

				return {
					success: false,
					item,
					conflicts: conflictedFiles,
					message,
				};
			}

			// Get the current commit SHA after successful merge
			const log = await this.git.log(['-1']);
			sha = log.latest?.hash;

			profiler.end(operationId, { item: operation.item.name, status: 'success' });
			metrics.incrementCounter(METRICS.MERGE_SUCCESS_TOTAL, { strategy: operation.strategy });

			// Emit ActionReceipt for successful merge (Disciplined Failure Pattern)
			emitActionReceipt({
				action: `merge ${branchName} to ${operation.targetBranch}`,
				rationale: `Branch merged successfully using ${strategy} strategy`,
				confidence: 'high',
				reversibility: 'reversible',
				rollbackPath: `Reset to previous state`,
				rollbackCommand: `git reset --hard ${previousHead}`,
				outcome: 'success',
				phase: 'apply',
			}, { log: false }); // Don't log to avoid cluttering output

			return {
				success: true,
				item,
				sha,
				message: `Successfully merged ${branchName} using ${strategy}`,
			};

		} catch (error) {
			profiler.end(operationId, { item: operation.item.name, status: 'error' });
			metrics.incrementCounter(METRICS.MERGE_FAILURE_TOTAL, { reason: 'exception' });
			
			// Try to get conflicted files even on exception
			let conflictedFiles: string[] = [];
			try {
				conflictedFiles = await this.getConflictedFiles();
			} catch {
				// Ignore errors getting conflict files
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			
			// Emit failure receipt for exception (Disciplined Failure Pattern)
			emitFailureReceipt({
				action: `merge ${operation.item.name} to ${operation.targetBranch}`,
				rationale: `Merge operation failed with exception: ${errorMessage}`,
				confidence: 'high',
				reversibility: 'reversible',
				rollbackPath: 'Reset to previous state',
				rollbackCommand: `git reset --hard ${previousHead}`,
				uncertaintyNotes: conflictedFiles.length > 0 ? [`Conflicted files: ${conflictedFiles.join(', ')}`] : undefined,
				nextActions: [
					'Check git status for repository state',
					'Review error details and retry',
					`Rollback: git reset --hard ${previousHead}`,
				],
				escalationRequired: true,
				escalationReason: 'Merge operation failed with exception',
				phase: 'apply',
			}, { log: false }); // Don't log to avoid cluttering output
			
			return {
				success: false,
				item: operation.item,
				conflicts: conflictedFiles.length > 0 ? conflictedFiles : undefined,
				message: `Merge operation failed: ${errorMessage}`,
			};
		}
	}

	/**
	 * Execute merge pyramid with dependency ordering
	 */
	async executeWeave(plan: Plan, levels: string[][], progressReporter?: ProgressReporter): Promise<WeaveExecutionResult> {
		const results: WeaveResult[] = [];
		let successful = 0;
		let failed = 0;
		let conflicts = 0;

		try {
			// Create integration branch
			const integrationBranch = await this.createWeaveBranch(plan.target);
			console.log(`Created integration branch: ${integrationBranch}`);

			// Process each level in dependency order
			for (const [levelIndex, level] of levels.entries()) {
				const levelNum = levelIndex + 1;
				
				// Check for unresolved conflicts before starting next level
				const unresolvedConflicts = await this.getConflictedFiles();
				if (unresolvedConflicts.length > 0) {
					console.log(`Stopping execution: unresolved conflicts detected in ${unresolvedConflicts.join(', ')}`);
					break;
				}
				
				// Report level start
				if (progressReporter) {
					progressReporter.levelStart(levelNum, level);
				} else {
					console.log(`Processing level ${levelNum}: [${level.join(', ')}]`);
				}

				// Process items in parallel within each level
				const levelPromises = level.map(async (itemName) => {
					const item = plan.items.find(i => i.name === itemName);
					if (!item) {
						const result: WeaveResult = {
							success: false,
							item: { name: itemName, deps: [], gates: [] },
							message: `Item ${itemName} not found in plan`,
						};
						return result;
					}

					const operation: MergeOperation = {
						item,
						targetBranch: integrationBranch,
						strategy: "merge-weave", // Default strategy, could be configurable
					};

					return this.executeMergeOperation(operation);
				});

				const levelResults = await Promise.all(levelPromises);
				results.push(...levelResults);

				// Count results
				for (const result of levelResults) {
					if (result.success) {
						successful++;
					} else {
						failed++;
						if (result.conflicts && result.conflicts.length > 0) {
							conflicts++;
						}
					}
				}

				// Report level completion
				if (progressReporter) {
					progressReporter.levelComplete(levelNum);
				}

				// Stop if any item in this level failed (dependency-aware execution)
				const levelFailed = levelResults.some(result => !result.success);
				if (levelFailed) {
					console.log(`Level ${levelNum} failed, stopping execution`);
					break;
				}
			}

			// Emit completion receipt for weave execution (Disciplined Failure Pattern)
			const outcome = failed === 0 ? 'success' : (successful > 0 ? 'partial' : 'failure');
			const hasPartialSuccess = successful > 0;
			const reversibility = hasPartialSuccess ? 'partially-reversible' : 'reversible';
			const rollbackPath = hasPartialSuccess
				? 'Manual review required to revert merged changes'
				: 'No changes made, no rollback needed';
			
			emitActionReceipt({
				action: `weave execution: ${successful} merged, ${failed} failed`,
				rationale: outcome === 'success' 
					? 'All items merged successfully' 
					: outcome === 'partial'
						? 'Some items merged, some failed'
						: 'Weave execution failed',
				confidence: 'high',
				reversibility,
				rollbackPath,
				outcome,
				phase: 'complete',
				nextActions: outcome === 'failure'
					? ['Review failure details', 'Resolve issues and retry']
					: outcome === 'partial'
						? ['Review partial results', 'Retry failed items']
						: ['Weave complete - ready for verification'],
				escalationRequired: outcome !== 'success',
				escalationReason: outcome !== 'success' ? 'Weave execution did not fully succeed' : undefined,
			}, { log: false }); // Don't log to avoid cluttering output

			return {
				operations: results,
				successful,
				failed,
				conflicts,
				totalOperations: results.length,
			};

		} catch (error) {
			throw new GitOperationError(`Weave execution failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Rollback to previous state
	 */
	async rollback(targetBranch: string): Promise<void> {
		try {
			await this.git.checkout(targetBranch);
			// The integration branch will be left for inspection
		} catch (error) {
			throw new GitOperationError(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Clean up integration branches
	 */
	async cleanup(branchPattern: string = 'weave/integration-*'): Promise<void> {
		try {
			const branches = await this.git.branch(['-l']);
			const weaveBranches = branches.all.filter(branch => 
				branch.startsWith('weave/integration-')
			);

			for (const branch of weaveBranches) {
				try {
					await this.git.deleteLocalBranch(branch, true); // Force delete
				} catch (error) {
					// Ignore errors for individual branch deletions
					console.warn(`Could not delete branch ${branch}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		} catch (error) {
			throw new GitOperationError(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get current HEAD commit SHA
	 */
	async getCurrentHead(): Promise<string> {
		try {
			const log = await this.git.log(['-1']);
			return log.latest?.hash || 'HEAD';
		} catch (error) {
			throw new GitOperationError(`Failed to get current HEAD: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get diff between two commits
	 */
	async getDiff(baseSha: string, headSha: string): Promise<string> {
		try {
			const diff = await this.git.diff([baseSha, headSha]);
			return diff;
		} catch (error) {
			throw new GitOperationError(`Failed to get diff: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Reset repository to a specific commit (hard reset)
	 */
	async resetHard(targetSha: string): Promise<void> {
		try {
			await this.git.reset(['--hard', targetSha]);
		} catch (error) {
			throw new GitOperationError(`Failed to reset to ${targetSha}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

export class GitOperationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GitOperationError";
	}
}

/**
 * Create git operations manager
 */
export function createGitOperations(workingDir?: string): GitOperations {
	return new GitOperations(workingDir);
}