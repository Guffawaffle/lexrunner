/**
 * Security CLI commands
 * Provides security operations like token rotation checks, secrets scanning, etc.
 */

import { SecretsManager } from '../security/secrets.js';
import { PlanSecretsScanner } from '../security/secrets.js';
import chalk from 'chalk';

/**
 * Check if secrets need rotation
 */
export async function checkRotation(
	secretIds: string[],
	maxAgeDays: number = 90
): Promise<void> {
	const secretsManager = new SecretsManager();

	console.log(chalk.blue(`\n🔐 Checking secret rotation status (max age: ${maxAgeDays} days)...\n`));

	let needsRotation = 0;

	for (const secretId of secretIds) {
		const needs = await secretsManager.checkRotationNeeded(secretId, maxAgeDays);
		
		if (needs) {
			console.log(chalk.yellow(`⚠️  ${secretId}: Needs rotation (>${maxAgeDays} days old)`));
			needsRotation++;
		} else {
			console.log(chalk.green(`✓ ${secretId}: Within rotation window`));
		}
	}

	console.log('');

	if (needsRotation > 0) {
		console.log(chalk.yellow(`⚠️  ${needsRotation} secret(s) need rotation`));
		process.exit(1);
	} else {
		console.log(chalk.green('✅ All secrets are within rotation policy'));
	}
}

/**
 * Scan plan file for accidentally exposed secrets
 */
export async function scanPlan(planPath: string): Promise<void> {
	const scanner = new PlanSecretsScanner();

	console.log(chalk.blue(`\n🔍 Scanning plan for exposed secrets: ${planPath}\n`));

	try {
		const detected = await scanner.scanPlanFile(planPath);
		const report = scanner.generateReport(detected);

		if (detected.length === 0) {
			console.log(chalk.green(report));
		} else {
			console.log(chalk.red(report));
			process.exit(1);
		}
	} catch (error) {
		console.error(chalk.red(`❌ Scan failed: ${error instanceof Error ? error.message : String(error)}`));
		process.exit(1);
	}
}

/**
 * Validate required secrets exist
 */
export async function validateSecrets(secretIds: string[]): Promise<void> {
	const secretsManager = new SecretsManager();

	console.log(chalk.blue(`\n🔐 Validating required secrets...\n`));

	const result = await secretsManager.validateSecrets(secretIds);

	if (result.valid) {
		console.log(chalk.green('✅ All required secrets are present'));
		for (const id of secretIds) {
			console.log(chalk.green(`  ✓ ${id}`));
		}
	} else {
		console.log(chalk.red('❌ Missing required secrets:'));
		for (const id of result.missing) {
			console.log(chalk.red(`  ✗ ${id}`));
		}
		console.log('');
		console.log(chalk.yellow('Set missing secrets with:'));
		console.log(chalk.cyan(`  export LEX_PR_<SECRET_ID>="<value>"`));
		process.exit(1);
	}
}
