/**
 * Preview Constraints Command
 *
 * Standalone command to preview constraints for a plan without execution.
 */

import { Command } from "commander";
import { loadPlan } from "../schema.js";
import { throwExit } from "../cli/exitHandler.js";
import {
  previewConstraints,
  formatConstraintPreview,
  formatConstraintPreviewJSON,
} from "../preview/constraints.js";
import fs from "fs";

interface PreviewConstraintsCommandDeps {
  jsonModeActive: () => boolean;
}

/**
 * Register the preview-constraints command
 */
export function registerPreviewConstraintsCommand(
  program: Command,
  deps: PreviewConstraintsCommandDeps
): void {
  program
    .command("preview-constraints")
    .description("Preview constraints that will apply to a plan")
    .option("--plan <file>", "Path to plan.json file", "plan.json")
    .option("--persona <id>", "Persona ID to use (overrides LEXSONA_PERSONA)")
    .option("--format <format>", "Output format: text (default) or json", "text")
    .option("--json", "Output JSON format (same as --format json)")
    .addHelpText(
      "after",
      `
Examples:
  # Preview constraints with default settings
  $ lex-pr preview-constraints --plan plan.json

  # Preview with specific persona
  $ lex-pr preview-constraints --plan plan.json --persona quality-first_engineering

  # JSON output for tooling
  $ lex-pr preview-constraints --plan plan.json --format json

  # Short JSON flag
  $ lex-pr preview-constraints --plan plan.json --json

Description:
  Shows what constraints and rules will apply to a plan before execution.
  Constraints are derived from:
    • Baseline rules (hardcoded in lexrunner)
    • Persona rules (from LexSona if enabled)
    • Learned rules (from past executions)

  The preview includes:
    • List of active constraints grouped by source
    • Which plan items each constraint affects
    • Conflict detection between constraints
    • Warnings about potential issues
`
    )
    .action(async (opts) => {
      try {
        // Load plan
        if (!fs.existsSync(opts.plan)) {
          console.error(`\n❌ Error: Plan file not found: ${opts.plan}\n`);
          console.error("Create a plan first:");
          console.error("  lex-pr weave plan --from-github --output plan.json\n");
          throwExit(1);
        }

        const planContent = fs.readFileSync(opts.plan, "utf-8");
        const plan = loadPlan(planContent);

        // Preview constraints
        const preview = await previewConstraints(plan, opts.persona || null);

        // Determine output format
        const format = opts.json ? "json" : opts.format;

        if (format === "json" || deps.jsonModeActive()) {
          // JSON output
          console.log(formatConstraintPreviewJSON(preview));
        } else {
          // Text output
          console.log("\n" + formatConstraintPreview(preview));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Constraint preview failed: ${message}\n`);
        throwExit(1);
      }
    });
}
