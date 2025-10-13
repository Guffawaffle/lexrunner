/**
 * Plan diff command - Compare two plans and show differences
 */

import { Command } from 'commander';
import * as fs from 'fs';
import { loadPlan } from '../schema.js';
import { writeJsonOutput } from '../cli/output.js';
import { throwExit } from '../cli/exitHandler.js';

/**
 * Register the plan-diff command
 * @param program - Commander program instance
 * @param deps - Dependencies for the command
 */
export function registerPlanDiffCommand(
	program: Command,
	deps: {
		jsonModeActive: () => boolean;
		exitWith: (e: unknown) => void;
	}
): void {
	program
		.command("plan-diff")
		.description("Compare two plans and show differences")
		.argument("<plan1>", "First plan file")
		.argument("<plan2>", "Second plan file")
		.option("--json", "Output JSON format")
		.action(async (plan1Path: string, plan2Path: string, opts) => {
			try {
				const plan1Content = fs.readFileSync(plan1Path, "utf-8");
				const plan2Content = fs.readFileSync(plan2Path, "utf-8");

				const plan1 = loadPlan(plan1Content);
				const plan2 = loadPlan(plan2Content);

				// Import diff utilities
				const { comparePlans, formatPlanDiff } = await import("../interactive/planDiff.js");

				const diff = comparePlans(plan1, plan2);

				if (opts.json || deps.jsonModeActive()) {
					writeJsonOutput(diff);
				} else {
					console.log('\n📊 Plan Comparison\n');
					console.log(`Plan 1: ${plan1Path}`);
					console.log(`Plan 2: ${plan2Path}\n`);
					console.log(formatPlanDiff(diff));
				}

				throwExit(diff.hasChanges ? 1 : 0);
			} catch (error) {
				deps.exitWith(error);
			}
		});
}
