/**
 * Orchestrate: analyze-issues command - Issue analysis for parallelization
 */

import { Command } from "commander";
import { createGitHubClient } from "../../github/client.js";
import { createIssueAnalyzer } from "../../orchestrate/analyzer.js";
import type { IssueAnalysisResult } from "../../orchestrate/types.js";
import { throwExit } from "../../cli/exitHandler.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";

/**
 * Format analysis result as a human-readable table
 */
function formatTable(result: IssueAnalysisResult): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push("Issue Analysis Results");
  lines.push("=".repeat(80));
  lines.push("");

  // Issue metadata table
  lines.push("Issues:");
  lines.push("-".repeat(80));
  lines.push(
    `${"#".padEnd(6)} ${"Title".padEnd(40)} ${"Files".padEnd(
      6
    )} ${"Complexity".padEnd(10)} ${"Duration".padEnd(10)}`
  );
  lines.push("-".repeat(80));

  for (const issue of result.metadata) {
    const title = issue.title.length > 40 ? issue.title.substring(0, 37) + "..." : issue.title;
    const files = issue.affectedFiles.length.toString();
    const complexity = issue.complexity.score.toFixed(1);
    const duration = issue.durationEstimate
      ? `${issue.durationEstimate.hours}h (${issue.durationEstimate.confidence})`
      : "N/A";

    lines.push(
      `${("#" + issue.number).padEnd(6)} ${title.padEnd(
        40
      )} ${files.padEnd(6)} ${complexity.padEnd(10)} ${duration.padEnd(10)}`
    );
  }

  lines.push("");

  // Overlap matrix (only show high overlap pairs)
  const highOverlap = result.overlapMatrix.filter((o) => o.score > 0.3);
  if (highOverlap.length > 0) {
    lines.push("High Overlap Pairs (>30%):");
    lines.push("-".repeat(80));
    lines.push(
      `${"Issue 1".padEnd(10)} ${"Issue 2".padEnd(10)} ${"Score".padEnd(
        10
      )} ${"Files".padEnd(10)} ${"Dirs".padEnd(10)} ${"Labels".padEnd(10)}`
    );
    lines.push("-".repeat(80));

    for (const overlap of highOverlap.slice(0, 10)) {
      lines.push(
        `${"#" + overlap.issue1.toString().padEnd(9)} ${
          "#" + overlap.issue2.toString().padEnd(9)
        } ${(overlap.score * 100).toFixed(1).padEnd(9) + "%"} ${
          (overlap.fileOverlap * 100).toFixed(1).padEnd(9) + "%"
        } ${
          (overlap.directoryOverlap * 100).toFixed(1).padEnd(9) + "%"
        } ${(overlap.labelOverlap * 100).toFixed(1).padEnd(9) + "%"}`
      );
    }

    if (highOverlap.length > 10) {
      lines.push(`... and ${highOverlap.length - 10} more pairs`);
    }
    lines.push("");
  }

  // Parallel work groups
  if (result.parallelGroups.length > 0) {
    lines.push("Parallel Work Groups:");
    lines.push("-".repeat(80));

    for (let i = 0; i < result.parallelGroups.length; i++) {
      const group = result.parallelGroups[i];
      lines.push(
        `Group ${i + 1}: ${group.issues.map((n) => "#" + n).join(", ")} (avg overlap: ${(
          group.avgOverlap * 100
        ).toFixed(1)}%)`
      );
    }
    lines.push("");
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    lines.push("-".repeat(80));

    for (const rec of result.recommendations) {
      lines.push(`• ${rec}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Register orchestrate:analyze-issues command
 */
export function registerAnalyzeIssuesCommand(
  program: Command,
  jsonModeActive: () => boolean
): void {
  program
    .command("orchestrate:analyze-issues")
    .description("Analyze GitHub issues for fanout [DEPRECATED: Use 'lex-pr fanout analyze']")
    .option("--repo <owner/repo>", "Repository (format: owner/repo)")
    .option("--labels <labels>", "Filter by labels (comma-separated)")
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        // Parse repository option
        let owner: string | undefined;
        let repo: string | undefined;

        if (opts.repo) {
          const parts = opts.repo.split("/");
          if (parts.length !== 2) {
            console.error("Error: --repo must be in format owner/repo");
            throwExit(1);
          }
          owner = parts[0];
          repo = parts[1];
        }

        // Create GitHub client
        const client = await createGitHubClient({ owner, repo });

        // Parse labels
        const labels = opts.labels
          ? opts.labels.split(",").map((l: string) => l.trim())
          : undefined;

        // Fetch issues
        const issues = await client.listIssues({
          state: "open",
          labels,
        });

        if (issues.length === 0) {
          const msg = labels
            ? `No open issues found with labels: ${labels.join(", ")}`
            : "No open issues found";

          if (opts.json || jsonModeActive()) {
            console.log(
              canonicalJSONStringify({
                error: msg,
                issueCount: 0,
              })
            );
          } else {
            console.log(msg);
          }
          return;
        }

        // Analyze issues
        const analyzer = createIssueAnalyzer(client);
        const result = await analyzer.analyzeIssues(issues);

        // Output results
        if (opts.json || jsonModeActive()) {
          console.log(canonicalJSONStringify(result));
        } else {
          console.log(formatTable(result));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        if (opts.json || jsonModeActive()) {
          console.log(
            canonicalJSONStringify({
              error: msg,
            })
          );
          throwExit(1);
        } else {
          console.error(`\nError: ${msg}\n`);
          throwExit(1);
        }
      }
    });
}
