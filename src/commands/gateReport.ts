/**
 * Gate report command - Validate and migrate gate report files
 */

import { Command } from 'commander';
import { validateGateReportWithErrors, migrateGateReport, needsMigration } from '../schema/gateReport.js';
import { throwExit } from '../cli/exitHandler.js';
import * as fs from 'fs';

/**
 * Register the gate-report command with the CLI program
 */
export function registerGateReportCommand(program: Command): void {
	program
		.command("gate-report")
		.description("Gate report operations")
		.addCommand(
			new Command("validate")
				.description("Validate gate report file(s)")
				.argument("<file>", "Path to gate report JSON file")
				.option("--json", "Output machine-readable JSON errors")
				.option("--migrate", "Attempt to migrate legacy report formats")
				.action((file: string, opts) => {
					try {
						if (!fs.existsSync(file)) {
							console.error(`\nError: File not found: ${file}\n`);
							throwExit(1);
						}

						const content = fs.readFileSync(file, "utf-8");
						let data: unknown;

						try {
							data = JSON.parse(content);
						} catch (parseError) {
							if (opts.json) {
								console.log(JSON.stringify({
									valid: false,
									errors: [{
										path: 'root',
										message: 'Invalid JSON format',
										code: 'invalid_json',
										suggestion: 'Check for syntax errors in the JSON file'
									}]
								}, null, 2));
							} else {
								console.error(`\nError: Invalid JSON format in ${file}`);
								console.error(`Tip: Check for syntax errors in the JSON file\n`);
							}
							throwExit(1);
						}

						// Check if migration is needed
						if (opts.migrate && needsMigration(data)) {
							try {
								const migrated = migrateGateReport(data);
								if (opts.json) {
									console.log(JSON.stringify({
										valid: true,
										migrated: true,
										data: migrated
									}, null, 2));
								} else {
									console.log(`✓ ${file} migrated and validated successfully`);
									console.log(`\n💡 Migrated report (consider updating the file):\n`);
									console.log(JSON.stringify(migrated, null, 2));
								}
								return;
							} catch (migrateError) {
								if (opts.json) {
									console.log(JSON.stringify({
										valid: false,
										migrated: false,
										errors: [{
											path: 'root',
											message: migrateError instanceof Error ? migrateError.message : String(migrateError),
											code: 'migration_failed'
										}]
									}, null, 2));
								} else {
									console.error(`\n❌ Error: Migration failed for ${file}`);
									console.error(`Details: ${migrateError instanceof Error ? migrateError.message : String(migrateError)}\n`);
								}
								throwExit(1);
							}
						}

						// Validate with enhanced error messages
						const validation = validateGateReportWithErrors(data);

						if (validation.valid) {
							if (opts.json) {
								console.log(JSON.stringify({ valid: true }));
								return;
							}
							
							console.log(`✓ ${file} is valid`);

							// Show helpful info about the report
							const report = validation.data;
							console.log(`\n  Item: ${report.item}`);
							console.log(`  Gate: ${report.gate}`);
							console.log(`  Status: ${report.status === 'pass' ? '✅' : '❌'} ${report.status}`);
							console.log(`  Duration: ${report.duration_ms}ms`);
							if (report.schemaVersion) {
								console.log(`  Schema Version: ${report.schemaVersion}`);
							}
							if (report.artifacts && report.artifacts.length > 0) {
								console.log(`  Artifacts: ${report.artifacts.length}`);
							}
							console.log('');
							return;
						} else {
							if (opts.json) {
								console.log(JSON.stringify({
									valid: false,
									errors: validation.errors
								}, null, 2));
							} else {
								console.error(`\n❌ Validation failed for ${file}:\n`);
								validation.errors.forEach(error => {
									console.error(`  ${error.path}: ${error.message}`);
									if (error.suggestion) {
										console.error(`    💡 ${error.suggestion}`);
									}
								});
								console.error('');
							}
							throwExit(1);
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (opts.json) {
							console.log(JSON.stringify({
								valid: false,
								errors: [{ path: 'root', message, code: 'unexpected_error' }]
							}));
						} else {
							console.error(`\n❌ Unexpected error: ${message}\n`);
						}
						throwExit(1);
					}
				})
		);
}
