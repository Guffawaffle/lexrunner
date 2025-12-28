import type { Plan } from "../../../src/schema.js";

/**
 * Simple plan with 2-3 independent PRs (no dependencies)
 * Use case: Testing basic plan execution, parallel processing
 */
export function simple(): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      {
        name: "feat-a",
        deps: [],
        gates: [],
      },
      {
        name: "feat-b",
        deps: [],
        gates: [],
      },
      {
        name: "feat-c",
        deps: [],
        gates: [],
      },
    ],
  };
}

/**
 * Simple plan with gates configured
 */
export function simpleWithGates(): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    policy: {
      requiredGates: ["lint", "test"],
      maxWorkers: 2,
    },
    items: [
      {
        name: "feat-a",
        deps: [],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "feat-b",
        deps: [],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
    ],
  };
}
