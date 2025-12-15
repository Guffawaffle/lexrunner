/**
 * Integration tests for autopilot artifact generation
 * Verifies that generated artifacts are consistent with analysis
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutopilotLevel1, AutopilotContext } from '../src/autopilot/index.js';
import { Plan } from '../src/schema.js';
import { computeMergeOrder } from '../src/mergeOrder.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Autopilot Integration Tests', () => {
	let testDir: string;
	let context: AutopilotContext;

	beforeEach(() => {
		testDir = path.join(os.tmpdir(), `lexrunner-autopilot-integration-${Date.now()}`);
		fs.mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it('should generate artifacts that match plan analysis', async () => {
		const plan: Plan = {
			schemaVersion: "1.0.0",
			target: "main",
			policy: {
				requiredGates: ["lint", "test"],
				optionalGates: [],
				maxWorkers: 2,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: "strict-required" }
			},
			items: [
				{
					name: "feature-a",
					deps: [],
					gates: [
						{ name: "lint", run: "npm run lint", env: {} },
						{ name: "test", run: "npm test", env: {} }
					]
				},
				{
					name: "feature-b",
					deps: [],
					gates: [
						{ name: "lint", run: "npm run lint", env: {} }
					]
				},
				{
					name: "feature-c",
					deps: ["feature-a", "feature-b"],
					gates: [
						{ name: "test", run: "npm test", env: {} }
					]
				}
			]
		};

		context = {
			plan,
			profilePath: testDir,
			profileRole: "local"
		};

		// Execute autopilot
		const autopilot = new AutopilotLevel1(context);
		const result = await autopilot.execute();

		expect(result.success).toBe(true);

		// Compute expected merge order independently
		const expectedMergeOrder = computeMergeOrder(plan);

		// Load generated analysis
		const deliverables = path.join(testDir, 'deliverables');
		const dirs = fs.readdirSync(deliverables);
		const weaveDir = path.join(deliverables, dirs[0]);
		const analysisPath = path.join(weaveDir, 'analysis.json');
		const analysisContent = fs.readFileSync(analysisPath, 'utf-8');
		const analysis = JSON.parse(analysisContent);

		// Verify merge order matches
		expect(analysis.mergeOrder).toEqual(expectedMergeOrder);
		expect(analysis.mergeOrder).toEqual([["feature-a", "feature-b"], ["feature-c"]]);

		// Verify plan data matches
		expect(analysis.plan.nodes).toHaveLength(plan.items.length);
		expect(analysis.plan.policy).toEqual(plan.policy);

		// Verify gate predictions match plan gates
		const predictionsPath = path.join(weaveDir, 'gate-predictions.json');
		const predictionsContent = fs.readFileSync(predictionsPath, 'utf-8');
		const predictions = JSON.parse(predictionsContent);

		const totalGates = plan.items.reduce((sum, item) => sum + item.gates.length, 0);
		expect(predictions.predictions).toHaveLength(totalGates);

		// Verify each gate has a prediction
		for (const item of plan.items) {
			for (const gate of item.gates) {
				const pred = predictions.predictions.find(
					(p: any) => p.item === item.name && p.gate === gate.name
				);
				expect(pred).toBeDefined();
				expect(pred.expectedStatus).toBe("pass");
			}
		}
	});

	it('should generate report consistent with merge order', async () => {
		const plan: Plan = {
			schemaVersion: "1.0.0",
			target: "develop",
			items: [
				{ name: "pr-1", deps: [], gates: [] },
				{ name: "pr-2", deps: ["pr-1"], gates: [] },
				{ name: "pr-3", deps: ["pr-1"], gates: [] },
				{ name: "pr-4", deps: ["pr-2", "pr-3"], gates: [] }
			]
		};

		context = {
			plan,
			profilePath: testDir,
			profileRole: "local"
		};

		const autopilot = new AutopilotLevel1(context);
		const result = await autopilot.execute();

		expect(result.success).toBe(true);

		const deliverables = path.join(testDir, 'deliverables');
		const dirs = fs.readdirSync(deliverables);
		const weaveDir = path.join(deliverables, dirs[0]);

		// Load analysis to get merge order
		const analysisPath = path.join(weaveDir, 'analysis.json');
		const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));

		// Load report
		const reportPath = path.join(weaveDir, 'weave-report.md');
		const report = fs.readFileSync(reportPath, 'utf-8');

		// Verify report mentions all levels
		expect(report).toContain("**Merge Levels**: 3");
		expect(report).toContain("**Level 1**: pr-1");
		expect(report).toContain("**Level 2**: pr-2, pr-3");
		expect(report).toContain("**Level 3**: pr-4");

		// Verify execution log matches merge order
		const logPath = path.join(weaveDir, 'execution-log.md');
		const log = fs.readFileSync(logPath, 'utf-8');

		expect(log).toContain("### Level 1 Execution");
		expect(log).toContain("### Level 2 Execution");
		expect(log).toContain("### Level 3 Execution");
	});

	it('should handle complex dependency graphs correctly', async () => {
		const plan: Plan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{ name: "a", deps: [], gates: [] },
				{ name: "b", deps: [], gates: [] },
				{ name: "c", deps: ["a"], gates: [] },
				{ name: "d", deps: ["b"], gates: [] },
				{ name: "e", deps: ["c", "d"], gates: [] },
				{ name: "f", deps: [], gates: [] }
			]
		};

		context = {
			plan,
			profilePath: testDir,
			profileRole: "local"
		};

		const autopilot = new AutopilotLevel1(context);
		const result = await autopilot.execute();

		expect(result.success).toBe(true);

		const deliverables = path.join(testDir, 'deliverables');
		const dirs = fs.readdirSync(deliverables);
		const weaveDir = path.join(deliverables, dirs[0]);

		// Load analysis
		const analysisPath = path.join(weaveDir, 'analysis.json');
		const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));

		// Verify merge order is correct
		expect(analysis.mergeOrder).toHaveLength(3);
		
		// Level 1: a, b, f (no dependencies)
		expect(analysis.mergeOrder[0]).toContain("a");
		expect(analysis.mergeOrder[0]).toContain("b");
		expect(analysis.mergeOrder[0]).toContain("f");

		// Level 2: c, d (depend on level 1)
		expect(analysis.mergeOrder[1]).toContain("c");
		expect(analysis.mergeOrder[1]).toContain("d");

		// Level 3: e (depends on level 2)
		expect(analysis.mergeOrder[2]).toContain("e");
	});

	it('should generate deterministic artifacts across multiple runs', async () => {
		const plan: Plan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: [
				{ name: "x", deps: [], gates: [{ name: "check", run: "echo ok", env: {} }] },
				{ name: "y", deps: ["x"], gates: [] }
			]
		};

		// Run autopilot twice with fresh directories
		const testDir1 = path.join(os.tmpdir(), `autopilot-det-1-${Date.now()}`);
		const testDir2 = path.join(os.tmpdir(), `autopilot-det-2-${Date.now()}`);

		try {
			fs.mkdirSync(testDir1, { recursive: true });
			fs.mkdirSync(testDir2, { recursive: true });

			const context1: AutopilotContext = {
				plan,
				profilePath: testDir1,
				profileRole: "local"
			};

			const context2: AutopilotContext = {
				plan,
				profilePath: testDir2,
				profileRole: "local"
			};

			const autopilot1 = new AutopilotLevel1(context1);
			const autopilot2 = new AutopilotLevel1(context2);

			const result1 = await autopilot1.execute();
			const result2 = await autopilot2.execute();

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);

			// Load both analysis files
			const dirs1 = fs.readdirSync(path.join(testDir1, 'deliverables'));
			const dirs2 = fs.readdirSync(path.join(testDir2, 'deliverables'));

			const analysis1Path = path.join(testDir1, 'deliverables', dirs1[0], 'analysis.json');
			const analysis2Path = path.join(testDir2, 'deliverables', dirs2[0], 'analysis.json');

			const analysis1 = JSON.parse(fs.readFileSync(analysis1Path, 'utf-8'));
			const analysis2 = JSON.parse(fs.readFileSync(analysis2Path, 'utf-8'));

			// Verify core data is identical (excluding timestamp)
			expect(analysis1.schemaVersion).toBe(analysis2.schemaVersion);
			expect(analysis1.plan).toEqual(analysis2.plan);
			expect(analysis1.mergeOrder).toEqual(analysis2.mergeOrder);
			expect(analysis1.conflicts).toEqual(analysis2.conflicts);
			expect(analysis1.recommendations).toEqual(analysis2.recommendations);
		} finally {
			if (fs.existsSync(testDir1)) fs.rmSync(testDir1, { recursive: true });
			if (fs.existsSync(testDir2)) fs.rmSync(testDir2, { recursive: true });
		}
	});
});
