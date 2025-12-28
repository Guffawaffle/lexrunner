/**
 * Gate configuration factories
 */

import type { Gate } from "../../../src/schema.js";

/**
 * Create a basic lint gate
 */
export function lint(
  options: {
    run?: string;
    cwd?: string;
    env?: Record<string, string>;
  } = {}
): Gate {
  return {
    name: "lint",
    run: options.run ?? 'echo "lint pass"',
    cwd: options.cwd,
    env: options.env ?? {},
    runtime: "local",
    artifacts: [],
  };
}

/**
 * Create a basic test gate
 */
export function test(
  options: {
    run?: string;
    cwd?: string;
    env?: Record<string, string>;
  } = {}
): Gate {
  return {
    name: "test",
    run: options.run ?? 'echo "test pass"',
    cwd: options.cwd,
    env: options.env ?? {},
    runtime: "local",
    artifacts: [],
  };
}

/**
 * Create an e2e test gate
 */
export function e2e(
  options: {
    run?: string;
    cwd?: string;
    env?: Record<string, string>;
  } = {}
): Gate {
  return {
    name: "e2e",
    run: options.run ?? 'echo "e2e pass"',
    cwd: options.cwd,
    env: options.env ?? {},
    runtime: "local",
    artifacts: [],
  };
}

/**
 * Create a security scanning gate
 */
export function security(
  options: {
    run?: string;
    env?: Record<string, string>;
  } = {}
): Gate {
  return {
    name: "security",
    run: options.run ?? 'echo "security scan pass"',
    env: options.env ?? {},
    runtime: "local",
    artifacts: ["security-report.json"],
  };
}

/**
 * Create a build gate
 */
export function build(
  options: {
    run?: string;
    cwd?: string;
  } = {}
): Gate {
  return {
    name: "build",
    run: options.run ?? 'echo "build pass"',
    cwd: options.cwd,
    env: {},
    runtime: "local",
    artifacts: ["dist/"],
  };
}

/**
 * Create a flaky gate (for retry testing)
 * Note: This uses deterministic seeding instead of random
 */
export function flaky(
  options: {
    name?: string;
    maxAttempts?: number;
    backoffSeconds?: number;
    failureRate?: number; // 0.0 to 1.0, defaults to 0.5
  } = {}
): Gate {
  const failureRate = options.failureRate ?? 0.5;
  // Convert failure rate to deterministic command
  // Instead of random, use a command that can be controlled
  const command =
    failureRate >= 1.0
      ? "exit 1" // Always fail
      : failureRate <= 0.0
        ? "exit 0" // Always pass
        : 'echo "flaky - test with controlled failure rate"'; // Placeholder for testing

  return {
    name: options.name ?? "flaky",
    run: command,
    env: {},
    runtime: "local",
    artifacts: [],
  };
}

/**
 * Create a gate that runs in a container
 */
export function containerized(
  options: {
    name?: string;
    image?: string;
    run?: string;
  } = {}
): Gate {
  return {
    name: options.name ?? "container-gate",
    run: options.run ?? 'echo "container pass"',
    env: {},
    runtime: "container",
    container: {
      image: options.image ?? "node:20-alpine",
      mounts: [],
    },
    artifacts: [],
  };
}

/**
 * Create a gate with artifacts
 */
export function withArtifacts(
  options: {
    name?: string;
    artifacts: string[];
    run?: string;
  } = { artifacts: [] }
): Gate {
  return {
    name: options.name ?? "artifact-gate",
    run: options.run ?? 'echo "generating artifacts"',
    env: {},
    runtime: "local",
    artifacts: options.artifacts,
  };
}

/**
 * Create a slow gate (for timeout testing)
 */
export function slow(
  options: {
    name?: string;
    delaySeconds?: number;
  } = {}
): Gate {
  const delay = options.delaySeconds ?? 30;
  return {
    name: options.name ?? "slow",
    run: `sleep ${delay} && echo "slow gate done"`,
    env: {},
    runtime: "local",
    artifacts: [],
  };
}

/**
 * Create a standard set of gates (lint + test)
 */
export function standard(): Gate[] {
  return [lint(), test()];
}

/**
 * Create a full set of gates (lint + test + e2e + security)
 */
export function full(): Gate[] {
  return [lint(), test(), e2e(), security()];
}

/**
 * Create gates that will fail
 */
export function failing(gateNames: string[]): Gate[] {
  return gateNames.map((name) => ({
    name,
    run: "exit 1",
    env: {},
    runtime: "local" as const,
    artifacts: [],
  }));
}

/**
 * Create gates that will pass
 */
export function passing(gateNames: string[]): Gate[] {
  return gateNames.map((name) => ({
    name,
    run: 'echo "pass"',
    env: {},
    runtime: "local" as const,
    artifacts: [],
  }));
}
