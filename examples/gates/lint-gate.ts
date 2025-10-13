#!/usr/bin/env node
/**
 * Example linter gate using Audit SDK
 * 
 * Usage: node lint-gate.js
 */

import { initAuditSDK } from '../../src/audit/sdk/index.js';
import { execSync } from 'child_process';

const audit = initAuditSDK('lint');

async function runLinter() {
	try {
		await audit.emit('lint_start', {
			tool: 'npm run lint',
			config: 'tsconfig.json',
			timestamp: new Date().toISOString()
		});

		const startTime = Date.now();

		try {
			// Run linter
			const output = execSync('npm run lint', {
				encoding: 'utf-8',
				stdio: 'pipe'
			});

			const duration = Date.now() - startTime;

			await audit.emit('lint_complete', {
				violations: 0,
				duration_ms: duration
			});

			console.log('Linting passed');
			process.exit(0);
		} catch (error: any) {
			const duration = Date.now() - startTime;
			
			// Parse lint output to count violations
			const output = error.stdout || error.stderr || '';
			const violations = parseLintErrors(output);

			await audit.emit('lint_violations', {
				count: violations.length,
				violations: violations.slice(0, 10), // First 10 for brevity
				duration_ms: duration
			}, 'warn');

			console.error(`Linting failed with ${violations.length} violations`);
			process.exit(1);
		}
	} catch (error) {
		await audit.emit('lint_error', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined
		}, 'error');

		console.error('Linter execution failed:', error);
		process.exit(2);
	} finally {
		await audit.close();
	}
}

/**
 * Parse lint output to extract violations
 * Note: This parser is specific to TypeScript compiler (tsc) output format
 */
function parseLintErrors(output: string): Array<{ file: string; line: number; message: string }> {
	const violations: Array<{ file: string; line: number; message: string }> = [];
	
	// Simple parser for TypeScript errors (tsc output format)
	const lines = output.split('\n');
	for (const line of lines) {
		const match = line.match(/^(.+\.ts)\((\d+),\d+\): error TS\d+: (.+)$/);
		if (match) {
			violations.push({
				file: match[1],
				line: parseInt(match[2], 10),
				message: match[3]
			});
		}
	}

	return violations;
}

runLinter();
