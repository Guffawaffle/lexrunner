/**
 * Performance report generation utilities
 * Generates Markdown and JSON reports from benchmark results
 */

export interface BenchmarkResult {
  name: string;
  suite: string;
  meanTime: number;
  minTime: number;
  maxTime: number;
  stdDev: number;
  samples: number;
}

export interface BaselineResult {
  name: string;
  suite: string;
  meanTime: number;
}

export interface ComparisonResult {
  name: string;
  suite: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  status: "pass" | "warning" | "regression";
}

/**
 * Compare current results against baseline
 */
export function compareResults(
  current: BenchmarkResult[],
  baseline: BaselineResult[]
): ComparisonResult[] {
  const baselineMap = new Map(baseline.map((b) => [`${b.suite}:${b.name}`, b]));
  const comparisons: ComparisonResult[] = [];

  for (const result of current) {
    const key = `${result.suite}:${result.name}`;
    const baselineResult = baselineMap.get(key);

    if (!baselineResult) {
      // New benchmark, no baseline
      continue;
    }

    const delta = result.meanTime - baselineResult.meanTime;
    const deltaPercent = (delta / baselineResult.meanTime) * 100;

    let status: "pass" | "warning" | "regression";
    if (deltaPercent > 20) {
      status = "regression";
    } else if (deltaPercent > 10) {
      status = "warning";
    } else {
      status = "pass";
    }

    comparisons.push({
      name: result.name,
      suite: result.suite,
      baseline: baselineResult.meanTime,
      current: result.meanTime,
      delta,
      deltaPercent,
      status,
    });
  }

  return comparisons;
}

/**
 * Generate Markdown report from comparison results
 */
export function generateMarkdownReport(
  comparisons: ComparisonResult[],
  metadata?: {
    baselineVersion?: string;
    currentVersion?: string;
    baselineDate?: string;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push("# Performance Benchmark Results\n");

  if (metadata) {
    if (metadata.baselineVersion) {
      lines.push(
        `**Baseline:** ${metadata.baselineVersion}${metadata.baselineDate ? ` (${metadata.baselineDate})` : ""}`
      );
    }
    if (metadata.currentVersion) {
      lines.push(`**Current:** ${metadata.currentVersion}`);
    }
    lines.push("");
  }

  // Group by suite
  const suites = new Map<string, ComparisonResult[]>();
  for (const comp of comparisons) {
    if (!suites.has(comp.suite)) {
      suites.set(comp.suite, []);
    }
    suites.get(comp.suite)!.push(comp);
  }

  // Generate table for each suite
  for (const [suite, results] of suites) {
    lines.push(`## ${suite}\n`);
    lines.push("| Operation | Baseline | Current | Delta | Status |");
    lines.push("|-----------|----------|---------|-------|--------|");

    for (const result of results) {
      const baselineStr = formatTime(result.baseline);
      const currentStr = formatTime(result.current);
      const deltaStr = formatDelta(result.deltaPercent);
      const statusIcon = getStatusIcon(result.status);

      lines.push(
        `| ${result.name} | ${baselineStr} | ${currentStr} | ${deltaStr} | ${statusIcon} |`
      );
    }

    lines.push("");
  }

  // Summary
  const regressions = comparisons.filter((c) => c.status === "regression");
  const warnings = comparisons.filter((c) => c.status === "warning");
  const passes = comparisons.filter((c) => c.status === "pass");

  lines.push("## Summary\n");
  lines.push(`- ✅ Passed: ${passes.length}`);
  lines.push(`- ⚠️ Warnings: ${warnings.length}`);
  lines.push(`- ❌ Regressions: ${regressions.length}`);
  lines.push("");

  if (regressions.length > 0) {
    lines.push("### ❌ Performance Regressions Detected\n");
    for (const reg of regressions) {
      lines.push(`- **${reg.suite} / ${reg.name}**: ${formatDelta(reg.deltaPercent)} slower`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("### ⚠️ Performance Warnings\n");
    for (const warn of warnings) {
      lines.push(`- **${warn.suite} / ${warn.name}**: ${formatDelta(warn.deltaPercent)} slower`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate JSON report from comparison results
 */
export function generateJSONReport(
  comparisons: ComparisonResult[],
  metadata?: {
    baselineVersion?: string;
    currentVersion?: string;
    timestamp?: string;
  }
): string {
  const report = {
    metadata: {
      baselineVersion: metadata?.baselineVersion || "unknown",
      currentVersion: metadata?.currentVersion || "unknown",
      timestamp: metadata?.timestamp || new Date().toISOString(),
      totalBenchmarks: comparisons.length,
      regressions: comparisons.filter((c) => c.status === "regression").length,
      warnings: comparisons.filter((c) => c.status === "warning").length,
      passes: comparisons.filter((c) => c.status === "pass").length,
    },
    results: comparisons,
  };

  return JSON.stringify(report, null, 2);
}

/**
 * Format time in human-readable format
 */
function formatTime(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/**
 * Format delta percentage
 */
function formatDelta(deltaPercent: number): string {
  const sign = deltaPercent >= 0 ? "+" : "";
  return `${sign}${deltaPercent.toFixed(1)}%`;
}

/**
 * Get status icon
 */
function getStatusIcon(status: "pass" | "warning" | "regression"): string {
  switch (status) {
    case "pass":
      return "✅";
    case "warning":
      return "⚠️";
    case "regression":
      return "❌ REGRESSION";
  }
}

/**
 * Check if there are any regressions
 */
export function hasRegressions(comparisons: ComparisonResult[]): boolean {
  return comparisons.some((c) => c.status === "regression");
}
