/**
 * Lock hash computation for merge-weave idempotency
 * Computes hash of plan.json + PR head commits to detect duplicate runs
 */

import { sha256 } from "./hash.js";
import { canonicalJSONStringify } from "./canonicalJson.js";
import type { Plan } from "../schema.js";

/**
 * PR head information for lock hash computation
 */
export interface PRHead {
  name: string;
  sha: string;
}

/**
 * Lock hash result with metadata
 */
export interface LockHashResult {
  hash: string;
  inputs: {
    planHash: string;
    prHeads: PRHead[];
  };
  timestamp: string;
}

/**
 * Compute lock hash from plan and PR head commits
 * Lock hash = SHA256(canonical(plan.json) + sorted(PR heads by name))
 *
 * @param plan - The plan configuration
 * @param prHeads - Array of PR head commits (name + sha)
 * @returns Lock hash result with metadata
 */
export function computeLockHash(plan: Plan, prHeads: PRHead[]): LockHashResult {
  // Compute canonical plan hash
  const planJson = canonicalJSONStringify(plan);
  const planHash = sha256(Buffer.from(planJson));

  // Sort PR heads by name for deterministic ordering
  const sortedPrHeads = [...prHeads].sort((a, b) => a.name.localeCompare(b.name));

  // Create combined input: plan hash + sorted PR heads
  const prHeadsStr = sortedPrHeads.map((pr) => `${pr.name}:${pr.sha}`).join(",");
  const combinedInput = `${planHash}:${prHeadsStr}`;

  // Compute final lock hash
  const lockHash = sha256(Buffer.from(combinedInput));

  return {
    hash: lockHash,
    inputs: {
      planHash,
      prHeads: sortedPrHeads,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format lock hash for display (first 12 characters)
 */
export function formatLockHash(hash: string): string {
  return hash.substring(0, 12);
}

/**
 * Generate lock-based branch name
 */
export function generateLockBranchName(prefix: string, lockHash: string): string {
  const shortHash = formatLockHash(lockHash);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
  return `${prefix}${timestamp}-${shortHash}`;
}

/**
 * Generate lock-based filename
 */
export function generateLockFilename(
  base: string,
  lockHash: string,
  extension: string = ""
): string {
  const shortHash = formatLockHash(lockHash);
  const ext = extension ? `.${extension}` : "";
  return `${base}-${shortHash}${ext}`;
}
