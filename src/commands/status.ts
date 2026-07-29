/**
 * Status command - Show current execution status and merge eligibility
 */

import { Command } from "commander";
import { asPlanValidationFailure, formatPlanValidationFailureText, loadPlan } from "../schema.js";
import { CycleError, UnknownDependencyError } from "../mergeOrder.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { IntegrationStatusQueryService } from "../application/integration-query-services.js";
import * as fs from "fs";

/**
 * Register the status command with the CLI program
 */
export function registerStatusCommand(program: Command, jsonModeActive: () => boolean): void {
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

        const result = new IntegrationStatusQueryService().run(plan);
        const mergeSummary = result.mergeSummary;

        if (opts.json || jsonModeActive()) {
          console.log(
            canonicalJSONStringify(
              program.name() === "weave"
                ? result
                : { plan: result.plan, mergeSummary: result.mergeSummary }
            )
          );
        } else {
          console.log(`Plan: ${plan.items.length} items targeting ${plan.target}`);
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
        const failure = asPlanValidationFailure(error);
        if (failure) {
          if (opts.json || jsonModeActive()) {
            console.log(canonicalJSONStringify(failure));
          } else {
            console.error(formatPlanValidationFailureText(failure));
          }
          throwExit(2);
        }

        console.error(
          `Error getting status: ${error instanceof Error ? error.message : String(error)}`
        );
        // Use exit code 2 for validation errors, 1 for others
        if (error instanceof CycleError || error instanceof UnknownDependencyError) {
          throwExit(2);
        } else {
          throwExit(1);
        }
      }
    });
}
