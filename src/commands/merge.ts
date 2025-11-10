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
import { computeLockHash, formatLockHash, generateLockBranchName } from '../util/lockHash.js';
import { parseWeaveLock, serializeWeaveLock, WeaveLock } from '../schema/weaveLock.js';
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
		.option("--force", "Force execution even if same lock hash exists")
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
  $ lex-pr merge --execute --force              # Force execution even if lock exists
  $ lex-pr merge --json > merge-results.json    # JSON output for automation
  $ lex-pr merge --levels 1,2 --execute         # Merge only specific levels
  $ lex-pr merge --items pr-123,pr-456 --execute # Merge specific items

Idempotency:
  • Lock hash computed from plan.json + PR head commits
  • Duplicate runs are skipped unless --force is used
  • Lock hash included in all logs and audit events

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

				// Initialize git operations early (needed for lock hash computation)
				const gitOps = createGitOperations();

				// Compute lock hash from plan + PR head commits
				const prHeads = await Promise.all(
					plan.items.map(async (item) => {
						const sha = await gitOps.getBranchHead(item.name);
						return {
							name: item.name,
							sha: sha || 'unknown'
						};
					})
				);

				const lockHashResult = computeLockHash(plan, prHeads);
				const lockHash = lockHashResult.hash;
				const lockHashShort = formatLockHash(lockHash);

				// Check for existing lock file
				const lockFilePath = path.join(path.dirname(opts.plan), 'weave-lock.json');
				let existingLock: WeaveLock | null = null;
				
				if (fs.existsSync(lockFilePath)) {
					try {
						const lockContent = fs.readFileSync(lockFilePath, 'utf-8');
						existingLock = parseWeaveLock(lockContent);
					} catch (e) {
						console.warn(`Warning: Could not parse existing lock file: ${e instanceof Error ? e.message : String(e)}`);
					}
				}

				// Check if we should skip due to existing lock (unless --force)
				if (existingLock && existingLock.lockHash === lockHash && !opts.force && opts.execute) {
					if (opts.json || jsonModeActive()) {
						console.log(canonicalJSONStringify({
							mode: "skipped",
							reason: "identical-lock",
							lockHash: lockHashShort,
							message: "Same plan and PR heads already executed. Use --force to override."
						}));
					} else {
						console.log(`🔒 Lock Hash: ${lockHashShort}`);
						console.log(`\n⏭️  Skipping execution - identical lock hash found`);
						console.log(`   Lock file: ${lockFilePath}`);
						console.log(`   This plan with these exact PR heads has already been executed.`);
						console.log(`\n💡 Use --force to override and execute anyway`);
					}
					return; // Exit early
				}

				// Display lock hash (unless in JSON mode)
				if (!opts.json && !jsonModeActive()) {
					console.log(`🔒 Lock Hash: ${lockHashShort}`);
					if (opts.force && existingLock) {
						console.log(`   Force mode: overriding existing lock`);
					}
					console.log("");
				}

				// Initialize audit emitter from global flag if present
				const globalOpts = getProgramOpts();
				const globalAudit = globalOpts.auditProfile as string | undefined;
				if (globalAudit && globalAudit !== 'off') {
					const auditDir = path.join(path.dirname(opts.plan || '.'), 'audit');
					const envKey = process.env.LEX_AUDIT_KEY_HEX;
					const phiFlag = (globalAudit === 'hipaa-strict') || process.env.LEX_AUDIT_PHI === '1';
					auditEmitter = await initAuditEmitter({ profile: globalAudit as any, dir: auditDir, phiRedaction: phiFlag, encryptionKeyHex: envKey });
					
					// Set lock hash in audit emitter so all events include it
					auditEmitter.setLockHash(lockHash);
					
					await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, { command: 'merge', argv: process.argv.slice(2), lockHash: lockHashShort });
				}

				// Compute merge order
				const levels = computeMergeOrder(plan);

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
							lockHash: lockHashShort,
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
					// Write lock file before execution
					const lockData: WeaveLock = {
						lockHash,
						planHash: lockHashResult.inputs.planHash,
						prHeads: lockHashResult.inputs.prHeads,
						timestamp: lockHashResult.timestamp,
						status: 'in-progress'
					};
					fs.writeFileSync(lockFilePath, serializeWeaveLock(lockData));

					// Execute mode
					if (opts.json || jsonModeActive()) {
						writeJsonOutput({ mode: "execute", status: "starting", lockHash: lockHashShort });
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

					// Update lock file status based on result
					const finalLockData: WeaveLock = {
						lockHash,
						planHash: lockHashResult.inputs.planHash,
						prHeads: lockHashResult.inputs.prHeads,
						timestamp: lockHashResult.timestamp,
						status: result.failed > 0 ? 'failed' : 'completed'
					};
					fs.writeFileSync(lockFilePath, serializeWeaveLock(finalLockData));

					if (opts.json || jsonModeActive()) {
						console.log(canonicalJSONStringify({
							mode: "execute",
							status: "completed",
							lockHash: lockHashShort,
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
						if (!opts.json && !jsonModeActive()) {
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
