import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CLI Progress Indicators E2E', () => {
	let testDir: string;
	let planFile: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-pr-progress-test-'));
		planFile = path.join(testDir, 'test-plan.json');

		// Create a test plan with sleep gates >2s
		const plan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{
					name: "task-slow",
					deps: [],
					gates: [
						{
							name: "sleep-3s",
							run: "sleep 3",
							runtime: "local"
						}
					]
				}
			],
			policy: {
				requiredGates: [],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: {
					type: "strict-required"
				}
			}
		};

		fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});

	it('should show progress indicators in human mode', () => {
		const output = execSync(
			`node dist/cli.js execute --plan "${planFile}" --artifact-dir "${testDir}/artifacts"`,
			{ cwd: path.resolve(__dirname, '..'), encoding: 'utf-8' }
		);

		// Should show node start indicator
		expect(output).toContain('⏳ task-slow: Starting...');
		
		// Should show node completion indicator (for >2s operation)
		expect(output).toContain('✅ task-slow: Completed');
		expect(output).toMatch(/Completed \(\d+\.\d+s\)/);
		
		// Should show execution results
		expect(output).toContain('=== Execution Results ===');
	});

	it('should NOT show progress indicators in JSON mode', () => {
		const output = execSync(
			`node dist/cli.js execute --plan "${planFile}" --artifact-dir "${testDir}/artifacts" --json`,
			{ cwd: path.resolve(__dirname, '..'), encoding: 'utf-8' }
		);

		// Should NOT contain progress indicators
		expect(output).not.toContain('⏳');
		expect(output).not.toContain('✅');
		expect(output).not.toContain('Starting...');
		expect(output).not.toContain('Completed');
		
		// Should be valid JSON
		const parsed = JSON.parse(output);
		expect(parsed).toHaveProperty('execution');
		expect(parsed.execution).toHaveProperty('results');
	});

	it('should show level progress for multi-level plans', () => {
		// Create a multi-level plan
		const multiLevelPlan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{
					name: "level1-task",
					deps: [],
					gates: [
						{
							name: "sleep-2s",
							run: "sleep 2",
							runtime: "local"
						}
					]
				},
				{
					name: "level2-task",
					deps: ["level1-task"],
					gates: [
						{
							name: "sleep-2s",
							run: "sleep 2",
							runtime: "local"
						}
					]
				}
			],
			policy: {
				requiredGates: [],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: {
					type: "strict-required"
				}
			}
		};

		const multiPlanFile = path.join(testDir, 'multi-plan.json');
		fs.writeFileSync(multiPlanFile, JSON.stringify(multiLevelPlan, null, 2));

		const output = execSync(
			`node dist/cli.js execute --plan "${multiPlanFile}" --artifact-dir "${testDir}/artifacts-multi"`,
			{ cwd: path.resolve(__dirname, '..'), encoding: 'utf-8' }
		);

		// Should show both tasks starting
		expect(output).toContain('⏳ level1-task: Starting...');
		expect(output).toContain('⏳ level2-task: Starting...');
		
		// Should show completion indicators
		expect(output).toContain('✅ level1-task: Completed');
		expect(output).toContain('✅ level2-task: Completed');
	});

	it('should NOT show completion tick for fast operations', () => {
		// Create a plan with fast operation (<2s)
		const fastPlan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{
					name: "task-fast",
					deps: [],
					gates: [
						{
							name: "sleep-1s",
							run: "sleep 1",
							runtime: "local"
						}
					]
				}
			],
			policy: {
				requiredGates: [],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: {
					type: "strict-required"
				}
			}
		};

		const fastPlanFile = path.join(testDir, 'fast-plan.json');
		fs.writeFileSync(fastPlanFile, JSON.stringify(fastPlan, null, 2));

		const output = execSync(
			`node dist/cli.js execute --plan "${fastPlanFile}" --artifact-dir "${testDir}/artifacts-fast"`,
			{ cwd: path.resolve(__dirname, '..'), encoding: 'utf-8' }
		);

		// Should show start indicator
		expect(output).toContain('⏳ task-fast: Starting...');
		
		// Should NOT show completion indicator (operation <2s)
		expect(output).not.toContain('task-fast: Completed');
	});
});
