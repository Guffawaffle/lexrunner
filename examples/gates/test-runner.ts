#!/usr/bin/env node
/**
 * Example test runner gate using Audit SDK
 * 
 * Usage: node test-runner.js
 */

import { initAuditSDK } from '../../src/audit/sdk/index.js';
import { execSync } from 'child_process';

const audit = initAuditSDK('test');

async function runTests() {
	try {
		await audit.emit('test_run_start', {
			suite: 'all-tests',
			framework: 'vitest',
			timestamp: new Date().toISOString()
		});

		const startTime = Date.now();

		try {
			// Run tests with JSON reporter
			const output = execSync('npm run test -- --reporter=json', {
				encoding: 'utf-8',
				stdio: 'pipe'
			});

			const duration = Date.now() - startTime;

			// Parse test results
			let results: any = {};
			try {
				results = JSON.parse(output);
			} catch {
				// If JSON parsing fails, try to extract basic stats
				const passMatch = output.match(/(\d+) passed/);
				const failMatch = output.match(/(\d+) failed/);
				
				results = {
					passed: passMatch ? parseInt(passMatch[1], 10) : 0,
					failed: failMatch ? parseInt(failMatch[1], 10) : 0,
					tests: []
				};
			}

			// Emit individual test results if available
			if (results.tests && Array.isArray(results.tests)) {
				for (const test of results.tests) {
					await audit.emitTestResult(
						test.name || test.fullName || 'unnamed-test',
						test.status || (test.passed ? 'pass' : 'fail'),
						test.duration
					);
				}
			}

			await audit.emit('test_run_complete', {
				passed: results.passed || 0,
				failed: results.failed || 0,
				skipped: results.skipped || 0,
				total: (results.passed || 0) + (results.failed || 0) + (results.skipped || 0),
				duration_ms: duration
			});

			if (results.failed > 0) {
				console.log(`Tests failed: ${results.failed} failures`);
				process.exit(1);
			} else {
				console.log(`All tests passed: ${results.passed} tests`);
				process.exit(0);
			}
		} catch (error: any) {
			const duration = Date.now() - startTime;

			// Try to extract test stats from error output
			const output = error.stdout || error.stderr || '';
			const failMatch = output.match(/(\d+) failed/);
			const passMatch = output.match(/(\d+) passed/);

			await audit.emit('test_run_failed', {
				passed: passMatch ? parseInt(passMatch[1], 10) : 0,
				failed: failMatch ? parseInt(failMatch[1], 10) : 1,
				duration_ms: duration,
				error: error.message
			}, 'error');

			console.error('Tests failed');
			process.exit(1);
		}
	} catch (error) {
		await audit.emit('test_error', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined
		}, 'error');

		console.error('Test execution failed:', error);
		process.exit(2);
	} finally {
		await audit.close();
	}
}

runTests();
