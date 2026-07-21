import { Command } from "commander";

import { GateImpactService, GateImpactServiceError } from "../application/gate-impact-service.js";
import { throwExit } from "../cli/exitHandler.js";
import { writeJsonOutput } from "../cli/output.js";
import { mcpToolError } from "../errors/index.js";

export function registerGateSelectCommand(program: Command, jsonModeActive: () => boolean): void {
  program
    .command("select")
    .description("Select deterministic touched/adjacent implementation tests")
    .requiredOption("--base <sha>", "Explicit base commit SHA")
    .requiredOption("--head <sha>", "Explicit head commit SHA")
    .option("--repo-root <path>", "Repository root", process.cwd())
    .option("--json", "Output bounded JSON")
    .action(async (options) => {
      const json = options.json || jsonModeActive();
      try {
        const selection = await new GateImpactService().select({
          repoRoot: options.repoRoot,
          baseSha: options.base,
          headSha: options.head,
        });
        if (json) writeJsonOutput(selection);
        else {
          console.log(`Implementation gate: ${selection.mode}`);
          console.log(`Changed files: ${selection.changedFiles.length}`);
          console.log(`Selected tests: ${selection.selectedTests.length}`);
          if (selection.fallbackReason) console.log(`Fallback: ${selection.fallbackReason}`);
          console.log(`Command: ${selection.testCommand}`);
        }
      } catch (error) {
        if (json && error instanceof GateImpactServiceError) {
          writeJsonOutput(mcpToolError(error.code, error.message, { tool: "gate.select" }));
        } else {
          console.error(error instanceof Error ? error.message : String(error));
        }
        throwExit(1);
      }
    });
}
