/**
 * Retry command - Retry failed gates with selective filtering
 */

import { Command } from 'commander';
import { RetryOperation } from './bulkOps.js';
import { writeJsonOutput } from '../cli/output.js';
import { throwExit } from '../cli/exitHandler.js';

/**
 * Register the retry command with the CLI program
 */
export function registerRetryCommand(
	program: Command,
	jsonModeActive: () => boolean,
	exitWith: (error: unknown) => void
): void {
	program
		.command("retry")
		.description("Retry failed gates with selective filtering")
		.option("--state-dir <dir>", "State directory", ".smartergpt/runner")
		.option("--filter <text>", "Filter items/gates to retry")
		.option("--items <items>", "Comma-separated list of items to retry")
		.option("--dry-run", "Show what would be retried without executing")
		.option("--json", "Output JSON format")
		.action(async (opts) => {
			try {
				const retryOperation = new RetryOperation(opts.stateDir);

				const items = opts.items ? opts.items.split(",").map((s: string) => s.trim()) : undefined;

				const result = await retryOperation.retryFailed({
					filter: opts.filter,
					items,
					dryRun: opts.dryRun,
				});

				if (opts.json || jsonModeActive()) {
					writeJsonOutput(result);
				} else {
					if (opts.dryRun) {
						console.log(`Would retry ${result.processedItems.length} gate(s):`);
						result.processedItems.forEach((item) => console.log(`  - ${item}`));
					} else {
						console.log(`✓ Retried ${result.processedItems.length} gate(s)`);
						if (result.failedItems.length > 0) {
							console.log(`✗ Failed ${result.failedItems.length} gate(s)`);
							result.errors.forEach((err) => console.log(`  - ${err.item}: ${err.error}`));
						}
					}
				}

				if (!result.success) {
					throwExit(1);
				}
			} catch (error) {
				exitWith(error);
			}
		});
}
