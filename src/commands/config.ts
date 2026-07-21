/** Configuration inspection backed by the shared bounded query service. */

import chalk from "chalk";
import { Command } from "commander";

import {
  ConfigurationQueryService,
  WorkspaceConfigServiceError,
} from "../application/workspace-config-services.js";
import { throwExit } from "../cli/exitHandler.js";
import { writeJsonOutput } from "../cli/output.js";
import { mcpToolError } from "../errors/index.js";

export function registerConfigCommand(
  program: Command,
  deps: { jsonModeActive: () => boolean }
): void {
  const config = program.command("config").description("Configuration inspection and debugging");

  config
    .command("show")
    .description("Display configuration with precedence chain")
    .option("--json", "Output JSON format")
    .option("--key <name>", "Show specific configuration key")
    .action((options) => {
      const service = new ConfigurationQueryService();
      const json = options.json || deps.jsonModeActive();
      try {
        const result = service.show({ baseDir: process.cwd(), key: options.key });
        if (json) {
          writeJsonOutput(
            options.key ? { contract: result.contract, ...result.configuration[0] } : result
          );
          return;
        }

        console.log(chalk.bold("\nConfiguration Precedence:"));
        result.precedenceChain.forEach((level, index) => {
          console.log(
            `${index + 1}. ${chalk.cyan(level.source || level.level)}${level.path ? `: ${level.path}` : ""}`
          );
        });
        console.log(chalk.bold("\nResolved Configuration:"));
        console.log("━".repeat(60));
        for (const value of result.configuration) {
          console.log(`  ${chalk.bold(value.key)}: ${formatValue(value.value)}`);
          console.log(`    ${chalk.gray("Source:")} ${chalk.green(value.source)}`);
          if (value.overrides) {
            console.log(
              `    ${chalk.gray("Original:")} ${formatValue(value.overrides.value)} ${chalk.gray(`(from ${value.overrides.source})`)}`
            );
          }
          console.log("");
        }
        console.log("━".repeat(60));
      } catch (error) {
        if (json) {
          if (error instanceof WorkspaceConfigServiceError) {
            writeJsonOutput(mcpToolError(error.code, error.message, { tool: "config.show" }));
          } else {
            writeJsonOutput(
              mcpToolError("WORKSPACE_DIAGNOSTICS_FAILED", String(error), {
                tool: "config.show",
              })
            );
          }
        } else {
          console.error(
            chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`)
          );
          if (
            error instanceof WorkspaceConfigServiceError &&
            error.code === "CONFIG_KEY_NOT_FOUND"
          ) {
            console.error(chalk.gray("Available keys:"));
            for (const value of service.show({ baseDir: process.cwd() }).configuration) {
              console.error(`  - ${value.key}`);
            }
          }
        }
        throwExit(1);
      }
    });
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}
