/**
 * Enhanced plan validation with cycle detection, orphan warnings, and diagnostics
 */

import { Plan, PlanItem } from "../schema.js";

/**
 * Validation error types
 */
export type ValidationErrorType = "cycle" | "invalid-ref" | "self-dependency";

/**
 * Validation warning types
 */
export type ValidationWarningType = "orphan" | "low-confidence" | "large-layer";

/**
 * Detailed information about a validation error
 */
export interface ValidationError {
	type: ValidationErrorType;
	message: string;
	details: {
		cyclePath?: string[]; // For cycle errors
		invalidRef?: string; // For invalid reference errors
		itemName?: string; // For self-dependency errors
	};
	suggestion: string; // How to fix
}

/**
 * Detailed information about a validation warning
 */
export interface ValidationWarning {
	type: ValidationWarningType;
	message: string;
	affectedPRs: string[];
	suggestion: string;
}

/**
 * Diagnostic information about the plan
 */
export interface ValidationDiagnostics {
	nodes: number;
	edges: number;
	layers: Array<{ level: number; prs: string[] }>;
	orphans: string[];
}

/**
 * Complete validation result
 */
export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
	diagnostics: ValidationDiagnostics;
}

/**
 * Validate a plan's dependency graph
 * 
 * @param plan - The plan to validate
 * @param options - Optional validation options
 * @returns Validation result with errors, warnings, and diagnostics
 */
export function validatePlan(
	plan: Plan,
	options?: { verbose?: boolean }
): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];
	const items = plan.items;
	const itemNames = new Set(items.map(item => item.name));

	// Build dependency graph
	const graph = new Map<string, string[]>();
	let edgeCount = 0;

	for (const item of items) {
		if (!graph.has(item.name)) {
			graph.set(item.name, []);
		}
		for (const dep of item.deps) {
			graph.get(item.name)!.push(dep);
			edgeCount++;
		}
	}

	// Check for self-dependencies
	for (const item of items) {
		if (item.deps.includes(item.name)) {
			errors.push({
				type: "self-dependency",
				message: `Item '${item.name}' depends on itself`,
				details: { itemName: item.name },
				suggestion: `Remove '${item.name}' from the dependencies of '${item.name}'`
			});
		}
	}

	// Check for invalid references
	for (const item of items) {
		for (const dep of item.deps) {
			if (!itemNames.has(dep)) {
				errors.push({
					type: "invalid-ref",
					message: `Item '${item.name}' references unknown dependency '${dep}'`,
					details: { invalidRef: dep, itemName: item.name },
					suggestion: `Ensure '${dep}' exists in the plan or remove it from '${item.name}' dependencies`
				});
			}
		}
	}

	// Detect cycles using DFS
	const cycles = detectCycles(graph);
	if (cycles && cycles.length > 0) {
		for (const cycle of cycles) {
			errors.push({
				type: "cycle",
				message: formatCycleError(cycle, plan),
				details: { cyclePath: cycle },
				suggestion: suggestCycleFix(cycle, plan)
			});
		}
	}

	// Find orphan PRs (only if no errors so far)
	const orphans = findOrphans(graph, items);
	if (orphans.length > 0) {
		warnings.push({
			type: "orphan",
			message: formatOrphanWarning(orphans),
			affectedPRs: orphans,
			suggestion: "Consider if these items should have dependencies or dependents. Use labels to mark intentional orphans."
		});
	}

	// Compute topological layers (only if no cycles)
	const layers = cycles && cycles.length > 0 ? [] : computeLayers(graph, items);

	// Check for large layers
	const largeLayers = layers.filter(layer => layer.prs.length > 10);
	if (largeLayers.length > 0) {
		for (const layer of largeLayers) {
			warnings.push({
				type: "large-layer",
				message: `Layer ${layer.level} has ${layer.prs.length} items, which may cause merge conflicts`,
				affectedPRs: layer.prs,
				suggestion: "Consider splitting large layers into smaller groups to reduce merge conflicts"
			});
		}
	}

	const diagnostics: ValidationDiagnostics = {
		nodes: items.length,
		edges: edgeCount,
		layers,
		orphans
	};

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		diagnostics
	};
}

/**
 * Detect cycles in a dependency graph using DFS with back-edge tracking
 * 
 * @param graph - Dependency graph (node -> dependencies)
 * @returns Array of cycles found, or null if no cycles
 */
function detectCycles(graph: Map<string, string[]>): string[][] | null {
	const visited = new Set<string>();
	const recursionStack = new Set<string>();
	const cycles: string[][] = [];

	function dfs(node: string, path: string[]): void {
		visited.add(node);
		recursionStack.add(node);
		path.push(node);

		const neighbors = graph.get(node) || [];
		for (const neighbor of neighbors) {
			if (!visited.has(neighbor)) {
				dfs(neighbor, [...path]);
			} else if (recursionStack.has(neighbor)) {
				// Back edge = cycle found
				const cycleStart = path.indexOf(neighbor);
				if (cycleStart !== -1) {
					const cycle = path.slice(cycleStart);
					cycle.push(neighbor); // Close the cycle
					cycles.push(cycle);
				}
			}
		}

		recursionStack.delete(node);
	}

	for (const node of graph.keys()) {
		if (!visited.has(node)) {
			dfs(node, []);
		}
	}

	return cycles.length > 0 ? cycles : null;
}

/**
 * Find orphan PRs (items with no dependencies and no dependents)
 * 
 * @param graph - Dependency graph
 * @param items - All plan items
 * @returns Array of orphan item names
 */
