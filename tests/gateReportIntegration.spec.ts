import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateGateReport } from '../src/schema/gateReport.js';
import { readGateDir } from '../src/report/aggregate.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Gate Report Integration', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-integration-'));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it('validates and aggregates reports with schema version and artifacts', () => {
		// Create gate reports with new schema features
		const reports = [
			{
				schemaVersion: "1.0.0",
				item: "frontend",
				gate: "build",
				status: "pass",
				duration_ms: 5000,
				started_at: "2024-01-15T10:00:00Z",
				artifacts: [
					{
						path: "/dist/bundle.js",
						type: "build-output",
						size: 524288
					}
				]
			},
			{
				schemaVersion: "1.0.0",
				item: "frontend",
				gate: "test",
				status: "pass",
				duration_ms: 3000,
				started_at: "2024-01-15T10:05:00Z",
				meta: {
					test_count: "42"
				}
			},
			{
				schemaVersion: "1.0.0",
				item: "backend",
				gate: "lint",
				status: "pass",
				duration_ms: 1000,
				started_at: "2024-01-15T10:01:00Z"
			}
		];

		// Validate each report individually
		reports.forEach(report => {
			const validated = validateGateReport(report);
			expect(validated.schemaVersion).toBe("1.0.0");
		});

		// Write reports to directory
		reports.forEach((report, idx) => {
			fs.writeFileSync(
				path.join(tempDir, `report-${idx}.json`),
				JSON.stringify(report)
			);
		});

		// Aggregate reports
		const aggregated = readGateDir(tempDir);

		// Verify aggregation
		expect(aggregated.items).toHaveLength(2);
		expect(aggregated.allGreen).toBe(true);

		// Verify frontend item
		const frontend = aggregated.items.find(i => i.item === 'frontend');
		expect(frontend).toBeDefined();
		expect(frontend!.gates).toHaveLength(2);
		
		// Verify artifact is preserved
		const buildGate = frontend!.gates.find(g => g.gate === 'build');
		expect(buildGate).toBeDefined();
		expect(buildGate!.artifacts).toHaveLength(1);
		expect(buildGate!.artifacts![0].path).toBe("/dist/bundle.js");

		// Verify metadata is preserved
		const testGate = frontend!.gates.find(g => g.gate === 'test');
		expect(testGate).toBeDefined();
		expect(testGate!.meta?.test_count).toBe("42");
	});

	it('handles mixed reports with and without schema version', () => {
		const reports = [
			{
				// New format with schema version
				schemaVersion: "1.0.0",
				item: "feature-a",
				gate: "lint",
				status: "pass",
				duration_ms: 1000,
				started_at: "2024-01-15T10:00:00Z"
			},
			{
				// Legacy format without schema version (still valid)
				item: "feature-b",
				gate: "test",
				status: "fail",
				duration_ms: 2000,
				started_at: "2024-01-15T10:01:00Z"
			}
		];

		// Both should validate
		reports.forEach((report, idx) => {
			const validated = validateGateReport(report);
			fs.writeFileSync(
				path.join(tempDir, `report-${idx}.json`),
				JSON.stringify(report)
			);
		});

		// Should aggregate successfully
		const aggregated = readGateDir(tempDir);
		expect(aggregated.items).toHaveLength(2);
		expect(aggregated.allGreen).toBe(false); // feature-b failed
	});

	it('handles reports with all optional fields populated', () => {
		const fullReport = {
			schemaVersion: "1.0.0",
			item: "complex-service",
			gate: "integration-test",
			status: "pass",
			duration_ms: 15000,
			started_at: "2024-01-15T10:00:00Z",
			stderr_path: "/logs/stderr.log",
			stdout_path: "/logs/stdout.log",
			meta: {
				environment: "staging",
				runner: "jest",
				exit_code: "0"
			},
			artifacts: [
				{
					path: "/coverage/index.html",
					type: "coverage-report",
					size: 245760,
					description: "HTML coverage report"
				},
				{
					path: "/test-results.xml",
					type: "junit",
					size: 8192
				}
			]
		};

		// Validate
		const validated = validateGateReport(fullReport);
		expect(validated.schemaVersion).toBe("1.0.0");
		expect(validated.artifacts).toHaveLength(2);
		expect(validated.meta?.environment).toBe("staging");
		expect(validated.stderr_path).toBe("/logs/stderr.log");

		// Write and aggregate
		fs.writeFileSync(
			path.join(tempDir, 'full-report.json'),
			JSON.stringify(fullReport)
		);

		const aggregated = readGateDir(tempDir);
		expect(aggregated.items).toHaveLength(1);
		
		const service = aggregated.items[0];
		expect(service.gates[0].artifacts).toHaveLength(2);
		expect(service.gates[0].meta?.runner).toBe("jest");
	});
});
