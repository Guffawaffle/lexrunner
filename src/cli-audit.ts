import { Command } from "commander";
import chalk from "chalk";

/**
 * Audit CLI Registration
 *
 * Output Controls:
 * --format text|json  (default text)
 *   json: stable key ordering: {command,status,exitCode,result,timestamp}
 * --no-color disables ANSI styling (text mode only)
 *
 * Exit Codes:
 * 0 verified (signature is valid)
 * 1 invalid (signature verification failed)
 * 2 error (unexpected failure)
 */

export interface AuditCommandResult {
  exitCode: number;
  report: string;
  result?: any;
  status: "verified" | "invalid" | "error";
}

function outputAuditResult(
  command: string,
  result: AuditCommandResult,
  format: string,
  color: boolean
) {
  if (format === "json") {
    const payload = {
      command,
      status: result.status,
      exitCode: result.exitCode,
      result: result.result || {},
      timestamp: new Date().toISOString(),
    };
    const keyOrder = ["command", "status", "exitCode", "result", "timestamp"] as const;
    const ordered = Object.fromEntries(keyOrder.map((k) => [k, payload[k]]));
    process.stdout.write(JSON.stringify(ordered, null, 2) + "\n");
    process.exit(result.exitCode);
  }

  const useColor = color && process.stdout.isTTY;
  if (useColor) {
    if (result.status === "verified") {
      console.log(chalk.green(result.report));
    } else if (result.status === "invalid") {
      console.log(chalk.yellow(result.report));
    } else {
      console.log(chalk.red(result.report));
    }
  } else {
    console.log(result.report);
  }
  process.exit(result.exitCode);
}

export async function registerAuditCommands(program: Command) {
  program
    .command("audit")
    .description("Audit operations: signature verification, manifest validation")
    .addCommand(
      new Command("verify")
        .description("Verify audit manifest signature")
        .argument("[manifest-file]", "Path to audit manifest file", "audit-manifest.json")
        .option("--format <format>", "Output format: text or json", "text")
        .option("--no-color", "Disable ANSI colors in text output")
        .action(async (manifestFile: string, opts: { format: string; color?: boolean }) => {
          const { verifyCommand } = await import("./commands/audit/verify.js");
          const result = await verifyCommand(manifestFile);
          outputAuditResult("verify", result, opts.format, opts.color !== false);
        })
    );
}
