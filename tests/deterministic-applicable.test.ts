import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generatePlan, generateEmptyPlan } from '../src/core/plan';
import { loadInputs } from '../src/core/inputs';
import { canonicalJSONStringify } from '../src/util/canonicalJson';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('deterministic plan generation', () => {
	const testDir = path.join(os.tmpdir(), 'lexrunner-test');

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

	it('should generate identical plans for same inputs', () => {
		// Create .smartergpt directory structure
		fs.mkdirSync('.smartergpt', { recursive: true });

		// Create stack.yml with deterministic content
		fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: item-1
    branch: feat/item-1
    deps: []
    gates:
      - name: lint
        run: npm run lint
      - name: test
        run: npm test
  - id: item-2
    branch: feat/item-2
    deps: [item-1]
    gates:
      - name: lint
        run: npm run lint
      - name: test
        run: npm test
`);

		// Generate plans multiple times
		const inputs1 = loadInputs();
		const plan1 = generatePlan(inputs1);

		const inputs2 = loadInputs();
		const plan2 = generatePlan(inputs2);

		const inputs3 = loadInputs();
		const plan3 = generatePlan(inputs3);

		// Should be byte-for-byte identical
		const json1 = canonicalJSONStringify(plan1);
		const json2 = canonicalJSONStringify(plan2);
		const json3 = canonicalJSONStringify(plan3);

		expect(json1).toBe(json2);
		expect(json2).toBe(json3);

		// Verify structure
		expect(plan1.schemaVersion).toBe('1.0.0');
		expect(plan1.target).toBe('main');
		expect(plan1.items).toHaveLength(2);

		// Verify deterministic ordering
		expect(plan1.items[0].name).toBe('item-1');
		expect(plan1.items[1].name).toBe('item-2');
		expect(plan1.items[1].deps).toEqual(['item-1']);
	});

	it('should handle empty configurations gracefully', () => {
		// No configuration files - should generate empty plan
		const inputs = loadInputs();
		const plan = generatePlan(inputs);

		expect(plan.schemaVersion).toBe('1.0.0');
		expect(plan.target).toBe('main');
		expect(plan.items).toHaveLength(0);

		// Should be deterministic
		const inputs2 = loadInputs();
		const plan2 = generatePlan(inputs2);
		expect(canonicalJSONStringify(plan)).toBe(canonicalJSONStringify(plan2));
	});

	it('should handle mixed numeric and string IDs consistently', () => {
		// Create .smartergpt directory structure
		fs.mkdirSync('.smartergpt', { recursive: true });

		// Mix numeric and string IDs to test normalization
		fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: 42
    branch: feat/numeric-id
    deps: []
    gates:
      - name: lint
        run: npm run lint
  - id: "string-id"
    branch: feat/string-id
    deps: ["42"]
    gates:
      - name: test
        run: npm test
  - id: 100
    branch: feat/another-numeric
    deps: ["string-id", "42"]
    gates:
      - name: build
        run: npm run build
`);

		const inputs = loadInputs();
		const plan = generatePlan(inputs);

		// All IDs should be normalized to strings and dependency resolution should work
		expect(plan.items).toHaveLength(3);

		const itemMap = Object.fromEntries(plan.items.map(item => [item.name, item]));

		// Verify numeric IDs are normalized to strings as names
		expect(itemMap['42']).toBeDefined();
		expect(itemMap['string-id']).toBeDefined();
		expect(itemMap['100']).toBeDefined();

		// Verify dependencies resolve correctly despite mixed ID types in input
		expect(itemMap['string-id'].deps).toEqual(['42']);
		expect(itemMap['100'].deps).toEqual(['42', 'string-id']); // Should be sorted

		// Should be deterministic across runs
		const plan2 = generatePlan(loadInputs());
		expect(canonicalJSONStringify(plan)).toBe(canonicalJSONStringify(plan2));
	});
});
