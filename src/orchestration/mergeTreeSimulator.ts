/**
 * Git merge-tree simulation for conflict prediction
 */

import { execa } from "execa";
import type { ConflictDetail, MergeSimulationResult } from "./types.js";

/**
 * Simulate merge using git merge-tree
 * Returns whether the merge would be clean or have conflicts
 */
export async function simulateMerge(
	baseBranch: string,
	pr1Head: string,
	pr2Head: string,
	workingDir: string = process.cwd()
): Promise<MergeSimulationResult> {
	try {
		// Run git merge-tree to simulate the merge
		const { stdout } = await execa(
			"git",
			["merge-tree", baseBranch, pr1Head, pr2Head],
			{ cwd: workingDir }
		);

		// Parse the output for conflict markers
		const conflicts = parseMergeTreeOutput(stdout);

		return {
			status: conflicts.length > 0 ? 'conflict' : 'clean',
			conflicts
		};
	} catch (error) {
		// If git merge-tree fails, treat as conflict
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			status: 'conflict',
			conflicts: [{
				file: 'unknown',
				lines: 'unknown',
				type: `git-error: ${errorMessage}`
			}]
		};
	}
}

/**
 * Parse git merge-tree output for conflicts
 * Looks for conflict markers and extracts conflict information
 */
export function parseMergeTreeOutput(output: string): ConflictDetail[] {
	const conflicts: ConflictDetail[] = [];
	const lines = output.split('\n');

	let currentFile: string | null = null;
	let inConflict = false;
	let conflictStartLine = 0;
	let lineNumber = 0;

	for (const line of lines) {
		lineNumber++;

		// Check for conflict markers
		if (line.includes('<<<<<<<')) {
			inConflict = true;
			conflictStartLine = lineNumber;
			
			// Try to extract file from marker
			const match = line.match(/<<<<<<< (.+)/);
			if (match) {
				currentFile = match[1];
			}
		} else if (line.includes('>>>>>>>') && inConflict) {
			inConflict = false;
			
			if (currentFile) {
				conflicts.push({
					file: currentFile,
					lines: `${conflictStartLine}-${lineNumber}`,
					type: 'both-modified'
				});
			}
			
			currentFile = null;
		}

		// Alternative: look for merge conflict output format
		if (line.startsWith('CONFLICT') || line.includes('both modified:')) {
			const fileMatch = line.match(/both modified:\s+(.+)/) || 
			                  line.match(/CONFLICT.*:\s+(.+)/);
			
			if (fileMatch && fileMatch[1]) {
				const file = fileMatch[1].trim();
				// Avoid duplicates
				if (!conflicts.some(c => c.file === file)) {
					conflicts.push({
						file,
						lines: 'unknown',
						type: 'both-modified'
					});
				}
			}
		}
	}

	return conflicts;
}

/**
 * Simulate merges for all pairs in a batch
 */
export async function simulateBatchMerges(
	baseBranch: string,
	prHeads: Map<string, string>,
	prNumbers: string[],
	workingDir?: string
): Promise<Record<string, MergeSimulationResult>> {
	const results: Record<string, MergeSimulationResult> = {};

	// Check all pairs
	for (let i = 0; i < prNumbers.length; i++) {
		for (let j = i + 1; j < prNumbers.length; j++) {
			const pr1 = prNumbers[i];
			const pr2 = prNumbers[j];
			const pr1Head = prHeads.get(pr1);
			const pr2Head = prHeads.get(pr2);

			if (!pr1Head || !pr2Head) {
				continue;
			}

			const key = `${pr1}-${pr2}`;
			results[key] = await simulateMerge(baseBranch, pr1Head, pr2Head, workingDir);
		}
	}

	return results;
}
