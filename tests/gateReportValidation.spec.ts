import { describe, it, expect } from 'vitest';
import { 
	validateGateReport, 
	validateGateReportWithErrors, 
	migrateGateReport,
	needsMigration,
	formatValidationErrors
} from '../src/schema/gateReport.js';
import { z } from 'zod';

describe('Gate Report Schema Validation', () => {
	describe('Basic Validation', () => {
		it('validates valid gate report with all required fields', () => {
			const validReport = {
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReport(validReport);
			expect(result).toEqual(validReport);
		});

		it('validates gate report with schema version', () => {
			const validReport = {
				schemaVersion: "1.0.0",
				item: "test-item",
				gate: "test",
				status: "pass" as const,
				duration_ms: 2500,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReport(validReport);
			expect(result.schemaVersion).toBe("1.0.0");
		});

		it('validates gate report with artifacts', () => {
			const validReport = {
				item: "test-item",
				gate: "coverage",
				status: "pass" as const,
				duration_ms: 5000,
				started_at: "2024-01-15T10:30:00Z",
				artifacts: [
					{
						path: "/path/to/coverage.html",
						type: "coverage",
						size: 12345,
						description: "Coverage report"
					}
				]
			};

			const result = validateGateReport(validReport);
			expect(result.artifacts).toHaveLength(1);
			expect(result.artifacts![0].path).toBe("/path/to/coverage.html");
		});

		it('rejects invalid status values', () => {
			const invalidReport = {
				item: "test-item",
				gate: "lint",
				status: "invalid-status",
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			expect(() => validateGateReport(invalidReport)).toThrow();
		});

		it('rejects negative duration', () => {
			const invalidReport = {
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: -100,
				started_at: "2024-01-15T10:30:00Z"
			};

			expect(() => validateGateReport(invalidReport)).toThrow();
		});

		it('rejects missing required fields', () => {
			const invalidReport = {
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000
				// missing item and started_at
			};

			expect(() => validateGateReport(invalidReport)).toThrow();
		});
	});

	describe('Enhanced Error Messages', () => {
		it('provides helpful error with suggestion for invalid status', () => {
			const invalidReport = {
				item: "test-item",
				gate: "lint",
				status: "invalid-status",
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReportWithErrors(invalidReport);
			expect(result.valid).toBe(false);
			
			if (!result.valid) {
				const statusError = result.errors.find(e => e.path === 'status');
				expect(statusError).toBeDefined();
				expect(statusError?.suggestion).toContain('pass');
				expect(statusError?.suggestion).toContain('fail');
			}
		});

		it('provides helpful error with suggestion for missing started_at', () => {
			const invalidReport = {
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000
				// missing started_at
			};

			const result = validateGateReportWithErrors(invalidReport);
			expect(result.valid).toBe(false);
			
			if (!result.valid) {
				const timeError = result.errors.find(e => e.path === 'started_at');
				expect(timeError).toBeDefined();
				expect(timeError?.suggestion).toContain('ISO 8601');
			}
		});

		it('provides helpful error for negative duration', () => {
			const invalidReport = {
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: -100,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReportWithErrors(invalidReport);
			expect(result.valid).toBe(false);
			
			if (!result.valid) {
				const durationError = result.errors.find(e => e.path === 'duration_ms');
				expect(durationError).toBeDefined();
				expect(durationError?.suggestion).toContain('>=');
			}
		});

		it('formats validation errors correctly', () => {
			const invalidData = {
				item: 123, // wrong type
				gate: "test",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReportWithErrors(invalidData);
			expect(result.valid).toBe(false);
			
			if (!result.valid) {
				expect(result.errors.length).toBeGreaterThan(0);
				const error = result.errors[0];
				expect(error).toHaveProperty('path');
				expect(error).toHaveProperty('message');
				expect(error).toHaveProperty('code');
			}
		});
	});

	describe('Schema Migration', () => {
		it('detects legacy report needing migration', () => {
			const legacyReport = {
				item: "test-item",
				gate: "lint",
				result: "success", // old field name
				duration: 1000, // old field name
				start_time: "2024-01-15T10:30:00Z" // old field name
			};

			expect(needsMigration(legacyReport)).toBe(true);
		});

		it('detects report missing schema version', () => {
			const report = {
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
				// missing schemaVersion
			};

			expect(needsMigration(report)).toBe(true);
		});

		it('does not detect valid report as needing migration', () => {
			const validReport = {
				schemaVersion: "1.0.0",
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			expect(needsMigration(validReport)).toBe(false);
		});

		it('migrates legacy report with old field names', () => {
			const legacyReport = {
				item: "test-item",
				gate: "lint",
				result: "success",
				duration: 1500,
				start_time: "2024-01-15T10:30:00Z"
			};

			const migrated = migrateGateReport(legacyReport);
			expect(migrated.status).toBe("pass");
			expect(migrated.duration_ms).toBe(1500);
			expect(migrated.started_at).toBe("2024-01-15T10:30:00Z");
			expect(migrated.schemaVersion).toBe("1.0.0");
		});

		it('migrates legacy report with failure status', () => {
			const legacyReport = {
				item: "test-item",
				gate: "test",
				result: "failure",
				duration: 2500,
				start_time: "2024-01-15T10:30:00Z"
			};

			const migrated = migrateGateReport(legacyReport);
			expect(migrated.status).toBe("fail");
		});

		it('adds schema version to report without one', () => {
			const report = {
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const migrated = migrateGateReport(report);
			expect(migrated.schemaVersion).toBe("1.0.0");
		});

		it('preserves valid report during migration', () => {
			const validReport = {
				schemaVersion: "1.0.0",
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const migrated = migrateGateReport(validReport);
			expect(migrated).toEqual(validReport);
		});

		it('preserves optional fields during migration', () => {
			const legacyReport = {
				item: "test-item",
				gate: "test",
				result: "success",
				duration: 1000,
				start_time: "2024-01-15T10:30:00Z",
				stderr_path: "/path/to/stderr.log",
				meta: { key: "value" }
			};

			const migrated = migrateGateReport(legacyReport);
			expect(migrated.stderr_path).toBe("/path/to/stderr.log");
			expect(migrated.meta).toEqual({ key: "value" });
		});

		it('throws error for invalid legacy format that cannot be migrated', () => {
			const invalidReport = {
				item: "test-item",
				// missing critical fields that can't be inferred
			};

			expect(() => migrateGateReport(invalidReport)).toThrow();
		});
	});

	describe('Artifact Metadata', () => {
		it('validates artifact with all fields', () => {
			const report = {
				item: "test-item",
				gate: "build",
				status: "pass" as const,
				duration_ms: 10000,
				started_at: "2024-01-15T10:30:00Z",
				artifacts: [
					{
						path: "/dist/bundle.js",
						type: "build-output",
						size: 524288,
						description: "Production bundle"
					}
				]
			};

			const result = validateGateReport(report);
			expect(result.artifacts).toHaveLength(1);
			expect(result.artifacts![0]).toEqual({
				path: "/dist/bundle.js",
				type: "build-output",
				size: 524288,
				description: "Production bundle"
			});
		});

		it('validates artifact with only required fields', () => {
			const report = {
				item: "test-item",
				gate: "build",
				status: "pass" as const,
				duration_ms: 10000,
				started_at: "2024-01-15T10:30:00Z",
				artifacts: [
					{
						path: "/dist/bundle.js"
					}
				]
			};

			const result = validateGateReport(report);
			expect(result.artifacts![0].path).toBe("/dist/bundle.js");
		});

		it('validates multiple artifacts', () => {
			const report = {
				item: "test-item",
				gate: "test",
				status: "pass" as const,
				duration_ms: 5000,
				started_at: "2024-01-15T10:30:00Z",
				artifacts: [
					{ path: "/coverage/index.html", type: "coverage" },
					{ path: "/test-results.xml", type: "junit" }
				]
			};

			const result = validateGateReport(report);
			expect(result.artifacts).toHaveLength(2);
		});

		it('rejects artifact with negative size', () => {
			const report = {
				item: "test-item",
				gate: "build",
				status: "pass" as const,
				duration_ms: 10000,
				started_at: "2024-01-15T10:30:00Z",
				artifacts: [
					{
						path: "/dist/bundle.js",
						size: -100
					}
				]
			};

			expect(() => validateGateReport(report)).toThrow();
		});
	});

	describe('Schema Versioning', () => {
		it('accepts valid schema version', () => {
			const report = {
				schemaVersion: "1.0.0",
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReport(report);
			expect(result.schemaVersion).toBe("1.0.0");
		});

		it('accepts patch version increments', () => {
			const report = {
				schemaVersion: "1.0.1",
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReport(report);
			expect(result.schemaVersion).toBe("1.0.1");
		});

		it('accepts minor version increments', () => {
			const report = {
				schemaVersion: "1.2.0",
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			const result = validateGateReport(report);
			expect(result.schemaVersion).toBe("1.2.0");
		});

		it('rejects invalid schema version format', () => {
			const report = {
				schemaVersion: "2.0.0", // major version 2 not supported
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			expect(() => validateGateReport(report)).toThrow();
		});

		it('rejects non-semver schema version', () => {
			const report = {
				schemaVersion: "v1",
				item: "test-item",
				gate: "lint",
				status: "pass" as const,
				duration_ms: 1000,
				started_at: "2024-01-15T10:30:00Z"
			};

			expect(() => validateGateReport(report)).toThrow();
		});
	});
});
