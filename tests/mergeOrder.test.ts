import { describe, it, expect } from 'vitest';
import { computeMergeOrder, CycleError, UnknownDependencyError } from '../src/mergeOrder.js';
import { loadPlan } from '../src/schema.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Merge Order Computation', () => {
	it('computes linear order for tiny plan', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.tiny.json'), 'utf-8');
		const plan = loadPlan(planContent);
		const levels = computeMergeOrder(plan);

		expect(levels).toEqual([
			['feat-a'],
			['feat-b'],
			['feat-c']
		]);
	});

	it('computes parallel groups correctly', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.parallel.json'), 'utf-8');
		const plan = loadPlan(planContent);
		const levels = computeMergeOrder(plan);

		// Expected: Level 1: feat-a, feat-b, feat-f (no deps)
		//          Level 2: feat-c, feat-d (depend on level 1)
		//          Level 3: feat-e (depends on level 2)
		expect(levels).toEqual([
			['feat-a', 'feat-b', 'feat-f'],
			['feat-c', 'feat-d'],
			['feat-e']
		]);
	});

	it('maintains deterministic ordering within levels', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.parallel.json'), 'utf-8');
		const plan = loadPlan(planContent);

		// Run multiple times to verify determinism
		const results = [];
		for (let i = 0; i < 5; i++) {
			results.push(computeMergeOrder(plan));
		}

		// All results should be identical
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toEqual(results[0]);
		}

		// Within each level, items should be sorted alphabetically
		const levels = results[0];
		for (const level of levels) {
			const sortedLevel = [...level].sort();
			expect(level).toEqual(sortedLevel);
		}
	});

	it('detects cycles', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.cycle.json'), 'utf-8');
		const plan = loadPlan(planContent);

		expect(() => computeMergeOrder(plan)).toThrow(CycleError);

		try {
			computeMergeOrder(plan);
			expect.fail('Should have thrown CycleError');
		} catch (error) {
			expect(error).toBeInstanceOf(CycleError);
			const cycleError = error as CycleError;
			expect(cycleError.message.toLowerCase()).toContain('dependency cycle detected');
			expect(cycleError.message).toContain('feat-a');
			expect(cycleError.message).toContain('feat-b');
		}
	});

	it('detects unknown dependencies', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.bad-unknown-dep.json'), 'utf-8');
		const plan = loadPlan(planContent);

		expect(() => computeMergeOrder(plan)).toThrow(UnknownDependencyError);

		try {
			computeMergeOrder(plan);
			expect.fail('Should have thrown UnknownDependencyError');
		} catch (error) {
			expect(error).toBeInstanceOf(UnknownDependencyError);
			const depError = error as UnknownDependencyError;
			expect(depError.message).toContain('feat-missing');
			expect(depError.message).toContain('feat-b');
		}
	});

	it('handles empty plans', () => {
		const plan = { target: 'main', items: [] };
		const levels = computeMergeOrder(plan);
		expect(levels).toEqual([]);
	});

	it('handles single item with no dependencies', () => {
		const plan = {
			target: 'main',
			items: [{ name: 'solo', deps: [] }]
		};
		const levels = computeMergeOrder(plan);
		expect(levels).toEqual([['solo']]);
	});
});
