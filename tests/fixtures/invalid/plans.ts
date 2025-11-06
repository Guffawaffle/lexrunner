import type { Plan } from '../../../src/schema.js';

/**
 * Plan with circular dependency: A → B → C → A
 * Should be detected and rejected by validation
 */
export function cycle(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'feat-a',
        deps: ['feat-c'], // Circular!
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
      }
    ]
  };
}

/**
 * Complex circular dependency (harder to detect)
 * A → B → D
 * A → C → D → A (cycle)
 */
export function complexCycle(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'feat-a',
        deps: ['feat-d'], // Part of cycle
        gates: []
      },
      {
        name: 'feat-b',
        deps: ['feat-a'],
        gates: []
      },
      {
        name: 'feat-c',
        deps: ['feat-a'],
        gates: []
      },
      {
        name: 'feat-d',
        deps: ['feat-b', 'feat-c'],
        gates: []
      }
    ]
  };
}

/**
 * Plan with unknown dependency reference
 * Should be detected during validation
 */
export function unknownDependency(): Plan {
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
        deps: ['feat-nonexistent'], // Unknown!
        gates: []
      }
    ]
  };
}

/**
 * Plan with orphaned items (no path to merge)
 * Items exist but have no connection to the graph
 */
export function orphans(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: [
      {
        name: 'connected-a',
        deps: [],
        gates: []
      },
      {
        name: 'connected-b',
        deps: ['connected-a'],
        gates: []
      },
      {
        name: 'orphan-x',
        deps: ['orphan-y'], // Both orphaned
        gates: []
      },
      {
        name: 'orphan-y',
        deps: ['orphan-x'], // Cycle that's disconnected
        gates: []
      }
    ]
  };
}

/**
 * Plan with duplicate item names
 * Should be rejected by schema validation
 */
export function duplicateNames(): Plan {
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
        name: 'feat-a', // Duplicate!
        deps: [],
        gates: []
      }
    ]
  };
}

/**
 * Plan with missing required gates
 * Policy requires gates that items don't have
 */
export function missingRequiredGates(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    policy: {
      requiredGates: ['lint', 'test', 'security'],
      maxWorkers: 1
    },
    items: [
      {
        name: 'feat-a',
        deps: [],
        gates: [
          { name: 'lint', run: 'echo "lint"', env: {} }
          // Missing 'test' and 'security'!
        ]
      }
    ]
  };
}

/**
 * Empty plan (edge case)
 */
export function empty(): Plan {
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items: []
  };
}
