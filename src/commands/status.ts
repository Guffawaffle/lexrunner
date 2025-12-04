/**
 * Status command - Show current execution status and merge eligibility
 */

import { Command } from "commander";
import { loadPlan, SchemaValidationError } from "../schema.js";
import { ExecutionState } from "../executionState.js";
import { MergeEligibilityEvaluator } from "../mergeEligibility.js";
import { CycleError, UnknownDependencyError } from "../mergeOrder.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import * as fs from "fs";

/**
 * Register the status command with the CLI program
 */
export function registerStatusCommand(
	program: Command,
	jsonModeActive: () => boolean
): void {
	program
		.command("status")
		.description(
			"Show current execution status and merge eligibility (canonical: lex-pr weave status)"
		)
		.option("--plan <file>", "Path to plan.json file", "plan.json")
		.argument("[file]", "Path to plan.json file (alternative to --plan)")
		.option("--json", "Output JSON format")
		.addHelpText(
			"after",
			`
Examples:
  $ lex-pr status plan.json                     # Show plan status
  $ lex-pr status --json                        # JSON output for dashboards
  $ lex-pr status --json | jq '.mergeSummary'   # Extract merge summary

Common Issues:
  • "Plan file not found": Verify path to plan.json
  • Missing execution state: Run 'lex-pr execute' first to populate status`
		)
		.action((file: string | undefined, opts) => {
			const planFile = opts.plan || file || "plan.json";

			try {
				const planContent = fs.readFileSync(planFile, "utf-8");
				const plan = loadPlan(planContent);

				// For now, show plan structure and policy
				// In a full implementation, this would load execution state from artifacts
				const executionState = new ExecutionState(plan);
				const evaluator = new MergeEligibilityEvaluator(
					plan,
					executionState
				);
				const mergeSummary = evaluator.getMergeSummary();

				if (opts.json || jsonModeActive()) {
					console.log(
						canonicalJSONStringify({
							plan: {
								schemaVersion: plan.schemaVersion,
								target: plan.target,
								itemCount: plan.items.length,
								policy: plan.policy,
							},
							mergeSummary,
						})
					);
				} else {
					console.log(
						`Plan: ${plan.items.length} items targeting ${plan.target}`
					);
					console.log(`Schema version: ${plan.schemaVersion}`);
					if (plan.policy) {
						console.log(
							`Policy: ${plan.policy.maxWorkers} max workers, merge rule: ${plan.policy.mergeRule.type}`
						);
					}
					console.log(
						`Status: ${mergeSummary.eligible.length} eligible, ${mergeSummary.pending.length} pending, ${mergeSummary.failed.length} failed`
					);
				}
			} catch (error) {
				console.error(
					`Error getting status: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
				// Use exit code 2 for validation errors, 1 for others
				if (
					error instanceof SchemaValidationError ||
					error instanceof CycleError ||
					error instanceof UnknownDependencyError
				) {
					throwExit(2);
				} else {
					throwExit(1);
				}
			}
		});
}
