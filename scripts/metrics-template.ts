#!/usr/bin/env tsx
/**
 * Generate adoption metrics template with deterministic output
 * 
 * Emits JSON placeholders for tracking lexrunner adoption and badge-ready values
 */

import { canonicalJSONStringify } from '../src/util/canonicalJson.js';

export interface AdoptionMetrics {
	/** Schema version for forward compatibility */
	schemaVersion: string;
	/** Period covered by metrics */
	period: {
		start: string;
		end: string;
	};
	/** PR merge statistics */
	prMetrics: {
		totalMerged: number;
		averageTimeToMerge: number;
		successRate: number;
	};
	/** Gate execution statistics */
	gateMetrics: {
		totalExecutions: number;
		passRate: number;
		averageExecutionTime: number;
	};
	/** Dependency resolution metrics */
	dependencyMetrics: {
		totalResolved: number;
		cyclesDetected: number;
		accuracyRate: number;
	};
	/** Time savings estimate */
	timeSavings: {
		totalHoursSaved: number;
		automationRate: number;
	};
	/** Badge-ready values */
	badges: {
		status: 'active' | 'inactive' | 'testing';
		prsPerWeek: number;
		successRate: number;
	};
}

/**
 * Generate template metrics with placeholder values
 */
export function generateMetricsTemplate(fixedDate?: Date): AdoptionMetrics {
	const now = fixedDate || new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	return {
		schemaVersion: '1.0.0',
		period: {
			start: weekAgo.toISOString().split('T')[0],
			end: now.toISOString().split('T')[0],
		},
		prMetrics: {
			totalMerged: 0,
			averageTimeToMerge: 0,
			successRate: 0,
		},
		gateMetrics: {
			totalExecutions: 0,
			passRate: 0,
			averageExecutionTime: 0,
		},
		dependencyMetrics: {
			totalResolved: 0,
			cyclesDetected: 0,
			accuracyRate: 0,
		},
		timeSavings: {
			totalHoursSaved: 0,
			automationRate: 0,
		},
		badges: {
			status: 'testing',
			prsPerWeek: 0,
			successRate: 0,
		},
	};
}

/**
 * Generate badge URLs for README
 */
export function generateBadgeUrls(metrics: AdoptionMetrics): Record<string, string> {
	const { badges } = metrics;
	
	return {
		status: `https://img.shields.io/badge/status-${badges.status}-${getBadgeColor(badges.status)}`,
		prsPerWeek: `https://img.shields.io/badge/PRs%2Fweek-${badges.prsPerWeek}-blue`,
		successRate: `https://img.shields.io/badge/success%20rate-${Math.round(badges.successRate * 100)}%25-${getSuccessColor(badges.successRate)}`,
	};
}

function getBadgeColor(status: string): string {
	switch (status) {
		case 'active':
			return 'brightgreen';
		case 'testing':
			return 'yellow';
		case 'inactive':
			return 'lightgrey';
		default:
			return 'lightgrey';
	}
}

function getSuccessColor(rate: number): string {
	if (rate >= 0.9) return 'brightgreen';
	if (rate >= 0.7) return 'green';
	if (rate >= 0.5) return 'yellow';
	return 'red';
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
	const metrics = generateMetricsTemplate();
	const badges = generateBadgeUrls(metrics);

	const output = {
		metrics,
		badges,
	};

	// Use canonical JSON for deterministic output
	console.log(canonicalJSONStringify(output));
}
