/**
 * Token report command - Analyze and summarize token usage from logs
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { resolveProfile } from "../config/profileResolver.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import type { TokenUsageEntry } from "../monitoring/tokenLogger.js";

interface TokenReportCommandDeps {
  jsonModeActive: () => boolean;
}

interface SourceSummary {
  source: string;
  totalTokens: number;
  entryCount: number;
}

interface TokenReport {
  totalTokens: number;
  totalEntries: number;
  bySource: SourceSummary[];
  byOperation: Record<string, number>;
  logFilePath: string;
}

/**
 * Read and parse token usage log
 */
function readTokenLog(logFilePath: string): TokenUsageEntry[] {
  if (!fs.existsSync(logFilePath)) {
    return [];
  }

  const content = fs.readFileSync(logFilePath, "utf-8");
  const lines = content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as TokenUsageEntry);
}

/**
 * Generate token usage report from log entries
 */
function generateReport(entries: TokenUsageEntry[], logFilePath: string): TokenReport {
  const bySourceMap = new Map<string, { tokens: number; count: number }>();
  const byOperationMap = new Map<string, number>();
  let totalTokens = 0;

  for (const entry of entries) {
    totalTokens += entry.estimatedTokens;

    // By source
    const sourceStat = bySourceMap.get(entry.source) || { tokens: 0, count: 0 };
    sourceStat.tokens += entry.estimatedTokens;
    sourceStat.count += 1;
    bySourceMap.set(entry.source, sourceStat);

    // By operation
    const opTokens = byOperationMap.get(entry.operation) || 0;
    byOperationMap.set(entry.operation, opTokens + entry.estimatedTokens);
  }

  // Convert to sorted arrays
  const bySource = Array.from(bySourceMap.entries())
    .map(([source, { tokens, count }]) => ({
      source,
      totalTokens: tokens,
      entryCount: count,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const byOperation: Record<string, number> = {};
  Array.from(byOperationMap.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([op, tokens]) => {
      byOperation[op] = tokens;
    });

  return {
    totalTokens,
    totalEntries: entries.length,
    bySource,
    byOperation,
    logFilePath,
  };
}

/**
 * Format report as human-readable text
 */
function formatReportText(report: TokenReport): string {
  const lines: string[] = [];

  lines.push("Token Usage Report");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`Total Tokens: ${report.totalTokens.toLocaleString()}`);
  lines.push(`Total Entries: ${report.totalEntries.toLocaleString()}`);
  lines.push(`Log File: ${report.logFilePath}`);
  lines.push("");

  if (report.bySource.length > 0) {
    lines.push("By Source:");
    lines.push("-".repeat(60));
    for (const { source, totalTokens, entryCount } of report.bySource) {
      const percentage =
        report.totalTokens > 0 ? ((totalTokens / report.totalTokens) * 100).toFixed(1) : "0.0";
      lines.push(`  ${source}`);
      lines.push(`    Tokens: ${totalTokens.toLocaleString()} (${percentage}%)`);
      lines.push(`    Entries: ${entryCount}`);
    }
    lines.push("");
  }

  if (Object.keys(report.byOperation).length > 0) {
    lines.push("By Operation:");
    lines.push("-".repeat(60));
    for (const [operation, tokens] of Object.entries(report.byOperation)) {
      const percentage =
        report.totalTokens > 0 ? ((tokens / report.totalTokens) * 100).toFixed(1) : "0.0";
      lines.push(`  ${operation}: ${tokens.toLocaleString()} (${percentage}%)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Register the token-report command
 */
export function registerTokenReportCommand(program: Command, deps: TokenReportCommandDeps): void {
  program
    .command("token-report")
    .description("Analyze and summarize token usage from logs")
    .option("--profile-dir <dir>", "Profile directory")
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        // Resolve profile directory
        const profile = resolveProfile(opts.profileDir);
        const logFilePath = path.join(profile.path, "runner", "logs", "token-usage.jsonl");

        // Read and analyze log
        const entries = readTokenLog(logFilePath);
        const report = generateReport(entries, logFilePath);

        // Output report
        if (opts.json || deps.jsonModeActive()) {
          writeJsonOutput(report);
        } else {
          console.log(formatReportText(report));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error generating token report: ${message}`);
        throwExit(1);
      }
    });
}
