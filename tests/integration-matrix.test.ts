import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadInputs } from '../src/core/inputs.js';
import { generatePlan } from '../src/core/plan.js';
import { executeGatesWithPolicy } from '../src/gates.js';
import { ExecutionState } from '../src/executionState.js';
import { MergeEligibilityEvaluator } from '../src/mergeEligibility.js';
import { computeMergeOrder } from '../src/mergeOrder.js';
import { canonicalJSONStringify } from '../src/util/canonicalJson.js';
import { loadPlan } from '../src/schema.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Integration Matrix Test', () => {
	const testDir = path.join(os.tmpdir(), 'lexrunner-integration-matrix');

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
		process.chdir('/');
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('Plan Configuration Patterns', () => {
		it('should handle simple linear dependency chain', async () => {
			// Create linear chain: A → B → C → D
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: item-a
    branch: feat/a
    deps: []
    gates:
      - name: test
        run: bash -c "echo 'testing A'; exit 0"
  - id: item-b
    branch: feat/b
    deps: [item-a]
    gates:
      - name: test
        run: bash -c "echo 'testing B'; exit 0"
  - id: item-c
    branch: feat/c
    deps: [item-b]
    gates:
      - name: test
        run: bash -c "echo 'testing C'; exit 0"
  - id: item-d
    branch: feat/d
    deps: [item-c]
    gates:
      - name: test
        run: bash -c "echo 'testing D'; exit 0"
`);

			const result = await runIntegrationTest();

			// Verify linear execution order
			expect(result.executionOrder).toEqual(['item-a', 'item-b', 'item-c', 'item-d']);
			
			// Verify all gates pass in correct order
			expect(result.allGatesPassed).toBe(true);
			
			// Verify merge eligibility follows dependency order
			const eligibleNodes = result.mergeDecisions.filter(d => d.eligible).map(d => d.nodeName);
			expect(eligibleNodes).toContain('item-a'); // No dependencies
		});

		it('should handle parallel independent branches', async () => {
			// Create parallel structure: A ← B, A ← C, A ← D (all depend on A, but B/C/D are independent)
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: foundation
    branch: feat/foundation
    deps: []
    gates:
      - name: test
        run: bash -c "echo 'foundation test'; exit 0"
  - id: feature-x
    branch: feat/x
    deps: [foundation]
    gates:
      - name: test
        run: bash -c "echo 'feature x test'; exit 0"
  - id: feature-y
    branch: feat/y
    deps: [foundation]
    gates:
      - name: test
        run: bash -c "echo 'feature y test'; exit 0"
  - id: feature-z
    branch: feat/z
    deps: [foundation]
    gates:
      - name: test
        run: bash -c "echo 'feature z test'; exit 0"
`);

			const result = await runIntegrationTest();

			// Foundation should be first
			expect(result.executionOrder[0]).toBe('foundation');
			
			// Parallel features can be in any order after foundation
			const parallelFeatures = result.executionOrder.slice(1);
			expect(parallelFeatures).toContain('feature-x');
			expect(parallelFeatures).toContain('feature-y');
			expect(parallelFeatures).toContain('feature-z');
			
			// All should pass
			expect(result.allGatesPassed).toBe(true);
		});

		it('should handle diamond dependency pattern', async () => {
			// Create diamond: A → B,C → D (B and C depend on A, D depends on both B and C)
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: base
    branch: feat/base
    deps: []
    gates:
      - name: test
        run: bash -c "echo 'base test'; exit 0"
  - id: left-path
    branch: feat/left
    deps: [base]
    gates:
      - name: test
        run: bash -c "echo 'left path test'; exit 0"
  - id: right-path
    branch: feat/right
    deps: [base]
    gates:
      - name: test
        run: bash -c "echo 'right path test'; exit 0"
  - id: convergence
    branch: feat/convergence
    deps: [left-path, right-path]
    gates:
      - name: integration-test
        run: bash -c "echo 'convergence integration test'; exit 0"
`);

			const result = await runIntegrationTest();

			// Base should be first
			expect(result.executionOrder[0]).toBe('base');
			
			// Convergence should be last
			expect(result.executionOrder[result.executionOrder.length - 1]).toBe('convergence');
			
			// Left and right paths should come after base but before convergence
			const baseIndex = result.executionOrder.indexOf('base');
			const leftIndex = result.executionOrder.indexOf('left-path');
			const rightIndex = result.executionOrder.indexOf('right-path');
			const convergenceIndex = result.executionOrder.indexOf('convergence');
			
			expect(leftIndex).toBeGreaterThan(baseIndex);
			expect(rightIndex).toBeGreaterThan(baseIndex);
			expect(convergenceIndex).toBeGreaterThan(leftIndex);
			expect(convergenceIndex).toBeGreaterThan(rightIndex);
			
			expect(result.allGatesPassed).toBe(true);
		});

		it('should handle complex multi-level dependencies', async () => {
			// Create complex tree with multiple levels and cross-dependencies
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: core
    branch: feat/core
    deps: []
    gates:
      - name: unit-test
        run: bash -c "echo 'core unit tests'; exit 0"
  - id: utils
    branch: feat/utils
    deps: [core]
    gates:
      - name: unit-test
        run: bash -c "echo 'utils unit tests'; exit 0"
  - id: api
    branch: feat/api
    deps: [core, utils]
    gates:
      - name: api-test
        run: bash -c "echo 'api tests'; exit 0"
  - id: frontend
    branch: feat/frontend
    deps: [api]
    gates:
      - name: frontend-test
        run: bash -c "echo 'frontend tests'; exit 0"
  - id: backend
    branch: feat/backend
    deps: [api, utils]
    gates:
      - name: backend-test
        run: bash -c "echo 'backend tests'; exit 0"
  - id: integration
    branch: feat/integration
    deps: [frontend, backend]
    gates:
      - name: e2e-test
        run: bash -c "echo 'end-to-end tests'; exit 0"
`);

			const result = await runIntegrationTest();

			// Verify dependency constraints are respected
			const getIndex = (name: string) => result.executionOrder.indexOf(name);
			
			// Core should be first (no dependencies)
			expect(getIndex('core')).toBe(0);
			
			// Utils depends on core
			expect(getIndex('utils')).toBeGreaterThan(getIndex('core'));
			
			// API depends on both core and utils
			expect(getIndex('api')).toBeGreaterThan(getIndex('core'));
			expect(getIndex('api')).toBeGreaterThan(getIndex('utils'));
			
			// Frontend depends on API
			expect(getIndex('frontend')).toBeGreaterThan(getIndex('api'));
			
			// Backend depends on API and utils
			expect(getIndex('backend')).toBeGreaterThan(getIndex('api'));
			expect(getIndex('backend')).toBeGreaterThan(getIndex('utils'));
			
			// Integration depends on frontend and backend
			expect(getIndex('integration')).toBeGreaterThan(getIndex('frontend'));
			expect(getIndex('integration')).toBeGreaterThan(getIndex('backend'));
			
			expect(result.allGatesPassed).toBe(true);
		});
	});

	describe('Policy Enforcement', () => {
		it('should handle gate execution results', async () => {
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: passing-item
    branch: feat/passing
    deps: []
    gates:
      - name: test
        run: bash -c "echo 'test passed'; exit 0"
      - name: lint
        run: bash -c "echo 'lint passed'; exit 0"
  - id: failing-item
    branch: feat/failing
    deps: []
    gates:
      - name: test
        run: bash -c "echo 'test failed' >&2; exit 1"
      - name: lint
        run: bash -c "echo 'lint passed'; exit 0"
`);

			const result = await runIntegrationTest();

			// Passing item should have all gates pass
			const passingDecision = result.mergeDecisions.find(d => d.nodeName === 'passing-item');
			expect(passingDecision?.eligible).toBe(true);

			// Failing item should have at least one gate fail
			const failingDecision = result.mergeDecisions.find(d => d.nodeName === 'failing-item');
			expect(failingDecision?.eligible).toBe(false);
		});

		it('should maintain consistent status reporting', async () => {
			fs.mkdirSync('.smartergpt', { recursive: true });
			fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: status-test
    branch: feat/status
    deps: []
    gates:
      - name: quick-test
        run: bash -c "echo 'quick test'; exit 0"
      - name: slow-test
        run: bash -c "echo 'slow test'; sleep 0.1; exit 0"
`);

			const result = await runIntegrationTest();

			// Verify status reporting structure is consistent
			expect(result.statusReport).toBeDefined();
			expect(result.statusReport.plan).toBeDefined();
			expect(result.statusReport.execution).toBeDefined();
			expect(result.statusReport.mergeEligibility).toBeDefined();

			// Verify status includes all expected items
			const statusItems = result.statusReport.execution.results;
			expect(statusItems).toHaveLength(1);
			expect(statusItems[0].name).toBe('status-test');
			expect(statusItems[0].gates).toHaveLength(2);
		});
	});

	/**
	 * Run integration test and return comprehensive results
	 */
	async function runIntegrationTest() {
		// Load inputs and generate plan
		const inputs = loadInputs();
		const plan = generatePlan(inputs);
		const validatedPlan = loadPlan(canonicalJSONStringify(plan));

		// Compute merge order for execution verification
		const executionLevels = computeMergeOrder(validatedPlan);
		const executionOrder = executionLevels.flat(); // Flatten levels to single array for simple order checking

		// Execute gates
		const executionState = new ExecutionState(validatedPlan);
		const artifactDir = path.join(process.cwd(), '.artifacts');
		
		if (!fs.existsSync(artifactDir)) {
			fs.mkdirSync(artifactDir, { recursive: true });
		}

		await executeGatesWithPolicy(validatedPlan, executionState, artifactDir, 15000);

		// Generate merge decisions
		const evaluator = new MergeEligibilityEvaluator(validatedPlan, executionState);
		const mergeDecisionsMap = evaluator.evaluateAllNodes();
		const mergeDecisions = Array.from(mergeDecisionsMap.values());
		const mergeSummary = evaluator.getMergeSummary();

		// Check if all gates passed
		const results = Array.from(executionState.getResults().values());
		const allGatesPassed = results.every(result => 
			result.gates.every(gate => gate.status === 'pass')
		);

		// Generate status report
		const statusReport = {
			plan: {
				schemaVersion: validatedPlan.schemaVersion,
				target: validatedPlan.target,
				itemCount: validatedPlan.items.length
			},
			execution: {
				results: results.map(r => ({
					name: r.name,
					status: r.status,
					gates: r.gates.map(g => ({
						name: g.gate,
						status: g.status,
						duration: g.duration
					}))
				}))
			},
			mergeEligibility: mergeSummary
		};

		return {
			executionOrder,
			allGatesPassed,
			mergeDecisions,
			statusReport,
			planJson: canonicalJSONStringify(validatedPlan)
		};
	}
});