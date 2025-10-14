/**
 * Conflict graph construction from PR file lists
 */

import type { ConflictGraph, PRWithFiles } from "./types.js";

/**
 * Build conflict graph from PR file lists
 * Nodes: PRs, Edges: Shared files between PRs
 */
export function buildConflictGraph(prs: PRWithFiles[]): ConflictGraph {
	const nodes: string[] = prs.map(pr => String(pr.number)).sort((a, b) => parseInt(a) - parseInt(b));
	const edges: Array<{ from: string; to: string; sharedFiles: string[] }> = [];

	// Compare each pair of PRs for shared files
	for (let i = 0; i < prs.length; i++) {
		for (let j = i + 1; j < prs.length; j++) {
			const pr1 = prs[i];
			const pr2 = prs[j];

			const sharedFiles = findSharedFiles(pr1.files, pr2.files);

			if (sharedFiles.length > 0) {
				// Ensure deterministic ordering: lower PR number first
				const from = String(Math.min(pr1.number, pr2.number));
				const to = String(Math.max(pr1.number, pr2.number));

				edges.push({
					from,
					to,
					sharedFiles: sharedFiles.sort()
				});
			}
		}
	}

	// Sort edges for deterministic output
	edges.sort((a, b) => {
		const fromCompare = parseInt(a.from) - parseInt(b.from);
		if (fromCompare !== 0) return fromCompare;
		return parseInt(a.to) - parseInt(b.to);
	});

	return { nodes, edges };
}

/**
 * Find files that appear in both PR file lists
 */
function findSharedFiles(files1: string[], files2: string[]): string[] {
	const set1 = new Set(files1);
	const shared: string[] = [];

	for (const file of files2) {
		if (set1.has(file)) {
			shared.push(file);
		}
	}

	return shared;
}
