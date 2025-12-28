/**
 * CLI command: orchestrate:plan-batch
 * Generate batch plan using Kahn's algorithm for deterministic topological sorting
 */

import { Command } from "commander";
import {
  computeBatches,
  Node,
  CycleError,
  UnknownDependencyError,
} from "../../orchestration/batchPlanner.js";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import chalk from "chalk";
import * as fs from "fs";

export function registerPlanBatchCommand(program: Command, jsonModeActive?: () => boolean): void {
  program
    .command("orchestrate:plan-batch")
    .description("Generate batch plan using Kahn's algorithm (canonical: lex-pr weave plan)")
    .option("--issues <numbers>", "Comma-separated issue/PR numbers (e.g., 156,157,160)")
    .option("--input <file>", "Input JSON file with analyzed issues")
    .option("--json", "Output JSON format instead of human-readable")
    .action(async (options) => {
      try {
        let nodes: Node[] = [];

        // Load from input file if provided
        if (options.input) {
          const inputData = JSON.parse(fs.readFileSync(options.input, "utf-8"));

          // Support both direct nodes array or wrapped format
          if (Array.isArray(inputData)) {
            nodes = inputData;
          } else if (inputData.nodes) {
            nodes = inputData.nodes;
          } else if (inputData.issues) {
            nodes = inputData.issues;
          } else {
            throw new Error("Invalid input format: expected nodes, issues array, or direct array");
          }
        }
        // Parse explicit issue list
        else if (options.issues) {
          const issueNumbers = options.issues.split(",").map((n: string) => n.trim());

          // Create mock nodes for explicit issue list
          // In real usage, this would fetch from GitHub
          nodes = issueNumbers.map((num: string) => ({
            id: num,
            type: "issue" as const,
            dependencies: [],
            metadata: {
              score: 1.0,
              createdAt: new Date().toISOString(),
              issueNumber: parseInt(num),
            },
          }));
        } else {
          throw new Error("Either --issues or --input must be provided");
        }

        // Compute batch plan
        const plan = computeBatches(nodes);

        // Check if JSON mode is active (either from flag or global)
        const isJsonMode = options.json || (jsonModeActive && jsonModeActive());

        // Output results
        if (isJsonMode) {
          console.log(canonicalJSONStringify(plan));
        } else {
          // Human-readable output
          console.log(chalk.bold("\nBatch Plan (Kahn's Algorithm)"));
          console.log(chalk.bold("============================\n"));

          for (const batch of plan.batches) {
            console.log(chalk.cyan(`Batch ${batch.layer + 1} (layer ${batch.layer}):`));

            for (const item of batch.items) {
              const itemId = item.metadata.prNumber
                ? `PR-${item.metadata.prNumber}`
                : item.metadata.issueNumber
                  ? `#${item.metadata.issueNumber}`
                  : item.id;

              const deps =
                item.dependencies.length > 0 ? `, depends on ${item.dependencies.join(", ")}` : "";

              console.log(`  - ${itemId}: score ${item.metadata.score.toFixed(1)}${deps}`);
            }
            console.log();
          }

          console.log(chalk.gray(`Algorithm: ${plan.algorithm}`));
          console.log(chalk.gray(`Plan Hash: ${plan.planHash}`));
          console.log(chalk.gray(`Deterministic: ${plan.deterministic}`));
        }

        process.exit(0);
      } catch (error) {
        if (error instanceof CycleError) {
          console.error(chalk.red("Error: Cycle detected in dependency graph"));
          console.error(chalk.red(error.message));
          process.exit(2);
        } else if (error instanceof UnknownDependencyError) {
          console.error(chalk.red("Error: Unknown dependency"));
          console.error(chalk.red(error.message));
          process.exit(2);
        } else {
          console.error(
            chalk.red("Error:"),
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      }
    });
}
