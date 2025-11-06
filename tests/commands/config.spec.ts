/**
 * Tests for the config command module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerConfigCommand } from '../../src/commands/config.js';
import { skipIfCliNotBuilt } from '../helpers/cli.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Config Command', () => {
	let program: Command;

	beforeEach(() => {
		// Create fresh Command instance for each test
		program = new Command();
	});

	it('should register config command with show subcommand', () => {
		registerConfigCommand(program, { jsonModeActive: () => false });
		
		const configCommand = program.commands.find(cmd => cmd.name() === 'config');
		expect(configCommand).toBeDefined();
		expect(configCommand?.description()).toBe('Configuration inspection and debugging');
		
		// Check that show subcommand exists
		const showCommand = configCommand?.commands.find(cmd => cmd.name() === 'show');
		expect(showCommand).toBeDefined();
		expect(showCommand?.description()).toBe('Display configuration with precedence chain');
	});

	it('should have correct options on show subcommand', () => {
		registerConfigCommand(program, { jsonModeActive: () => false });
		
		const configCommand = program.commands.find(cmd => cmd.name() === 'config');
		const showCommand = configCommand?.commands.find(cmd => cmd.name() === 'show');
		
		expect(showCommand).toBeDefined();
		
		const options = showCommand?.options || [];
		const optionNames = options.map(opt => opt.long);
		expect(optionNames).toContain('--json');
		expect(optionNames).toContain('--key');
	});

	it('should register with program successfully', () => {
		const initialCommandCount = program.commands.length;
		registerConfigCommand(program, { jsonModeActive: () => false });
		
		expect(program.commands.length).toBe(initialCommandCount + 1);
		expect(program.commands.some(cmd => cmd.name() === 'config')).toBe(true);
	});
});

describe('config show command (CLI integration)', () => {
	const testDir = path.join(os.tmpdir(), 'lex-pr-runner-config-test');
	const cliPath = path.resolve(__dirname, '../..', 'dist', 'cli.js');
	const originalCwd = process.cwd();

	beforeEach(() => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);
		
		// Create minimal .smartergpt profile
		fs.mkdirSync('.smartergpt', { recursive: true });
		fs.writeFileSync('.smartergpt/scope.yml', 'version: 1\ntarget: main\n');
	});

	afterEach(() => {
		// Cleanup
		process.chdir(originalCwd);
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it('should display configuration with precedence chain', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		const output = execSync(`node ${cliPath} config show`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		expect(output).toContain('Configuration Precedence:');
		expect(output).toContain('Resolved Configuration:');
		expect(output).toContain('.smartergpt/');
		expect(output).toContain('built-in defaults');
	});

	it('should output JSON format with --json flag', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		const output = execSync(`node ${cliPath} config show --json`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		const result = JSON.parse(output);
		expect(result).toHaveProperty('precedenceChain');
		expect(result).toHaveProperty('configuration');
		expect(Array.isArray(result.precedenceChain)).toBe(true);
		expect(Array.isArray(result.configuration)).toBe(true);
	});

	it('should filter by specific key', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		const output = execSync(`node ${cliPath} config show --key scope.target`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		expect(output).toContain('scope.target');
		expect(output).toContain('"main"');
		expect(output).toContain('Source:');
	});

	it('should output JSON for specific key with --json', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		const output = execSync(`node ${cliPath} config show --key scope.target --json`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		const result = JSON.parse(output);
		expect(result).toHaveProperty('key', 'scope.target');
		expect(result).toHaveProperty('value');
		expect(result).toHaveProperty('source');
		expect(result).toHaveProperty('precedence');
		expect(Array.isArray(result.precedence)).toBe(true);
	});

	it('should show override information when local overlay exists', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		// Create local overlay with different target
		fs.mkdirSync('.smartergpt.local', { recursive: true });
		fs.writeFileSync('.smartergpt.local/scope.yml', 'version: 1\ntarget: develop\n');

		const output = execSync(`node ${cliPath} config show --key scope.target`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		expect(output).toContain('scope.target');
		expect(output).toContain('"develop"');
		expect(output).toContain('Original:');
		expect(output).toContain('"main"');
		expect(output).toContain('.smartergpt.local/');
		expect(output).toContain('.smartergpt/');
	});

	it('should show override in JSON format', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		// Create local overlay with different target
		fs.mkdirSync('.smartergpt.local', { recursive: true });
		fs.writeFileSync('.smartergpt.local/scope.yml', 'version: 1\ntarget: develop\n');

		const output = execSync(`node ${cliPath} config show --key scope.target --json`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		const result = JSON.parse(output);
		expect(result.key).toBe('scope.target');
		expect(result.value).toBe('develop');
		expect(result.source).toContain('.smartergpt.local/');
		expect(result).toHaveProperty('overrides');
		expect(result.overrides.value).toBe('main');
		expect(result.overrides.source).toContain('.smartergpt/');
	});

	it('should include precedence chain in JSON output', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		const output = execSync(`node ${cliPath} config show --key scope.target --json`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		const result = JSON.parse(output);
		expect(result.precedence).toBeDefined();
		expect(Array.isArray(result.precedence)).toBe(true);
		
		const levels = result.precedence.map((p: any) => p.level);
		expect(levels).toContain('env');
		expect(levels).toContain('workspace');
	});

	it('should display multiple config files', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		// Add gates.yml
		fs.writeFileSync('.smartergpt/gates.yml', 
			'version: 1\nlevels:\n  default:\n    - name: lint\n      run: npm run lint\n');

		const output = execSync(`node ${cliPath} config show --json`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		const result = JSON.parse(output);
		const keys = result.configuration.map((c: any) => c.key);
		
		expect(keys).toContain('scope.target');
		expect(keys).toContain('gates.version');
		expect(keys.some((k: string) => k.startsWith('gates.levels'))).toBe(true);
	});

	it('should handle non-existent key gracefully', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		try {
			execSync(`node ${cliPath} config show --key nonexistent.key`, {
				encoding: 'utf-8',
				cwd: testDir,
				stdio: 'pipe'
			});
			// Should not reach here
			expect(true).toBe(false);
		} catch (error: any) {
			// Error message goes to stdout
			const output = error.stdout?.toString() || error.stderr?.toString() || '';
			expect(output).toContain('nonexistent.key');
			expect(output).toContain('Available keys:');
			expect(error.status).toBeGreaterThan(0);
		}
	});

	it('should handle environment variable LEX_PR_PROFILE_DIR', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		// Create custom profile directory
		const customProfileDir = path.join(testDir, 'custom-profile');
		fs.mkdirSync(customProfileDir, { recursive: true });
		fs.writeFileSync(path.join(customProfileDir, 'scope.yml'), 
			'version: 1\ntarget: production\n');

		const output = execSync(`node ${cliPath} config show --key scope.target --json`, {
			encoding: 'utf-8',
			cwd: testDir,
			env: { 
				...process.env, 
				LEX_PR_PROFILE_DIR: customProfileDir 
			}
		});

		const result = JSON.parse(output);
		expect(result.value).toBe('production');
		expect(result.source).toContain('scope.yml');
		
		// Check precedence includes env
		const envLevel = result.precedence.find((p: any) => p.level === 'env');
		expect(envLevel).toBeDefined();
	});

	it('should show all configuration values by default', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		const output = execSync(`node ${cliPath} config show`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		// Should contain multiple configuration keys
		expect(output).toContain('scope.target');
		expect(output).toContain('scope.version');
		expect(output).toContain('defaults.strategy');
		expect(output).toContain('pin_commits');
	});

	it('should handle complex nested configurations', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

		// Create a complex gates.yml
		fs.writeFileSync('.smartergpt/gates.yml', `version: 1
levels:
  default:
    - name: lint
      run: npm run lint
    - name: test
      run: npm test
`);

		const output = execSync(`node ${cliPath} config show --json`, {
			encoding: 'utf-8',
			cwd: testDir
		});

		const result = JSON.parse(output);
		const gatesConfig = result.configuration.find((c: any) => 
			c.key === 'gates.levels.default'
		);
		
		expect(gatesConfig).toBeDefined();
		expect(Array.isArray(gatesConfig.value)).toBe(true);
		expect(gatesConfig.value.length).toBe(2);
	});
});
