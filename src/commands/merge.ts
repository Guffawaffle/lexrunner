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
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { throwExit } from "../cli/exitHandler.js";
import { initAuditEmitter, emitEvent, AuditEmitter, EVENT_TYPES } from "../audit/index.js";
import { generateDryRunOutput, formatDryRunOutput } from "../weave/mergeHelpers.js";
import { computeLockHash, formatLockHash } from "../util/lockHash.js";
import { parseWeaveLock, serializeWeaveLock, WeaveLock } from "../schema/weaveLock.js";
import { MergeWeaveTurnCost } from "../metrics/turncost.js";
import {
  getLexSonaConfig,
  isLexSonaEnabled,
  deriveShadowConstraints,
  formatShadowGovernanceSummary,
  createGovernanceComparisonLog,
  writeGovernanceLog,
  type LexSonaWorkflowContext,
  type RunnerGovernanceSignals,
} from "../lexsona/index.js";
import * as fs from "fs";
import * as path from "path";
import {
  createLocalResumeCheckpoint,
  LocalWeaveResumeDriver,
} from "../weave/local-resume-driver.js";
import {
  getLatestCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
} from "../weave/checkpoint/storage.js";
import { resumePersistedWeave } from "../weave/resume-service.js";
import { sha256 } from "../util/hash.js";

