/**
 * Explain Command - LR-TSF-001
 *
 * Query why a specific action happened by analyzing constraint attributions
 * from execution runs.
 */

import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { getRunsDir } from "../runs/storage.js";

interface AttributionLogEntry {
  timestamp: string;
  constraintId: string;
  action: string;
  target?: string;
  source: string;
  statement: string;
}

/**
 * Register the explain command
 */
export function registerExplainCommand(program: Command): void {
  program
    .command("explain")
    .description("Explain why a specific action happened by analyzing constraint attributions")
    .argument("<query>", "Query string to search for (e.g., 'why lint gate', 'skip gate X')")
    .option("--run-id <id>", "Limit search to a specific run ID")
    .option("--json", "Output JSON format")
    .action(async (query: string, opts) => {
      try {
        const results = await searchAttributions(query, opts.runId);

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log(chalk.yellow("\n⚠️  No attributions found matching your query.\n"));
          console.log("Try:");
          console.log("  - Using different keywords");
          console.log("  - Running a merge-weave with --show-attribution first");
          console.log("  - Checking if run artifacts exist in .lexrunner/runs/\n");
          return;
        }

        console.log(chalk.bold(`\n🔍 Found ${results.length} attribution(s):\n`));

        for (const result of results) {
          console.log(chalk.cyan(`Run: ${result.runId}`));
          console.log(chalk.gray(`  Timestamp: ${result.timestamp}`));
          console.log(chalk.white(`  Action: ${result.action}`));
          if (result.target) {
            console.log(chalk.white(`  Target: ${result.target}`));
          }
          console.log(chalk.yellow(`  Constraint: ${result.constraintId} (${result.source})`));
          console.log(chalk.green(`  Statement: ${result.statement}`));
          console.log();
        }
      } catch (error) {
        if (opts.json) {
          console.error(JSON.stringify({ error: String(error) }));
        } else {
          console.error(
            chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`)
          );
        }
        process.exit(1);
      }
    });
}

/**
 * Search for attributions matching a query
 */
async function searchAttributions(
  query: string,
  runId?: string
): Promise<Array<AttributionLogEntry & { runId: string }>> {
  const runsDir = getRunsDir();
  const results: Array<AttributionLogEntry & { runId: string }> = [];

  // Normalize query for case-insensitive search
  const queryLower = query.toLowerCase();

  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const currentRunId = entry.name;

      // Filter by run ID if specified
      if (runId && currentRunId !== runId) {
        continue;
      }

      // Check for attributions.ndjson file
      const attributionsPath = path.join(runsDir, currentRunId, "attributions.ndjson");

      try {
        await fs.access(attributionsPath);
      } catch {
        // File doesn't exist, skip this run
        continue;
      }

      // Read and parse attributions
      const content = await fs.readFile(attributionsPath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const attribution = JSON.parse(line) as AttributionLogEntry;

          // Search in action, constraintId, and statement
          const matches =
            attribution.action.toLowerCase().includes(queryLower) ||
            attribution.constraintId.toLowerCase().includes(queryLower) ||
            attribution.statement.toLowerCase().includes(queryLower) ||
            (attribution.target && attribution.target.toLowerCase().includes(queryLower));

          if (matches) {
            results.push({
              ...attribution,
              runId: currentRunId,
            });
          }
        } catch (parseError) {
          // Skip malformed lines
          continue;
        }
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to search attributions: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return results;
}
