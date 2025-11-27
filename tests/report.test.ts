import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readGateDir, generateMarkdownSummary } from '../src/report/aggregate.js';
import { validateGateReport, safeValidateGateReport } from '../src/schema/gateReport.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Gate Report Schema', () => {
	it('validates valid gate report', () => {
		const validReport = {
			item: "test-item",
			gate: "lint",
			status: "pass" as const,
			duration_ms: 1000,
			started_at: "2024-01-15T10:30:00Z"
		};

		const result = validateGateReport(validReport);
		// Zod v4 applies defaults, so schemaVersion is added
		expect(result).toEqual({ ...validReport, schemaVersion: "1.0.0" });
	});

	it('validates gate report with optional fields', () => {
		const validReport = {
			item: "test-item",
			gate: "test",
			status: "fail" as const,
			duration_ms: 2500,
			started_at: "2024-01-15T10:30:00Z",
			stderr_path: "/path/to/stderr.log",
			stdout_path: "/path/to/stdout.log",
			meta: {
				"exit_code": "1",
				"command": "npm test"
			}
		};

		const result = validateGateReport(validReport);
		// Zod v4 applies defaults, so schemaVersion is added
		expect(result).toEqual({ ...validReport, schemaVersion: "1.0.0" });
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

	it('safe validation returns success for valid data', () => {
		const validReport = {
			item: "test-item",
			gate: "lint",
			status: "pass" as const,
			duration_ms: 1000,
			started_at: "2024-01-15T10:30:00Z"
		};

		const result = safeValidateGateReport(validReport);
		expect(result.success).toBe(true);
		if (result.success) {
			// Zod v4 applies defaults, so schemaVersion is added
			expect(result.data).toEqual({ ...validReport, schemaVersion: "1.0.0" });
		}
	});

	it('safe validation returns error for invalid data', () => {
		const invalidReport = {
			item: "test-item",
			gate: "lint",
			status: "invalid-status"
		};

		const result = safeValidateGateReport(invalidReport);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeDefined();
		}
	});
});

describe('Report Aggregator', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it('reads empty directory', () => {
		const result = readGateDir(tempDir);
		
		expect(result.items).toEqual([]);
		expect(result.allGreen).toBe(true);
		expect(result.levels).toBeUndefined();
	});

	it('reads single gate report correctly', () => {
		// Create test file
		const reportData = {
			item: "test-item",
			gate: "lint",
			status: "pass",
			duration_ms: 1200,
			started_at: "2024-01-15T10:30:00Z"
		};
		
		fs.writeFileSync(
			path.join(tempDir, 'test-report.json'),
			JSON.stringify(reportData)
		);

		const result = readGateDir(tempDir);
		
		expect(result.items).toHaveLength(1);
		expect(result.items[0].item).toBe("test-item");
		expect(result.items[0].gates).toHaveLength(1);
		// Zod v4 applies defaults, so schemaVersion is added
		expect(result.items[0].gates[0]).toEqual({ ...reportData, schemaVersion: "1.0.0" });
		expect(result.allGreen).toBe(true);
	});

	it('aggregates multiple reports with stable ordering', () => {
		// Create multiple test files
		const reports = [
			{
				item: "zebra-item",
				gate: "test",
				status: "pass",
				duration_ms: 2000,
				started_at: "2024-01-15T10:31:00Z"
			},
			{
				item: "alpha-item",
				gate: "lint",
				status: "fail",
				duration_ms: 1500,
				started_at: "2024-01-15T10:30:00Z"
			},
			{
				item: "alpha-item",
				gate: "test",
				status: "pass",
				duration_ms: 3000,
				started_at: "2024-01-15T10:32:00Z"
			}
		];

		reports.forEach((report, index) => {
			fs.writeFileSync(
				path.join(tempDir, `report-${index}.json`),
				JSON.stringify(report)
			);
		});

		const result = readGateDir(tempDir);
		
		// Items should be sorted alphabetically
		expect(result.items).toHaveLength(2);
		expect(result.items[0].item).toBe("alpha-item");
		expect(result.items[1].item).toBe("zebra-item");
		
		// Gates within item should be sorted alphabetically
		expect(result.items[0].gates).toHaveLength(2);
		expect(result.items[0].gates[0].gate).toBe("lint");
		expect(result.items[0].gates[1].gate).toBe("test");
		
		// allGreen should be false due to lint failure
		expect(result.allGreen).toBe(false);
	});

	it('handles validation errors in gate reports', () => {
		// Create invalid report
		const invalidReport = {
			item: "test-item",
			gate: "lint",
			status: "invalid-status", // Invalid status
			duration_ms: 1000
			// Missing started_at
		};
		
		fs.writeFileSync(
			path.join(tempDir, 'invalid-report.json'),
			JSON.stringify(invalidReport)
		);

		expect(() => readGateDir(tempDir)).toThrow(/Validation errors in gate reports/);
	});

	it('handles JSON parse errors', () => {
		// Create malformed JSON file
		fs.writeFileSync(
			path.join(tempDir, 'malformed.json'),
			'{ invalid json'
		);

		expect(() => readGateDir(tempDir)).toThrow(/Validation errors in gate reports/);
	});

	it('throws error for non-existent directory', () => {
		expect(() => readGateDir('/non/existent/directory')).toThrow(/does not exist/);
	});

	it('throws error for non-directory path', () => {
		const filePath = path.join(tempDir, 'not-a-directory');
		fs.writeFileSync(filePath, 'test');
		
		expect(() => readGateDir(filePath)).toThrow(/is not a directory/);
	});

	it('ignores non-JSON files', () => {
		// Create JSON and non-JSON files
		const reportData = {
			item: "test-item",
			gate: "lint",
			status: "pass",
			duration_ms: 1200,
			started_at: "2024-01-15T10:30:00Z"
		};
		
		fs.writeFileSync(path.join(tempDir, 'report.json'), JSON.stringify(reportData));
		fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'This should be ignored');
		fs.writeFileSync(path.join(tempDir, 'config.yaml'), 'key: value');

		const result = readGateDir(tempDir);
		
		expect(result.items).toHaveLength(1);
		expect(result.items[0].gates).toHaveLength(1);
	});
});

