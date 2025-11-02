import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSchemaCommand } from '../../src/commands/schema.js';
import { skipIfCliNotBuilt } from '../helpers/cli.js';
import { execSync } from 'child_process';
import { canonicalJSONStringify } from '../../src/util/canonicalJson.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Schema Command Module', () => {
	const testDir = path.join(os.tmpdir(), 'lex-pr-runner-schema-test');
	const cliPath = path.resolve(__dirname, '../..', 'dist', 'cli.js');
	const originalCwd = process.cwd();

	beforeEach(() => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);
	});

	afterEach(() => {
		// Cleanup
		process.chdir(originalCwd);
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('registerSchemaCommand', () => {
		it('should register schema command with validate subcommand', () => {
			const program = new Command();
			let jsonModeValue = false;

			registerSchemaCommand(program, {
				jsonModeActive: () => jsonModeValue
			});

			const schemaCommand = program.commands.find(cmd => cmd.name() === 'schema');
			expect(schemaCommand).toBeDefined();
			expect(schemaCommand?.description()).toBe('Schema utilities (validate plan.json)');

			// Check that validate subcommand exists
			const validateCommand = schemaCommand?.commands.find(cmd => cmd.name() === 'validate');
			expect(validateCommand).toBeDefined();
			expect(validateCommand?.description()).toBe('Validate a plan file against schema');
		});

		it('should have correct options on validate subcommand', () => {
			const program = new Command();

			registerSchemaCommand(program, {
				jsonModeActive: () => false
			});

			const schemaCommand = program.commands.find(cmd => cmd.name() === 'schema');
			const validateCommand = schemaCommand?.commands.find(cmd => cmd.name() === 'validate');

			expect(validateCommand).toBeDefined();

			const options = validateCommand?.options || [];
			const optionNames = options.map(opt => opt.long);
			expect(optionNames).toContain('--json');
			expect(optionNames).toContain('--verbose');
		});
	});

	describe('schema validate command (CLI integration)', () => {
		it('should validate a valid plan file', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

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

		it('should detect invalid plan file', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

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

			const result = JSON.parse(output);
			expect(result).toHaveProperty('valid', false);
			expect(result).toHaveProperty('errors');
			expect(Array.isArray(result.errors)).toBe(true);
		});

		it('should handle missing file gracefully', (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			let output: string;
			try {
				execSync(`node ${cliPath} schema validate nonexistent.json --json`, {
					encoding: 'utf8',
					stdio: 'pipe'
				});
				throw new Error('Should have failed');
			} catch (error: any) {
				output = error.stdout || error.message;
			}

			const result = JSON.parse(output);
			expect(result).toHaveProperty('valid', false);
			expect(result.errors).toEqual([{ path: 'root', message: 'File not found' }]);
		});
	});
});
