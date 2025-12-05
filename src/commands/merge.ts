/**
 * Merge command - Execute merge pyramid with git operations
 */

import { Command } from "commander";
import { loadPlan } from "../schema.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { createGitOperations, GitOperationError } from "../git/operations.js";
import {
	parseAutopilotConfig,
	AutopilotConfigError,
	getAutopilotLevelDescription,
	AutopilotLevel,
} from "../autopilot/index.js";
import { ProgressReporter } from "../util/progress.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import {
	initAuditEmitter,
	emitEvent,
	AuditEmitter,
	EVENT_TYPES,
} from "../audit/index.js";
import {
	generateDryRunOutput,
	formatDryRunOutput,
	validateResume,
	initializeWeaveExecution,
} from "../weave/mergeHelpers.js";
import {
	initializeLockFile,
	updateLockFile,
	deleteLockFile,
} from "../weave/lockFile.js";
import { WeaveEvent } from "../weave/types.js";
import {
	computeLockHash,
	formatLockHash,
	generateLockBranchName,
} from "../util/lockHash.js";
import {
	parseWeaveLock,
	serializeWeaveLock,
	WeaveLock,
} from "../schema/weaveLock.js";
import { MergeWeaveTurnCost } from "../metrics/turncost.js";
import * as fs from "fs";
import * as path from "path";

