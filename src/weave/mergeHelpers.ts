/**
 * Enhanced merge command helpers for state machine integration
 * Provides dry-run output and resume capability
 */

import { Plan } from '../schema.js';
import { computeMergeOrder } from '../mergeOrder.js';
import { DryRunOutput, PRHead, WeaveEvent } from '../weave/types.js';
import {
	createWeaveContext,
	WeaveStateMachine
} from '../weave/stateMachine.js';
import {
	computePlanHash,
	loadContextFromLockFile,
	lockFileExists,
	readLockFile
} from '../weave/lockFile.js';
import { simpleGit } from 'simple-git';

/**
 * Fetch current PR head information from git
 */
export async function fetchPRHeads(plan: Plan): Promise<PRHead[]> {
	const git = simpleGit();
	const prHeads: PRHead[] = [];

	for (const item of plan.items) {
		try {
			// Get the SHA for the branch/ref
			const result = await git.revparse([item.name]);
			const sha = result.trim();

			prHeads.push({
				name: item.name,
				sha,
				updatedAt: new Date().toISOString()
			});
		} catch (error) {
			// If branch doesn't exist locally, we'll skip it for now
			// In a real implementation, we'd fetch from remote
			prHeads.push({
				name: item.name,
				sha: 'unknown',
				updatedAt: new Date().toISOString()
			});
		}
	}

	return prHeads;
}

/**
 * Generate dry-run output showing planned execution
 */
export async function generateDryRunOutput(
	plan: Plan,
	workingDir: string = process.cwd()
): Promise<DryRunOutput> {
	const git = simpleGit(workingDir);

	// Compute merge order
	const levels = computeMergeOrder(plan);

	// Fetch PR heads
	const prHeads = await fetchPRHeads(plan);

	// Check working directory status
	const status = await git.status();
	const cleanWorkingDirectory = status.files.length === 0;

	// Build batches with dependency information
	const batches = levels.map((level, index) => {
		// Find dependencies for items in this level
		const dependencies: string[] = [];
		for (const itemName of level) {
			const item = plan.items.find(i => i.name === itemName);
			if (item && item.deps) {
				dependencies.push(...item.deps);
			}
		}

		// Remove duplicates
		const uniqueDeps = Array.from(new Set(dependencies));

		return {
			batchNumber: index,
			items: level,
			dependencies: uniqueDeps,
			parallelizable: level.length > 1
		};
	});

	// Build PR information
	const prs = prHeads.map(head => ({
		name: head.name,
		currentSha: head.sha,
		status: head.sha === 'unknown' ? 'not-found' : 'ready'
	}));

	// Basic conflict prediction (simplified)
	const conflictsPredicted = 0; // TODO: Implement conflict analysis

	// Check if target branch exists
	let branchExists = true;
	try {
		await git.revparse([plan.target]);
	} catch {
		branchExists = false;
	}

	return {
		summary: {
			totalBatches: batches.length,
			totalItems: plan.items.length,
			targetBranch: plan.target,
			estimatedDuration: undefined // Could add estimation based on history
		},
		batches,
		prs,
		checks: {
			cleanWorkingDirectory,
			branchExists,
			conflictsPredicted
		}
	};
}

/**
 * Format dry-run output as human-readable text
 */
export function formatDryRunOutput(output: DryRunOutput): string {
	const lines: string[] = [];

	lines.push('🔍 DRY RUN: Merge Execution Plan');
	lines.push('');
	lines.push('## Summary');
	lines.push(`- Target Branch: ${output.summary.targetBranch}`);
	lines.push(`- Total Items: ${output.summary.totalItems}`);
	lines.push(`- Total Batches: ${output.summary.totalBatches}`);
	if (output.summary.estimatedDuration) {
		lines.push(`- Estimated Duration: ${output.summary.estimatedDuration}`);
	}
	lines.push('');

	lines.push('## Batches (Execution Order)');
	for (const batch of output.batches) {
		lines.push('');
		lines.push(`### Batch ${batch.batchNumber + 1}`);
		lines.push(`- Items: ${batch.items.join(', ')}`);
		if (batch.dependencies.length > 0) {
			lines.push(`- Dependencies: ${batch.dependencies.join(', ')}`);
		}
		lines.push(`- Parallelizable: ${batch.parallelizable ? 'Yes' : 'No'}`);
	}

	lines.push('');
	lines.push('## PR Status');
	const prTable: string[] = [];
	prTable.push('| PR | SHA | Status |');
	prTable.push('|----|-----|--------|');
	for (const pr of output.prs) {
		const sha = pr.currentSha === 'unknown' ? '—' : pr.currentSha.substring(0, 8);
		const status = pr.status === 'ready' ? '✓' : '✗';
		prTable.push(`| ${pr.name} | ${sha} | ${status} |`);
	}
	lines.push(...prTable);

	lines.push('');
	lines.push('## Pre-flight Checks');
	lines.push(`- Clean working directory: ${output.checks.cleanWorkingDirectory ? '✓' : '✗'}`);
	lines.push(`- Target branch exists: ${output.checks.branchExists ? '✓' : '✗'}`);
	lines.push(`- Predicted conflicts: ${output.checks.conflictsPredicted}`);

	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push('ℹ️  This is a dry run. Use --execute to perform actual merges.');
	lines.push('ℹ️  Execution state will be saved to weave-lock.json for resume capability.');

	return lines.join('\n');
}

/**
 * Validate resume prerequisites
 */
export async function validateResume(
	runId: string | undefined,
	plan: Plan,
	workingDir: string = process.cwd()
): Promise<{ valid: boolean; reason?: string; context?: any }> {
	// Check if lock file exists
	if (!lockFileExists(workingDir)) {
		return {
			valid: false,
			reason: 'No lock file found. Cannot resume execution.'
		};
	}

	// Read lock file
	const lockFile = readLockFile(workingDir);
	if (!lockFile) {
		return {
			valid: false,
			reason: 'Failed to read lock file.'
		};
	}

	// Validate run ID if provided
	if (runId && lockFile.runId !== runId) {
		return {
			valid: false,
			reason: `Run ID mismatch. Lock file contains run ID '${lockFile.runId}', but '${runId}' was requested.`
		};
	}

	// Fetch current PR heads
	const prHeads = await fetchPRHeads(plan);

	// Load and validate context
	const result = loadContextFromLockFile(plan, prHeads, workingDir);

	if (!result.valid) {
		return {
			valid: false,
			reason: result.reason || 'Lock file validation failed.'
		};
	}

	// Check if state is resumable
	const sm = new WeaveStateMachine(result.context);
	if (!sm.canResume()) {
		return {
			valid: false,
			reason: `Cannot resume from state '${result.context.state}'. Only 'paused' state can be resumed.`
		};
	}

	return {
		valid: true,
		context: result.context
	};
}

/**
 * Initialize a new weave execution
 */
export async function initializeWeaveExecution(
	plan: Plan,
	workingDir: string = process.cwd()
): Promise<{ context: any; stateMachine: WeaveStateMachine }> {
	// Fetch PR heads
	const prHeads = await fetchPRHeads(plan);

	// Compute plan hash
	const planHash = computePlanHash(plan, prHeads);

	// Create context
	const context = createWeaveContext(plan, prHeads, planHash, false);

	// Compute merge order and populate batches
	const levels = computeMergeOrder(plan);
	context.batches = levels.map((level, index) => ({
		batchNumber: index,
		items: level,
		state: 'pending' as const
	}));

	// Create state machine
	const stateMachine = new WeaveStateMachine(context);

	return { context, stateMachine };
}
