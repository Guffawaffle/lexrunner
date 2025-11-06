import type { Plan } from '../../../src/schema.js';

/**
 * Diamond dependency pattern:
 *      A     B
 *       \   /
 *        \ /
 *         C
 * 
 * Use case: Testing parallel dependencies, merge conflicts, topological sort
 */
export function diamond(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'foundation-a',
        deps: [],
        gates: []
      },
      {
        name: 'foundation-b',
        deps: [],
        gates: []
      },
      {
        name: 'integration',
        deps: ['foundation-a', 'foundation-b'],
        gates: []
      }
    ]
  };
}

/**
 * Extended diamond with additional layer:
 *      A     B
 *       \   /
 *        \ /
 *         C
 *         |
 *         D
 */
export function diamondExtended(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'foundation-a',
        deps: [],
        gates: []
      },
      {
        name: 'foundation-b',
        deps: [],
        gates: []
      },
      {
        name: 'integration',
        deps: ['foundation-a', 'foundation-b'],
        gates: []
      },
      {
        name: 'finalization',
        deps: ['integration'],
        gates: []
      }
    ]
  };
}

/**
 * Double diamond pattern (pyramid):
 *      A     B
 *       \   /
 *        \ /
 *       C   D
 *        \ /
 *         E
 */
export function doubleDiamond(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'foundation-a',
        deps: [],
        gates: []
      },
      {
        name: 'foundation-b',
        deps: [],
        gates: []
      },
      {
        name: 'feature-c',
        deps: ['foundation-a', 'foundation-b'],
        gates: []
      },
      {
        name: 'feature-d',
        deps: ['foundation-a', 'foundation-b'],
        gates: []
      },
      {
        name: 'integration',
        deps: ['feature-c', 'feature-d'],
        gates: []
      }
    ]
  };
}
