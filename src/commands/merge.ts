/**
 * Merge command - Execute merge pyramid with git operations
 */

import { Command } from 'commander';
import { loadPlan } from '../schema.js';
import { computeMergeOrder } from '../mergeOrder.js';
import { createGitOperations, GitOperationError } from '../git/operations.js';
import { parseAutopilotConfig, AutopilotConfigError, getAutopilotLevelDescription, AutopilotLevel } from '../autopilot/index.js';
import { ProgressReporter } from '../util/progress.js';
import { canonicalJSONStringify } from '../util/canonicalJson.js';
import { writeJsonOutput } from '../cli/output.js';
import { throwExit } from '../cli/exitHandler.js';
import { initAuditEmitter, emitEvent, AuditEmitter, EVENT_TYPES } from '../audit/index.js';
import * as fs from 'fs';
import * as path from 'path';

// Guarded finalize: ensure HIPAA-prefixed errors rethrow (to map to exit 2),
// while non-HIPAA finalize errors are logged and ignored.
async function finalizeAuditGuard(emitter: AuditEmitter, status?: string): Promise<void> {
	try {
		const { finalizeAudit } = await import('../audit/index.js');
		await finalizeAudit(emitter, status);
	} catch (e) {
		if (e instanceof Error && typeof e.message === 'string' && e.message.startsWith('HIPAA:')) {
			throw e; // let top-level handler map to exit code 2
		}
		console.warn('[lex-pr] audit: finalize failed (ignored)', String(e));
	}
}

/**
 * Register the merge command with the CLI program
 */
