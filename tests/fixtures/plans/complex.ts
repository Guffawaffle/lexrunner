import type { Plan } from "../../../src/schema.js";

/**
 * Complex realistic plan with 20+ PRs, multiple dependency chains
 * Simulates a real-world feature rollout with multiple teams
 *
 * Structure:
 * - 3 foundation PRs (parallel)
 * - 6 feature PRs (depend on foundations)
 * - 4 integration PRs (depend on features)
 * - 3 polish PRs (depend on integration)
 * - Total: 16 PRs with max depth of 4
 */
export function complex(): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    policy: {
      requiredGates: ["lint", "test"],
      optionalGates: ["e2e"],
      maxWorkers: 4,
      retries: {
        e2e: { maxAttempts: 2, backoffSeconds: 5 },
      },
    },
    items: [
      // Layer 0: Foundations (parallel)
      {
        name: "foundation-api",
        deps: [],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "foundation-db",
        deps: [],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "foundation-ui",
        deps: [],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },

      // Layer 1: Core features
      {
        name: "feature-auth",
        deps: ["foundation-api", "foundation-db"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "feature-users",
        deps: ["foundation-api", "foundation-db"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "feature-roles",
        deps: ["foundation-api", "foundation-db"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "feature-profile",
        deps: ["foundation-ui"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "feature-settings",
        deps: ["foundation-ui"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "feature-notifications",
        deps: ["foundation-api"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },

      // Layer 2: Integrations
      {
        name: "integration-auth-ui",
        deps: ["feature-auth", "feature-profile"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
          { name: "e2e", run: 'echo "e2e pass"', env: {} },
        ],
      },
      {
        name: "integration-user-roles",
        deps: ["feature-users", "feature-roles"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "integration-settings-profile",
        deps: ["feature-settings", "feature-profile"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "integration-notifications",
        deps: ["feature-notifications", "feature-users"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },

      // Layer 3: Polish
      {
        name: "polish-ux",
        deps: ["integration-auth-ui", "integration-settings-profile"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
          { name: "e2e", run: 'echo "e2e pass"', env: {} },
        ],
      },
      {
        name: "polish-security",
        deps: ["integration-auth-ui", "integration-user-roles"],
        gates: [
          { name: "lint", run: 'echo "lint pass"', env: {} },
          { name: "test", run: 'echo "test pass"', env: {} },
        ],
      },
      {
        name: "polish-docs",
        deps: ["integration-notifications"],
        gates: [{ name: "lint", run: 'echo "lint pass"', env: {} }],
      },
    ],
  };
}

/**
 * Wide parallel plan with many independent PRs (stress test)
 * 10 completely independent PRs for testing parallel execution
 */
export function wideParallel(): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    policy: {
      maxWorkers: 8,
    },
    items: Array.from({ length: 10 }, (_, i) => ({
      name: `feature-${i + 1}`,
      deps: [],
      gates: [
        { name: "lint", run: 'echo "lint pass"', env: {} },
        { name: "test", run: 'echo "test pass"', env: {} },
      ],
    })),
  };
}

/**
 * Deep chain plan (stress test for sequential execution)
 * 15 PRs in a single dependency chain
 */
export function deepChain(): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: Array.from({ length: 15 }, (_, i) => ({
      name: `step-${i + 1}`,
      deps: i === 0 ? [] : [`step-${i}`],
      gates: [{ name: "lint", run: 'echo "lint pass"', env: {} }],
    })),
  };
}