// Guarded finalize: ensure HIPAA-prefixed errors rethrow (to map to exit 2),
// while non-HIPAA finalize errors are logged and ignored.
async function finalizeAuditGuard(
	emitter: AuditEmitter,
	status?: string
): Promise<void> {
	try {
		const { finalizeAudit } = await import("../audit/index.js");
		await finalizeAudit(emitter, status);
	} catch (e) {
		if (
			e instanceof Error &&
			typeof e.message === "string" &&
			e.message.startsWith("HIPAA:")
		) {
			throw e; // let top-level handler map to exit code 2
		}
		console.warn("[lex-pr] audit: finalize failed (ignored)", String(e));
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
		.option(
			"--dry-run",
			"Show what would be merged without executing",
			true
		)
		.option("--execute", "Actually perform merge operations")
		.option(
			"--resume [runId]",
			"Resume execution from weave-lock.json (optional: specific run ID)"
		)
		.option("--cleanup", "Clean up integration branches after execution")
		.option("--force", "Force execution even if same lock hash exists")
		.option("--json", "Output JSON format")
		.option("--batch", "Enable batch mode for multiple items")
		.option("--filter <query>", "Filter items using query language")
		.option("--levels <levels>", "Comma-separated list of levels to merge")
		.option("--items <items>", "Comma-separated list of items to merge")
		.option("--max-level <level>", "Maximum autopilot level (0-4)", "0")
		.option(
			"--open-pr",
			"Open pull requests for integration branches (Level 3+)"
		)
		.option(
			"--close-superseded",
			"Close superseded PRs after integration (Level 4)"
		)
		.option(
			"--comment-template <path>",
			"Path to PR comment template (Level 2+)"
		)
		.option(
			"--branch-prefix <prefix>",
			"Prefix for integration branch names",
			"integration/"
		)
		.option(
			"--skip-preflight",
			"Skip preflight conflict detection in dry-run mode"
		)
		.option(
			"--fail-on-preflight-conflict",
			"Exit with error if preflight conflict detection finds conflicts"
		)
		.option(
			"--track-turncost",
			"Track Turn Cost metrics during execution (coordination overhead)"
		)
		.addHelpText(
			"after",
			`
Examples:
  $ lex-pr merge                                # Dry-run: preview merge operations
  $ lex-pr merge --execute                      # Execute merge pyramid
  $ lex-pr merge --resume                       # Resume from weave-lock.json
  $ lex-pr merge --resume <runId>               # Resume specific run
  $ lex-pr merge --execute --cleanup            # Execute and clean up integration branches
  $ lex-pr merge --execute --force              # Force execution even if lock exists
  $ lex-pr merge --json > merge-results.json    # JSON output for automation
  $ lex-pr merge --levels 1,2 --execute         # Merge only specific levels
  $ lex-pr merge --items pr-123,pr-456 --execute # Merge specific items
  $ lex-pr merge --skip-preflight               # Skip conflict detection
  $ lex-pr merge --fail-on-preflight-conflict   # Abort if conflicts detected
  $ lex-pr merge --execute --track-turncost     # Track coordination overhead

State Management:
  • Dry-run shows planned batches and execution order
  • Execute creates weave-lock.json for resume capability
  • Lock file contains hash(plan.json + PR heads) for validation
  • Resume validates lock file and continues from last successful state

Idempotency:
  • Lock hash computed from plan.json + PR head commits
  • Duplicate runs are skipped unless --force is used
  • Lock hash included in all logs and audit events

Preflight Conflict Detection:
  • Enabled by default in dry-run mode
  • Uses git merge-tree to simulate merges without modifying working tree
  • Detects conflicts early for each item before execution
  • Use --skip-preflight to disable or --fail-on-preflight-conflict to abort

Turn Cost Tracking:
  • Measures coordination overhead during merge-weave operations
  • Components: Latency (L), Renegotiation (R), Token Bloat (T), Attention (A)
  • Weighted score: λL + γC + ρR + τT + αA
  • Use --track-turncost to enable metrics collection

Common Issues:
  • Merge conflicts: Review conflicts and resolve manually, then re-run
  • Dirty working directory: Commit or stash changes before merging
  • Permission denied: Ensure you have push access to the repository
  • Resume validation failed: Plan or PR heads have changed since lock file creation`
		)
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
						branchPrefix: opts.branchPrefix,
					});
				} catch (error) {
					if (error instanceof AutopilotConfigError) {
						console.error(`Configuration Error: ${error.message}`);
						throwExit(2);
					}
					throw error;
				}

				// Show autopilot configuration if not in JSON mode
				if (
					!(opts.json || jsonModeActive()) &&
					autopilotConfig.maxLevel > AutopilotLevel.ReportOnly
				) {
					console.log(
						`🤖 Autopilot Level ${
							autopilotConfig.maxLevel
						}: ${getAutopilotLevelDescription(
							autopilotConfig.maxLevel
						)}`
					);
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
							sha: sha || "unknown",
						};
					})
				);

				const lockHashResult = computeLockHash(plan, prHeads);
				const lockHash = lockHashResult.hash;
				const lockHashShort = formatLockHash(lockHash);

				// Check for existing lock file
				const lockFilePath = path.join(
					path.dirname(opts.plan),
					"weave-lock.json"
				);
				let existingLock: WeaveLock | null = null;

				if (fs.existsSync(lockFilePath)) {
					try {
						const lockContent = fs.readFileSync(
							lockFilePath,
							"utf-8"
						);
						existingLock = parseWeaveLock(lockContent);
					} catch (e) {
						console.warn(
							`Warning: Could not parse existing lock file: ${
								e instanceof Error ? e.message : String(e)
							}`
						);
					}
				}

				// Check if we should skip due to existing lock (unless --force)
				if (
					existingLock &&
					existingLock.lockHash === lockHash &&
					!opts.force &&
					opts.execute
				) {
					if (opts.json || jsonModeActive()) {
						console.log(
							canonicalJSONStringify({
								mode: "skipped",
								reason: "identical-lock",
								lockHash: lockHashShort,
								message:
									"Same plan and PR heads already executed. Use --force to override.",
							})
						);
					} else {
						console.log(`🔒 Lock Hash: ${lockHashShort}`);
						console.log(
							`\n⏭️  Skipping execution - identical lock hash found`
						);
						console.log(`   Lock file: ${lockFilePath}`);
						console.log(
							`   This plan with these exact PR heads has already been executed.`
						);
						console.log(
							`\n💡 Use --force to override and execute anyway`
						);
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
				const globalAudit = globalOpts.auditProfile as
					| string
					| undefined;
				if (globalAudit && globalAudit !== "off") {
					const auditDir = path.join(
						path.dirname(opts.plan || "."),
						"audit"
					);
					const envKey = process.env.LEX_AUDIT_KEY_HEX;
					const phiFlag =
						globalAudit === "hipaa-strict" ||
						process.env.LEX_AUDIT_PHI === "1";
					auditEmitter = await initAuditEmitter({
						profile: globalAudit as any,
						dir: auditDir,
						phiRedaction: phiFlag,
						encryptionKeyHex: envKey,
					});

					// Set lock hash in audit emitter so all events include it
					auditEmitter.setLockHash(lockHash);

					await emitEvent(
						auditEmitter,
						EVENT_TYPES.COMMAND_INVOCATION,
						{
							command: "merge",
							argv: process.argv.slice(2),
							lockHash: lockHashShort,
						}
					);
				}

				// Compute merge order
				const levels = computeMergeOrder(plan);

				// Check git status
				const isClean = await gitOps.isClean();
				if (!isClean && opts.execute) {
					console.error(
						"Error: Working directory is not clean. Please commit or stash changes."
					);
					throwExit(1);
				}

				const currentBranch = await gitOps.getCurrentBranch();

				// Handle resume mode
				if (opts.resume !== undefined) {
					const runId =
						typeof opts.resume === "string"
							? opts.resume
							: undefined;

					if (!(opts.json || jsonModeActive())) {
						console.log(
							"🔄 RESUME MODE - Validating execution state..."
						);
					}

					const resumeValidation = await validateResume(runId, plan);

					if (!resumeValidation.valid) {
						console.error(
							`Resume Error: ${resumeValidation.reason}`
						);
						throwExit(1);
					}

					if (!(opts.json || jsonModeActive())) {
						console.log(
							`✓ Lock file validated (Run ID: ${resumeValidation.context.runId})`
						);
						console.log(
							`✓ Resuming from state: ${resumeValidation.context.state}`
						);
						console.log(
							`✓ Completed batches: ${resumeValidation.context.currentBatchIndex}/${resumeValidation.context.batches.length}`
						);
						console.log("");
					}

					// Resume execution would continue here
					// For now, this is a placeholder for the actual resume logic
					console.log(
						"Resume functionality will continue execution from saved state"
					);
					return;
				}

				if (opts.dryRun && !opts.execute) {
					// Enhanced dry run mode with state machine preview
					const dryRunOutput = await generateDryRunOutput(
						plan,
						process.cwd(),
						opts.skipPreflight || false
					);

					// Check for preflight conflicts and fail if requested
					if (
						opts.failOnPreflightConflict &&
						dryRunOutput.preflight &&
						!dryRunOutput.preflight.skipped &&
						dryRunOutput.preflight.conflictsDetected > 0
					) {
						if (opts.json || jsonModeActive()) {
							console.log(
								canonicalJSONStringify({
									...dryRunOutput,
									lockHash: lockHashShort,
									error: "Preflight conflict detection found conflicts",
									exitCode: 1,
								})
							);
						} else {
							console.log(formatDryRunOutput(dryRunOutput));
							console.log("");
							console.error(
								`❌ Preflight conflict detection found ${dryRunOutput.preflight.conflictsDetected} conflict(s)`
							);
							console.error(
								"   Use --execute to proceed anyway or resolve conflicts first"
							);
						}
						throwExit(1);
					}

					if (opts.json || jsonModeActive()) {
						// Merge lock hash into dry run output
						console.log(
							canonicalJSONStringify({
								...dryRunOutput,
								lockHash: lockHashShort,
							})
						);
					} else {
						console.log(formatDryRunOutput(dryRunOutput));
					}
				} else if (opts.execute) {
					// Execute mode with state machine
					// Initialize weave execution context
					const { context, stateMachine } =
						await initializeWeaveExecution(plan);

					// Initialize lock file with lock hash from PR #378
					const lockData: WeaveLock = {
						lockHash,
						planHash: lockHashResult.inputs.planHash,
						prHeads: lockHashResult.inputs.prHeads,
						timestamp: lockHashResult.timestamp,
						status: "in-progress",
					};
					fs.writeFileSync(
						lockFilePath,
						serializeWeaveLock(lockData)
					);
					initializeLockFile(context);

					if (opts.json || jsonModeActive()) {
						writeJsonOutput({
							mode: "execute",
							status: "starting",
							runId: context.runId,
							lockHash: lockHashShort,
						});
					} else {
						console.log(
							`🚀 EXECUTE MODE - Starting merge pyramid execution`
						);
						console.log(`Run ID: ${context.runId}`);
						console.log(`Target: ${plan.target}`);
						console.log(`Items: ${plan.items.length}`);
						console.log(`Batches: ${context.batches.length}`);
						console.log("");
					}

					// Transition to planning state
					stateMachine.transition(WeaveEvent.START);
					updateLockFile(stateMachine.getContext());

					// Create progress reporter (disabled in JSON mode)
					const progressReporter = new ProgressReporter({
						enabled: !jsonModeActive(),
					});

					// Compute merge order
					const levels = computeMergeOrder(plan);

					// Initialize Turn Cost tracker if enabled
					const turnCostTracker = opts.trackTurncost
						? new MergeWeaveTurnCost()
						: null;
					const executeStartTime = performance.now();

					// Execute weave
					const result = await gitOps.executeWeave(
						plan,
						levels,
						progressReporter
					);

					// Record Turn Cost metrics
					if (turnCostTracker) {
						// Record total execution latency
						turnCostTracker.recordLatency(
							performance.now() - executeStartTime,
							"total_execution"
						);

						// Record renegotiations (conflicts that need resolution)
						for (const op of result.operations) {
							if (op.conflicts && op.conflicts.length > 0) {
								turnCostTracker.recordRenegotiation(
									`conflict in ${op.item.name}: ${op.conflicts.length} file(s)`,
									op.item.name
								);
							}
						}

						// Attach Turn Cost to context for frame emission
						context.turnCost = turnCostTracker.toJSON();
					}

					// Update lock file status based on result
					const finalLockData: WeaveLock = {
						lockHash,
						planHash: lockHashResult.inputs.planHash,
						prHeads: lockHashResult.inputs.prHeads,
						timestamp: lockHashResult.timestamp,
						status: result.failed > 0 ? "failed" : "completed",
					};
					fs.writeFileSync(
						lockFilePath,
						serializeWeaveLock(finalLockData)
					);

					if (opts.json || jsonModeActive()) {
						const output: Record<string, any> = {
							mode: "execute",
							status: "completed",
							lockHash: lockHashShort,
							result: {
								successful: result.successful,
								failed: result.failed,
								conflicts: result.conflicts,
								totalOperations: result.totalOperations,
							},
							operations: result.operations.map((op) => ({
								item: op.item.name,
								success: op.success,
								conflicts: op.conflicts,
								message: op.message,
								sha: op.sha,
							})),
						};
						// Include Turn Cost in JSON output if tracked
						if (turnCostTracker) {
							output.turnCost = turnCostTracker.toJSON();
						}
						console.log(canonicalJSONStringify(output));
					} else {
						console.log("");
						console.log("## Execution Results");
						console.log("");
						console.log("| Item | Status | Message | SHA |");
						console.log("|------|--------|---------|-----|");

						for (const operation of result.operations) {
							const status = operation.success ? "✓" : "✗";
							const sha = operation.sha
								? operation.sha.substring(0, 8)
								: "—";
							const message = operation.message || "—";
							console.log(
								`| ${operation.item.name} | ${status} | ${message} | ${sha} |`
							);
						}

						console.log("");
						console.log("### Summary");
						console.log(
							`- **Successful**: ${result.successful}/${result.totalOperations}`
						);
						console.log(
							`- **Failed**: ${result.failed}/${result.totalOperations}`
						);
						console.log(
							`- **Conflicts**: ${result.conflicts}/${result.totalOperations}`
						);

						// Display detailed conflict information if any
						if (result.conflicts > 0) {
							console.log("");
							console.log("### Conflicted Files");
							for (const operation of result.operations) {
								if (operation.conflicts && operation.conflicts.length > 0) {
									console.log(`\n**${operation.item.name}**:`);
									for (const file of operation.conflicts) {
										console.log(`  - ${file}`);
									}
								}
							}
						}

						// Display Turn Cost summary if tracked
						if (turnCostTracker) {
							const turnCostSummary = turnCostTracker.toJSON();
							console.log("");
							console.log("### Turn Cost");
							console.log(
								`- **Weighted Score**: ${turnCostSummary.weightedScore.toFixed(2)}`
							);
							console.log(
								`- **Latency**: ${(turnCostSummary.components.latencyMs / 1000).toFixed(2)}s`
							);
							console.log(
								`- **Renegotiations**: ${turnCostSummary.components.renegotiationCount}`
							);
							console.log(
								`- **Attention Switches**: ${turnCostSummary.components.attentionSwitchCount}`
							);
							if (turnCostSummary.improvement) {
								console.log(
									`- **vs Prior Run**: ${turnCostSummary.improvement}`
								);
							}
						}

						if (result.failed > 0) {
							console.log("");
							console.log(
								"❌ Merge pyramid execution completed with failures"
							);
							throwExit(1);
						} else {
							console.log("");
							console.log(
								"✅ Merge pyramid execution completed successfully"
							);
						}
					}

					// Cleanup if requested
					if (opts.cleanup) {
						await gitOps.cleanup();
						if (!opts.json && !jsonModeActive()) {
							console.log("🧹 Cleaned up integration branches");
						}
					}

					// Delete lock file on successful completion
					if (result.failed === 0) {
						deleteLockFile();
						if (!opts.json && !jsonModeActive()) {
							console.log(
								"🗑️  Removed weave-lock.json (execution complete)"
							);
						}
					}
				}
			} catch (error) {
				if (auditEmitter) {
					await emitEvent(
						auditEmitter,
						EVENT_TYPES.ERROR,
						{
							code: "MERGE_ERROR",
							message:
								error instanceof Error
									? error.message
									: String(error),
							where: "merge_command",
						},
						"error"
					);
					await finalizeAuditGuard(auditEmitter, "error");
				}
				if (error instanceof GitOperationError) {
					console.error(`Git Operation Error: ${error.message}`);
					throwExit(1);
				}
				console.error(
					`Error executing merge: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
				throwExit(1);
			} finally {
				if (auditEmitter) {
					await finalizeAuditGuard(auditEmitter, "success");
				}
			}
		});
}
