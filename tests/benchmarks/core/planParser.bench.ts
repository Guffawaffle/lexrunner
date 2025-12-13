/**
 * Plan Parsing Performance Benchmarks
 * Measures performance of plan generation and validation
 */

import { describe, bench } from 'vitest';
import { generatePlan } from '../../../src/core/plan.js';
import { validatePlan } from '../../../src/planner/validation.js';
import type { InputConfig } from '../../../src/core/inputs.js';
import { generateGraph } from '../utils/graphGenerator.js';

describe('Plan Parsing Performance', () => {
  // Small plans (5-10 items)
  describe('Small plans (5-10 items)', () => {
    const smallInput: InputConfig = {
      target: 'main',
      items: [
        { id: 'pr-1', branch: 'feat-1', deps: [] },
        { id: 'pr-2', branch: 'feat-2', deps: [] },
        { id: 'pr-3', branch: 'feat-3', deps: ['pr-1', 'pr-2'] },
        { id: 'pr-4', branch: 'feat-4', deps: ['pr-3'] },
        { id: 'pr-5', branch: 'feat-5', deps: ['pr-3'] },
      ]
    };

    bench('generate plan from input', () => {
      generatePlan(smallInput);
    });

    bench('validate small plan', () => {
      const plan = generatePlan(smallInput);
      validatePlan(plan);
    });

    bench('generate and validate', () => {
      const plan = generatePlan(smallInput);
      validatePlan(plan);
    });
  });

  // Medium plans (20-30 items)
  describe('Medium plans (20-30 items)', () => {
    const mediumGraph = generateGraph({ nodes: 25, pattern: 'complex' });
    const mediumInput: InputConfig = {
      target: 'main',
      items: mediumGraph.items.map((item, idx) => ({
        id: `pr-${idx}`,
        branch: item.name,
        deps: item.deps.map(dep => {
          const depIdx = mediumGraph.items.findIndex(i => i.name === dep);
          return `pr-${depIdx}`;
        }),
        gates: [
          { name: 'lint', run: 'npm run lint', env: {} },
          { name: 'test', run: 'npm test', env: {} }
        ]
      }))
    };

    bench('generate plan from input', () => {
      generatePlan(mediumInput);
    });

    bench('validate medium plan', () => {
      const plan = generatePlan(mediumInput);
      validatePlan(plan);
    });

    bench('generate and validate', () => {
      const plan = generatePlan(mediumInput);
      validatePlan(plan);
    });
  });

  // Large plans (50-100 items)
  describe('Large plans (50-100 items)', () => {
    const largeGraph = generateGraph({ nodes: 75, pattern: 'complex' });
    const largeInput: InputConfig = {
      target: 'main',
      items: largeGraph.items.map((item, idx) => ({
        id: `pr-${idx}`,
        branch: item.name,
        deps: item.deps.map(dep => {
          const depIdx = largeGraph.items.findIndex(i => i.name === dep);
          return `pr-${depIdx}`;
        }),
        gates: [
          { name: 'lint', run: 'npm run lint', env: {} },
          { name: 'test', run: 'npm test', env: {} },
          { name: 'build', run: 'npm run build', env: {} }
        ]
      }))
    };

    bench('generate plan from input', () => {
      generatePlan(largeInput);
    });

    bench('validate large plan', () => {
      const plan = generatePlan(largeInput);
      validatePlan(plan);
    });

    bench('generate and validate', () => {
      const plan = generatePlan(largeInput);
      validatePlan(plan);
    });
  });
});
