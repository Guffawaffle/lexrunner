/**
 * Merge Order Command
 * Compute dependency levels and merge order using Kahn's algorithm
 */

import { Command } from "commander";
import { loadPlan } from "../schema.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import * as fs from "fs";

/**
 * Error handler type - passed from cli.ts to handle errors consistently
 */
export type ExitWithHandler = (error: unknown) => void;

/**
 * Register the merge-order command with the CLI program
 */
export function registerMergeOrderCommand(
	program: Command,
	jsonModeActive: () => boolean,
	exitWith: ExitWithHandler
): void {
	program
		.command("merge-order")
		.description("Compute dependency levels and merge order")
		.option("--plan <file>", "Path to plan.json file")
		.argument("[file]", "Path to plan.json file (alternative to --plan)")
		.option("--json", "Output JSON format")
		.action((file: string | undefined, opts) => {
			// Show deprecation warning if called as top-level command (not as weave subcommand)
			if (program.name() === "lex-pr" && !opts.json && !jsonModeActive()) {
				console.warn("⚠️  'merge-order' is deprecated. Use: lex-pr weave order");
			}
			
			const planFile = opts.plan || file;
			if (!planFile) {
				console.error("Error: plan file is required (use --plan <file> or provide as argument)");
				throwExit(1);
			}

			try {
				const planContent = fs.readFileSync(planFile, "utf-8");
				const plan = loadPlan(planContent);
				const levels = computeMergeOrder(plan);

				if (opts.json || jsonModeActive()) {
					writeJsonOutput({ levels });
				} else {
					console.log(`Merge order for ${plan.items.length} items:`);
					levels.forEach((level: string[], index: number) => {
						console.log(`Level ${index + 1}: [${level.join(', ')}]`);
					});
				}
				return;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (opts.json || jsonModeActive()) {
					writeJsonOutput({ error: message });
				} else {
					console.error(`Error computing merge order: ${message}`);
				}
				exitWith(error);
			}
		});
}
