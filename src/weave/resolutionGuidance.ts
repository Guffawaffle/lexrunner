/**
 * Conflict resolution guidance for common patterns
 *
 * Provides automated resolution hints for well-known file types
 * that typically have safe merge strategies.
 */

import type { ConflictResolutionGuidance } from "./types.js";

/**
 * Common file patterns that can be safely merged
 */
const AUTO_MERGE_PATTERNS = [
  { pattern: /tsconfig\.json$/i, type: "tsconfig" },
  { pattern: /package\.json$/i, type: "package" },
  { pattern: /\.eslintrc(\.json)?$/i, type: "eslint-config" },
  { pattern: /\.prettierrc(\.json)?$/i, type: "prettier-config" },
  { pattern: /jest\.config\.(js|ts)$/i, type: "jest-config" },
  { pattern: /vitest\.config\.(js|ts)$/i, type: "vitest-config" },
];

/**
 * Lock file patterns that should be regenerated
 */
const LOCK_FILE_PATTERNS = [
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /Gemfile\.lock$/i,
  /Cargo\.lock$/i,
  /composer\.lock$/i,
];

/**
 * Generate resolution guidance for a conflicted file
 */
export function generateResolutionGuidance(
  filePath: string
): ConflictResolutionGuidance | undefined {
  // Check for lock files
  if (LOCK_FILE_PATTERNS.some((pattern) => pattern.test(filePath))) {
    return {
      type: "auto-merge-safe",
      message: `Lock file can be regenerated after merge. Run the appropriate package manager command to update.`,
      confidence: 0.9,
      strategy: "manual",
      context: {
        fileType: "lock-file",
        regenerationCommand: getLockFileRegenerationCommand(filePath),
      },
    };
  }

  // Check for auto-mergeable configs
  const configMatch = AUTO_MERGE_PATTERNS.find((p) => p.pattern.test(filePath));
  if (configMatch) {
    const guidance = getConfigFileGuidance(configMatch.type, filePath);
    if (guidance) {
      return guidance;
    }
  }

  // No specific guidance available
  return undefined;
}

/**
 * Get guidance for configuration file types
 */
function getConfigFileGuidance(
  configType: string,
  filePath: string
): ConflictResolutionGuidance | undefined {
  switch (configType) {
    case "tsconfig":
      return {
        type: "auto-merge-safe",
        message: `TypeScript config files typically have additive changes (includes, compiler options). Merge both additions when possible.`,
        confidence: 0.85,
        strategy: "merge-both",
        context: {
          fileType: "tsconfig",
          commonConflicts: ["include", "exclude", "compilerOptions.paths"],
          safeMergeStrategy: "Combine array entries from both sides, remove duplicates",
        },
      };

    case "package":
      return {
        type: "auto-merge-safe",
        message: `Package.json conflicts often involve dependencies or scripts. Review both changes and merge additive changes.`,
        confidence: 0.75,
        strategy: "merge-both",
        context: {
          fileType: "package.json",
          commonConflicts: ["dependencies", "devDependencies", "scripts"],
          safeMergeStrategy: "Merge object properties from both sides, preferring latest versions",
          warning:
            "If both PRs modify the same dependency version differently, manual review required",
        },
      };

    case "eslint-config":
    case "prettier-config":
    case "jest-config":
    case "vitest-config":
      return {
        type: "manual-review",
        message: `Configuration file conflicts require review to ensure consistency. Both PRs may be changing the same settings.`,
        confidence: 0.6,
        strategy: "manual",
        context: {
          fileType: configType,
          recommendation: "Review both changes and ensure they are compatible",
        },
      };

    default:
      return undefined;
  }
}

/**
 * Get lock file regeneration command
 */
function getLockFileRegenerationCommand(filePath: string): string {
  if (/package-lock\.json$/i.test(filePath)) {
    return "npm install";
  }
  if (/yarn\.lock$/i.test(filePath)) {
    return "yarn install";
  }
  if (/pnpm-lock\.yaml$/i.test(filePath)) {
    return "pnpm install";
  }
  if (/Gemfile\.lock$/i.test(filePath)) {
    return "bundle install";
  }
  if (/Cargo\.lock$/i.test(filePath)) {
    return "cargo update";
  }
  if (/composer\.lock$/i.test(filePath)) {
    return "composer update";
  }
  return "regenerate lock file with package manager";
}

/**
 * Determine conflict severity based on file overlap
 */
export function determineConflictSeverity(
  file: string,
  item1Changes: string[],
  item2Changes: string[]
): "likely" | "possible" | "unlikely" {
  // If both items modified the same file
  if (item1Changes.includes(file) && item2Changes.includes(file)) {
    // Lock files are likely to conflict
    if (LOCK_FILE_PATTERNS.some((pattern) => pattern.test(file))) {
      return "likely";
    }

    // Config files with additive patterns are possible conflicts
    if (AUTO_MERGE_PATTERNS.some((p) => p.pattern.test(file))) {
      return "possible";
    }

    // Generic files are likely to conflict
    return "likely";
  }

  return "unlikely";
}
