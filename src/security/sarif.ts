/**
 * SARIF (Static Analysis Results Interchange Format) Parser
 * 
 * Parses SARIF 2.1.0 format for vulnerability scanning results
 * https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */

import { Severity, SecurityScanResult, Vulnerability } from './scanning.js';

/**
 * SARIF severity level mapping
 */
export enum SarifLevel {
	ERROR = 'error',
	WARNING = 'warning',
	NOTE = 'note',
	NONE = 'none',
}

/**
 * SARIF result object (simplified)
 */
interface SarifResult {
	level?: string;
	message?: {
		text?: string;
	};
	ruleId?: string;
	locations?: Array<{
		physicalLocation?: {
			artifactLocation?: {
				uri?: string;
			};
		};
	}>;
	properties?: {
		'security-severity'?: string;
		package?: string;
		version?: string;
		cve?: string;
		cvss?: number;
	};
}

/**
 * SARIF run object (simplified)
 */
interface SarifRun {
	tool?: {
		driver?: {
			name?: string;
		};
	};
	results?: SarifResult[];
}

/**
 * SARIF document structure (simplified)
 */
interface SarifDocument {
	version?: string;
	runs?: SarifRun[];
}

/**
 * Map SARIF level to our Severity enum
 */
function mapSarifLevel(level?: string, securitySeverity?: string): Severity {
	// First check security-severity property if available
	if (securitySeverity) {
		const normalized = securitySeverity.toLowerCase();
		if (normalized === 'critical') return Severity.CRITICAL;
		if (normalized === 'high') return Severity.HIGH;
		if (normalized === 'medium' || normalized === 'moderate') return Severity.MEDIUM;
		if (normalized === 'low') return Severity.LOW;
	}

	// Fall back to SARIF level
	const normalized = (level || 'note').toLowerCase();
	if (normalized === 'error') return Severity.HIGH;
	if (normalized === 'warning') return Severity.MEDIUM;
	if (normalized === 'note') return Severity.LOW;
	return Severity.INFO;
}

/**
 * Parse SARIF document and extract vulnerabilities
 */
export function parseSarif(sarifContent: string): SecurityScanResult {
	let sarif: SarifDocument;
	
	try {
		sarif = JSON.parse(sarifContent);
	} catch (error) {
		throw new Error(`Invalid SARIF JSON: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!sarif.runs || sarif.runs.length === 0) {
		return createEmptyResult('sarif');
	}

	const vulnerabilities: Vulnerability[] = [];
	const run = sarif.runs[0];
	const scannerName = run.tool?.driver?.name || 'sarif';
	
	if (!run.results || run.results.length === 0) {
		return createEmptyResult(scannerName);
	}

	// Process results - sort by rule ID for deterministic ordering
	const sortedResults = [...run.results].sort((a, b) => {
		const aId = a.ruleId || '';
		const bId = b.ruleId || '';
		return aId.localeCompare(bId);
	});

	for (const result of sortedResults) {
		const securitySeverity = result.properties?.['security-severity'];
		const severity = mapSarifLevel(result.level, securitySeverity);
		
		// Extract package info from properties or location
		const packageName = result.properties?.package || 
			result.locations?.[0]?.physicalLocation?.artifactLocation?.uri || 
			'unknown';
		
		vulnerabilities.push({
			id: result.ruleId || 'SARIF-UNKNOWN',
			package: packageName,
			version: result.properties?.version || 'unknown',
			severity,
			title: result.message?.text || 'Security finding',
			description: result.message?.text || '',
			cve: result.properties?.cve,
			cvssScore: result.properties?.cvss,
		});
	}

	// Count by severity
	const criticalCount = vulnerabilities.filter(v => v.severity === Severity.CRITICAL).length;
	const highCount = vulnerabilities.filter(v => v.severity === Severity.HIGH).length;
	const mediumCount = vulnerabilities.filter(v => v.severity === Severity.MEDIUM).length;
	const lowCount = vulnerabilities.filter(v => v.severity === Severity.LOW).length;

	return {
		timestamp: new Date(),
		scanner: scannerName,
		totalVulnerabilities: vulnerabilities.length,
		vulnerabilities,
		criticalCount,
		highCount,
		mediumCount,
		lowCount,
		passed: criticalCount === 0 && highCount === 0,
	};
}

/**
 * Create empty scan result
 */
function createEmptyResult(scanner: string): SecurityScanResult {
	return {
		timestamp: new Date(),
		scanner,
		totalVulnerabilities: 0,
		vulnerabilities: [],
		criticalCount: 0,
		highCount: 0,
		mediumCount: 0,
		lowCount: 0,
		passed: true,
	};
}
