import { z } from "zod";

/**
 * Schema version for gate reports
 */
export const GateReportSchemaVersion = z.string().regex(/^1\.\d+\.\d+$/).default("1.0.0");

/**
 * Artifact metadata for gate execution outputs
 */
export const ArtifactMetadata = z.object({
	/** Path to the artifact file */
	path: z.string(),
	/** Type of artifact (e.g., 'log', 'coverage', 'report') */
	type: z.string().optional(),
	/** Size in bytes */
	size: z.number().min(0).optional(),
	/** Human-readable description */
	description: z.string().optional()
}).strict();

/**
 * Gate result schema with stable keys and no timestamps for deterministic output
 * Based on issue requirement: stable keys, no timestamps
 */
export const GateReport = z.object({
	/** Schema version for backward compatibility */
	schemaVersion: GateReportSchemaVersion.optional(),
	/** Item identifier this gate was run for */
	item: z.string(),
	/** Gate name identifier */
	gate: z.string(),
	/** Gate execution status - only pass or fail for stable output */
	status: z.enum(["pass", "fail"]),
	/** Duration in milliseconds */
	duration_ms: z.number().min(0),
	/** ISO-8601 timestamp when gate started */
	started_at: z.string(),
	/** Optional path to stderr output file */
	stderr_path: z.string().optional(),
	/** Optional path to stdout output file */
	stdout_path: z.string().optional(),
	/** Optional metadata as string key-value pairs */
	meta: z.record(z.string()).optional(),
	/** Optional artifacts metadata */
	artifacts: z.array(ArtifactMetadata).optional()
}).strict();

export type GateReport = z.infer<typeof GateReport>;
export type ArtifactMetadata = z.infer<typeof ArtifactMetadata>;

/**
 * Validation error with helpful context
 */
export interface GateReportValidationError {
	path: string;
	message: string;
	code: string;
	suggestion?: string;
}

/**
 * Format Zod issues into user-friendly validation errors with fix suggestions
 */
export function formatValidationErrors(error: z.ZodError): GateReportValidationError[] {
	return error.issues.map(issue => {
		const path = issue.path.join('.');
		let suggestion: string | undefined;

		// Provide helpful suggestions based on error type
		if (issue.code === 'invalid_type') {
			if (path === 'started_at') {
				suggestion = 'Use ISO 8601 format: "2024-01-15T10:30:00Z"';
			} else if (path === 'status') {
				suggestion = 'Valid values: "pass" or "fail"';
			} else if (path === 'duration_ms') {
				suggestion = 'Must be a non-negative number (milliseconds)';
			} else if (path === 'item' || path === 'gate') {
				suggestion = 'Must be a non-empty string identifier';
			}
		} else if (issue.code === 'invalid_enum_value') {
			if (path === 'status') {
				suggestion = 'Valid values: "pass" or "fail"';
			}
		} else if (issue.code === 'too_small') {
			if (path === 'duration_ms') {
				suggestion = 'Duration must be >= 0 milliseconds';
			}
		} else if (issue.code === 'unrecognized_keys') {
			const keys = (issue as any).keys?.join(', ') || 'unknown';
			suggestion = `Remove unexpected fields: ${keys}`;
		}

		return {
			path: path || 'root',
			message: issue.message,
			code: issue.code,
			suggestion
		};
	});
}

/**
 * Validate a gate report object
 */
export function validateGateReport(data: unknown): GateReport {
	return GateReport.parse(data);
}

/**
 * Safe validation that returns success/error result
 */
export function safeValidateGateReport(data: unknown): { success: true; data: GateReport } | { success: false; error: z.ZodError } {
	const result = GateReport.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return { success: false, error: result.error };
}

/**
 * Validate with enhanced error messages
 */
export function validateGateReportWithErrors(data: unknown): { 
	valid: true; 
	data: GateReport 
} | { 
	valid: false; 
	errors: GateReportValidationError[] 
} {
	const result = GateReport.safeParse(data);
	if (result.success) {
		return { valid: true, data: result.data };
	}
	return { 
		valid: false, 
		errors: formatValidationErrors(result.error) 
	};
}

/**
 * Migration utilities for gate report schema evolution
 */

/**
 * Migrate legacy gate report to current schema version
 * Handles backward compatibility for older report formats
 */
export function migrateGateReport(data: unknown): GateReport {
	// If data is already valid, return it (ensuring schema version is set)
	const validation = GateReport.safeParse(data);
	if (validation.success) {
		// Ensure schema version is present
		return {
			...validation.data,
			schemaVersion: validation.data.schemaVersion || "1.0.0"
		};
	}

	// Handle legacy formats
	if (typeof data === 'object' && data !== null) {
		const legacy = data as any;
		const migrated: any = { ...legacy };

		// Add schema version if missing (for v1.0.0 reports)
		if (!migrated.schemaVersion) {
			migrated.schemaVersion = "1.0.0";
		}

		// Migrate old status values if needed
		if (legacy.result === 'success') {
			migrated.status = 'pass';
			delete migrated.result;
		} else if (legacy.result === 'failure') {
			migrated.status = 'fail';
			delete migrated.result;
		}

		// Rename old field names if present
		if (legacy.duration !== undefined && legacy.duration_ms === undefined) {
			migrated.duration_ms = legacy.duration;
			delete migrated.duration;
		}

		if (legacy.start_time !== undefined && legacy.started_at === undefined) {
			migrated.started_at = legacy.start_time;
			delete migrated.start_time;
		}

		// Try validating the migrated data
		const migratedValidation = GateReport.safeParse(migrated);
		if (migratedValidation.success) {
			return {
				...migratedValidation.data,
				schemaVersion: migratedValidation.data.schemaVersion || "1.0.0"
			};
		}
		throw migratedValidation.error;
	}

	// If migration fails, throw with original validation error
	throw validation.error;
}

/**
 * Check if a gate report needs migration
 */
export function needsMigration(data: unknown): boolean {
	if (typeof data !== 'object' || data === null) {
		return false;
	}

	const legacy = data as any;
	
	// Check for legacy field names
	const hasLegacyFields = 
		legacy.result !== undefined ||
		(legacy.duration !== undefined && legacy.duration_ms === undefined) ||
		(legacy.start_time !== undefined && legacy.started_at === undefined);

	// Check for missing schema version
	const missingVersion = !legacy.schemaVersion;

	return hasLegacyFields || missingVersion;
}
