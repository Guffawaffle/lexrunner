/**
 * Module Alias Resolution
 *
 * Public API for resolving file paths to canonical module IDs.
 * Integrates with Lex's aliasing system for Frame emission.
 *
 * @module
 */

export type { ModuleResolution, ResolveOptions } from "./resolver.js";
export {
  resolveModulePath,
  resolveModulePaths,
  extractCanonicalIds,
  clearResolverCache,
} from "./resolver.js";
