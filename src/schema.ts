import { z } from "zod";

/**
 * Schema v1 for plan.json - the single frozen runtime input
 */

/**
 * Status tracking for gates and nodes
 */
export const GateStatus = z.enum(["pass", "fail", "blocked", "skipped", "retrying"]);
export type GateStatus = z.infer<typeof GateStatus>;

export const NodeStatus = z.enum(["pass", "fail", "blocked", "skipped", "retrying"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

/**
 * Gate execution result
 */
export const GateResult = z.object({
	gate: z.string(),
	status: GateStatus,
	exitCode: z.number().optional(),
	duration: z.number().optional(), // milliseconds
	stdout: z.string().optional(),
	stderr: z.string().optional(),
	artifacts: z.array(z.string()).optional(),
	attempts: z.number().default(1),
	lastAttempt: z.string().optional() // ISO timestamp
});
export type GateResult = z.infer<typeof GateResult>;

/**
 * Node execution state
 */
export const NodeResult = z.object({
	name: z.string(),
	status: NodeStatus,
	gates: z.array(GateResult).default([]),
	blockedBy: z.array(z.string()).optional(), // names of nodes that blocked this one
	eligibleForMerge: z.boolean().default(false)
});
export type NodeResult = z.infer<typeof NodeResult>;

/**
 * Schema versioning according to SemVer
 * - Patch: additive, optional fields or docs only
 * - Minor: additive required fields with safe defaults
 * - Major: breaking changes to structure or semantics
 */
export const SchemaVersion = z.string().regex(
	/^1\.\d+\.\d+$/,
	"Schema version must be 1.x.y format"
);

/**
 * Validate schema version compatibility
 */
export function validateSchemaVersion(version: string): void {
	const parsed = SchemaVersion.safeParse(version);
	if (!parsed.success) {
		throw new Error(`Unsupported schema version: ${version}. This runner only supports schema version 1.x.y`);
	}

	const [major] = version.split('.').map(Number);
	if (major !== 1) {
		throw new Error(`Incompatible schema major version: ${major}. This runner only supports major version 1.`);
	}
}

/**
 * Retry configuration for gates
 */
export const RetryConfig = z.object({
	maxAttempts: z.number().int().min(1).default(1),
	backoffSeconds: z.number().min(0).default(0)
});
export type RetryConfig = z.infer<typeof RetryConfig>;

/**
 * Admin override configuration
 */
export const AdminOverride = z.object({
	allowedUsers: z.array(z.string()).optional(),
	requireReason: z.boolean().default(false)
});
export type AdminOverride = z.infer<typeof AdminOverride>;

/**
 * Merge rule types
 */
export const MergeRule = z.object({
	type: z.enum(["strict-required"]).default("strict-required"),
	// Future: could add "best-effort", "admin-override-allowed", etc.
});
export type MergeRule = z.infer<typeof MergeRule>;

/**
 * Performance configuration for scale optimization
 */
export const PerformanceConfig = z.object({
	maxMemoryMB: z.number().int().min(128).optional(), // Memory limit in MB
	batchSize: z.number().int().min(1).default(50), // Batch size for large plans
	cacheTTLSeconds: z.number().int().min(0).default(3600), // Cache TTL in seconds
	enableCaching: z.boolean().default(true), // Enable operation caching
	throttleOnMemory: z.boolean().default(true), // Throttle workers when memory high
	memoryThresholdPercent: z.number().min(0).max(100).default(80) // Memory threshold %
}).default({});
export type PerformanceConfig = z.infer<typeof PerformanceConfig>;

/**
 * Security policy for vulnerability thresholds in vuln gate
 */
export const VulnPolicy = z.object({
	blockCritical: z.boolean().default(true),
	blockHigh: z.boolean().default(true),
	maxMedium: z.number().int().min(0).default(5),
	maxLow: z.number().int().min(0).default(10),
}).default({
	blockCritical: true,
	blockHigh: true,
	maxMedium: 5,
	maxLow: 10,
});
export type VulnPolicy = z.infer<typeof VulnPolicy>;

/**
 * Policy configuration for the plan execution
 */
export const Policy = z.object({
	requiredGates: z.array(z.string()).default([]),
	optionalGates: z.array(z.string()).default([]),
	maxWorkers: z.number().int().min(1).default(1),
	retries: z.record(RetryConfig).default({}),
	overrides: z.object({
		adminGreen: AdminOverride.optional()
	}).default({}),
	blockOn: z.array(z.string()).default([]),
	mergeRule: MergeRule.default({ type: "strict-required" }),
	performance: PerformanceConfig.optional(), // Performance tuning options
	security: VulnPolicy.optional() // Security/vulnerability thresholds for vuln gate
});
export type Policy = z.infer<typeof Policy>;

/**
 * Container mount specification
 */
export const ContainerMount = z.object({
	source: z.string(),
	target: z.string(),
	type: z.enum(["bind", "volume"]).default("bind")
});
export type ContainerMount = z.infer<typeof ContainerMount>;

/**
 * Container specification for gate execution
 */
export const ContainerSpec = z.object({
	image: z.string(),
	entrypoint: z.array(z.string()).optional(),
	mounts: z.array(ContainerMount).optional()
});
export type ContainerSpec = z.infer<typeof ContainerSpec>;

export const Gate = z.object({
	name: z.string(),
	run: z.string(),
	cwd: z.string().optional(),
	env: z.record(z.string()).default({}),
	// Runtime configuration
	runtime: z.enum(["local", "container", "ci-service"]).default("local"),
	// Container spec (only used when runtime is "container")
	container: ContainerSpec.optional(),
	// Expected artifact paths (for output collection)
	artifacts: z.array(z.string()).default([])
}).strict();
export type Gate = z.infer<typeof Gate>;

/**
 * Plan item with dependencies resolved by name.
 * Note: Input generator defaults name := id when name is unset.
 * All deps references must match item names in the final plan.
 */
export const PlanItem = z.object({
	name: z.string(),
	deps: z.string().array().default([]), // Dependency references by item name
	gates: z.array(Gate).default([])
}).strict();
export type PlanItem = z.infer<typeof PlanItem>;

export const Plan = z.object({
	schemaVersion: SchemaVersion,
	target: z.string().default("main"),
	policy: Policy.optional(),
	items: z.array(PlanItem).default([])
}).strict();
export type Plan = z.infer<typeof Plan>;

/**
 * Machine-readable validation error
 */
export interface ValidationError {
	path: string;
	message: string;
	code: string;
}

/**
 * Validation errors for schema failures
 */
export class SchemaValidationError extends Error {
	public readonly issues: z.ZodIssue[];
	public readonly errors: ValidationError[];

	constructor(issues: z.ZodIssue[]) {
		const errors = issues.map(issue => ({
			path: issue.path.join('.'),
			message: issue.message,
			code: issue.code
		}));

		const message = errors.map(e => `${e.path}: ${e.message}`).join('; ');
		super(`Schema validation failed: ${message}`);
		this.name = "SchemaValidationError";
		this.issues = issues;
		this.errors = errors;
	}

	/**
	 * Get machine-readable error format
	 */
	toJSON(): { valid: false; errors: ValidationError[] } {
		return {
			valid: false,
			errors: this.errors
		};
	}
}

/**
 * Validate a plan object against the schema
 */
export function validatePlan(planData: unknown): Plan {
	// First validate the basic structure
	const result = Plan.safeParse(planData);
	if (!result.success) {
		throw new SchemaValidationError(result.error.issues);
	}

	// Then validate schema version compatibility
	validateSchemaVersion(result.data.schemaVersion);

	return result.data;
}

/**
 * Load and validate a plan.json file
 */
export function loadPlan(planContent: string): Plan {
	try {
		const planData = JSON.parse(planContent);
		return validatePlan(planData);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON: ${error.message}`);
		}
		throw error;
	}
}
