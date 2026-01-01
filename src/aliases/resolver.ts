/**
 * Module Alias Resolver
 *
 * Integrates with Lex's aliasing system to resolve file paths to canonical module IDs
 * for Frame emission. Implements LPR-019: Module aliasing integration.
 *
 * Design:
 * - Loads alias table from Lex (via @smartergpt/lex/aliases)
 * - Resolves file paths to canonical module IDs
 * - Falls back gracefully when aliases not found
 * - Supports both file paths and PR numbers (passes through non-paths)
 */

import {
  resolveModuleId,
  loadAliasTable,
  type AliasTable,
  type AliasResolution,
} from "@smartergpt/lex/aliases";
import { loadPolicy, type Policy } from "@smartergpt/lex";

/**
 * Resolution result with additional metadata
 */
export interface ModuleResolution {
  /** The canonical module ID */
  canonical: string;
  /** The original input */
  original: string;
  /** Whether this was resolved via alias table */
  resolved: boolean;
  /** Confidence score from Lex resolver */
  confidence: number;
}

/**
 * Options for module path resolution
 */
export interface ResolveOptions {
  /** Path to custom aliases.json (defaults to Lex default) */
  aliasTablePath?: string;
  /** Path to custom lexmap.policy.json (defaults to Lex default) */
  policyPath?: string;
  /** Whether to warn on unresolved paths (default: true) */
  warnOnUnresolved?: boolean;
  /** Minimum confidence threshold for acceptance (default: 0.9) */
  minConfidence?: number;
  /** Base directory for frame storage and other file operations */
  baseDir?: string;
}

/**
 * Cached policy and alias table for performance
 */
let cachedPolicy: Policy | null = null;
let cachedAliasTable: AliasTable | null = null;

/**
 * Clear cached policy and alias table (useful for testing)
 */
export function clearResolverCache(): void {
  cachedPolicy = null;
  cachedAliasTable = null;
}

/**
 * Check if a string looks like a file path (vs PR number like "#123")
 */
function isFilePath(input: string): boolean {
  // PR numbers: "#123", "PR-123", etc.
  if (input.match(/^(#|PR-)\d+$/i)) {
    return false;
  }
  // File paths contain slashes or dots
  return input.includes("/") || input.includes(".");
}

/**
 * Resolve a single module path to its canonical module ID
 *
 * @param input - File path or PR number
 * @param options - Resolution options
 * @returns Module resolution with canonical ID
 *
 * @example
 * ```typescript
 * // File path resolution
 * const result = await resolveModulePath('src/cli/commands/merge.ts');
 * // { canonical: 'cli/commands/merge', original: 'src/cli/commands/merge.ts', resolved: true, confidence: 1.0 }
 *
 * // PR number passthrough
 * const result2 = await resolveModulePath('#123');
 * // { canonical: '#123', original: '#123', resolved: false, confidence: 1.0 }
 * ```
 */
export async function resolveModulePath(
  input: string,
  options: ResolveOptions = {}
): Promise<ModuleResolution> {
  // Fast path: if not a file path, return as-is (e.g., PR numbers)
  if (!isFilePath(input)) {
    return {
      canonical: input,
      original: input,
      resolved: false,
      confidence: 1.0,
    };
  }

  try {
    // Load policy if not cached
    if (!cachedPolicy) {
      cachedPolicy = await loadPolicy(options.policyPath);
    }

    // Load alias table if not cached
    if (!cachedAliasTable) {
      cachedAliasTable = loadAliasTable(options.aliasTablePath);
    }

    // TypeScript: ensure policy is loaded before passing to resolveModuleId
    if (!cachedPolicy) {
      throw new Error("Failed to load policy");
    }

    // Resolve through Lex alias system
    const resolution: AliasResolution = await resolveModuleId(
      input,
      cachedPolicy,
      cachedAliasTable
    );

    const minConfidence = options.minConfidence ?? 0.9;
    const warnOnUnresolved = options.warnOnUnresolved ?? true;

    // Check confidence threshold
    if (resolution.confidence < minConfidence) {
      if (warnOnUnresolved && process.env.DEBUG) {
        console.warn(
          `[alias-resolver] Low confidence (${resolution.confidence}) for "${input}" → "${resolution.canonical}"`
        );
      }
      // Use original input for low-confidence matches
      return {
        canonical: input,
        original: input,
        resolved: false,
        confidence: resolution.confidence,
      };
    }

    return {
      canonical: resolution.canonical,
      original: input,
      resolved: resolution.source === "alias" || resolution.source === "exact",
      confidence: resolution.confidence,
    };
  } catch (error) {
    // Fallback: use original path on error
    if (options.warnOnUnresolved ?? true) {
      if (process.env.DEBUG) {
        console.warn(`[alias-resolver] Failed to resolve "${input}":`, error);
      }
    }
    return {
      canonical: input,
      original: input,
      resolved: false,
      confidence: 0,
    };
  }
}

/**
 * Resolve multiple module paths to canonical module IDs
 *
 * Batch version of resolveModulePath for efficiency.
 *
 * @param paths - Array of file paths or PR numbers
 * @param options - Resolution options
 * @returns Array of module resolutions
 *
 * @example
 * ```typescript
 * const results = await resolveModulePaths([
 *   'src/cli.ts',
 *   '#123',
 *   'src/frames/emitter.ts'
 * ]);
 * // Returns canonical IDs for file paths, passes through PR numbers
 * ```
 */
export async function resolveModulePaths(
  paths: string[],
  options: ResolveOptions = {}
): Promise<ModuleResolution[]> {
  // Resolve all paths in parallel
  const resolutions = await Promise.all(paths.map((path) => resolveModulePath(path, options)));
  return resolutions;
}

/**
 * Extract canonical module IDs from resolution results
 *
 * Helper to get just the canonical IDs for Frame emission.
 *
 * @param resolutions - Array of module resolutions
 * @returns Array of canonical module IDs
 */
export function extractCanonicalIds(resolutions: ModuleResolution[]): string[] {
  return resolutions.map((r) => r.canonical);
}
