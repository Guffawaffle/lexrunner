/**
 * Schema command - Schema validation utilities
 */

import { Command } from "commander";
import {
  asPlanValidationFailure,
  formatPlanValidationFailureText,
  Plan,
  loadPlan,
} from "../schema.js";
import { throwExit, CLIExitSignal } from "../cli/exitHandler.js";
import { validatePlan as validatePlanDeps, formatValidationResult } from "../planner/validation.js";
import * as fs from "fs";

/**
 * Register the schema command with subcommands
 * @param program - Commander program instance
 * @param deps - Dependencies for the command
 */
export function registerSchemaCommand(
  program: Command,
  deps: {
    jsonModeActive: () => boolean;
  }
): void {
  program
    .command("schema")
    .description("Schema utilities (validate plan.json)")
    .addCommand(
      new Command("validate")
        .description("Validate a plan file against schema")
        .argument("<file>", "Path to plan.json file")
        .option("--json", "Output JSON result")
        .option("--verbose", "Show detailed diagnostics including layers and warnings")
        .action((file: string, opts) => {
          try {
            if (!fs.existsSync(file)) {
              if (opts.json || deps.jsonModeActive()) {
                console.log(
                  JSON.stringify({
                    valid: false,
                    errors: [{ path: "root", message: "File not found" }],
                  })
                );
              } else {
                console.error(`File not found: ${file}`);
              }
              throwExit(1);
            }
            const content = fs.readFileSync(file, "utf-8");
            let plan: Plan | undefined;
            try {
              plan = loadPlan(content);
            } catch (error) {
              const failure = asPlanValidationFailure(error);
              if (failure) {
                if (opts.json || deps.jsonModeActive()) {
                  console.log(JSON.stringify(failure, null, 2));
                } else {
                  console.error(formatPlanValidationFailureText(failure));
                }
              } else if (opts.json || deps.jsonModeActive()) {
                const err = error as any;
                console.log(
                  JSON.stringify(
                    {
                      valid: false,
                      errors: [{ path: "root", message: String(err?.message || error) }],
                    },
                    null,
                    2
                  )
                );
              } else {
                console.error(
                  `Validation failed: ${error instanceof Error ? error.message : String(error)}`
                );
              }
              throwExit(1);
            }
            if (!plan) {
              throw new Error("Plan parsing failed unexpectedly");
            }
            const validatedPlan = plan;

            // Enhanced semantic validation with detailed error reporting
            const validationResult = validatePlanDeps(validatedPlan, { verbose: opts.verbose });

            if (opts.json || deps.jsonModeActive()) {
              // Output machine-readable JSON
              console.log(
                JSON.stringify(
                  {
                    valid: validationResult.valid,
                    errors: validationResult.errors,
                    warnings: validationResult.warnings,
                    diagnostics: validationResult.diagnostics,
                  },
                  null,
                  2
                )
              );
            } else {
              // Human-readable output
              const formattedResult = formatValidationResult(validationResult, opts.verbose);
              console.log(formattedResult);
            }

            if (!validationResult.valid) {
              throwExit(1);
            }

            return;
          } catch (error) {
            // Let CLIExitSignal propagate - JSON already output
            if (error instanceof CLIExitSignal) {
              throw error;
            }
            if (opts.json || deps.jsonModeActive()) {
              console.log(
                JSON.stringify({
                  valid: false,
                  errors: [{ path: "root", message: String((error as Error).message) }],
                })
              );
            } else {
              console.error(
                `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
              );
            }
            throwExit(1);
          }
        })
    );
}
