import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { skipIfCliNotBuilt } from './helpers/cli';
import { execSync } from 'child_process';
import { canonicalJSONStringify } from '../src/util/canonicalJson';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CLI JSON Output Tests', () => {
	const testDir = path.join(os.tmpdir(), 'lex-pr-runner-cli-json-test');
	const cliPath = path.resolve(__dirname, '..', 'dist', 'cli.js');

	beforeEach((context) => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		// Don't use process.chdir() - not supported in worker threads

		// Gate tests on CLI build
		if (skipIfCliNotBuilt({ skip: context.skip })) return;
	});

	afterEach(() => {
		// Cleanup
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('schema validate --json', () => {
		it('should output valid JSON for valid plan file', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// Create valid plan.json
			const validPlan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [
					{
						name: 'test-item',
						deps: []
					}
				]
			};
			fs.writeFileSync('plan.json', canonicalJSONStringify(validPlan));

			const output = execSync(`node ${cliPath} schema validate plan.json --json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result).toHaveProperty('valid', true);
		});

		it('should output valid JSON for invalid plan file', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// Create invalid plan.json (missing required fields)
			fs.writeFileSync('plan.json', '{"invalid": "plan"}');

			let output: string;
			try {
				execSync(`node ${cliPath} schema validate plan.json --json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
				throw new Error('Should have failed');
			} catch (error: any) {
				output = error.stdout || error.message;
			}

			// Should still be valid JSON even on error
			const result = JSON.parse(output);
			expect(result).toHaveProperty('valid', false);
			expect(result).toHaveProperty('errors');
			expect(Array.isArray(result.errors)).toBe(true);
		});

		it('should have deterministic key ordering in error output', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			fs.writeFileSync('plan.json', '{"invalid": "plan"}');

			let output1: string, output2: string;
			try {
				execSync(`node ${cliPath} schema validate plan.json --json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			} catch (error: any) {
				output1 = error.stdout || error.message;
			}

			try {
				execSync(`node ${cliPath} schema validate plan.json --json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			} catch (error: any) {
				output2 = error.stdout || error.message;
			}

			expect(output1!).toBe(output2!);
		});
	});

	describe('plan --json', () => {
		it('should output deterministic JSON plan', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// Create minimal config
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: test-item
    branch: feat/test
    deps: []
`);

			const output1 = execSync(`node ${cliPath} plan --json`, { encoding: 'utf8' });
			const output2 = execSync(`node ${cliPath} plan --json`, { encoding: 'utf8' });

			expect(output1).toBe(output2);

			// Verify it's valid JSON with expected structure
			const plan = JSON.parse(output1);
			expect(plan).toHaveProperty('schemaVersion', '1.0.0');
			expect(plan).toHaveProperty('target', 'main');
			expect(plan).toHaveProperty('items');
			expect(Array.isArray(plan.items)).toBe(true);
		});

		it('should handle empty configuration gracefully', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// No config files - should generate empty plan
			const output = execSync(`node ${cliPath} plan --json`, { encoding: 'utf8' });

			const plan = JSON.parse(output);
			expect(plan.schemaVersion).toBe('1.0.0');
			expect(plan.target).toBe('main');
			expect(plan.items).toHaveLength(0);
		});

		it('should use canonical JSON formatting with sorted keys', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: zebra-item
    branch: feat/zebra
    deps: []
  - id: alpha-item
    branch: feat/alpha
    deps: []
`);

			const output = execSync(`node ${cliPath} plan --json`, { encoding: 'utf8' });

			// Verify keys are sorted and formatting is consistent
			expect(output).toMatch(/"items".*"schemaVersion".*"target"/s);
			expect(output.endsWith('\n')).toBe(true);
		});
	});

	describe('merge-order --json', () => {
		beforeEach(() => {
			// Create a plan file for merge-order tests
			const plan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [
					{ name: 'item-a', deps: [] },
					{ name: 'item-b', deps: ['item-a'] },
					{ name: 'item-c', deps: ['item-b'] }
				]
			};
			fs.writeFileSync('plan.json', canonicalJSONStringify(plan));
		});

		it('should output deterministic merge order JSON', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			const output1 = execSync(`node ${cliPath} merge-order plan.json --json`, { encoding: 'utf8' });
			const output2 = execSync(`node ${cliPath} merge-order plan.json --json`, { encoding: 'utf8' });

			expect(output1).toBe(output2);

			const result = JSON.parse(output1);
			expect(result).toHaveProperty('levels');
			expect(Array.isArray(result.levels)).toBe(true);
		});

		it('should have stable ordering in levels', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			const output = execSync(`node ${cliPath} merge-order plan.json --json`, { encoding: 'utf8' });

			const result = JSON.parse(output);
			expect(result.levels).toHaveLength(3);
			expect(result.levels[0]).toEqual(['item-a']);
			expect(result.levels[1]).toEqual(['item-b']);
			expect(result.levels[2]).toEqual(['item-c']);
		});
	});

	describe('status --json', () => {
		beforeEach(() => {
			const plan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [
					{ name: 'test-item', deps: [] }
				]
			};
			fs.writeFileSync('plan.json', canonicalJSONStringify(plan));
		});

		it('should output deterministic status JSON', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			const output1 = execSync(`node ${cliPath} status plan.json --json`, { encoding: 'utf8' });
			const output2 = execSync(`node ${cliPath} status plan.json --json`, { encoding: 'utf8' });

			expect(output1).toBe(output2);

			const result = JSON.parse(output1);
			expect(result).toHaveProperty('plan');
			expect(result).toHaveProperty('mergeSummary');
		});

		it('should use canonical JSON with sorted keys', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			const output = execSync(`node ${cliPath} status plan.json --json`, { encoding: 'utf8' });

			// Verify canonical formatting
			expect(output.endsWith('\n')).toBe(true);
			const result = JSON.parse(output);
			expect(result.plan).toHaveProperty('schemaVersion');
		});
	});

	describe('execute --json', () => {
		beforeEach(() => {
			const plan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [
					{ name: 'test-item', deps: [] }
				]
			};
			fs.writeFileSync('plan.json', canonicalJSONStringify(plan));
		});

		it('should output deterministic execution results in dry-run mode', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			const output1 = execSync(`node ${cliPath} execute plan.json --dry-run --json`, { encoding: 'utf8' });
			const output2 = execSync(`node ${cliPath} execute plan.json --dry-run --json`, { encoding: 'utf8' });

			expect(output1).toBe(output2);

			const result = JSON.parse(output1);
			expect(result).toHaveProperty('dryRun', true);
			expect(result).toHaveProperty('plan');
			expect(result).toHaveProperty('execution');
			expect(result.execution).toHaveProperty('levels');
		});

		it('should handle errors gracefully without crashing', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// Create plan file that will fail during loading
			fs.writeFileSync('malformed.json', 'not valid json at all');

			// Should not crash, regardless of exit code
			try {
				execSync(`node ${cliPath} execute malformed.json --json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			} catch (error: any) {
				// Error is expected, just ensure we don't crash
				expect(error.status).toBeGreaterThan(0);
			}
		});
	});

	describe('Exit codes and error handling', () => {
		it('should use correct exit codes for different error types', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// Schema validation error (exit 2)
			fs.writeFileSync('invalid.json', '{"invalid": true}');

			try {
				execSync(`node ${cliPath} schema validate invalid.json --json`, { stdio: 'pipe' });
				throw new Error('Should have failed');
			} catch (error: any) {
				expect(error.status).toBe(1); // Schema validation error
			}
		});

		it('should handle missing files gracefully with JSON output', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			try {
				execSync(`node ${cliPath} schema validate nonexistent.json --json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
				throw new Error('Should have failed');
			} catch (error: any) {
				const output = error.stdout || error.stderr;
				// Should still attempt JSON output for errors
				expect(output).toBeTruthy();
			}
		});
	});

	describe('Weave Reporting & Matrix Generation (Planned)', () => {
		/**
		 * Test stubs for matrix generation and weave reporting
		 * See: docs/cli-mcp-weave-reporting.md
		 * Related: Epic #76 (Developer Experience), Issue #40
		 */

		it.skip('should generate integration matrix from plan', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Implement matrix.generate CLI command
			// Expected usage: npm run cli -- matrix --from-plan plan.json
			// Expected output shape: { schemaVersion, generated, plan, execution, policy }

			const validPlan = {
				schemaVersion: '1.0.0',
				target: 'main',
				items: [
					{ name: 'item-1', deps: [], gates: [{ name: 'lint', run: 'npm run lint', env: {} }] },
					{ name: 'item-2', deps: ['item-1'], gates: [{ name: 'test', run: 'npm test', env: {} }] }
				]
			};
			fs.writeFileSync('plan.json', canonicalJSONStringify(validPlan));

			// const output = execSync(`node ${cliPath} matrix --from-plan plan.json --json`, {
			// 	encoding: 'utf8'
			// });
			// const matrix = JSON.parse(output);
			// expect(matrix).toHaveProperty('execution.levels');
			// expect(matrix.execution.levels).toHaveLength(2);
			// expect(matrix.execution.levels[0].items).toEqual(['item-1']);
			// expect(matrix.execution.levels[1].items).toEqual(['item-2']);
		});

		it.skip('should include gate commands in matrix output', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Matrix should include all gate definitions with commands
			// Expected: matrix.execution.gates[] with { item, gate, command, timeout, env }
		});

		it.skip('should mark parallel levels correctly in matrix', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Detect when items can run in parallel (no dependencies between them)
			// Expected: matrix.execution.levels[n].parallel = true/false
		});

		it.skip('should produce deterministic matrix output', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Ensure matrix generation is deterministic
			// Multiple runs with same plan should produce identical byte output
		});

		it.skip('should include policy configuration in matrix', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Include retry configs, max workers, etc. from plan policy
			// Expected: matrix.policy = { maxWorkers, retryConfigs }
		});

		it.skip('should support matrix filtering by item', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Add --items flag to filter matrix to specific items
			// Expected: npm run cli -- matrix --from-plan plan.json --items item-1,item-2
		});

		it.skip('should support matrix filtering by gate', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Add --gates flag to filter matrix to specific gate types
			// Expected: npm run cli -- matrix --from-plan plan.json --gates lint,type
		});

		it.skip('should generate workflow templates from matrix', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Generate CI/CD workflow definitions from matrix
			// Expected: npm run cli -- matrix --from-plan plan.json --format github-actions
			// Expected: npm run cli -- matrix --from-plan plan.json --format gitlab-ci
		});

		it.skip('should include timing predictions in matrix', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			// TODO: Add historical timing data for gates
			// Expected: matrix.execution.gates[].estimatedDuration based on history
		});
	});
});