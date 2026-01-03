/**
 * Checkpoint management commands for weave
 */

import { Command } from "commander";
import { throwExit } from "../cli/exitHandler.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import {
  listCheckpoints,
  loadCheckpoint,
  cleanupOldCheckpoints,
  getLatestCheckpoint,
} from "../weave/checkpoint/storage.js";
import { formatCheckpoint, formatCheckpointList } from "../weave/checkpoint/utils.js";

interface CheckpointCommandDeps {
  jsonModeActive: () => boolean;
}

/**
 * Register checkpoint management commands under weave
 */
export function registerCheckpointCommands(weave: Command, deps: CheckpointCommandDeps): void {
  const checkpoints = weave
    .command("checkpoints")
    .description("Manage merge-weave checkpoints for resume support")
    .addHelpText(
      "after",
      `
Examples:
  # List all checkpoints
  $ lex-pr weave checkpoints list

  # Show specific checkpoint details
  $ lex-pr weave checkpoints show <run-id>

  # Clean up old checkpoints
  $ lex-pr weave checkpoints clean
`
    );

  // checkpoints list - List all available checkpoints
  checkpoints
    .command("list")
    .description("List all available checkpoints")
    .option("--phase <phase>", "Filter by phase (discovery|gates|merge|complete)")
    .option("--state <state>", "Filter by state")
    .option("--limit <n>", "Maximum number of results", (val) => parseInt(val, 10))
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        const entries = await listCheckpoints({
          phase: opts.phase,
          state: opts.state,
          limit: opts.limit,
        });

        if (opts.json || deps.jsonModeActive()) {
          console.log(canonicalJSONStringify({ checkpoints: entries, count: entries.length }));
        } else {
          if (entries.length === 0) {
            console.log("\nNo checkpoints found.\n");
            console.log("Checkpoints are created automatically during weave execution.");
            console.log(
              "Run 'lex-pr weave apply' to start a merge-weave operation that creates checkpoints.\n"
            );
          } else {
            console.log(formatCheckpointList(entries));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Failed to list checkpoints: ${message}\n`);
        throwExit(1);
      }
    });

  // checkpoints show - Show detailed checkpoint information
  checkpoints
    .command("show <run-id>")
    .description("Show detailed information about a specific checkpoint")
    .option("--json", "Output JSON format")
    .action(async (runId: string, opts) => {
      try {
        const checkpoint = await loadCheckpoint(runId, { validatePlanHash: false });

        if (opts.json || deps.jsonModeActive()) {
          console.log(canonicalJSONStringify(checkpoint));
        } else {
          console.log("\n" + formatCheckpoint(checkpoint) + "\n");

          if (checkpoint.completedItems.length > 0) {
            console.log("Completed Items:");
            checkpoint.completedItems.forEach((item) => console.log(`  ✅ ${item}`));
            console.log("");
          }

          if (checkpoint.pendingItems.length > 0) {
            console.log("Pending Items:");
            checkpoint.pendingItems.forEach((item) => console.log(`  ⏳ ${item}`));
            console.log("");
          }

          if (checkpoint.failedItems.length > 0) {
            console.log("Failed Items:");
            checkpoint.failedItems.forEach((item) => console.log(`  ❌ ${item}`));
            console.log("");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Failed to load checkpoint: ${message}\n`);
        throwExit(1);
      }
    });

  // checkpoints clean - Clean up old checkpoints
  checkpoints
    .command("clean")
    .description("Clean up old checkpoints based on retention policy (7 days)")
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        const result = await cleanupOldCheckpoints();

        if (opts.json || deps.jsonModeActive()) {
          console.log(canonicalJSONStringify(result));
        } else {
          console.log(`\n✅ Checkpoint cleanup completed\n`);
          console.log(`   Removed: ${result.removed} checkpoint(s)`);
          console.log(`   Retained: ${result.retained} checkpoint(s)\n`);

          if (result.removedRunIds.length > 0) {
            console.log("Removed checkpoints:");
            result.removedRunIds.forEach((runId) => console.log(`  - ${runId}`));
            console.log("");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Failed to clean checkpoints: ${message}\n`);
        throwExit(1);
      }
    });
}
