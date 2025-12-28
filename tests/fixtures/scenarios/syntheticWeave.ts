/**
 * Synthetic 6-PR merge-weave scenario with predictable conflicts
 *
 * This fixture generates a complete end-to-end test scenario with:
 * - 6 PRs in pyramid dependency structure
 * - 2 predictable merge conflicts
 * - All gates configured to pass
 * - Budget tracking (≤ 3 prompts, ≤ 5k tokens)
 */

import type { Plan } from "../../../src/schema.js";

export interface SyntheticWeaveScenario {
  plan: Plan;
  /** File structure for the synthetic repository */
  files: Record<string, string>;
  /** Expected conflicts (file paths and conflicting PR names) */
  conflicts: Array<{
    file: string;
    prs: [string, string];
    resolution: string;
  }>;
  /** Expected budget usage */
  expectedBudget: {
    maxPrompts: number;
    maxTokens: number;
  };
  /** Expected outcomes */
  expected: {
    totalItems: number;
    levels: number;
    allGatesPass: boolean;
    conflictsResolved: number;
  };
}

/**
 * Generate a synthetic 6-PR weave scenario with 2 predictable conflicts
 *
 * Dependency structure (pyramid):
 *   Level 1: foundation-a, foundation-b (independent, no conflicts)
 *   Level 2: feature-x, feature-y (depend on foundations, CONFLICT on shared file)
 *   Level 3: integration (depends on features, CONFLICT on config file)
 *   Level 4: final (depends on integration)
 */
export function syntheticSixPRWeave(): SyntheticWeaveScenario {
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
      mergeRule: { type: "strict-required" },
    },
    items: [
      // Level 1: Two independent foundations
      {
        name: "foundation-a",
        deps: [],
        gates: [
          {
            name: "lint",
            run: 'echo "✓ lint passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
          {
            name: "test",
            run: 'echo "✓ test passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
        ],
      },
      {
        name: "foundation-b",
        deps: [],
        gates: [
          {
            name: "lint",
            run: 'echo "✓ lint passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
          {
            name: "test",
            run: 'echo "✓ test passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
        ],
      },
      // Level 2: Two features depending on foundations (will conflict on utils.ts)
      {
        name: "feature-x",
        deps: ["foundation-a"],
        gates: [
          {
            name: "lint",
            run: 'echo "✓ lint passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
          {
            name: "test",
            run: 'echo "✓ test passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
        ],
      },
      {
        name: "feature-y",
        deps: ["foundation-b"],
        gates: [
          {
            name: "lint",
            run: 'echo "✓ lint passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
          {
            name: "test",
            run: 'echo "✓ test passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
        ],
      },
      // Level 3: Integration depending on both features (will conflict on config.json)
      {
        name: "integration",
        deps: ["feature-x", "feature-y"],
        gates: [
          {
            name: "lint",
            run: 'echo "✓ lint passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
          {
            name: "test",
            run: 'echo "✓ test passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
        ],
      },
      // Level 4: Final integration
      {
        name: "final",
        deps: ["integration"],
        gates: [
          {
            name: "lint",
            run: 'echo "✓ lint passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
          {
            name: "test",
            run: 'echo "✓ test passed"',
            env: {},
            runtime: "local",
            artifacts: [],
          },
        ],
      },
    ],
  };

  // Initial repository files
  const files: Record<string, string> = {
    "README.md": "# Synthetic Test Repository\n\nInitial state.\n",
    "src/utils.ts": `// Utility functions
export function helper() {
  return 'base';
}
`,
    "config.json": `{
  "name": "test-project",
  "version": "1.0.0"
}
`,
    "package.json": `{
  "name": "synthetic-test",
  "version": "1.0.0",
  "description": "Synthetic test repository"
}
`,
  };

  // Define the two predictable conflicts
  const conflicts = [
    {
      file: "src/utils.ts",
      prs: ["feature-x", "feature-y"] as [string, string],
      resolution: `// Utility functions
export function helper() {
  return 'enhanced';
}

export function featureX() {
  return 'feature-x';
}

export function featureY() {
  return 'feature-y';
}
`,
    },
    {
      file: "config.json",
      prs: ["feature-x", "integration"] as [string, string],
      resolution: `{
  "name": "test-project",
  "version": "2.0.0",
  "features": {
    "x": true,
    "y": true,
    "integration": true
  }
}
`,
    },
  ];

  return {
    plan,
    files,
    conflicts,
    expectedBudget: {
      maxPrompts: 3,
      maxTokens: 5000,
    },
    expected: {
      totalItems: 6,
      levels: 4,
      allGatesPass: true,
      conflictsResolved: 2,
    },
  };
}

/**
 * Get file changes for a specific PR in the synthetic scenario
 *
 * Returns the file modifications that each PR would introduce,
 * which will be used to create actual commits in the test.
 */
export function getFileChangesForPR(prName: string): Record<string, string> {
  const changes: Record<string, Record<string, string>> = {
    "foundation-a": {
      "src/foundation-a.ts": `// Foundation A module
export function setupA() {
  console.log('Foundation A initialized');
}
`,
    },
    "foundation-b": {
      "src/foundation-b.ts": `// Foundation B module
export function setupB() {
  console.log('Foundation B initialized');
}
`,
    },
    "feature-x": {
      "src/utils.ts": `// Utility functions
export function helper() {
  return 'enhanced';
}

export function featureX() {
  return 'feature-x';
}
`,
      "config.json": `{
  "name": "test-project",
  "version": "2.0.0",
  "features": {
    "x": true
  }
}
`,
    },
    "feature-y": {
      "src/utils.ts": `// Utility functions
export function helper() {
  return 'enhanced';
}

export function featureY() {
  return 'feature-y';
}
`,
      "config.json": `{
  "name": "test-project",
  "version": "1.1.0",
  "features": {
    "y": true
  }
}
`,
    },
    integration: {
      "src/integration.ts": `// Integration module
import { featureX, featureY } from './utils';

export function integrate() {
  return [featureX(), featureY()];
}
`,
      "config.json": `{
  "name": "test-project",
  "version": "2.0.0",
  "features": {
    "x": true,
    "y": true,
    "integration": true
  }
}
`,
    },
    final: {
      "src/final.ts": `// Final integration
import { integrate } from './integration';

export function finalize() {
  return integrate();
}
`,
    },
  };

  return changes[prName] || {};
}