export function registerMergeCommand(
	program: Command,
	jsonModeActive: () => boolean,
	getProgramOpts: () => any
): void {
	program
		.command("merge")
		.description("Execute merge pyramid with git operations")
		.option("--plan <file>", "Path to plan.json file", "plan.json")
		.option("--dry-run", "Show what would be merged without executing", true)
		.option("--execute", "Actually perform merge operations")
		.option("--cleanup", "Clean up integration branches after execution")
		.option("--json", "Output JSON format")
		.option("--batch", "Enable batch mode for multiple items")
		.option("--filter <query>", "Filter items using query language")
		.option("--levels <levels>", "Comma-separated list of levels to merge")
		.option("--items <items>", "Comma-separated list of items to merge")
		.option("--max-level <level>", "Maximum autopilot level (0-4)", "0")
		.option("--open-pr", "Open pull requests for integration branches (Level 3+)")
		.option("--close-superseded", "Close superseded PRs after integration (Level 4)")
		.option("--comment-template <path>", "Path to PR comment template (Level 2+)")
		.option("--branch-prefix <prefix>", "Prefix for integration branch names", "integration/")
		.addHelpText('after', `
Examples:
  $ lex-pr merge                                # Dry-run: preview merge operations
  $ lex-pr merge --execute                      # Execute merge pyramid
  $ lex-pr merge --execute --cleanup            # Execute and clean up integration branches
  $ lex-pr merge --json > merge-results.json    # JSON output for automation
  $ lex-pr merge --levels 1,2 --execute         # Merge only specific levels
  $ lex-pr merge --items pr-123,pr-456 --execute # Merge specific items

Common Issues:
  • Merge conflicts: Review conflicts and resolve manually, then re-run
  • Dirty working directory: Commit or stash changes before merging
  • Permission denied: Ensure you have push access to the repository`)
		.action(async (opts) => {
			let auditEmitter: AuditEmitter | null = null;
			try {
				// Parse and validate autopilot configuration
				let autopilotConfig;
				try {
					autopilotConfig = parseAutopilotConfig({
						maxLevel: parseInt(opts.maxLevel),
						dryRun: opts.dryRun && !opts.execute,
						openPr: opts.openPr,
						closeSuperseded: opts.closeSuperseded,
						commentTemplate: opts.commentTemplate,
						branchPrefix: opts.branchPrefix
					});
				} catch (error) {
					if (error instanceof AutopilotConfigError) {
						console.error(`Configuration Error: ${error.message}`);
						throwExit(2);
					}
					throw error;
				}

				// Show autopilot configuration if not in JSON mode
				if (!(opts.json || jsonModeActive()) && autopilotConfig.maxLevel > AutopilotLevel.ReportOnly) {
					console.log(`🤖 Autopilot Level ${autopilotConfig.maxLevel}: ${getAutopilotLevelDescription(autopilotConfig.maxLevel)}`);
					if (autopilotConfig.dryRun) {
						console.log("   Mode: Dry run (preview only)");
					}
					if (autopilotConfig.openPR) {
						console.log("   Open PRs: enabled");
					}
					if (autopilotConfig.closeSuperseded) {
						console.log("   Close superseded: enabled");
					}
					console.log("");
				}

				// Load plan
				if (!fs.existsSync(opts.plan)) {
					console.error(`Error: Plan file ${opts.plan} not found`);
					throwExit(1);
				}

				const planContent = fs.readFileSync(opts.plan, "utf-8");
				const plan = loadPlan(planContent);

				// Initialize audit emitter from global flag if present
				const globalOpts = getProgramOpts();
				const globalAudit = globalOpts.auditProfile as string | undefined;
				if (globalAudit && globalAudit !== 'off') {
					const auditDir = path.join(path.dirname(opts.plan || '.'), 'audit');
					const envKey = process.env.LEX_AUDIT_KEY_HEX;
					const phiFlag = (globalAudit === 'hipaa-strict') || process.env.LEX_AUDIT_PHI === '1';
					auditEmitter = await initAuditEmitter({ profile: globalAudit as any, dir: auditDir, phiRedaction: phiFlag, encryptionKeyHex: envKey });
					await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, { command: 'merge', argv: process.argv.slice(2) });
				}

				// Compute merge order
				const levels = computeMergeOrder(plan);

				// Initialize git operations
				const gitOps = createGitOperations();

				// Check git status
				const isClean = await gitOps.isClean();
				if (!isClean && opts.execute) {
					console.error("Error: Working directory is not clean. Please commit or stash changes.");
					throwExit(1);
				}

				const currentBranch = await gitOps.getCurrentBranch();

				if (opts.dryRun && !opts.execute) {
					// Dry run mode (default)
					if (opts.json || jsonModeActive()) {
						console.log(canonicalJSONStringify({
							mode: "dry-run",
							plan: {
								target: plan.target,
								items: plan.items.length,
							},
							levels: levels.map((level, index) => ({
								level: index + 1,
								items: level,
								count: level.length,
							})),
							currentBranch,
							isClean,
						}));
					} else {
						console.log(`🔍 DRY RUN MODE - Merge plan for ${plan.items.length} items → ${plan.target}`);
						console.log(`Current branch: ${currentBranch}`);
						console.log(`Working directory: ${isClean ? 'clean' : 'has changes'}`);
						console.log("");

						levels.forEach((level, index) => {
							console.log(`Level ${index + 1}: would merge items [${level.join(', ')}]`);
						});

						console.log("");
						console.log("Use --execute to perform actual merges");
					}
				} else if (opts.execute) {
					// Execute mode
					if (opts.json || jsonModeActive()) {
						writeJsonOutput({ mode: "execute", status: "starting" });
					} else {
						console.log(`🚀 EXECUTE MODE - Starting merge pyramid execution`);
						console.log(`Target: ${plan.target}`);
						console.log(`Items: ${plan.items.length}`);
						console.log(`Levels: ${levels.length}`);
						console.log("");
					}

					// Create progress reporter (disabled in JSON mode)
					const progressReporter = new ProgressReporter({ enabled: !jsonModeActive() });

					// Execute weave
					const result = await gitOps.executeWeave(plan, levels, progressReporter);

					if (opts.json || jsonModeActive()) {
						console.log(canonicalJSONStringify({
							mode: "execute",
							status: "completed",
							result: {
								successful: result.successful,
								failed: result.failed,
								conflicts: result.conflicts,
								totalOperations: result.totalOperations,
							},
							operations: result.operations.map(op => ({
								item: op.item.name,
								success: op.success,
								conflicts: op.conflicts,
								message: op.message,
								sha: op.sha,
							})),
						}));
					} else {
						console.log("");
						console.log("## Execution Results");
						console.log("");
						console.log("| Item | Status | Message | SHA |");
						console.log("|------|--------|---------|-----|");

						for (const operation of result.operations) {
							const status = operation.success ? "✓" : "✗";
							const sha = operation.sha ? operation.sha.substring(0, 8) : "—";
							const message = operation.message || "—";
							console.log(`| ${operation.item.name} | ${status} | ${message} | ${sha} |`);
						}

						console.log("");
						console.log("### Summary");
						console.log(`- **Successful**: ${result.successful}/${result.totalOperations}`);
						console.log(`- **Failed**: ${result.failed}/${result.totalOperations}`);
						console.log(`- **Conflicts**: ${result.conflicts}/${result.totalOperations}`);

						if (result.failed > 0) {
							console.log("");
							console.log("❌ Merge pyramid execution completed with failures");
							throwExit(1);
						} else {
							console.log("");
							console.log("✅ Merge pyramid execution completed successfully");
						}
					}

					// Cleanup if requested
					if (opts.cleanup) {
						await gitOps.cleanup();
						if (!(opts.json || jsonModeActive())) {
							console.log("🧹 Cleaned up integration branches");
						}
					}
				}

			} catch (error) {
				if (auditEmitter) {
					await emitEvent(auditEmitter, EVENT_TYPES.ERROR, { code: 'MERGE_ERROR', message: error instanceof Error ? error.message : String(error), where: 'merge_command' }, 'error');
					await finalizeAuditGuard(auditEmitter, 'error');
				}
				if (error instanceof GitOperationError) {
					console.error(`Git Operation Error: ${error.message}`);
					throwExit(1);
				}
				console.error(`Error executing merge: ${error instanceof Error ? error.message : String(error)}`);
				throwExit(1);
			} finally {
				if (auditEmitter) {
					await finalizeAuditGuard(auditEmitter, 'success');
				}
			}
		});
}
