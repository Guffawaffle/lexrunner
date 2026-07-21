/** Doctor command backed by the shared workspace diagnostics service. */

import { Command } from "commander";

import { WorkspaceDiagnosticsService } from "../application/workspace-config-services.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import { WriteProtectionError } from "../config/profileResolver.js";
import { createMinimalWorkspace } from "../core/bootstrap.js";
import { formatHostilityReport } from "../hostility/index.js";
import { initColorControl } from "../util/colorControl.js";

export function registerDoctorCommand(program: Command, jsonModeActive?: () => boolean): void {
  program
    .command("doctor")
    .description("Environment and config sanity checks (canonical: lex-pr workspace doctor)")
    .option("--bootstrap", "Create minimal workspace configuration if missing")
    .option("--json", "Output JSON format")
    .option("--environment-quality", "Run environmental hostility scoring")
    .action(async (options) => {
      const json = options.json || (jsonModeActive?.() ?? false);
      if (json) initColorControl({ jsonMode: true });

      let result = await new WorkspaceDiagnosticsService().run({
        baseDir: process.cwd(),
        environmentQuality: options.environmentQuality,
      });
      if (options.bootstrap && !result.configuration.hasConfiguration) {
        try {
          createMinimalWorkspace();
        } catch (error) {
          if (error instanceof WriteProtectionError) throwExit(2);
          throw error;
        }
        result = await new WorkspaceDiagnosticsService().run({
          baseDir: process.cwd(),
          environmentQuality: options.environmentQuality,
        });
      }

      if (json) {
        writeJsonOutput(result);
        if (result.hasErrors) throwExit(1);
        return;
      }

      console.log("🩺 Doctor - Environment and config sanity checks\n");
      console.log(
        `${result.nodejs.status === "mismatch" ? "✗" : "✓"} Node.js: ${result.nodejs.current} (required ${result.nodejs.required}${result.nodejs.expected ? `; workspace pin ${result.nodejs.expected}` : ""})`
      );
      console.log(`✓ Project type: ${result.projectType}`);
      console.log(
        `${result.git?.status === "ok" ? "✓" : "✗"} Git: ${result.git?.currentBranch ?? result.git?.error ?? "unavailable"}`
      );
      console.log(
        `${result.github?.authenticated ? "✓" : "ℹ"} GitHub: ${result.github?.user ?? "not authenticated"}`
      );
      console.log(
        `${result.configuration.hasConfiguration ? "✓" : "ℹ"} Configuration: ${result.configuration.hasConfiguration ? "complete" : `missing ${result.configuration.missingFiles.length} files`}`
      );
      for (const issue of result.issues) console.log(`✗ ${issue}`);
      for (const suggestion of result.suggestions) console.log(`ℹ ${suggestion}`);
      if (result.environmentQuality) {
        console.log("");
        console.log(formatHostilityReport(result.environmentQuality));
      }
      if (result.hasErrors) throwExit(1);
    });
}