// Guarded finalize: ensure HIPAA-prefixed errors rethrow (to map to exit 2),
// while non-HIPAA finalize errors are logged and ignored.
async function finalizeAuditGuard(emitter: AuditEmitter, status?: string): Promise<void> {
  try {
    const { finalizeAudit } = await import("../audit/index.js");
    await finalizeAudit(emitter, status);
  } catch (e) {
    if (e instanceof Error && typeof e.message === "string" && e.message.startsWith("HIPAA:")) {
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
    .option("--dry-run", "Show what would be merged without executing", true)
    .option("--execute", "Actually perform merge operations")
    .option("--resume [runId]", "Resume from the persisted operation checkpoint")
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
    .option("--skip-preflight", "Skip preflight conflict detection in dry-run mode")
    .option(
      "--fail-on-preflight-conflict",
      "Exit with error if preflight conflict detection finds conflicts"
    )
    .option("--track-turncost", "Track Turn Cost metrics during execution (coordination overhead)")
    .option(
      "--resolve-policy <policy>",
      "Conflict resolution policy: minimal-hunk (default), ours, theirs",
      "minimal-hunk"
    )
    .option("--ai-assist <mode>", "AI assistance mode: auto (default), none, required", "auto")
    .option("--emit-frames", "Emit execution frames for observability and debugging")
    .option("--no-auto-update", "Disable automatic PR branch updates during sequential merge-weave")
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
  $ lex-pr merge --execute --resolve-policy ours    # Use "ours" conflict resolution
  $ lex-pr merge --execute --ai-assist required     # Require AI assistance for conflicts
  $ lex-pr merge --execute --emit-frames            # Enable frame emission
  $ lex-pr merge --execute --no-auto-update         # Disable auto PR branch updates

State Management:
  • Dry-run shows planned batches and execution order
  • Execute creates a versioned operation checkpoint for resume capability
  • The checkpoint binds the plan, target, source heads, and integration branch
  • Resume reconciles current external state before continuing

Idempotency:
  • Lock hash computed from plan.json + PR head commits
  • Duplicate runs are skipped unless --force is used
  • Lock hash included in all logs and audit events

Auto-Update PR Branches:
  • Enabled by default during sequential merge-weave
  • After merging PR N, remaining PRs are checked for 'behind' status
  • Behind PRs are automatically updated via GitHub API
  • Update failures are logged but don't block the weave
  • Use --no-auto-update to disable this behavior

Conflict Resolution Policies:
  • minimal-hunk (default): AI-powered minimal edit resolution with precise conflict boundaries
  • ours: Accept all changes from current branch (opt-in, use with caution)
  • theirs: Accept all changes from incoming branch (opt-in, use with caution)

AI Assistance Modes:
  • auto (default): Use AI assistance when available and beneficial
  • none: Disable AI assistance entirely (manual resolution required)
  • required: Fail if AI assistance is not available for conflicts

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

Frame Emission:
  • Enable with --emit-frames to output execution frames
  • Frames capture state transitions for debugging and observability
  • Useful for integration with monitoring tools and dashboards

Common Issues:
  • Merge conflicts: Review conflicts and resolve manually, then re-run
  • Dirty working directory: Commit or stash changes before merging
  • Permission denied: Ensure you have push access to the repository
  • Resume validation failed: Plan or PR heads have changed since lock file creation`
    )
    .action(async (opts) => {
      let auditEmitter: AuditEmitter | null = null;
      try {
        // Validate --resolve-policy flag
        const validResolvePolicies = ["minimal-hunk", "ours", "theirs"];
        if (opts.resolvePolicy && !validResolvePolicies.includes(opts.resolvePolicy)) {
          console.error(
            `Invalid --resolve-policy: ${opts.resolvePolicy}. Must be one of: ${validResolvePolicies.join(", ")}`
          );
          throwExit(2);
        }

        // Validate --ai-assist flag
        const validAiAssistModes = ["auto", "none", "required"];
        if (opts.aiAssist && !validAiAssistModes.includes(opts.aiAssist)) {
          console.error(
            `Invalid --ai-assist: ${opts.aiAssist}. Must be one of: ${validAiAssistModes.join(", ")}`
          );
          throwExit(2);
        }

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
            `🤖 Autopilot Level ${autopilotConfig.maxLevel}: ${getAutopilotLevelDescription(
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
        const lockFilePath = path.join(path.dirname(opts.plan), "weave-lock.json");
        let existingLock: WeaveLock | null = null;

        if (fs.existsSync(lockFilePath)) {
          try {
            const lockContent = fs.readFileSync(lockFilePath, "utf-8");
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
        if (existingLock && existingLock.lockHash === lockHash && !opts.force && opts.execute) {
          if (opts.json || jsonModeActive()) {
            console.log(
              canonicalJSONStringify({
                mode: "skipped",
                reason: "identical-lock",
                lockHash: lockHashShort,
                message: "Same plan and PR heads already executed. Use --force to override.",
              })
            );
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
        if (globalAudit && globalAudit !== "off") {
          const auditDir = path.join(path.dirname(opts.plan || "."), "audit");
          const envKey = process.env.LEX_AUDIT_KEY_HEX;
          const phiFlag = globalAudit === "hipaa-strict" || process.env.LEX_AUDIT_PHI === "1";
          auditEmitter = await initAuditEmitter({
            profile: globalAudit as any,
            dir: auditDir,
            phiRedaction: phiFlag,
            encryptionKeyHex: envKey,
          });

          // Set lock hash in audit emitter so all events include it
          auditEmitter.setLockHash(lockHash);

          await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, {
            command: "merge",
            argv: process.argv.slice(2),
            lockHash: lockHashShort,
          });
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

        // Handle resume mode
        if (opts.resume !== undefined) {
          const runId = typeof opts.resume === "string" ? opts.resume : undefined;

          if (!(opts.json || jsonModeActive())) {
            console.log("🔄 RESUME MODE - Validating execution state...");
          }

          const checkpoint = runId
            ? await loadCheckpoint(runId, { validatePlanHash: false })
            : await getLatestCheckpoint();
          if (!checkpoint) {
            console.error("Resume Error: No persisted checkpoint found.");
            throwExit(1);
          }
          const requestedPlanHash = sha256(Buffer.from(canonicalJSONStringify(plan)));
          if (checkpoint.planHash !== requestedPlanHash) {
            console.error("Resume Error: The supplied plan does not match the persisted run.");
            throwExit(1);
          }

          if (!(opts.json || jsonModeActive())) {
            console.log(`✓ Checkpoint validated (Run ID: ${checkpoint.runId})`);
            console.log(`✓ Resuming from state: ${checkpoint.state}`);
            console.log("");
          }
          const result = await resumePersistedWeave({
            runId: checkpoint.runId,
            driver: new LocalWeaveResumeDriver(process.cwd()),
          });
          if (opts.json || jsonModeActive()) {
            console.log(canonicalJSONStringify({ mode: "resume", ...result }));
          } else if (result.ok) {
            console.log(
              `✅ ${result.outcome === "completed" ? "Execution completed" : "Execution paused"}`
            );
            console.log(
              `Completed: ${result.completed} | Pending: ${result.pending} | Failed: ${result.failed}`
            );
          } else {
            console.error(`Resume Error: ${result.reason}`);
            throwExit(1);
          }
          if (result.ok && result.outcome === "completed" && fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
          }
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
              console.error("   Use --execute to proceed anyway or resolve conflicts first");
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
          const checkpoint = await createLocalResumeCheckpoint({ plan, workingDir: process.cwd() });
          await saveCheckpoint(checkpoint, { skipCleanup: true });
          const lockData: WeaveLock = {
            lockHash,
            planHash: lockHashResult.inputs.planHash,
            prHeads: lockHashResult.inputs.prHeads,
            timestamp: lockHashResult.timestamp,
            status: "in-progress",
          };
          fs.writeFileSync(lockFilePath, serializeWeaveLock(lockData));

          if (!(opts.json || jsonModeActive())) {
            console.log(`🚀 EXECUTE MODE - Starting merge pyramid execution`);
            console.log(`Run ID: ${checkpoint.runId}`);
            console.log(`Target: ${plan.target}`);
            console.log(`Items: ${plan.items.length}`);
            console.log(`Batches: ${checkpoint.totalBatches}`);
            console.log("");
          }

          // Initialize Turn Cost tracker if enabled
          const turnCostTracker = opts.trackTurncost ? new MergeWeaveTurnCost() : null;
          // Note: performance.now() is available in Node.js >= 8.5.0,
          // and this project requires Node.js >= 20 (package.json)
          const executeStartTime = turnCostTracker ? performance.now() : 0;

          // === LexSona Shadow Governance (Version Contract v0.1) ===
          const lexsonaConfig = getLexSonaConfig();
          if (isLexSonaEnabled(lexsonaConfig)) {
            const workflowContext: LexSonaWorkflowContext = {
              workflowId: "merge-weave",
              stepKind: "execute",
              repo: plan.target,
              branch: currentBranch,
              hints: {
                task: "merge-pyramid-execution",
                itemCount: plan.items.length,
                batchCount: checkpoint.totalBatches,
              },
            };

            // Derive shadow constraints (no enforcement)
            const shadowResult = await deriveShadowConstraints(workflowContext, lexsonaConfig);

            // Collect runner governance signals for comparison
            // Aggregate gates from all plan items
            const allGates = plan.items.flatMap((item) => item.gates.map((g) => g.name));
            const uniqueGates = [...new Set(allGates)];
            const runnerSignals: RunnerGovernanceSignals = {
              gatesRequired: uniqueGates,
              mergeEligible: true, // We got here, so eligible
            };

            // Log governance comparison
            const governanceLog = createGovernanceComparisonLog(
              workflowContext,
              shadowResult,
              runnerSignals,
              lexsonaConfig.mode
            );
            const logPath = await writeGovernanceLog(governanceLog);

            // Show real-time console feedback (QOL-003)
            if (!(opts.json || jsonModeActive())) {
              const summary = formatShadowGovernanceSummary(shadowResult, runnerSignals, {
                noColor: opts.noColor,
              });
              console.log(summary);
              console.log(`   Logged to: ${logPath.replace(process.cwd(), ".")}`);
              console.log("");
            }
          }
          const result = await resumePersistedWeave({
            runId: checkpoint.runId,
            driver: new LocalWeaveResumeDriver(process.cwd()),
          });
          const persisted = await loadCheckpoint(checkpoint.runId, { validatePlanHash: false });
          const operations = persisted.metadata?.resume?.operations ?? [];
          const merges = operations.filter((operation) => operation.phase === "merge");
          const successful = merges.filter((operation) => operation.status === "completed").length;
          const failed = merges.filter((operation) => operation.status === "failed").length;

          // Record Turn Cost metrics
          if (turnCostTracker) {
            turnCostTracker.recordLatency(performance.now() - executeStartTime, "total_execution");
          }

          const finalLockData: WeaveLock = {
            lockHash,
            planHash: lockHashResult.inputs.planHash,
            prHeads: lockHashResult.inputs.prHeads,
            timestamp: lockHashResult.timestamp,
            status: result.ok && result.outcome === "completed" ? "completed" : "failed",
          };
          fs.writeFileSync(lockFilePath, serializeWeaveLock(finalLockData));

          if (opts.json || jsonModeActive()) {
            const output: Record<string, any> = {
              mode: "execute",
              status: result.ok ? result.outcome : "failed",
              runId: checkpoint.runId,
              lockHash: lockHashShort,
              result: {
                successful,
                failed,
                totalOperations: merges.length,
              },
              operations: operations.map((operation) => ({
                id: operation.id,
                phase: operation.phase,
                item: operation.item,
                status: operation.status,
                externalId: operation.result?.externalId,
                error: operation.error,
              })),
            };
            if (turnCostTracker) {
              output.turnCost = turnCostTracker.toJSON();
            }
            console.log(canonicalJSONStringify(output));
          } else {
            console.log("");
            console.log("## Execution Results");
            console.log("");
            console.log("| Operation | Phase | Status | Evidence |");
            console.log("|-----------|-------|--------|----------|");

            for (const operation of operations) {
              const evidence = operation.result?.externalId?.slice(0, 12) ?? operation.error ?? "—";
              console.log(
                `| ${operation.id} | ${operation.phase} | ${operation.status} | ${evidence} |`
              );
            }

            console.log("");
            console.log("### Summary");
            console.log(`- **Successful merges**: ${successful}/${merges.length}`);
            console.log(`- **Failed merges**: ${failed}/${merges.length}`);
            console.log(`- **Checkpoint**: ${checkpoint.runId}`);

            // Display Turn Cost summary if tracked
            if (turnCostTracker) {
              const turnCostSummary = turnCostTracker.toJSON();
              console.log("");
              console.log("### Turn Cost");
              console.log(`- **Weighted Score**: ${turnCostSummary.weightedScore.toFixed(2)}`);
              console.log(
                `- **Latency**: ${(turnCostSummary.components.latencyMs / 1000).toFixed(2)}s`
              );
              console.log(`- **Renegotiations**: ${turnCostSummary.components.renegotiationCount}`);
              console.log(
                `- **Attention Switches**: ${turnCostSummary.components.attentionSwitchCount}`
              );
              if (turnCostSummary.improvement) {
                console.log(`- **vs Prior Run**: ${turnCostSummary.improvement}`);
              }
            }

            if (!result.ok || result.outcome !== "completed") {
              console.log("");
              console.log(
                `❌ Merge pyramid execution stopped: ${result.ok ? result.outcome : result.reason}`
              );
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

          if (result.ok && result.outcome === "completed") {
            if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath);
            if (!opts.json && !jsonModeActive()) {
              console.log("🗑️  Removed weave-lock.json; retained the completed checkpoint");
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
              message: error instanceof Error ? error.message : String(error),
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
          `Error executing merge: ${error instanceof Error ? error.message : String(error)}`
        );
        throwExit(1);
      } finally {
        if (auditEmitter) {
          await finalizeAuditGuard(auditEmitter, "success");
        }
      }
    });
}
