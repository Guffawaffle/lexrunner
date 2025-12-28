/**
 * Context diet integration - combines diff hunks, symbol maps, and minimal PR metadata
 * Provides complete minimal context packaging for AI consumption
 */

import type { PullRequest } from "./types.js";
import {
  extractDiffHunks,
  optimizeHunkSize,
  formatMinimalDiff,
  calculateContextMetrics,
  type MinimalDiffContext,
  type ContextMetrics,
} from "./diffHunks.js";
import { buildSymbolMaps, formatSymbolMaps, type SymbolMapContext } from "./symbolMap.js";
import {
  filterPRMetadata,
  filterPRsWithMetrics,
  formatMinimalPR,
  formatMinimalPRs,
  type MinimalPRMetadata,
  type MinimalPRContext,
} from "./minimalContext.js";

export interface CompleteMinimalContext {
  /** Filtered PR metadata */
  prMetadata: MinimalPRContext;
  /** Diff hunks (if available) */
  diffContext?: MinimalDiffContext;
  /** Symbol maps (if available) */
  symbolMaps?: SymbolMapContext;
  /** Overall size metrics */
  metrics: OverallContextMetrics;
}

export interface OverallContextMetrics {
  /** Total context size in characters */
  totalSize: number;
  /** PR metadata size */
  prMetadataSize: number;
  /** Diff hunks size (if included) */
  diffSize?: number;
  /** Symbol map size (if included) */
  symbolMapSize?: number;
  /** Original size estimate (without optimization) */
  estimatedOriginalSize: number;
  /** Reduction percentage */
  reductionPercent: number;
  /** Number of PRs */
  prCount: number;
  /** Number of PRs with body included */
  prWithBodyCount: number;
  /** Number of files in diff */
  fileCount?: number;
  /** Number of hunks */
  hunkCount?: number;
  /** Number of symbols */
  symbolCount?: number;
}

/**
 * Build complete minimal context from PRs and optional diff/file data
 */
export async function buildMinimalContext(
  prs: PullRequest[],
  options?: {
    /** Unified diff content for the changes */
    diff?: string;
    /** Source files for symbol extraction */
    files?: Array<{ path: string; content: string }>;
  }
): Promise<CompleteMinimalContext> {
  // Filter PR metadata
  const prMetadata = filterPRsWithMetrics(prs);

  // Extract and optimize diff hunks if provided
  let diffContext: MinimalDiffContext | undefined;
  let diffMetrics: ContextMetrics | undefined;
  if (options?.diff) {
    const extracted = extractDiffHunks(options.diff);
    diffContext = optimizeHunkSize(extracted);
    diffMetrics = calculateContextMetrics(options.diff, diffContext);
  }

  // Build symbol maps if files provided
  let symbolMaps: SymbolMapContext | undefined;
  if (options?.files) {
    symbolMaps = buildSymbolMaps(options.files);
  }

  // Calculate overall metrics
  const prMetadataSize = prMetadata.totalSize;
  const diffSize = diffContext?.totalSize;
  const symbolMapSize = symbolMaps?.mapSize;

  const totalSize = prMetadataSize + (diffSize || 0) + (symbolMapSize || 0);
  const estimatedOriginalSize =
    prMetadata.originalSize + (diffMetrics?.rawSize || 0) + (symbolMapSize || 0); // Symbol maps don't have reduction

  const reductionPercent =
    estimatedOriginalSize > 0
      ? ((estimatedOriginalSize - totalSize) / estimatedOriginalSize) * 100
      : 0;

  return {
    prMetadata,
    diffContext,
    symbolMaps,
    metrics: {
      totalSize,
      prMetadataSize,
      diffSize,
      symbolMapSize,
      estimatedOriginalSize,
      reductionPercent,
      prCount: prs.length,
      prWithBodyCount: prMetadata.withBodyCount,
      fileCount: diffContext?.fileCount,
      hunkCount: diffContext?.hunkCount,
      symbolCount: symbolMaps?.symbolCount,
    },
  };
}

/**
 * Format complete minimal context as text for AI consumption
 */
export function formatCompleteContext(context: CompleteMinimalContext): string {
  const parts: string[] = [];

  parts.push("# Minimal Context Package");
  parts.push("");
  parts.push("## Metrics");
  parts.push(`- Total size: ${context.metrics.totalSize} chars`);
  parts.push(`- Reduction: ${context.metrics.reductionPercent.toFixed(1)}%`);
  parts.push(`- PRs: ${context.metrics.prCount} (${context.metrics.prWithBodyCount} with body)`);
  if (context.metrics.fileCount !== undefined) {
    parts.push(`- Files: ${context.metrics.fileCount}`);
  }
  if (context.metrics.hunkCount !== undefined) {
    parts.push(`- Hunks: ${context.metrics.hunkCount}`);
  }
  if (context.metrics.symbolCount !== undefined) {
    parts.push(`- Symbols: ${context.metrics.symbolCount}`);
  }
  parts.push("");

  // PR Metadata
  parts.push(formatMinimalPRs(context.prMetadata));

  // Diff hunks
  if (context.diffContext) {
    parts.push("---");
    parts.push("");
    parts.push(formatMinimalDiff(context.diffContext));
  }

  // Symbol maps
  if (context.symbolMaps) {
    parts.push("---");
    parts.push("");
    parts.push(formatSymbolMaps(context.symbolMaps));
  }

  return parts.join("\n");
}

/**
 * Export metrics as JSON for monitoring
 */
export function exportMetrics(context: CompleteMinimalContext): string {
  return JSON.stringify(context.metrics, null, 2);
}

/**
 * Build minimal context for a single PR with diff
 */
export async function buildMinimalPRContext(
  pr: PullRequest,
  diff?: string,
  files?: Array<{ path: string; content: string }>
): Promise<CompleteMinimalContext> {
  return buildMinimalContext([pr], { diff, files });
}

// Re-export types and utilities
export type {
  MinimalPRMetadata,
  MinimalPRContext,
  MinimalDiffContext,
  SymbolMapContext,
  ContextMetrics,
};

export {
  filterPRMetadata,
  filterPRsWithMetrics,
  formatMinimalPR,
  extractDiffHunks,
  optimizeHunkSize,
  formatMinimalDiff,
  buildSymbolMaps,
  formatSymbolMaps,
  calculateContextMetrics,
};
