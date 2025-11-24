/**
 * Tests for orchestrate:pin-toolchain CLI command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { skipIfCliNotBuilt } from './helpers/cli';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CLI orchestrate:pin-toolchain', () => {
	const testDir = path.join(os.tmpdir(), `lex-pr-orchestrate-test-${Date.now()}`);
	const cliPath = path.resolve(__dirname, '..', 'dist', 'cli.js');

	beforeEach((context) => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		// Don't use process.chdir() - not supported in worker threads

		// Central CLI build gate
		if (skipIfCliNotBuilt({ skip: context.skip })) return;
	});

	afterEach(() => {
		// Cleanup
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('Human-readable output', () => {
		it('should show verification results in human-readable format', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Create .tool-versions with current versions to ensure pass
			const nodeVersion = process.version.slice(1); // Remove 'v' prefix
			fs.writeFileSync('.tool-versions', `node ${nodeVersion}\n`);

			const output = execSync(`node ${cliPath} orchestrate pin-toolchain --verify`, {
				encoding: 'utf8'
			});

			expect(output).toContain('🔧 Toolchain Version Verification');
			expect(output).toContain('node');
		});

		it('should show mismatch when versions do not match', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Create .tool-versions with impossible version
			fs.writeFileSync('.tool-versions', 'node 1.0.0\n');

			try {
				execSync(`node ${cliPath} orchestrate pin-toolchain --verify`, {
					encoding: 'utf8'
				});
				// Should not reach here
				expect(true).toBe(false);
			} catch (error: any) {
				expect(error.status).toBe(1);
				expect(error.stdout).toContain('[MISMATCH]');
				expect(error.stdout).toContain('Some toolchain versions do not match');
			}
		});
	});

	describe('JSON output', () => {
		it('should output JSON with --json flag', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const nodeVersion = process.version.slice(1);
			fs.writeFileSync('.tool-versions', `node ${nodeVersion}\n`);

			const output = execSync(`node ${cliPath} --json orchestrate pin-toolchain --verify`, {
				encoding: 'utf8'
			});

			// Parse the entire output as JSON (it should be a single JSON object)
			const json = JSON.parse(output.trim());

			expect(json).toHaveProperty('allMatch');
			expect(json).toHaveProperty('tools');
			expect(Array.isArray(json.tools)).toBe(true);
			expect(json.tools.length).toBeGreaterThan(0);

			const nodeResult = json.tools.find((t: any) => t.name === 'node');
			expect(nodeResult).toBeDefined();
			expect(nodeResult.version).toBe(nodeVersion);
			expect(nodeResult.pinned).toBe(nodeVersion);
			expect(nodeResult.matches).toBe(true);
		});

		it('should return allMatch: false when versions mismatch', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			fs.writeFileSync('.tool-versions', 'node 1.0.0\n');

			try {
				execSync(`node ${cliPath} --json orchestrate pin-toolchain --verify`, {
					encoding: 'utf8'
				});
				expect(true).toBe(false);
			} catch (error: any) {
				// Output contains main JSON + error JSON separated by newline
				const outputs = error.stdout.trim().split('\n}\n');
				const json = JSON.parse(outputs[0] + '}');

				expect(json.allMatch).toBe(false);
				
				const nodeResult = json.tools.find((t: any) => t.name === 'node');
				expect(nodeResult.matches).toBe(false);
				expect(nodeResult.pinned).toBe('1.0.0');
			}
		});
	});

	describe('.tool-versions parsing', () => {
		it('should read multiple tools from .tool-versions', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			fs.writeFileSync('.tool-versions', `
git 2.45.2
node 20.18.0
npm 10.8.2
`);

			try {
				execSync(`node ${cliPath} --json orchestrate pin-toolchain --verify`, {
					encoding: 'utf8'
				});
			} catch (error: any) {
				// Parse main JSON (before error JSON)
				const outputs = error.stdout.trim().split('\n}\n');
				const json = JSON.parse(outputs[0] + '}');

				const gitResult = json.tools.find((t: any) => t.name === 'git');
				const nodeResult = json.tools.find((t: any) => t.name === 'node');
				const npmResult = json.tools.find((t: any) => t.name === 'npm');

				expect(gitResult.pinned).toBe('2.45.2');
				expect(nodeResult.pinned).toBe('20.18.0');
				expect(npmResult.pinned).toBe('10.8.2');
			}
		});

		it('should ignore comments in .tool-versions', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const nodeVersion = process.version.slice(1);
			fs.writeFileSync('.tool-versions', `
# This is a comment
node ${nodeVersion}
# Another comment
`);

			const output = execSync(`node ${cliPath} --json orchestrate pin-toolchain --verify`, {
				encoding: 'utf8'
			});

			// Parse the entire output as JSON
			const json = JSON.parse(output.trim());

			const nodeResult = json.tools.find((t: any) => t.name === 'node');
			expect(nodeResult.pinned).toBe(nodeVersion);
		});
	});

	describe('.nvmrc integration', () => {
		it('should read node version from .nvmrc', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const nodeVersion = '16.20.0';
			fs.writeFileSync('.nvmrc', `${nodeVersion}\n`);

			try {
				execSync(`node ${cliPath} --json orchestrate pin-toolchain --verify`, {
					encoding: 'utf8'
				});
			} catch (error: any) {
				// Parse main JSON (before error JSON)
				const outputs = error.stdout.trim().split('\n}\n');
				const json = JSON.parse(outputs[0] + '}');

				const nodeResult = json.tools.find((t: any) => t.name === 'node');
				expect(nodeResult.pinned).toBe(nodeVersion);
			}
		});
	});

	describe('Exit codes', () => {
		it('should exit with 0 when all versions match', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const nodeVersion = process.version.slice(1);
			fs.writeFileSync('.tool-versions', `node ${nodeVersion}\n`);

			const result = execSync(`node ${cliPath} orchestrate pin-toolchain --verify`, {
				encoding: 'utf8'
			});

			// No exception means exit code 0
			expect(result).toBeDefined();
		});

		it('should exit with 1 when versions mismatch', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			fs.writeFileSync('.tool-versions', 'node 1.0.0\n');

			try {
				execSync(`node ${cliPath} orchestrate pin-toolchain --verify`, {
					encoding: 'utf8'
				});
				expect(true).toBe(false); // Should not reach here
			} catch (error: any) {
				expect(error.status).toBe(1);
			}
		});
	});
});
