import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Test suite validating CLI UX enhancements from issue #78
 * Enhanced CLI Error Reporting and User Experience
 */
describe('CLI UX Enhancements E2E', () => {
	const cliPath = path.resolve(__dirname, '..', 'dist', 'cli.js');

	describe('Help text with examples', () => {
		it('execute command should include usage examples', () => {
			const output = execSync(`node ${cliPath} execute --help`, { encoding: 'utf-8' });
			
			expect(output).toContain('Examples:');
			expect(output).toContain('$ lex-pr execute plan.json');
			expect(output).toContain('$ lex-pr execute --dry-run');
			expect(output).toContain('$ lex-pr execute --json > results.json');
			expect(output).toContain('Common Issues:');
			expect(output).toContain('Gates timing out');
		});

		it('merge command should include usage examples', () => {
			const output = execSync(`node ${cliPath} merge --help`, { encoding: 'utf-8' });
			
			expect(output).toContain('Examples:');
			expect(output).toContain('$ lex-pr merge --execute');
			expect(output).toContain('$ lex-pr merge --execute --cleanup');
			expect(output).toContain('Common Issues:');
			expect(output).toContain('Merge conflicts');
		});

		it('discover command should include usage examples', () => {
			const output = execSync(`node ${cliPath} discover --help`, { encoding: 'utf-8' });
			
			expect(output).toContain('Examples:');
			expect(output).toContain('$ lex-pr discover --suggest');
			expect(output).toContain('$ lex-pr discover --json > prs.json');
			expect(output).toContain('Common Issues:');
			expect(output).toContain('Could not detect repository');
		});

		it('plan command should include usage examples', () => {
			const output = execSync(`node ${cliPath} plan --help`, { encoding: 'utf-8' });
			
			expect(output).toContain('Examples:');
			expect(output).toContain('$ lex-pr plan --from-github --json > plan.json');
			expect(output).toContain('$ lex-pr plan --dry-run');
			expect(output).toContain('Common Issues:');
			expect(output).toContain('GitHub API errors');
		});

		it('status command should include usage examples', () => {
			const output = execSync(`node ${cliPath} status --help`, { encoding: 'utf-8' });
			
			expect(output).toContain('Examples:');
			expect(output).toContain('$ lex-pr status plan.json');
			expect(output).toContain('$ lex-pr status --json');
			expect(output).toContain('Common Issues:');
			expect(output).toContain('Plan file not found');
		});
	});

	describe('Exit code consistency', () => {
		it('should return exit code 2 for validation errors', () => {
			let exitCode = 0;
			try {
				execSync(`node ${cliPath} execute --plan /tmp/nonexistent-plan.json`, { 
					encoding: 'utf-8',
					stdio: 'pipe'
				});
			} catch (err: any) {
				exitCode = err.status;
			}
			
			// File not found might be code 1, but invalid schema should be 2
			// Let's test with an actual invalid schema
			const fs = require('fs');
			const tmpFile = '/tmp/invalid-schema-test.json';
			fs.writeFileSync(tmpFile, JSON.stringify({ invalid: 'schema' }));
			
			try {
				execSync(`node ${cliPath} execute --plan ${tmpFile}`, { 
					encoding: 'utf-8',
					stdio: 'pipe'
				});
			} catch (err: any) {
				exitCode = err.status;
			}
			
			expect(exitCode).toBe(2);
		});

		it('should return exit code 0 for successful operations', () => {
			const fs = require('fs');
			const tmpFile = '/tmp/valid-plan-test.json';
			const validPlan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [{ name: 'test', deps: [], gates: [] }],
				policy: {
					requiredGates: [],
					optionalGates: [],
					maxWorkers: 1,
					retries: {},
					overrides: {},
					blockOn: [],
					mergeRule: { type: 'strict-required' }
				}
			};
			fs.writeFileSync(tmpFile, JSON.stringify(validPlan));
			
			let exitCode = -1;
			try {
				execSync(`node ${cliPath} execute --plan ${tmpFile} --dry-run`, { 
					encoding: 'utf-8',
					stdio: 'pipe'
				});
				exitCode = 0;
			} catch (err: any) {
				exitCode = err.status;
			}
			
			expect(exitCode).toBe(0);
		});
	});

	describe('JSON mode consistency', () => {
		it('should produce clean JSON output without progress indicators', () => {
			const fs = require('fs');
			const tmpFile = '/tmp/json-test-plan.json';
			const validPlan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [{ name: 'test', deps: [], gates: [] }],
				policy: {
					requiredGates: [],
					optionalGates: [],
					maxWorkers: 1,
					retries: {},
					overrides: {},
					blockOn: [],
					mergeRule: { type: 'strict-required' }
				}
			};
			fs.writeFileSync(tmpFile, JSON.stringify(validPlan));
			
			const output = execSync(`node ${cliPath} execute --plan ${tmpFile} --dry-run --json`, { 
				encoding: 'utf-8' 
			});
			
			// Should be valid JSON
			const parsed = JSON.parse(output);
			expect(parsed).toBeDefined();
			
			// Should NOT contain progress indicators
			expect(output).not.toContain('⏳');
			expect(output).not.toContain('✅');
			expect(output).not.toContain('Starting');
			expect(output).not.toContain('Completed');
		});
	});

	describe('Error message consistency', () => {
		it('should have consistent error format for validation errors', () => {
			const fs = require('fs');
			const tmpFile = '/tmp/invalid-error-test.json';
			fs.writeFileSync(tmpFile, JSON.stringify({ invalid: 'data' }));
			
			let stderr = '';
			try {
				execSync(`node ${cliPath} execute --plan ${tmpFile}`, { 
					encoding: 'utf-8',
					stdio: 'pipe'
				});
			} catch (err: any) {
				stderr = err.stderr;
			}
			
			// Should contain structured error message
			expect(stderr).toContain('Schema validation failed');
		});
	});
});
