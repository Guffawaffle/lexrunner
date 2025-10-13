/**
 * Conflict Predictor - Main orchestration module
 * Combines conflict graph, MIS computation, and merge-tree simulation
 */

import { buildConflictGraph } from "./conflictGraph.js";
import { computeAllMISBatches } from "./mis.js";
import { simulateBatchMerges } from "./mergeTreeSimulator.js";
import type { ConflictReport, PRWithFiles } from "./types.js";

export interface PredictConflictsOptions {
	prs: PRWithFiles[];
	baseBranch: string;
	prHeads?: Map<string, string>;
	workingDir?: string;
	skipMergeTreeSimulation?: boolean;
}

/**
 * Predict conflicts and compute safe parallel batches
 */
export async function predictConflicts(
	options: PredictConflictsOptions
): Promise<ConflictReport> {
	const { prs, baseBranch, prHeads, workingDir, skipMergeTreeSimulation = false } = options;

	// 1. Build conflict graph
	const conflictGraph = buildConflictGraph(prs);

	// 2. Compute MIS batches
	const misBatches = computeAllMISBatches(conflictGraph);

	// 3. Simulate merges (if not skipped and heads provided)
	let mergeTreeSimulation: Record<string, any> = {};
	
	if (!skipMergeTreeSimulation && prHeads && prHeads.size > 0) {
		// Simulate merges for all PR pairs with edges in the conflict graph
		for (const edge of conflictGraph.edges) {
			const pr1Head = prHeads.get(edge.from);
			const pr2Head = prHeads.get(edge.to);

			if (pr1Head && pr2Head) {
				const key = `${edge.from}-${edge.to}`;
				const result = await import("./mergeTreeSimulator.js").then(m =>
					m.simulateMerge(baseBranch, pr1Head, pr2Head, workingDir)
				);
				mergeTreeSimulation[key] = result;
			}
		}

		// Also check pairs with no file conflicts (should be clean)
		for (const batch of misBatches) {
			if (batch.prs.length > 1) {
				const batchResults = await simulateBatchMerges(
					baseBranch,
					prHeads,
					batch.prs,
					workingDir
				);
				mergeTreeSimulation = { ...mergeTreeSimulation, ...batchResults };
			}
		}
	}

	// 4. Generate recommendations
	const recommendations = generateRecommendations(misBatches, mergeTreeSimulation);

	return {
		analyzedAt: new Date().toISOString(),
		baseBranch,
		conflictGraph,
		misBatches,
		mergeTreeSimulation,
		recommendations
	};
}

/**
 * Generate merge recommendations based on MIS batches and simulation results
 */
function generateRecommendations(
	misBatches: Array<{ id: string; prs: string[]; reason: string }>,
	mergeTreeSimulation: Record<string, { status: 'clean' | 'conflict' }>
): { safeBatch: string[]; sequential: string[] } {
	const safeBatch: string[] = [];
	const sequential: string[] = [];

	// First batch with multiple PRs is usually the safe batch
	if (misBatches.length > 0) {
		const firstBatch = misBatches[0];
		
		if (firstBatch.prs.length > 1) {
			// Verify with merge-tree simulation if available
			let allClean = true;
			
			for (let i = 0; i < firstBatch.prs.length && allClean; i++) {
				for (let j = i + 1; j < firstBatch.prs.length; j++) {
					const key1 = `${firstBatch.prs[i]}-${firstBatch.prs[j]}`;
					const key2 = `${firstBatch.prs[j]}-${firstBatch.prs[i]}`;
					
					const result = mergeTreeSimulation[key1] || mergeTreeSimulation[key2];
					if (result && result.status === 'conflict') {
						allClean = false;
						break;
					}
				}
			}

			if (allClean) {
				safeBatch.push(...firstBatch.prs);
			}
		}

		// Remaining PRs should be sequential
		for (let i = safeBatch.length > 0 ? 1 : 0; i < misBatches.length; i++) {
			sequential.push(...misBatches[i].prs);
		}

		// If first batch was single PR and clean, add to safe batch
		if (safeBatch.length === 0 && misBatches[0].prs.length === 1) {
			safeBatch.push(...misBatches[0].prs);
			if (misBatches.length > 1) {
				sequential.push(...misBatches.slice(1).flatMap(b => b.prs));
			}
		}
	}

	// Sort for deterministic output
	safeBatch.sort((a, b) => parseInt(a) - parseInt(b));
	sequential.sort((a, b) => parseInt(a) - parseInt(b));

	return { safeBatch, sequential };
}

// Re-export types
export type { ConflictReport, PRWithFiles, ConflictGraph, MISBatch } from "./types.js";
export { buildConflictGraph } from "./conflictGraph.js";
export { computeMIS, computeAllMISBatches } from "./mis.js";
export { simulateMerge, parseMergeTreeOutput } from "./mergeTreeSimulator.js";