function findOrphans(graph: Map<string, string[]>, items: PlanItem[]): string[] {
	const orphans: string[] = [];
	const hasIncoming = new Set<string>();

	// Mark all items that have incoming edges (are depended upon)
	for (const deps of graph.values()) {
		for (const dep of deps) {
			hasIncoming.add(dep);
		}
	}

	// Find items with no outgoing (deps.length === 0) and no incoming edges
	for (const item of items) {
		const hasOutgoing = item.deps.length > 0;
		const hasIncomingEdge = hasIncoming.has(item.name);

		if (!hasOutgoing && !hasIncomingEdge) {
			orphans.push(item.name);
		}
	}

	return orphans;
}

/**
 * Compute topological layers for the dependency graph
 * 
 * @param graph - Dependency graph
 * @param items - All plan items
 * @returns Array of layers with level and item names
 */
function computeLayers(
	graph: Map<string, string[]>,
	items: PlanItem[]
): Array<{ level: number; prs: string[] }> {
	const inDegree = new Map<string, number>();
	const children = new Map<string, string[]>();

	// Initialize
	for (const item of items) {
		inDegree.set(item.name, 0);
		children.set(item.name, []);
	}

	// Build graph (reverse direction for children)
	for (const item of items) {
		for (const dep of item.deps) {
			if (children.has(dep)) {
				children.get(dep)!.push(item.name);
			}
			inDegree.set(item.name, (inDegree.get(item.name) || 0) + 1);
		}
	}

	// Kahn's algorithm
	const queue: string[] = [];
	const layers: Array<{ level: number; prs: string[] }> = [];

	// Start with nodes that have no dependencies
	for (const [name, degree] of inDegree.entries()) {
		if (degree === 0) {
			queue.push(name);
		}
	}
	queue.sort();

	let level = 0;
	while (queue.length > 0) {
		const thisLevel = [...queue].sort();
		queue.length = 0;
		layers.push({ level, prs: thisLevel });

		for (const name of thisLevel) {
			const childrenNames = children.get(name) || [];
			for (const childName of childrenNames) {
				const newDegree = inDegree.get(childName)! - 1;
				inDegree.set(childName, newDegree);
				if (newDegree === 0) {
					queue.push(childName);
				}
			}
		}
		level++;
	}

	return layers;
}

/**
 * Format a cycle error with full path and human-readable details
 * 
 * @param cycle - Array of item names in the cycle
 * @param plan - The plan
 * @returns Formatted error message
 */
function formatCycleError(cycle: string[], plan: Plan): string {
	const cyclePath = cycle.join(" → ");
	
	let message = `Dependency cycle detected in plan\n\n`;
	message += `Cycle path: ${cyclePath}\n\n`;
	message += `Dependency chain:\n`;

	for (let i = 0; i < cycle.length - 1; i++) {
		const current = cycle[i];
		const next = cycle[i + 1];
		const item = plan.items.find(item => item.name === current);
		if (item) {
			message += `  ${current.padEnd(20)} depends on ${next}\n`;
		}
	}

	return message.trim();
}

/**
 * Format orphan warning message
 * 
 * @param orphans - Array of orphan item names
 * @returns Formatted warning message
 */
function formatOrphanWarning(orphans: string[]): string {
	if (orphans.length === 1) {
		return `Item '${orphans[0]}' has no dependencies and no dependents (orphan)`;
	}
	return `${orphans.length} items have no dependencies and no dependents (orphans): ${orphans.join(", ")}`;
}

/**
 * Suggest how to fix a cycle
 * 
 * @param cycle - Array of item names in the cycle
 * @param plan - The plan
 * @returns Suggestion string
 */
function suggestCycleFix(cycle: string[], plan: Plan): string {
	if (cycle.length <= 2) {
		// Simple cycle A->B->A
		const a = cycle[0];
		const b = cycle[1];
		return `Remove the dependency from '${a}' to '${b}' or from '${b}' to '${a}' to break the cycle`;
	}

	// For longer cycles, suggest removing the last edge
	const lastIdx = cycle.length - 2;
	const from = cycle[lastIdx];
	const to = cycle[lastIdx + 1];
	return `Consider removing the dependency from '${from}' to '${to}' to break the cycle`;
}

/**
 * Format validation result as human-readable text
 * 
 * @param result - Validation result
 * @param verbose - Whether to include verbose output
 * @returns Formatted string
 */
export function formatValidationResult(result: ValidationResult, verbose = false): string {
	let output = "";

	if (verbose || result.errors.length > 0 || result.warnings.length > 0) {
		output += "=== Plan Validation Report ===\n\n";
	}

	// Diagnostics
	if (verbose) {
		output += `Nodes: ${result.diagnostics.nodes} items\n`;
		output += `Edges: ${result.diagnostics.edges} dependencies\n\n`;

		if (result.diagnostics.layers.length > 0) {
			output += "Layers (topological sort):\n";
			for (const layer of result.diagnostics.layers) {
				const prs = layer.prs.join(", ");
				output += `  Layer ${layer.level}: ${prs}\n`;
			}
			output += "\n";
		}
	}

	// Errors
	if (result.errors.length > 0) {
		output += "❌ Errors:\n\n";
		for (const error of result.errors) {
			output += `${error.message}\n\n`;
			output += `Suggestion: ${error.suggestion}\n\n`;
		}
	}

	// Warnings
	if (result.warnings.length > 0) {
		output += "⚠️  Warnings:\n\n";
		for (const warning of result.warnings) {
			output += `${warning.message}\n`;
			output += `Suggestion: ${warning.suggestion}\n\n`;
		}
	}

	// Final status
	if (result.errors.length === 0) {
		output += "✅ Plan is valid and ready for execution\n";
	} else {
		output += `❌ Plan has ${result.errors.length} error(s) that must be fixed\n`;
	}

	return output;
}
