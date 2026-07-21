/** Compatibility adapter for the canonical `weave apply` command. */

import { Command } from "commander";

import { runWeaveApply, type WeaveApplyOptions } from "./weave.js";

export interface MergeCommandDeps {
  runApply?: typeof runWeaveApply;
}

/**
 * Keep the top-level `merge` surface available through the 1.x compatibility
 * window without retaining a second merge implementation.
 */
export function registerMergeCommand(
  program: Command,
  jsonModeActive: () => boolean,
  _getProgramOpts: () => unknown,
  deps: MergeCommandDeps = {}
): void {
  const runApply = deps.runApply ?? runWeaveApply;
  program
    .command("merge")
    .description("Compatibility alias for weave apply")
    .option("--plan <file>", "Path to plan.json file", "plan.json")
    .option("--dry-run", "Show what would be merged without executing", true)
    .option("--execute", "Apply merges through the canonical persisted merge service")
    .option("--no-constraints", "Skip constraint preview in dry-run mode")
    .option("--skip-gates", "Skip gate execution (not recommended)")
    .option("--json", "Output JSON format")
    .addHelpText(
      "after",
      `
Compatibility:
  "merge" is supported through the LexRunner 1.x line and reviewed at 2.0.0.
  Use "lex-pr weave apply" for new automation.

Examples:
  $ lex-pr merge --plan plan.json
  $ lex-pr merge --plan plan.json --execute
  $ lex-pr weave apply --plan plan.json --dry-run
  $ lex-pr weave apply --plan plan.json --execute
`
    )
    .action(async (opts: WeaveApplyOptions) => {
      await runApply(
        {
          ...opts,
          dryRun: opts.execute ? false : opts.dryRun !== false,
        },
        {
          jsonModeActive,
          getProgramOpts: () => ({}),
        }
      );
    });
}