describe('Markdown Summary Generation', () => {
	it('generates summary for all passing gates', () => {
		const report = {
			items: [
				{
					item: "test-item",
					gates: [
						{
							item: "test-item",
							gate: "lint",
							status: "pass" as const,
							duration_ms: 1200,
							started_at: "2024-01-15T10:30:00Z"
						}
					]
				}
			],
			allGreen: true
		};

		const markdown = generateMarkdownSummary(report);
		
		expect(markdown).toContain('# Gate Report Summary');
		expect(markdown).toContain('✅ All gates passed');
		expect(markdown).toContain('✅ Passed: 1');
		expect(markdown).toContain('❌ Failed: 0');
		expect(markdown).toContain('### ✅ test-item');
		expect(markdown).toContain('| lint | ✅ pass | 1200ms |');
	});

	it('generates summary for mixed gate results', () => {
		const report = {
			items: [
				{
					item: "item-a",
					gates: [
						{
							item: "item-a",
							gate: "lint",
							status: "pass" as const,
							duration_ms: 800,
							started_at: "2024-01-15T10:30:00Z"
						},
						{
							item: "item-a",
							gate: "test",
							status: "fail" as const,
							duration_ms: 2500,
							started_at: "2024-01-15T10:31:00Z"
						}
					]
				}
			],
			allGreen: false
		};

		const markdown = generateMarkdownSummary(report);
		
		expect(markdown).toContain('❌ Some gates failed');
		expect(markdown).toContain('✅ Passed: 1');
		expect(markdown).toContain('❌ Failed: 1');
		expect(markdown).toContain('### ❌ item-a');
		expect(markdown).toContain('| lint | ✅ pass | 800ms |');
		expect(markdown).toContain('| test | ❌ fail | 2500ms |');
	});

	it('handles items with no gates', () => {
		const report = {
			items: [
				{
					item: "empty-item",
					gates: []
				}
			],
			allGreen: true
		};

		const markdown = generateMarkdownSummary(report);
		
		expect(markdown).toContain('### ✅ empty-item');
		expect(markdown).toContain('*No gates defined*');
	});
});
