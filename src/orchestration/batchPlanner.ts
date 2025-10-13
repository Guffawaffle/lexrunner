/**
 * Batch Planner using Kahn's Algorithm
 * Deterministic topological sorting for issue/PR merge pyramids
 */

import { MinHeap } from "../util/minHeap.js";
import { createHash } from "crypto";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

export interface Node {
	id: string;
	type: 'issue' | 'pr';
	dependencies: string[];
	metadata: {
		score: number;        // from overlap analysis (lower = higher priority)
		createdAt: string;    // ISO timestamp
		prNumber?: number;
		issueNumber?: number;
	};
}

export interface Batch {
	id: string;
	layer: number;
	items: Node[];
}

export interface BatchPlan {
	planVersion: string;
	algorithm: string;
	deterministic: boolean;
	planHash: string;      // SHA256 of canonical JSON
	batches: Batch[];
}

export class CycleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CycleError";
	}
}

export class UnknownDependencyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnknownDependencyError";
	}
}

/**
 * Compute batches using Kahn's algorithm with deterministic ordering.
 * 
 * @param nodes - DAG nodes (PRs/issues)
 * @returns BatchPlan with batches in topological order (layers)
 * @throws {CycleError} If graph contains cycles
 * @throws {UnknownDependencyError} If dependency references don't exist
 */
export function computeBatches(nodes: Node[]): BatchPlan {
	// Validate dependencies exist
	const nodeIds = new Set(nodes.map(n => n.id));
	for (const node of nodes) {
		for (const dep of node.dependencies) {
			if (!nodeIds.has(dep)) {
				throw new UnknownDependencyError(
					`Node '${node.id}' has unknown dependency '${dep}'`
				);
			}
		}
	}

	// Build in-degree map and adjacency list
	const inDegree = new Map<string, number>();
	const children = new Map<string, string[]>();
	const nodeMap = new Map<string, Node>();

	for (const node of nodes) {
		inDegree.set(node.id, 0);
		children.set(node.id, []);
		nodeMap.set(node.id, node);
	}

	// Build graph edges
	for (const node of nodes) {
		for (const dep of node.dependencies) {
			children.get(dep)!.push(node.id);
			inDegree.set(node.id, inDegree.get(node.id)! + 1);
		}
	}

	// Create stable priority queue with deterministic ordering
	const compareFn = (a: Node, b: Node): number => {
		// Primary: score (lower = higher priority)
		if (a.metadata.score !== b.metadata.score) {
			return a.metadata.score - b.metadata.score;
		}
		// Secondary: createdAt (older first)
		if (a.metadata.createdAt !== b.metadata.createdAt) {
			return a.metadata.createdAt.localeCompare(b.metadata.createdAt);
		}
		// Tertiary: number (lower first)
		const aNum = a.metadata.prNumber || a.metadata.issueNumber || 0;
		const bNum = b.metadata.prNumber || b.metadata.issueNumber || 0;
		return aNum - bNum;
	};

	const batches: Batch[] = [];
	let layer = 0;

	// Initialize priority queue with 0 in-degree nodes
	const pq = new MinHeap<Node>(compareFn);
	for (const [id, degree] of inDegree.entries()) {
		if (degree === 0) {
			pq.push(nodeMap.get(id)!);
		}
	}

	let processedCount = 0;

	// Process nodes layer by layer
	while (!pq.isEmpty()) {
		const currentBatch: Node[] = [];

		// Collect all nodes at current priority level (same layer)
		const tempNodes: Node[] = [];
		while (!pq.isEmpty()) {
			tempNodes.push(pq.pop()!);
		}

		// Process current layer
		for (const node of tempNodes) {
			currentBatch.push(node);
			processedCount++;

			// Update children's in-degrees
			const nodeChildren = children.get(node.id) || [];
			for (const childId of nodeChildren) {
				const newDegree = inDegree.get(childId)! - 1;
				inDegree.set(childId, newDegree);
				if (newDegree === 0) {
					pq.push(nodeMap.get(childId)!);
				}
			}
		}

		// Add batch if not empty
		if (currentBatch.length > 0) {
			batches.push({
				id: `batch${layer + 1}`,
				layer: layer,
				items: currentBatch
			});
			layer++;
		}
	}

	// Check for cycles
	if (processedCount < nodes.length) {
		const cycleNodes = Array.from(inDegree.entries())
			.filter(([, degree]) => degree > 0)
			.map(([id]) => id);
		throw new CycleError(
			`Dependency cycle detected involving: ${cycleNodes.join(', ')}`
		);
	}

	// Create batch plan
	const plan: BatchPlan = {
		planVersion: "1.0.0",
		algorithm: "kahn_topological_sort",
		deterministic: true,
		planHash: "",
		batches
	};

	// Compute hash for reproducibility (exclude hash field itself)
	const hashInput = {
		planVersion: plan.planVersion,
		algorithm: plan.algorithm,
		deterministic: plan.deterministic,
		batches: plan.batches
	};
	plan.planHash = `sha256:${createHash('sha256')
		.update(canonicalJSONStringify(hashInput))
		.digest('hex')}`;

	return plan;
}
