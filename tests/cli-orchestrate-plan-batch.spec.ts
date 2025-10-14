/**
 * CLI Integration Tests for orchestrate:plan-batch command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import * as fs from 'fs';
import * as path from 'path';

const cliPath = path.join(process.cwd(), 'dist/cli.js');

function skipIfCliNotBuilt(ctx: { skip?: () => void }): boolean {
	if (!fs.existsSync(cliPath)) {
		ctx.skip?.();
		return true;
	}
	return false;
}

describe('CLI - orchestrate:plan-batch', () => {
	let tmpDir: string;
	let inputFile: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'batch-planner-test-'));
		inputFile = path.join(tmpDir, 'issues.json');
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	describe('Help and basic usage', () => {
		it('should show help message', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const output = execSync(`node ${cliPath} orchestrate:plan-batch --help`, { encoding: 'utf8' });
			
			expect(output).toContain('Generate batch plan using Kahn\'s algorithm');
			expect(output).toContain('--issues <numbers>');
			expect(output).toContain('--input <file>');
			expect(output).toContain('--json');
		});

		it('should error when no input provided', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			expect(() => {
				execSync(`node ${cliPath} orchestrate:plan-batch`, { encoding: 'utf8', stdio: 'pipe' });
			}).toThrow();
		});
	});

	describe('Explicit issues list', () => {
		it('should handle simple issue list', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const output = execSync(`node ${cliPath} orchestrate:plan-batch --issues 1,2,3`, { 
				encoding: 'utf8' 
			});

			expect(output).toContain('Batch Plan (Kahn\'s Algorithm)');
			expect(output).toContain('Batch 1 (layer 0)');
			expect(output).toContain('#1');
			expect(output).toContain('#2');
			expect(output).toContain('#3');
		});

		it('should output JSON with --json flag', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const output = execSync(`node ${cliPath} orchestrate:plan-batch --issues 1,2,3 --json`, { 
				encoding: 'utf8' 
			});

			const result = JSON.parse(output);
			
			expect(result).toHaveProperty('planVersion', '1.0.0');
			expect(result).toHaveProperty('algorithm', 'kahn_topological_sort');
			expect(result).toHaveProperty('deterministic', true);
			expect(result).toHaveProperty('planHash');
			expect(result).toHaveProperty('batches');
			expect(result.batches).toHaveLength(1);
			expect(result.batches[0].items).toHaveLength(3);
		});

		it('should work with global --json flag', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const output = execSync(`node ${cliPath} --json orchestrate:plan-batch --issues 1,2,3`, { 
				encoding: 'utf8' 
			});

			const result = JSON.parse(output);
			
			expect(result).toHaveProperty('planVersion');
			expect(result).toHaveProperty('batches');
		});
	});

	describe('Input file processing', () => {
		it('should handle direct array input', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const input = [
				{
					id: '156',
					type: 'issue',
					dependencies: [],
					metadata: {
						score: 1.2,
						createdAt: '2025-10-13T00:56:27Z',
						issueNumber: 156
					}
				},
				{
					id: '160',
					type: 'issue',
					dependencies: [],
					metadata: {
						score: 0.8,
						createdAt: '2025-10-13T00:56:37Z',
						issueNumber: 160
					}
				}
			];

			fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));

			const output = execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile} --json`, { 
				encoding: 'utf8' 
			});

			const result = JSON.parse(output);
			
			expect(result.batches).toHaveLength(1);
			expect(result.batches[0].items).toHaveLength(2);
			
			// Check ordering: 160 (score 0.8) before 156 (score 1.2)
			expect(result.batches[0].items[0].id).toBe('160');
			expect(result.batches[0].items[1].id).toBe('156');
		});

		it('should handle wrapped input (nodes key)', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const input = {
				nodes: [
					{
						id: '1',
						type: 'issue',
						dependencies: [],
						metadata: {
							score: 1.0,
							createdAt: '2025-10-13T00:00:00Z',
							issueNumber: 1
						}
					}
				]
			};

			fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));

			const output = execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile} --json`, { 
				encoding: 'utf8' 
			});

			const result = JSON.parse(output);
			expect(result.batches[0].items).toHaveLength(1);
		});

		it('should handle dependencies correctly', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const input = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				},
				{
					id: 'C',
					type: 'issue',
					dependencies: ['B'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:02:00Z', issueNumber: 3 }
				}
			];

			fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));

			const output = execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile} --json`, { 
				encoding: 'utf8' 
			});

			const result = JSON.parse(output);
			
			expect(result.batches).toHaveLength(3);
			expect(result.batches[0].layer).toBe(0);
			expect(result.batches[0].items[0].id).toBe('A');
			expect(result.batches[1].layer).toBe(1);
			expect(result.batches[1].items[0].id).toBe('B');
			expect(result.batches[2].layer).toBe(2);
			expect(result.batches[2].items[0].id).toBe('C');
		});
	});

	describe('Error handling', () => {
		it('should detect cycles and exit with code 2', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const input = [
				{
					id: 'A',
					type: 'issue',
					dependencies: ['B'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				}
			];

			fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));

			try {
				execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile}`, { 
					encoding: 'utf8',
					stdio: 'pipe'
				});
				expect.fail('Should have thrown an error');
			} catch (error: any) {
				expect(error.status).toBe(2);
				expect(error.stderr.toString()).toContain('Cycle detected');
			}
		});

		it('should detect unknown dependencies and exit with code 2', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const input = [
				{
					id: 'A',
					type: 'issue',
					dependencies: ['NonExistent'],
					metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				}
			];

			fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));

			try {
				execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile}`, { 
					encoding: 'utf8',
					stdio: 'pipe'
				});
				expect.fail('Should have thrown an error');
			} catch (error: any) {
				expect(error.status).toBe(2);
				expect(error.stderr.toString()).toContain('Unknown dependency');
			}
		});
	});

	describe('Determinism', () => {
		it('should produce same hash for same input', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const input = [
				{
					id: 'A',
					type: 'issue',
					dependencies: [],
					metadata: { score: 1.2, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
				},
				{
					id: 'B',
					type: 'issue',
					dependencies: ['A'],
					metadata: { score: 0.5, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
				}
			];

			fs.writeFileSync(inputFile, JSON.stringify(input, null, 2));

			const output1 = execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile} --json`, { 
				encoding: 'utf8' 
			});
			const output2 = execSync(`node ${cliPath} orchestrate:plan-batch --input ${inputFile} --json`, { 
				encoding: 'utf8' 
			});

			const result1 = JSON.parse(output1);
			const result2 = JSON.parse(output2);

			expect(result1.planHash).toBe(result2.planHash);
			expect(result1).toEqual(result2);
		});
	});
});
