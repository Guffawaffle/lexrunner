import { describe, it, expect } from 'vitest';
import { generateMetricsTemplate, generateBadgeUrls } from '../scripts/metrics-template.js';
import { canonicalJSONStringify } from '../src/util/canonicalJson.js';

describe('metrics-template', () => {
	it('should generate deterministic output with fixed date', () => {
		const fixedDate = new Date('2024-01-15T12:00:00Z');
		
		const metrics1 = generateMetricsTemplate(fixedDate);
		const metrics2 = generateMetricsTemplate(fixedDate);
		
		const json1 = canonicalJSONStringify(metrics1);
		const json2 = canonicalJSONStringify(metrics2);
		
		expect(json1).toBe(json2);
	});

	it('should generate correct date range', () => {
		const fixedDate = new Date('2024-01-15T12:00:00Z');
		const metrics = generateMetricsTemplate(fixedDate);
		
		expect(metrics.period.end).toBe('2024-01-15');
		expect(metrics.period.start).toBe('2024-01-08');
	});

	it('should have correct schema structure', () => {
		const metrics = generateMetricsTemplate(new Date());
		
		expect(metrics.schemaVersion).toBe('1.0.0');
		expect(metrics).toHaveProperty('period');
		expect(metrics).toHaveProperty('prMetrics');
		expect(metrics).toHaveProperty('gateMetrics');
		expect(metrics).toHaveProperty('dependencyMetrics');
		expect(metrics).toHaveProperty('timeSavings');
		expect(metrics).toHaveProperty('badges');
	});

	it('should initialize all metrics to zero', () => {
		const metrics = generateMetricsTemplate(new Date());
		
		expect(metrics.prMetrics.totalMerged).toBe(0);
		expect(metrics.prMetrics.averageTimeToMerge).toBe(0);
		expect(metrics.prMetrics.successRate).toBe(0);
		
		expect(metrics.gateMetrics.totalExecutions).toBe(0);
		expect(metrics.gateMetrics.passRate).toBe(0);
		expect(metrics.gateMetrics.averageExecutionTime).toBe(0);
		
		expect(metrics.dependencyMetrics.totalResolved).toBe(0);
		expect(metrics.dependencyMetrics.cyclesDetected).toBe(0);
		expect(metrics.dependencyMetrics.accuracyRate).toBe(0);
		
		expect(metrics.timeSavings.totalHoursSaved).toBe(0);
		expect(metrics.timeSavings.automationRate).toBe(0);
	});

	it('should set default badge status to testing', () => {
		const metrics = generateMetricsTemplate(new Date());
		
		expect(metrics.badges.status).toBe('testing');
		expect(metrics.badges.prsPerWeek).toBe(0);
		expect(metrics.badges.successRate).toBe(0);
	});

	it('should generate valid badge URLs', () => {
		const metrics = generateMetricsTemplate(new Date());
		const badges = generateBadgeUrls(metrics);
		
		expect(badges.status).toContain('img.shields.io');
		expect(badges.status).toContain('testing-yellow');
		
		expect(badges.prsPerWeek).toContain('img.shields.io');
		expect(badges.prsPerWeek).toContain('PRs%2Fweek-0');
		
		expect(badges.successRate).toContain('img.shields.io');
		expect(badges.successRate).toContain('0%25-red');
	});

	it('should generate correct badge colors for different statuses', () => {
		const testCases = [
			{ status: 'active' as const, color: 'brightgreen' },
			{ status: 'testing' as const, color: 'yellow' },
			{ status: 'inactive' as const, color: 'lightgrey' },
		];

		for (const { status, color } of testCases) {
			const metrics = generateMetricsTemplate(new Date());
			metrics.badges.status = status;
			const badges = generateBadgeUrls(metrics);
			
			expect(badges.status).toContain(`status-${status}-${color}`);
		}
	});

	it('should generate correct colors for success rates', () => {
		const testCases = [
			{ rate: 0.95, color: 'brightgreen' },
			{ rate: 0.85, color: 'green' },
			{ rate: 0.65, color: 'yellow' },
			{ rate: 0.45, color: 'red' },
		];

		for (const { rate, color } of testCases) {
			const metrics = generateMetricsTemplate(new Date());
			metrics.badges.successRate = rate;
			const badges = generateBadgeUrls(metrics);
			
			expect(badges.successRate).toContain(`-${color}`);
		}
	});

	it('should have stable key ordering in JSON output', () => {
		const metrics = generateMetricsTemplate(new Date('2024-01-15T12:00:00Z'));
		const json = canonicalJSONStringify(metrics);
		
		// Check that keys appear in alphabetical order
		expect(json).toMatch(/"badges".*"dependencyMetrics".*"gateMetrics"/s);
		expect(json).toMatch(/"period".*"prMetrics".*"schemaVersion"/s);
		expect(json).toMatch(/"timeSavings"/s);
	});

	it('should produce same output for multiple calls with same date', () => {
		const fixedDate = new Date('2024-01-15T12:00:00Z');
		
		const outputs = Array.from({ length: 5 }, () => {
			const metrics = generateMetricsTemplate(fixedDate);
			const badges = generateBadgeUrls(metrics);
			return canonicalJSONStringify({ metrics, badges });
		});
		
		// All outputs should be identical
		const first = outputs[0];
		outputs.forEach(output => {
			expect(output).toBe(first);
		});
	});
});
