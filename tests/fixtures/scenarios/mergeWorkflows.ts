/**
 * Complete end-to-end test scenarios combining plans, PRs, and gates
 */

import type { Plan } from '../../../src/schema.js';
import type { MockPR } from '../prs/basic.js';
import type { GateResult } from '../../../src/schema.js';
import * as plans from '../plans/simple.js';
import * as prs from '../prs/withDeps.js';
import * as gateResults from '../gates/results.js';

export interface Scenario {
  description: string;
  plan: Plan;
  prs: MockPR[];
  gateResults?: Record<string, GateResult[]>;
  expected?: {
    merged?: number;
    blocked?: number;
    failed?: number;
    layers?: number;
  };
}

/**
 * Simple successful merge scenario
 * All PRs independent, all gates pass
 */
export function simpleSuccess(): Scenario {
  return {
    description: 'Simple merge with all PRs passing',
    plan: plans.simple(),
    prs: [
      prs.withDeps({ number: 100, title: 'feat-a', dependsOn: [] }),
      prs.withDeps({ number: 101, title: 'feat-b', dependsOn: [] }),
      prs.withDeps({ number: 102, title: 'feat-c', dependsOn: [] })
    ],
    gateResults: {
      'feat-a': [],
      'feat-b': [],
      'feat-c': []
    },
    expected: {
      merged: 3,
      blocked: 0,
      failed: 0,
      layers: 1
    }
  };
}

/**
 * Linear dependency chain scenario
 */
export function linearChain(): Scenario {
  const chainPRs = prs.chain(4, 100);

  return {
    description: 'Linear dependency chain A→B→C→D',
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      items: [
        { name: 'PR-100', deps: [], gates: [] },
        { name: 'PR-101', deps: ['PR-100'], gates: [] },
        { name: 'PR-102', deps: ['PR-101'], gates: [] },
        { name: 'PR-103', deps: ['PR-102'], gates: [] }
      ]
    },
    prs: chainPRs,
    expected: {
      merged: 4,
      blocked: 0,
      failed: 0,
      layers: 4
    }
  };
}

/**
 * Diamond dependency scenario
 */
export function diamondMerge(): Scenario {
  const diamondPRs = prs.diamond(100);

  return {
    description: 'Diamond dependency: A,B → C',
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      items: [
        { name: 'PR-100', deps: [], gates: [] },
        { name: 'PR-101', deps: [], gates: [] },
        { name: 'PR-102', deps: ['PR-100', 'PR-101'], gates: [] }
      ]
    },
    prs: diamondPRs,
    expected: {
      merged: 3,
      blocked: 0,
      failed: 0,
      layers: 2
    }
  };
}

/**
 * Complex merge scenario with multiple layers
 */
export function complexMerge(options: {
  prCount?: number;
  maxDependencyDepth?: number;
  conflictRate?: number;
} = {}): Scenario {
  const prCount = options.prCount ?? 15;
  const complexPRs = prs.complex(prCount);

  // Map PRs to plan items
  const items = complexPRs.map(pr => {
    const body = pr.body ?? '';
    const depsMatch = body.match(/Depends on: #(\d+)(?:, #(\d+))*/);
    const deps = depsMatch 
      ? body.match(/#(\d+)/g)?.map(d => `PR-${d.substring(1)}`) ?? []
      : [];

    return {
      name: `PR-${pr.number}`,
      deps,
      gates: []
    };
  });

  return {
    description: `Complex merge with ${prCount} PRs`,
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      items
    },
    prs: complexPRs,
    expected: {
      merged: prCount,
      blocked: 0,
      failed: 0
    }
  };
}

/**
 * Scenario with gate failures
 */
export function withGateFailures(): Scenario {
  return {
    description: 'Merge scenario with some gate failures',
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      policy: {
        requiredGates: ['lint', 'test'],
        maxWorkers: 2
      },
      items: [
        {
          name: 'PR-100',
          deps: [],
          gates: [
            { name: 'lint', run: 'exit 0', env: {} },
            { name: 'test', run: 'exit 0', env: {} }
          ]
        },
        {
          name: 'PR-101',
          deps: [],
          gates: [
            { name: 'lint', run: 'exit 0', env: {} },
            { name: 'test', run: 'exit 1', env: {} } // Fails!
          ]
        },
        {
          name: 'PR-102',
          deps: ['PR-101'],
          gates: [
            { name: 'lint', run: 'exit 0', env: {} },
            { name: 'test', run: 'exit 0', env: {} }
          ]
        }
      ]
    },
    prs: [
      prs.withDeps({ number: 100, title: 'PR-100', dependsOn: [] }),
      prs.withDeps({ number: 101, title: 'PR-101', dependsOn: [] }),
      prs.withDeps({ number: 102, title: 'PR-102', dependsOn: [101] })
    ],
    gateResults: {
      'PR-100': gateResults.allPass(['lint', 'test']),
      'PR-101': gateResults.someFail({ pass: ['lint'], fail: ['test'] }),
      'PR-102': [] // Blocked by PR-101
    },
    expected: {
      merged: 1, // Only PR-100
      blocked: 1, // PR-102 blocked
      failed: 1, // PR-101 failed
      layers: 1
    }
  };
}

/**
 * Scenario with retries
 */
export function withRetries(): Scenario {
  return {
    description: 'Scenario with flaky gates and retries',
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      policy: {
        requiredGates: ['flaky'],
        maxWorkers: 1,
        retries: {
          'flaky': { maxAttempts: 3, backoffSeconds: 1 }
        }
      },
      items: [
        {
          name: 'PR-100',
          deps: [],
          gates: [
            { name: 'flaky', run: 'exit $((RANDOM % 2))', env: {} }
          ]
        }
      ]
    },
    prs: [
      prs.withDeps({ number: 100, title: 'Flaky PR', dependsOn: [] })
    ],
    gateResults: {
      'PR-100': [
        gateResults.withRetries({ 
          gate: 'flaky', 
          attempts: 3, 
          finalStatus: 'pass' 
        })
      ]
    },
    expected: {
      merged: 1,
      blocked: 0,
      failed: 0
    }
  };
}

/**
 * Scenario with blocked PRs (dependency failures)
 */
export function withBlockedPRs(): Scenario {
  return {
    description: 'Scenario where dependencies fail, blocking downstream PRs',
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      items: [
        { name: 'foundation', deps: [], gates: [] },
        { name: 'feature-a', deps: ['foundation'], gates: [] },
        { name: 'feature-b', deps: ['foundation'], gates: [] },
        { name: 'integration', deps: ['feature-a', 'feature-b'], gates: [] }
      ]
    },
    prs: [
      prs.withDeps({ number: 100, title: 'foundation', dependsOn: [] }),
      prs.withDeps({ number: 101, title: 'feature-a', dependsOn: [100] }),
      prs.withDeps({ number: 102, title: 'feature-b', dependsOn: [100] }),
      prs.withDeps({ number: 103, title: 'integration', dependsOn: [101, 102] })
    ],
    expected: {
      merged: 4,
      blocked: 0,
      failed: 0,
      layers: 3
    }
  };
}

/**
 * Empty scenario (edge case)
 */
export function empty(): Scenario {
  return {
    description: 'Empty plan with no PRs',
    plan: {
      schemaVersion: '1.0.0',
      target: 'main',
      items: []
    },
    prs: [],
    expected: {
      merged: 0,
      blocked: 0,
      failed: 0,
      layers: 0
    }
  };
}
