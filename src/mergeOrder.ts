import { Plan, PlanItem } from "./schema.js";
import { OperationCache } from "./performance.js";
import { metrics, METRICS } from "./monitoring/metrics.js";
import { validatePlan, ValidationError as PlanValidationError } from "./planner/validation.js";
import { 
	AXErrorException,
	cycleDetectedError,
	unknownDependencyError,
	type AXError,
} from "./errors/index.js";

/**
 * Merge order computation using Kahn's algorithm with deterministic tie-breaking
 */

/**
 * CycleError - thrown when a dependency cycle is detected
 * Now extends AXErrorException to provide structured error with nextActions
 */
export class CycleError extends AXErrorException {
	constructor(cycle: string[]) {
		const axError = cycleDetectedError({ cycle });
		super(axError.code, axError.message, axError.nextActions, axError.context);
		this.name = "CycleError";
	}
}

/**
 * UnknownDependencyError - thrown when a dependency reference doesn't exist
 * Now extends AXErrorException to provide structured error with nextActions
 */
export class UnknownDependencyError extends AXErrorException {
	constructor(item: string, dependency: string, availableItems?: string[]) {
		const axError = unknownDependencyError({ item, dependency, availableItems });
		super(axError.code, axError.message, axError.nextActions, axError.context);
		this.name = "UnknownDependencyError";
	}
}

// Cache for dependency resolution results
const dependencyCache = new OperationCache<string[][]>(3600, true);

/**
 * Generate cache key for a plan
 */
function getPlanCacheKey(plan: Plan): string {
	// Create stable key from plan items and dependencies
	const itemsKey = plan.items
		.map(item => `${item.name}:${item.deps.sort().join(',')}`)
		.sort()
		.join('|');
	return `merge-order:${itemsKey}`;
}

/**
 * Compute merge order levels using Kahn's algorithm with deterministic ordering
 * Returns array of levels, where each level contains item names that can be processed in parallel
 */
export function computeMergeOrder(plan: Plan): string[][] {
	const startTime = Date.now();

	// Check cache first
	const cacheKey = getPlanCacheKey(plan);
	const cached = dependencyCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	// Validate the plan first to provide better error messages
	const validationResult = validatePlan(plan);
	
	// Check for validation errors and throw appropriate AXError exceptions
	if (!validationResult.valid) {
		for (const error of validationResult.errors) {
			if (error.type === "cycle") {
				// Extract cycle path from error details
				const cyclePath = error.details.cyclePath || [];
				throw new CycleError(cyclePath);
			} else if (error.type === "invalid-ref") {
				// Extract item and dependency info from error details
				const invalidRef = error.details.invalidRef || "unknown";
				const itemName = error.details.itemName || "unknown";
				const availableItems = plan.items.map(i => i.name);
				throw new UnknownDependencyError(itemName, invalidRef, availableItems);
			} else if (error.type === "self-dependency") {
				// Throw as cycle error (self-dependency is a special case of cycle)
				const itemName = error.details.itemName || "unknown";
				throw new CycleError([itemName, itemName]);
			}
		}
	}

	const items = plan.items;
	const itemNames = items.map(item => item.name);
	const itemNameSet = new Set(itemNames);

	// Build in-degree map and children map
	const inDegree = new Map<string, number>();
	const children = new Map<string, string[]>();

	// Initialize in-degrees and children
	for (const item of items) {
		inDegree.set(item.name, 0);
		children.set(item.name, []);
	}

	// Build dependency graph
	for (const item of items) {
		for (const depName of item.deps) {
			if (!itemNameSet.has(depName)) {
				const availableItems = Array.from(itemNameSet);
				throw new UnknownDependencyError(item.name, depName, availableItems);
			}
			children.get(depName)!.push(item.name);
			inDegree.set(item.name, inDegree.get(item.name)! + 1);
		}
	}

	// Kahn's algorithm with deterministic ordering
	const queue: string[] = [];
	const result: string[][] = [];

	// Start with nodes that have no dependencies, sorted for determinism
	for (const [name, degree] of inDegree.entries()) {
		if (degree === 0) {
			queue.push(name);
		}
	}
	queue.sort();

	while (queue.length > 0) {
		const thisLevel = [...queue].sort();
		queue.length = 0;
		result.push(thisLevel);

		for (const name of thisLevel) {
			const childrenNames = children.get(name) || [];
			for (const childName of childrenNames.sort()) {
				const newDegree = inDegree.get(childName)! - 1;
				inDegree.set(childName, newDegree);
				if (newDegree === 0) {
					queue.push(childName);
				}
			}
		}
	}

	// Check for cycles (this should not happen if validation passed, but keep as safety check)
	if (inDegree.size > 0 && Array.from(inDegree.values()).some(degree => degree > 0)) {
		const cycleNodes = Array.from(inDegree.entries())
			.filter(([, degree]) => degree > 0)
			.map(([name]) => name);
		
		// Create a simple cycle representation showing nodes involved
		// Note: This creates a basic visual (A → B → A) rather than the actual cycle path,
		// as determining the exact path would require additional graph traversal
		const cycle = cycleNodes.length > 0 ? [...cycleNodes, cycleNodes[0]] : cycleNodes;
		
		throw new CycleError(cycle);
	}

	// Cache the result
	dependencyCache.set(cacheKey, result);

	// Record metrics
	const duration = (Date.now() - startTime) / 1000;
	metrics.observeHistogram(METRICS.DEPENDENCY_RESOLUTION_TIME, duration);

	return result;
}
