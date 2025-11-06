/**
 * Example: Migrating from old fixtures to new fixture library
 * This test demonstrates the same test logic using the new fixture library
 */

import { describe, it, expect } from 'vitest';
import { computeMergeOrder, CycleError, UnknownDependencyError } from '../src/mergeOrder.js';
import { fixtures } from './fixtures/index.js';

describe('Merge Order Computation (using new fixtures)', () => {
  describe('Basic ordering', () => {
    it('computes linear order for simple plan', () => {
      // OLD WAY: Load from JSON file
      // const plan = loadPlan(fs.readFileSync('fixtures/plan.tiny.json', 'utf-8'));

      // NEW WAY: Use fixture library
      const plan = fixtures.plans.linear();
      const levels = computeMergeOrder(plan);

      // Should have 4 levels (linear chain)
      expect(levels).toHaveLength(4);
      expect(levels[0]).toEqual(['feat-a']);
      expect(levels[1]).toEqual(['feat-b']);
      expect(levels[2]).toEqual(['feat-c']);
      expect(levels[3]).toEqual(['feat-d']);
    });

    it('computes parallel groups correctly', () => {
      // NEW WAY: Use fixture library for parallel scenario
      const plan = fixtures.plans.simple();
      const levels = computeMergeOrder(plan);

      // All items are independent, should be in one level
      expect(levels).toHaveLength(1);
      expect(levels[0]).toHaveLength(3);
      // Items should be sorted alphabetically
      expect(levels[0]).toEqual(['feat-a', 'feat-b', 'feat-c']);
    });

    it('handles diamond dependencies', () => {
      // NEW WAY: Use diamond fixture
      const plan = fixtures.plans.diamond();
      const levels = computeMergeOrder(plan);

      // Expected: 2 levels
      // Level 0: foundation-a, foundation-b (parallel)
      // Level 1: integration (depends on both)
      expect(levels).toHaveLength(2);
      expect(levels[0].sort()).toEqual(['foundation-a', 'foundation-b'].sort());
      expect(levels[1]).toEqual(['integration']);
    });
  });

  describe('Complex scenarios', () => {
    it('handles complex multi-layer dependencies', () => {
      const plan = fixtures.plans.complex();
      const levels = computeMergeOrder(plan);

      // Should have multiple layers
      expect(levels.length).toBeGreaterThan(3);

      // First level should have foundation items (no dependencies)
      const firstLevel = levels[0];
      const foundations = plan.items.filter(item => item.deps.length === 0);
      expect(firstLevel).toHaveLength(foundations.length);
    });

    it('handles wide parallel plans efficiently', () => {
      const plan = fixtures.plans.wideParallel();
      const levels = computeMergeOrder(plan);

      // All 10 items should be in one level (all independent)
      expect(levels).toHaveLength(1);
      expect(levels[0]).toHaveLength(10);
    });

    it('handles deep dependency chains', () => {
      const plan = fixtures.plans.deepChain();
      const levels = computeMergeOrder(plan);

      // Should have 15 levels (one for each step)
      expect(levels).toHaveLength(15);
      
      // Each level should have exactly one item
      levels.forEach(level => {
        expect(level).toHaveLength(1);
      });
    });
  });

  describe('Determinism', () => {
    it('maintains deterministic ordering within levels', () => {
      const plan = fixtures.plans.complex();

      // Run multiple times to verify determinism
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(computeMergeOrder(plan));
      }

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(JSON.stringify(results[i])).toBe(JSON.stringify(results[0]));
      }

      // Within each level, items should be sorted alphabetically
      const levels = results[0];
      for (const level of levels) {
        const sortedLevel = [...level].sort();
        expect(level).toEqual(sortedLevel);
      }
    });
  });

  describe('Error detection', () => {
    it('detects simple cycles', () => {
      // NEW WAY: Use invalid fixture for cycle testing
      const plan = fixtures.invalid.cycle();

      expect(() => computeMergeOrder(plan)).toThrow(CycleError);

      try {
        computeMergeOrder(plan);
        expect.fail('Should have thrown CycleError');
      } catch (error) {
        expect(error).toBeInstanceOf(CycleError);
        const cycleError = error as CycleError;
        expect(cycleError.message.toLowerCase()).toContain('dependency cycle detected');
      }
    });

    it('detects complex cycles', () => {
      const plan = fixtures.invalid.complexCycle();

      expect(() => computeMergeOrder(plan)).toThrow(CycleError);
    });

    it('detects unknown dependencies', () => {
      // NEW WAY: Use invalid fixture for unknown dep testing
      const plan = fixtures.invalid.unknownDependency();

      expect(() => computeMergeOrder(plan)).toThrow(UnknownDependencyError);

      try {
        computeMergeOrder(plan);
        expect.fail('Should have thrown UnknownDependencyError');
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownDependencyError);
        const unknownDepError = error as UnknownDependencyError;
        expect(unknownDepError.message).toContain('feat-nonexistent');
      }
    });
  });

  describe('Edge cases', () => {
    it('handles empty plan', () => {
      const plan = fixtures.invalid.empty();
      const levels = computeMergeOrder(plan);

      expect(levels).toEqual([]);
    });

    it('handles double diamond pattern', () => {
      const plan = fixtures.plans.doubleDiamond();
      const levels = computeMergeOrder(plan);

      // Expected structure:
      // Level 0: foundation-a, foundation-b
      // Level 1: feature-c, feature-d
      // Level 2: integration
      expect(levels).toHaveLength(3);
      expect(levels[0].sort()).toEqual(['foundation-a', 'foundation-b'].sort());
      expect(levels[1].sort()).toEqual(['feature-c', 'feature-d'].sort());
      expect(levels[2]).toEqual(['integration']);
    });
  });
});

describe('Fixture Library Benefits', () => {
  it('demonstrates easier test creation', () => {
    // Before: Had to create JSON files, load them, parse them
    // After: One line to get a fixture

    const plan = fixtures.plans.simple();
    expect(plan.items).toHaveLength(3);
  });

  it('demonstrates type safety', () => {
    // Fixtures are fully typed
    const plan = fixtures.plans.diamond();

    // TypeScript knows the shape
    expect(plan.schemaVersion).toBe('1.0.0');
    expect(plan.items[0].name).toBeTruthy();
    expect(plan.items[0].deps).toBeInstanceOf(Array);
  });

  it('demonstrates composability', () => {
    // Can easily combine fixtures
    const plan = fixtures.plans.complex();
    const prs = fixtures.prs.batch(plan.items.length);
    const gates = fixtures.gates.configs.standard();

    expect(prs).toHaveLength(plan.items.length);
    expect(gates).toHaveLength(2);
  });

  it('demonstrates determinism', () => {
    // Same fixture always produces same result
    const plan1 = fixtures.plans.simple();
    const plan2 = fixtures.plans.simple();

    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });
});
