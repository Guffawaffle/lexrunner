import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { skipIfCliNotBuilt } from '../helpers/cli';
import { execSync } from 'child_process';
import { canonicalJSONStringify } from '../../src/util/canonicalJson';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Query Command Tests', () => {
	const testDir = path.join(os.tmpdir(), 'lexrunner-query-test');
	const cliPath = path.resolve(__dirname, '../..', 'dist', 'cli.js');

	const samplePlan = {
		schemaVersion: '1.0.0',
		target: 'main',
		items: [
			{
				name: 'feature-a',
				deps: [],
				gates: [
					{ name: 'lint', run: 'echo lint', env: {} },
					{ name: 'test', run: 'echo test', env: {} }
				]
			},
			{
				name: 'feature-b',
				deps: ['feature-a'],
				gates: [{ name: 'lint', run: 'echo lint', env: {} }]
			},
			{
				name: 'feature-c',
				deps: ['feature-a', 'feature-b'],
				gates: [
					{ name: 'lint', run: 'echo lint', env: {} },
					{ name: 'test', run: 'echo test', env: {} },
					{ name: 'e2e', run: 'echo e2e', env: {} }
				]
			},
			{
				name: 'integration-feature',
				deps: ['feature-c'],
				gates: []
			}
		]
	};

	beforeEach((context) => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);

		// Create sample plan.json
		fs.writeFileSync('plan.json', canonicalJSONStringify(samplePlan));

		// Gate tests on CLI build
		if (skipIfCliNotBuilt({ skip: context.skip })) return;
	});

	afterEach(() => {
		// Cleanup
		process.chdir('/');
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('query with --stats', () => {
		it('should show plan statistics in table format', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --stats`, {
				encoding: 'utf8'
			});

			expect(output).toContain('Plan Statistics');
			expect(output).toContain('Total Items: 4');
			expect(output).toContain('Total Levels: 4');
			expect(output).toContain('Root Nodes: 1');
			expect(output).toContain('Leaf Nodes: 1');
		});

		it('should output JSON with --format json', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --stats --format json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result).toHaveProperty('stats');
			expect(result.stats.totalItems).toBe(4);
			expect(result.stats.totalLevels).toBe(4);
			expect(result.stats.rootNodes).toBe(1);
			expect(result.stats.leafNodes).toBe(1);
		});
	});

	describe('query with --roots', () => {
		it('should show root nodes', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --roots`, {
				encoding: 'utf8'
			});

			expect(output).toContain('feature-a');
			expect(output).toContain('Results: 1');
		});

		it('should output JSON with --format json', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --roots --format json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result.count).toBe(1);
			expect(result.items[0].name).toBe('feature-a');
		});
	});

	describe('query with --leaves', () => {
		it('should show leaf nodes', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --leaves`, {
				encoding: 'utf8'
			});

			expect(output).toContain('integration-feature');
			expect(output).toContain('Results: 1');
		});

		it('should output JSON with --format json', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --leaves --format json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result.count).toBe(1);
			expect(result.items[0].name).toBe('integration-feature');
		});
	});

	describe('query with --level', () => {
		it('should filter by level', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --level 1`, {
				encoding: 'utf8'
			});

			expect(output).toContain('feature-a');
			expect(output).toContain('Results: 1');
		});

		it('should output JSON with --format json', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json --level 2 --format json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result.count).toBe(1);
			expect(result.items[0].name).toBe('feature-b');
		});
	});

	describe('query with query string', () => {
		it('should filter by name contains', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json "name contains feature"`, {
				encoding: 'utf8'
			});

			expect(output).toContain('Results: 4');
		});

		it('should filter by gate count', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json "gatesCount eq 0" --format json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result.count).toBe(1);
			expect(result.items[0].name).toBe('integration-feature');
		});

		it('should support AND operator', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query plan.json "level eq 2 AND gatesCount eq 1" --format json`, {
				encoding: 'utf8'
			});

			const result = JSON.parse(output);
			expect(result.count).toBe(1);
			expect(result.items[0].name).toBe('feature-b');
		});
	});

	describe('query with --output', () => {
		it('should write results to file', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const outputFile = path.join(testDir, 'results.txt');
			const output = execSync(`node ${cliPath} query plan.json --stats --output ${outputFile}`, {
				encoding: 'utf8'
			});

			expect(output).toContain(`✓ Results written to ${outputFile}`);
			expect(fs.existsSync(outputFile)).toBe(true);
			
			const content = fs.readFileSync(outputFile, 'utf8');
			expect(content).toContain('Plan Statistics');
		});

		it('should write JSON to file', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const outputFile = path.join(testDir, 'results.json');
			execSync(`node ${cliPath} query plan.json --roots --format json --output ${outputFile}`, {
				encoding: 'utf8'
			});

			expect(fs.existsSync(outputFile)).toBe(true);
			
			const content = fs.readFileSync(outputFile, 'utf8');
			const result = JSON.parse(content);
			expect(result.count).toBe(1);
		});
	});

	describe('error handling', () => {
		it('should error when plan file is missing', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			expect(() => {
				execSync(`node ${cliPath} query missing.json --stats`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			}).toThrow();
		});

		it('should error when no query or option provided', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			expect(() => {
				execSync(`node ${cliPath} query plan.json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			}).toThrow();
		});

		it('should error when plan file argument is missing', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			expect(() => {
				execSync(`node ${cliPath} query --stats`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			}).toThrow();
		});
	});

	describe('--plan option', () => {
		it('should accept plan via --plan option', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
			
			const output = execSync(`node ${cliPath} query --plan plan.json --stats`, {
				encoding: 'utf8'
			});

			expect(output).toContain('Plan Statistics');
			expect(output).toContain('Total Items: 4');
		});
	});
});
