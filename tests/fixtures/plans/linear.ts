import type { Plan } from '../../../src/schema.js';

/**
 * Linear dependency chain: A → B → C → D
 * Use case: Testing sequential execution, dependency resolution
 */
export function linear(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'feat-a',
        deps: [],
        gates: []
      },
      {
        name: 'feat-b',
        deps: ['feat-a'],
        gates: []
      },
      {
        name: 'feat-c',
        deps: ['feat-b'],
        gates: []
      },
      {
        name: 'feat-d',
        deps: ['feat-c'],
        gates: []
      }
    ]
  };
}

/**
 * Short linear chain with gates: A → B → C
 */
export function linearWithGates(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    policy: {
      requiredGates: ['lint', 'test'],
      maxWorkers: 1
    },
    items: [
      {
        name: 'foundation',
        deps: [],
        gates: [
          { name: 'lint', run: 'echo "lint pass"', env: {} },
          { name: 'test', run: 'echo "test pass"', env: {} }
        ]
      },
      {
        name: 'feature',
        deps: ['foundation'],
        gates: [
          { name: 'lint', run: 'echo "lint pass"', env: {} },
          { name: 'test', run: 'echo "test pass"', env: {} }
        ]
      },
      {
        name: 'polish',
        deps: ['feature'],
        gates: [
          { name: 'lint', run: 'echo "lint pass"', env: {} },
          { name: 'test', run: 'echo "test pass"', env: {} }
        ]
      }
    ]
  };
}
