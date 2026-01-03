/**
 * Convert GitHub check runs to gate results
 */

import type { GitHubCheckRun } from "../github/types.js";
import type { GateResult } from "../schema.js";
import type { GateMappingConfig } from "../schema/gateMapping.js";
import { mapCheckNameToGate } from "../schema/gateMapping.js";

/**
 * Convert a GitHub check run to a gate result
 */
export function convertCheckRunToGateResult(
  check: GitHubCheckRun,
  config: GateMappingConfig
): GateResult | null {
  // Map check name to gate name
  const gateName = mapCheckNameToGate(check.name, config);
  if (!gateName) {
    // No mapping found, skip this check
    return null;
  }

  // Only process completed checks
  if (check.status !== "completed") {
    return null;
  }

  // Map conclusion to gate status
  let status: "pass" | "fail" | "skipped";
  switch (check.conclusion) {
    case "success":
      status = "pass";
      break;
    case "skipped":
    case "neutral":
      status = "skipped";
      break;
    case "failure":
    case "timed_out":
    case "action_required":
    case "cancelled":
    default:
      status = "fail";
      break;
  }

  // Calculate duration if both timestamps are available
  let duration: number | undefined;
  if (check.started_at && check.completed_at) {
    const started = new Date(check.started_at).getTime();
    const completed = new Date(check.completed_at).getTime();
    duration = completed - started;
  }

  return {
    gate: gateName,
    status,
    exitCode: status === "pass" ? 0 : 1,
    duration,
    stdout: `GitHub check: ${check.name}\nStatus: ${check.status}\nConclusion: ${check.conclusion || "unknown"}`,
    stderr: status === "fail" ? `Check failed: ${check.name}` : "",
    artifacts: [check.html_url],
    attempts: 1,
    lastAttempt: check.completed_at || new Date().toISOString(),
  };
}

/**
 * Convert multiple GitHub check runs to gate results
 */
export function convertCheckRunsToGateResults(
  checks: GitHubCheckRun[],
  config: GateMappingConfig
): GateResult[] {
  const results: GateResult[] = [];
  const seenGates = new Set<string>();

  for (const check of checks) {
    const result = convertCheckRunToGateResult(check, config);
    if (result) {
      // Only include the first result for each gate (in case of duplicates)
      if (!seenGates.has(result.gate)) {
        results.push(result);
        seenGates.add(result.gate);
      }
    }
  }

  return results;
}
