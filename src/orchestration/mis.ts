/**
 * Maximal Independent Set (MIS) computation using greedy algorithm
 * Used to find sets of PRs that can be merged in parallel without conflicts
 */

import type { ConflictGraph, MISBatch } from "./types.js";

/**
 * Compute Maximal Independent Set using greedy algorithm
 * Algorithm: Sort nodes by degree (fewest conflicts first), then by PR number
 * Greedily add nodes that don't conflict with already selected nodes
 */
export function computeMIS(graph: ConflictGraph): string[] {
	const mis: string[] = [];
	const neighbors = buildAdjacencyMap(graph);

	// Sort by degree (fewest conflicts first), then PR number for determinism
	const sorted = [...graph.nodes].sort((a, b) => {
		const degA = neighbors.get(a)?.size || 0;
		const degB = neighbors.get(b)?.size || 0;
		if (degA !== degB) return degA - degB;
		return parseInt(a) - parseInt(b);
	});

	// Greedy selection: add node if it doesn't conflict with any node in MIS
	for (const node of sorted) {
		const nodeNeighbors = neighbors.get(node) || new Set<string>();
		const hasConflict = mis.some(m => nodeNeighbors.has(m));
		
		if (!hasConflict) {
			mis.push(node);
		}
	}

	return mis;
}

/**
 * Compute all MIS batches from a conflict graph
 * Returns multiple batches to maximize parallelism
 */
export function computeAllMISBatches(graph: ConflictGraph): MISBatch[] {
	const batches: MISBatch[] = [];
	const remainingNodes = new Set(graph.nodes);
	const neighbors = buildAdjacencyMap(graph);
	let batchId = 1;

	while (remainingNodes.size > 0) {
		// Build subgraph from remaining nodes
		const subgraph: ConflictGraph = {
			nodes: Array.from(remainingNodes).sort((a, b) => parseInt(a) - parseInt(b)),
			edges: graph.edges.filter(edge => 
				remainingNodes.has(edge.from) && remainingNodes.has(edge.to)
			)
		};

		// Compute MIS for subgraph
		const mis = computeMIS(subgraph);

		if (mis.length === 0) {
			break; // Safety check
		}

		// Determine reason for this batch
		const reason = determineReason(mis, neighbors, remainingNodes);

		batches.push({
			id: `mis-${batchId}`,
			prs: mis,
			reason
		});

		// Remove MIS nodes from remaining
		mis.forEach(node => remainingNodes.delete(node));
		batchId++;
	}

	return batches;
}

/**
 * Build adjacency map from conflict graph
 */
function buildAdjacencyMap(graph: ConflictGraph): Map<string, Set<string>> {
	const neighbors = new Map<string, Set<string>>();

	// Initialize all nodes
	for (const node of graph.nodes) {
		neighbors.set(node, new Set());
	}

	// Add edges (bidirectional)
	for (const edge of graph.edges) {
		neighbors.get(edge.from)?.add(edge.to);
		neighbors.get(edge.to)?.add(edge.from);
	}

	return neighbors;
}

/**
 * Determine reason for MIS batch
 */
function determineReason(mis: string[], neighbors: Map<string, Set<string>>, allNodes: Set<string>): string {
	if (mis.length === 1) {
		const node = mis[0];
		const nodeNeighbors = neighbors.get(node);
		const conflictingNodes = Array.from(allNodes).filter(n => 
			n !== node && nodeNeighbors?.has(n)
		);
		
		if (conflictingNodes.length > 0) {
			return `Conflicts with #${conflictingNodes.join(', #')}`;
		}
		return "No shared files";
	}

	return "No shared files";
}
