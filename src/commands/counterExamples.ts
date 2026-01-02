/**
 * Counter-Examples CLI Commands - LR-TSF-003
 *
 * Provides commands to list and export counter-examples.
 */

import { Command } from "commander";
import {
  listCounterExamples,
  exportCounterExamples,
  loadCounterExample,
} from "../learning/storage.js";
import chalk from "chalk";

/**
 * Register counter-examples command
 */
export function registerCounterExamplesCommand(program: Command): void {
  const counterExamples = program
    .command("counter-examples")
    .description("Manage failure counter-examples for learning");

  // List command
  counterExamples
    .command("list")
    .description("List all recorded counter-examples")
    .option("--base-dir <dir>", "Base directory for lexrunner", process.cwd())
    .option("--format <format>", "Output format (table|json)", "table")
    .action(async (options) => {
      const entries = listCounterExamples(options.baseDir);

      if (entries.length === 0) {
        console.log(chalk.yellow("No counter-examples recorded yet."));
        return;
      }

      if (options.format === "json") {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      // Table format
      console.log(chalk.bold("\n📊 Counter-Examples:\n"));
      console.log(
        chalk.gray(
          "ID                          | Timestamp            | Type       | Target              | Classification"
        )
      );
      console.log(chalk.gray("-".repeat(120)));

      for (const entry of entries) {
        const id = entry.id.substring(0, 24);
        const timestamp = new Date(entry.timestamp).toLocaleString();
        const type = entry.failureType.padEnd(10);
        const target = entry.target.substring(0, 18).padEnd(18);
        const classification = entry.classificationType;

        const color = entry.shouldLearn ? chalk.yellow : chalk.gray;
        console.log(color(`${id} | ${timestamp} | ${type} | ${target} | ${classification}`));
      }

      console.log(
        chalk.gray(
          `\nTotal: ${entries.length} counter-examples (${entries.filter((e) => e.shouldLearn).length} for learning)`
        )
      );
    });

  // Show command
  counterExamples
    .command("show <id>")
    .description("Show details of a specific counter-example")
    .option("--base-dir <dir>", "Base directory for lexrunner", process.cwd())
    .action(async (id, options) => {
      const counterExample = loadCounterExample(id, options.baseDir);

      if (!counterExample) {
        console.log(chalk.red(`Counter-example not found: ${id}`));
        process.exit(1);
      }

      console.log(chalk.bold("\n📋 Counter-Example Details:\n"));
      console.log(JSON.stringify(counterExample, null, 2));
    });

  // Export command
  counterExamples
    .command("export")
    .description("Export counter-examples for analysis")
    .option("--format <format>", "Export format (json|csv)", "json")
    .option("--base-dir <dir>", "Base directory for lexrunner", process.cwd())
    .option("--output <file>", "Output file (prints to stdout if not specified)")
    .action(async (options) => {
      const output = exportCounterExamples(options.format, options.baseDir);

      if (options.output) {
        const fs = await import("fs");
        fs.writeFileSync(options.output, output, "utf-8");
        console.log(chalk.green(`✓ Exported counter-examples to ${options.output}`));
      } else {
        console.log(output);
      }
    });
}
