/**
 * Policy Loader
 *
 * Loads and validates merge-weave-policy.yml files from the filesystem.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { type MergeWeavePolicy, parseMergeWeavePolicy, validatePolicyVersion } from "./schema.js";

/** Default policy file paths to search */
const DEFAULT_POLICY_PATHS = [
  ".smartergpt/merge-weave-policy.yml",
  ".smartergpt/merge-weave-policy.yaml",
  "merge-weave-policy.yml",
  "merge-weave-policy.yaml",
];

export interface LoadPolicyOptions {
  /** Explicit path to policy file */
  policyPath?: string;
  /** Working directory to search from */
  cwd?: string;
  /** Skip version validation */
  skipVersionCheck?: boolean;
}

export interface LoadPolicyResult {
  policy: MergeWeavePolicy;
  /** Resolved absolute path to the policy file */
  resolvedPath: string;
  /** Directory containing the policy file */
  policyDir: string;
}

/**
 * Error thrown when policy cannot be loaded
 */
export class PolicyLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "PolicyLoadError";
  }
}

/**
 * Find the policy file in default locations
 */
async function findPolicyFile(cwd: string): Promise<string | null> {
  for (const relPath of DEFAULT_POLICY_PATHS) {
    const absPath = resolve(cwd, relPath);
    try {
      await readFile(absPath);
      return absPath;
    } catch {
      // File doesn't exist, try next
    }
  }
  return null;
}

/**
 * Load and validate a merge-weave policy
 *
 * @param options - Loading options
 * @returns Loaded and validated policy with metadata
 * @throws PolicyLoadError if file cannot be found, read, or validated
 */
export async function loadPolicy(options: LoadPolicyOptions = {}): Promise<LoadPolicyResult> {
  const cwd = options.cwd ?? process.cwd();

  // Resolve policy path
  let resolvedPath: string;
  if (options.policyPath) {
    resolvedPath = resolve(cwd, options.policyPath);
  } else {
    const found = await findPolicyFile(cwd);
    if (!found) {
      throw new PolicyLoadError(
        `No merge-weave policy file found. Searched: ${DEFAULT_POLICY_PATHS.join(", ")}`
      );
    }
    resolvedPath = found;
  }

  // Read file
  let content: string;
  try {
    content = await readFile(resolvedPath, "utf-8");
  } catch (err) {
    throw new PolicyLoadError(`Failed to read policy file: ${resolvedPath}`, err as Error);
  }

  // Parse YAML
  let rawData: unknown;
  try {
    rawData = parseYaml(content);
  } catch (err) {
    throw new PolicyLoadError(`Failed to parse YAML in policy file: ${resolvedPath}`, err as Error);
  }

  // Validate with Zod
  let policy: MergeWeavePolicy;
  try {
    policy = parseMergeWeavePolicy(rawData);
  } catch (err) {
    // Preserve full error details for debugging
    const errorMessage = err instanceof Error ? err.message : JSON.stringify(err, null, 2);
    throw new PolicyLoadError(`Policy validation failed: ${resolvedPath}`, new Error(errorMessage));
  }

  // Version check
  if (!options.skipVersionCheck) {
    try {
      validatePolicyVersion(policy);
    } catch (err) {
      throw new PolicyLoadError(`Policy version incompatible: ${resolvedPath}`, err as Error);
    }
  }

  return {
    policy,
    resolvedPath,
    policyDir: dirname(resolvedPath),
  };
}

/**
 * Load policy or return null if not found (no throw)
 */
export async function loadPolicyOrNull(
  options: LoadPolicyOptions = {}
): Promise<LoadPolicyResult | null> {
  try {
    return await loadPolicy(options);
  } catch (err) {
    if (err instanceof PolicyLoadError && err.message.includes("not found")) {
      return null;
    }
    throw err;
  }
}
