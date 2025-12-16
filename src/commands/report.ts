/**
 * Report command - Aggregate gate reports from directory
 */

import { Command } from "commander";
import { readGateDir, generateMarkdownSummary } from "../report/aggregate.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";

interface ReportCommandDeps {
	jsonModeActive: () => boolean;
}

/**
 * Register the report command with the CLI program
 */
export function registerReportCommand(
	program: Command,
	deps: ReportCommandDeps
): void {
	program
		.command("report")
		.description(
			"Aggregate gate reports from directory (canonical: lex-pr weave report)"
		)
		.argument("<dir>", "Directory containing *.json gate result files")
		.option("--json", "Output JSON format (alias for --out json)")
		.option("--out <format>", "Output format: 'json' or 'md'", "json")
		.action((dir: string, opts) => {
			// Show deprecation warning if called as top-level command
			if (program.name() === "lex-pr" && !opts.json && !deps.jsonModeActive()) {
				console.warn("⚠️  'report' is deprecated. Use: lex-pr weave report");
			}
			
			try {
				const report = readGateDir(dir);

				// --json flag or global json mode takes precedence over --out
				const outputFormat =
					opts.json || deps.jsonModeActive() ? "json" : opts.out;

				if (outputFormat === "md") {
					const markdown = generateMarkdownSummary(report);
					console.log(markdown);
				} else if (outputFormat === "json") {
					writeJsonOutput(report);
				} else {
					console.error(
						`Invalid output format: ${opts.out}. Use 'json' or 'md'.`
					);
					throwExit(1);
				}

				// Exit with error code if not all green
				if (!report.allGreen) {
					throwExit(1);
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				console.error(`Error aggregating gate reports: ${message}`);
				throwExit(1);
			}
		});
}
