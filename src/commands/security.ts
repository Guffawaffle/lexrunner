/**
 * Security CLI commands
 * Provides security operations like token rotation checks, secrets scanning, etc.
 */

import { SecretsManager, PlanSecretsScanner } from '../security/secrets.js';

/**
 * Standardized security command result
 */
export interface SecurityCommandResult<TFindings = any> {
	/** Exit code to be used by CLI */
	exitCode: number;
	/** Human‑readable report (no ANSI colors; CLI adds styling) */
	report: string;
	/** Machine‑readable findings payload (shape depends on command) */
	findings?: TFindings;
	/** Status classification */
	status: 'ok' | 'findings' | 'error';
}

function createResult<TFindings>(command: string, status: 'ok' | 'findings' | 'error', report: string, findings?: TFindings): SecurityCommandResult<TFindings> {
 	let exitCode = 0;
 	if (status === 'findings') exitCode = 1;
 	else if (status === 'error') exitCode = 2; // Reserved internal error code (documented elsewhere)
	// Prepend command name to report for clarity (without colors)
	const fullReport = report.startsWith(command) ? report : `${command}: ${report}`;
 	return { exitCode, report: fullReport, findings, status };
}

/**
 * Check if secrets need rotation
 */
export async function checkRotation(
	secretIds: string[],
	maxAgeDays: number = 90
): Promise<SecurityCommandResult<{ summary: { needsRotation: string[]; ok: string[]; maxAgeDays: number } }>> {
	const secretsManager = new SecretsManager();
	const needsRotation: string[] = [];
	const ok: string[] = [];

	for (const secretId of secretIds) {
		try {
			const needs = await secretsManager.checkRotationNeeded(secretId, maxAgeDays);
			if (needs) needsRotation.push(secretId); else ok.push(secretId);
		} catch (e) {
			// Treat errors as findings for now (could differentiate later)
			needsRotation.push(secretId);
		}
	}

	let reportLines: string[] = [];
	reportLines.push(`Checking secret rotation status (max age: ${maxAgeDays} days)`);
	for (const id of ok) {
		reportLines.push(`✓ ${id}: Within rotation window`);
	}
	for (const id of needsRotation) {
		reportLines.push(`! ${id}: Needs rotation (>${maxAgeDays} days old)`);
	}

	if (needsRotation.length === 0) {
		reportLines.push('All secrets are within rotation policy');
		return createResult('check-rotation', 'ok', reportLines.join('\n'), { summary: { needsRotation, ok, maxAgeDays } });
	}

	reportLines.push(`${needsRotation.length} secret(s) need rotation`);
	return createResult('check-rotation', 'findings', reportLines.join('\n'), { summary: { needsRotation, ok, maxAgeDays } });
}

/**
 * Scan plan file for accidentally exposed secrets
 */
export async function scanPlan(planPath: string): Promise<SecurityCommandResult<{ detected: number; items: any[] }>> {
	const scanner = new PlanSecretsScanner();
	try {
		const detected = await scanner.scanPlanFile(planPath);
		const report = scanner.generateReport(detected);
		if (detected.length === 0) {
			return createResult('scan-plan', 'ok', report, { detected: 0, items: [] });
		}
		return createResult('scan-plan', 'findings', report, { detected: detected.length, items: detected });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return createResult('scan-plan', 'error', `Scan failed: ${message}`, { detected: -1, items: [] });
	}
}

/**
 * Validate required secrets exist
 */
export async function validateSecrets(secretIds: string[]): Promise<SecurityCommandResult<{ missing: string[]; present: string[] }>> {
	const secretsManager = new SecretsManager();
	const result = await secretsManager.validateSecrets(secretIds);
	const present = secretIds.filter(id => !result.missing.includes(id));
	let reportLines: string[] = [];
	reportLines.push('Validating required secrets');
	if (result.valid) {
		reportLines.push('All required secrets are present');
		for (const id of present) reportLines.push(`✓ ${id}`);
		return createResult('validate-secrets', 'ok', reportLines.join('\n'), { missing: [], present });
	}
	reportLines.push('Missing required secrets:');
	for (const id of result.missing) reportLines.push(`✗ ${id}`);
	reportLines.push('Set missing secrets with:');
	reportLines.push('export LEX_PR_<SECRET_ID>="<value>"');
	return createResult('validate-secrets', 'findings', reportLines.join('\n'), { missing: result.missing, present });
}
