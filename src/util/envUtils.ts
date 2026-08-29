/**
 * Environment utilities for CI safety and variable aliasing
 */

import type { ProfileManifest } from "../config/profileResolver.js";

/**
 * Track deprecation notices to show each only once per process
 */
const deprecationNotices = new Set<string>();

/**
 * Get environment variable with alias fallback support
 *
 * Priority: primary variable > alias variable > undefined
 * Shows deprecation notice once per process when alias is used
 *
 * @param primary - Primary environment variable name (e.g., LEX_PR_PROFILE_DIR)
 * @param alias - Deprecated alias (e.g., LEXRUNNER_PROFILE_DIR)
 * @returns Value from primary, alias, or undefined
 */
export function getEnvWithAlias(primary: string, alias: string): string | undefined {
  const primaryValue = process.env[primary];
  const aliasValue = process.env[alias];

  if (primaryValue) {
    return primaryValue;
  }

  if (aliasValue) {
    // Emit deprecation notice once per process
    emitDeprecationNotice(alias, primary);
    return aliasValue;
  }

  return undefined;
}

/**
 * Emit deprecation notice for environment variable alias
 * Only shown once per process for each alias
 *
 * @param oldVar - Deprecated variable name
 * @param newVar - New variable name to use
 */
function emitDeprecationNotice(oldVar: string, newVar: string): void {
  const key = `${oldVar}->${newVar}`;

  if (deprecationNotices.has(key)) {
    return; // Already shown
  }

  deprecationNotices.add(key);

  console.warn(
    `⚠️  Environment variable ${oldVar} is deprecated. ` +
      `Use ${newVar} instead. Support for ${oldVar} will be removed in v3.0.0.`
  );
}

/**
 * Get CI mutation policy based on profile role
 *
 * For CI role:
 * - Forces ALLOW_MUTATIONS=false by default (safe default)
 * - Allows explicit override with ALLOW_MUTATIONS=true (with warning)
 * - Warns about invalid values
 *
 * For non-CI roles:
 * - Uses ALLOW_MUTATIONS value as-is
 *
 * @param profile - Profile manifest with role information
 * @returns true if mutations are allowed, false otherwise
 */
export function getCIMutationPolicy(profile: ProfileManifest): boolean {
  if (profile.role !== "ci") {
    // Non-CI profiles use ALLOW_MUTATIONS as-is
    return process.env.ALLOW_MUTATIONS === "true";
  }

  // CI role: force false unless explicitly true
  const explicit = process.env.ALLOW_MUTATIONS;

  if (explicit === "true") {
    console.warn("⚠️  CI role with ALLOW_MUTATIONS=true (explicit override)");
    return true;
  }

  if (explicit && explicit !== "false") {
    console.warn(`⚠️  Invalid ALLOW_MUTATIONS value: "${explicit}" (using false for CI)`);
  }

  return false;
}

/**
 * Validate CI environment for required configuration
 *
 * Checks:
 * - GITHUB_TOKEN or GH_TOKEN is present
 * - Warns about dangerous ALLOW_MUTATIONS=true
 *
 * @param profile - Profile manifest with role information
 * @throws Error if CI environment validation fails (missing required token)
 */
export function validateCIEnvironment(profile: ProfileManifest): void {
  if (profile.role !== "ci") {
    return;
  }

  const issues: string[] = [];

  // Require GITHUB_TOKEN
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    issues.push("Missing GITHUB_TOKEN (required for CI role)");
  }

  // Warn about mutations
  if (process.env.ALLOW_MUTATIONS === "true") {
    issues.push("ALLOW_MUTATIONS=true in CI role (dangerous)");
  }

  if (issues.length > 0) {
    console.error("❌ CI environment validation failed:");
    issues.forEach((issue) => console.error(`  - ${issue}`));

    if (issues.some((i) => i.includes("Missing GITHUB_TOKEN"))) {
      throw new Error("CI environment validation failed");
    }
  }
}

/**
 * Reset deprecation notices (for testing)
 * @internal
 */
export function resetDeprecationNotices(): void {
  deprecationNotices.clear();
}
