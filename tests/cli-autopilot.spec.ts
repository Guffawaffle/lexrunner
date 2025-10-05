/**
 * CLI integration tests for autopilot command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CLI autopilot command', () => {
	let testDir: string;
	let planFile: string;

	beforeEach(() => {
		testDir = path.join(os.tmpdir(), `lex-pr-runner-cli-autopilot-${Date.now()}`);
		fs.mkdirSync(testDir, { recursive: true });

		// Create test plan
		const plan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{
					name: "item-1",
					deps: [],
					gates: [
						{ name: "lint", run: "npm run lint", env: {} }
					]
				},
				{
					name: "item-2",
					deps: ["item-1"],
					gates: [
						{ name: "test", run: "npm test", env: {} }
					]
				}
			]
		};

		planFile = path.join(testDir, 'test-plan.json');
		fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));

		// Create profile directory
		const profileDir = path.join(testDir, 'profile');
		fs.mkdirSync(profileDir, { recursive: true });
		fs.writeFileSync(path.join(profileDir, 'profile.yml'), 'role: local\n');
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it('should run level 0 autopilot successfully', () => {
		const output = execSync(
			`npm run cli -- autopilot ${planFile} --level 0`,
			{ encoding: 'utf-8', cwd: process.cwd() }
		);

		expect(output).toContain('🔍 Merge-Weave Analysis (Level 0: Report Only)');
		expect(output).toContain('2 items in dependency graph');
		expect(output).toContain('🔀 Merge Order:');
		expect(output).toContain('🎯 Recommendations:');
	});

	it('should run level 0 autopilot with JSON output', () => {
		const output = execSync(
			`npm run cli -- autopilot ${planFile} --level 0 --json 2>/dev/null`,
			{ encoding: 'utf-8', cwd: process.cwd() }
		);

		// Extract JSON from npm output - find { and parse from there
		const jsonStart = output.indexOf('{');
		expect(jsonStart).toBeGreaterThan(-1);
		const jsonStr = output.substring(jsonStart);
		const result = JSON.parse(jsonStr);

		expect(result.level).toBe(0);
		expect(result.success).toBe(true);
		expect(result.message).toContain('Level 0');
	});

	it('should run level 1 autopilot and generate artifacts', () => {
		const profileDir = path.join(testDir, 'profile');
		const output = execSync(
			`npm run cli -- autopilot ${planFile} --level 1 --profile-dir ${profileDir}`,
			{ encoding: 'utf-8', cwd: process.cwd() }
		);

		expect(output).toContain('Level 1: Artifact generation complete');
		expect(output).toContain('Generated 5 artifacts');
		expect(output).toContain('analysis.json');
		expect(output).toContain('weave-report.md');
		expect(output).toContain('gate-predictions.json');
		expect(output).toContain('execution-log.md');
		expect(output).toContain('metadata.json');

		// Verify artifacts exist
		const deliverables = path.join(profileDir, 'deliverables');
		expect(fs.existsSync(deliverables)).toBe(true);

		const dirs = fs.readdirSync(deliverables);
		const weaveDirs = dirs.filter(d => d.startsWith('weave-'));
		expect(weaveDirs.length).toBe(1);
		expect(weaveDirs[0]).toMatch(/^weave-/);

		const weaveDir = path.join(deliverables, weaveDirs[0]);
		expect(fs.existsSync(path.join(weaveDir, 'analysis.json'))).toBe(true);
		expect(fs.existsSync(path.join(weaveDir, 'weave-report.md'))).toBe(true);
		expect(fs.existsSync(path.join(weaveDir, 'gate-predictions.json'))).toBe(true);
		expect(fs.existsSync(path.join(weaveDir, 'execution-log.md'))).toBe(true);
		expect(fs.existsSync(path.join(weaveDir, 'metadata.json'))).toBe(true);
		expect(fs.existsSync(path.join(weaveDir, 'manifest.json'))).toBe(true);
		
		// Verify latest symlink exists
		expect(fs.existsSync(path.join(deliverables, 'latest'))).toBe(true);
	});

	it('should fail when writing to role=example profile', () => {
		const exampleProfile = path.join(testDir, 'example-profile');
		fs.mkdirSync(exampleProfile, { recursive: true });
		fs.writeFileSync(path.join(exampleProfile, 'profile.yml'), 'role: example\n');

		try {
			execSync(
				`npm run cli -- autopilot ${planFile} --level 1 --profile-dir ${exampleProfile}`,
				{ encoding: 'utf-8', cwd: process.cwd(), stdio: 'pipe' }
			);
			expect.fail('Should have thrown an error');
		} catch (error: any) {
			const output = error.stdout || error.stderr || error.message;
			expect(output).toContain('failed');
			expect(output).toContain('role="example"');
		}
	});

	it('should support --plan flag', () => {
		const output = execSync(
			`npm run cli -- autopilot --plan ${planFile} --level 0`,
			{ encoding: 'utf-8', cwd: process.cwd() }
		);

		expect(output).toContain('🔍 Merge-Weave Analysis (Level 0: Report Only)');
	});

	it('should error on invalid level', () => {
		try {
			execSync(
				`npm run cli -- autopilot ${planFile} --level 99 2>&1`,
				{ encoding: 'utf-8', cwd: process.cwd() }
			);
			expect.fail('Should have thrown an error');
		} catch (error: any) {
			const output = (error.stdout || error.stderr || error.message).toString();
			expect(output).toContain('unsupported autopilot level');
		}
	});

	it('should error when plan file is missing', () => {
		try {
			execSync(
				`npm run cli -- autopilot --level 0 2>&1`,
				{ encoding: 'utf-8', cwd: process.cwd() }
			);
			expect.fail('Should have thrown an error');
		} catch (error: any) {
			const output = (error.stdout || error.stderr || error.message).toString();
			expect(output).toContain('plan file is required');
		}
	});
});
