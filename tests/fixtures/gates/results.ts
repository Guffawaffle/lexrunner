/**
 * Gate result factories for testing execution outcomes
 */

import type { GateResult, GateStatus } from "../../../src/schema.js";

/**
 * Fixed timestamp for deterministic fixtures
 * 2024-01-01T00:00:00.000Z
 */
const FIXTURE_TIMESTAMP = "2024-01-01T00:00:00.000Z";

/**
 * Create a passing gate result
 */
export function pass(
  gateName: string,
  options: {
    duration?: number;
    stdout?: string;
    attempts?: number;
    timestamp?: string;
  } = {}
): GateResult {
  return {
    gate: gateName,
    status: "pass" as GateStatus,
    exitCode: 0,
    duration: options.duration ?? 100,
    stdout: options.stdout ?? `${gateName} passed`,
    stderr: "",
    artifacts: [],
    attempts: options.attempts ?? 1,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}

/**
 * Create a failing gate result
 */
export function fail(
  gateName: string,
  options: {
    exitCode?: number;
    stderr?: string;
    duration?: number;
    attempts?: number;
    timestamp?: string;
  } = {}
): GateResult {
  return {
    gate: gateName,
    status: "fail" as GateStatus,
    exitCode: options.exitCode ?? 1,
    duration: options.duration ?? 50,
    stdout: "",
    stderr: options.stderr ?? `${gateName} failed`,
    artifacts: [],
    attempts: options.attempts ?? 1,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}

/**
 * Create a blocked gate result
 */
export function blocked(
  gateName: string,
  options: {
    timestamp?: string;
  } = {}
): GateResult {
  return {
    gate: gateName,
    status: "blocked" as GateStatus,
    attempts: 0,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}

/**
 * Create a skipped gate result
 */
export function skipped(
  gateName: string,
  options: {
    timestamp?: string;
  } = {}
): GateResult {
  return {
    gate: gateName,
    status: "skipped" as GateStatus,
    attempts: 0,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}

/**
 * Create a retrying gate result
 */
export function retrying(
  gateName: string,
  options: {
    attempts?: number;
    lastError?: string;
    timestamp?: string;
  } = {}
): GateResult {
  return {
    gate: gateName,
    status: "retrying" as GateStatus,
    exitCode: 1,
    stderr: options.lastError ?? "Temporary failure",
    attempts: options.attempts ?? 2,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}

/**
 * Create results for all gates passing
 */
export function allPass(gateNames: string[]): GateResult[] {
  return gateNames.map((name) => pass(name));
}

/**
 * Create results for all gates failing
 */
export function allFail(gateNames: string[]): GateResult[] {
  return gateNames.map((name) => fail(name));
}

/**
 * Create mixed results (some pass, some fail)
 */
export function someFail(config: { pass: string[]; fail: string[] }): GateResult[] {
  return [...config.pass.map((name) => pass(name)), ...config.fail.map((name) => fail(name))];
}

/**
 * Create results with retries
 */
export function withRetries(config: {
  gate: string;
  attempts: number;
  finalStatus: "pass" | "fail";
}): GateResult {
  if (config.finalStatus === "pass") {
    return pass(config.gate, { attempts: config.attempts });
  } else {
    return fail(config.gate, { attempts: config.attempts });
  }
}

/**
 * Create results with artifacts
 */
export function withArtifacts(gateName: string, artifacts: string[]): GateResult {
  return {
    ...pass(gateName),
    artifacts,
  };
}

/**
 * Create a slow gate result (high duration)
 */
export function slowPass(gateName: string, durationMs: number): GateResult {
  return pass(gateName, { duration: durationMs });
}

/**
 * Create a realistic test suite result
 */
export function testSuite(
  options: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    duration?: number;
    timestamp?: string;
  } = {}
): GateResult {
  const total = options.total ?? 100;
  const passed = options.passed ?? 95;
  const failed = options.failed ?? 0;
  const skipped = options.skipped ?? 5;

  const status = failed > 0 ? "fail" : "pass";
  const stdout = `Tests: ${passed} passed, ${failed} failed, ${skipped} skipped, ${total} total`;

  return {
    gate: "test",
    status: status as GateStatus,
    exitCode: failed > 0 ? 1 : 0,
    duration: options.duration ?? 5000,
    stdout,
    stderr: failed > 0 ? "Some tests failed" : "",
    artifacts: ["coverage/"],
    attempts: 1,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}

/**
 * Create a realistic lint result
 */
export function lintResult(
  options: {
    errors?: number;
    warnings?: number;
    duration?: number;
    timestamp?: string;
  } = {}
): GateResult {
  const errors = options.errors ?? 0;
  const warnings = options.warnings ?? 2;

  const status = errors > 0 ? "fail" : "pass";
  const stdout = `${errors} errors, ${warnings} warnings`;

  return {
    gate: "lint",
    status: status as GateStatus,
    exitCode: errors > 0 ? 1 : 0,
    duration: options.duration ?? 1000,
    stdout,
    stderr: errors > 0 ? "Linting errors found" : "",
    artifacts: [],
    attempts: 1,
    lastAttempt: options.timestamp ?? FIXTURE_TIMESTAMP,
  };
}
