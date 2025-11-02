/**
 * Report command - Aggregate gate reports from directory
 */

import { Command } from 'commander';
import { readGateDir, generateMarkdownSummary } from '../report/aggregate.js';
import { writeJsonOutput } from '../cli/output.js';
import { throwExit } from '../cli/exitHandler.js';

/**
 * Register the report command with the CLI program
 */
export function registerReportCommand(program: Command): void {
	program
		.command("report")
		.description("Aggregate gate reports from directory")
		.argument("<dir>", "Directory containing *.json gate result files")
		.option("--out <format>", "Output format: 'json' or 'md'", "json")
		.action((dir: string, opts) => {
			try {
				const report = readGateDir(dir);

				if (opts.out === 'md') {
					const markdown = generateMarkdownSummary(report);
					console.log(markdown);
				} else if (opts.out === 'json') {
					writeJsonOutput(report);
				} else {
					console.error(`Invalid output format: ${opts.out}. Use 'json' or 'md'.`);
					throwExit(1);
				}

				// Exit with error code if not all green
				if (!report.allGreen) {
					throwExit(1);
				}
				return;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`Error aggregating gate reports: ${message}`);
				throwExit(1);
			}
		});
}
