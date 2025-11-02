#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import chalk from "chalk";
import { Plan, loadPlan, SchemaValidationError } from "./schema.js";
import {
	computeMergeOrder,
	CycleError,
	UnknownDependencyError,
} from "./mergeOrder.js";
import { executeGatesWithPolicy } from "./gates.js";
import { ExecutionState } from "./executionState.js";
import { MergeEligibilityEvaluator } from "./mergeEligibility.js";
import { loadInputs } from "./core/inputs.js";
import { generatePlan } from "./core/plan.js";
import { generateSnapshot } from "./core/snapshot.js";
import { canonicalJSONStringify } from "./util/canonicalJson.js";
import { createGitHubAPI, GitHubAPI, GitHubAPIError } from "./github/api.js";
import { createGitOperations, GitOperationError } from "./git/operations.js";
import {
	bootstrapWorkspace,
	createMinimalWorkspace,
	detectProjectType,
	getEnvironmentSuggestions,
} from "./core/bootstrap.js";
import { initLocalOverlay, hasLocalOverlay } from "./config/localOverlay.js";
import {
	WriteProtectionError,
	resolveProfile,
	validateWriteOperation,
} from "./config/profileResolver.js";
import {
	parseAutopilotConfig,
	AutopilotConfigError,
	getAutopilotLevelDescription,
	AutopilotLevel,
} from "./autopilot/index.js";
import {
	createLogger,
	Logger,
	generateCorrelationId,
	healthChecker,
} from "./monitoring/index.js";
import { runInit } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerReportCommand } from "./commands/report.js";
import { registerRetryCommand } from "./commands/retry.js";
import { registerGateReportCommand } from "./commands/gateReport.js";
import { registerSecurityCommands } from "./cli-security.js";
import { registerAuditCommands } from "./cli-audit.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerMergeOrderCommand } from "./commands/mergeOrder.js";
import { registerMergeCommand } from "./commands/merge.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerPlanDiffCommand } from "./commands/planDiff.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerSchemaCommand } from "./commands/schema.js";
import { registerAutopilotCommand } from "./commands/autopilot.js";
import { registerPlanBatchCommand } from "./commands/orchestrate/plan-batch.js";
import { registerPinToolchainCommand } from "./commands/orchestrate/pinToolchain.js";
import { registerPredictConflictsCommand } from "./commands/orchestrate/predict-conflicts.js";
import { registerGenerateDeliverablesCommand } from "./commands/orchestrate/generate-deliverables.js";
import { registerAssignBatchCommand } from "./commands/orchestrate/assign-batch.js";
import { registerAnalyzeIssuesCommand } from "./commands/orchestrate/analyze-issues.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { ProgressReporter } from "./util/progress.js";
import { initColorControl, isColorDisabled } from "./util/colorControl.js";
import { parseGlobalFlags, validateFlagCombinations } from "./cli/flags.js";
import { writeJsonOutput } from "./cli/output.js";
import {
	CLIExitSignal,
	throwExit,
	installSignalHandlers,
	installUnhandledRejectionHandler,
} from "./cli/exitHandler.js";
import {
	getStatusIcon,
	formatStatusTable,
	formatQueryResult,
} from "./cli/formatters.js";
import {
	initAuditEmitter,
	emitEvent,
	finalizeAudit,
	AuditEmitter,
	AuditOptions,
	EVENT_TYPES,
} from "./audit/index.js";
import { sha256 } from "./util/hash.js";
import {
	validatePlan as validatePlanDeps,
	formatValidationResult,
} from "./planner/validation.js";
import * as fs from "fs";
import * as path from "path";

let jsonModeActive = false;

// Guarded finalize: ensure HIPAA-prefixed errors rethrow (to map to exit 2),
// while non-HIPAA finalize errors are logged and ignored.
async function finalizeAuditGuard(
	emitter: AuditEmitter,
	status?: string
): Promise<void> {
	try {
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
 * CLI exit discipline with proper error codes
 */
function exitWith(e: unknown, schemaCode = "ESCHEMA") {
	// Let CLIExitSignal propagate - don't treat it as an error
	if (e instanceof CLIExitSignal) {
		throw e;
	}

	const err: any = e;
	if (err?.code === schemaCode && Array.isArray(err.issues)) {
		console.log(JSON.stringify({ errors: err.issues }, null, 2));
		if (!jsonModeActive) {
			console.error(err.message);
		}
		process.exitCode = 2;
		throwExit(2);
	}
	if (
		e instanceof SchemaValidationError ||
		e instanceof CycleError ||
		e instanceof UnknownDependencyError ||
		e instanceof WriteProtectionError ||
		e instanceof AutopilotConfigError
	) {
		const prefix = jsonModeActive ? "[lex-pr]" : "❌";
		console.error(`\n${prefix} Error: ${String(err?.message ?? e)}\n`);

		// Add helpful suggestions based on error type (suppress in JSON mode)
		if (!jsonModeActive) {
			if (e instanceof WriteProtectionError) {
				console.error(
					"💡 Tip: Use a local profile directory for development:"
				);
				console.error(
					"   lex-pr init --profile-dir .smartergpt.local\n"
				);
			} else if (e instanceof CycleError) {
				console.error(
					"💡 Tip: Check your dependency declarations in PR descriptions"
				);
				console.error(
					"   Look for circular dependencies like: A→B→C→A\n"
				);
			} else if (e instanceof UnknownDependencyError) {
				console.error(
					"💡 Tip: Ensure all referenced PRs exist and are included in your plan"
				);
				console.error(
					"   Run 'lex-pr discover' to find available PRs\n"
				);
			} else if (e instanceof SchemaValidationError) {
				console.error("💡 Tip: Validate your configuration files:");
				console.error("   lex-pr schema validate plan.json\n");
			}
		}

		process.exitCode = 2;
		throwExit(2); // Validation errors
	}
	// HIPAA fail-closed errors are surfaced as Error messages prefixed with 'HIPAA:'
	if (
		e instanceof Error &&
		typeof e.message === "string" &&
		e.message.startsWith("HIPAA:")
	) {
		const prefix = jsonModeActive ? "[lex-pr]" : "❌";
		console.error(`\n${prefix} ${e.message.replace(/^HIPAA:\s*/, "")}\n`);
		process.exitCode = 2;
		throwExit(2);
	}
	const prefix = jsonModeActive ? "[lex-pr]" : "❌";
	console.error(
		`\n${prefix} Unexpected error: ${String(err?.message ?? e)}\n`
	);
	if (!jsonModeActive) {
		console.error(
			"💡 Tip: Run 'lex-pr doctor' to check your environment\n"
		);
	}
	throwExit(1); // Unexpected failures
}

// Global logger instance
let logger: Logger;

const program = new Command();

// Intercept all Commander exits centrally - no brittle message filtering needed
program.exitOverride((err: CommanderError) => {
	// Help/version often exit with code 0; normalize through CLIExitSignal
	throw new CLIExitSignal(err.exitCode ?? 1, err.message);
});

// Configure output streams explicitly for JSON purity
program.configureOutput({
	writeOut: (str) => process.stdout.write(str),
	writeErr: (str) => process.stderr.write(str),
});

program
	.name("lex-pr")
	.description(
		"Lex-PR Runner - Fan-out PRs, compute merge pyramid, run gates, and weave merges cleanly"
	)
	.version("0.1.0")
	.option("--no-color", "Disable ANSI color codes in output")
	.option(
		"--audit-profile <profile>",
		"Audit logging profile: off|basic|soc2|hipaa-strict",
		"off"
	)
	.option(
		"--audit-key <hex>",
		"Audit encryption key (64 hex chars) - overrides LEX_AUDIT_KEY_HEX"
	)
	.option("--json", "Enable JSON output mode (implies --no-color)")
	.option(
		"--log-format <format>",
		"Log output format: 'json' or 'human'",
		process.env.LOG_FORMAT || "human"
	)
	.hook("preAction", (thisCommand) => {
		// Initialize color control based on global flags
		const opts = thisCommand.optsWithGlobals();
		const jsonMode = opts.json || false;
		const noColor = opts.noColor || false;

		// Set global JSON mode
		jsonModeActive = jsonMode;

		// Initialize color control (--json implies --no-color)
		initColorControl({ noColor, jsonMode });
	})
	.addHelpText(
		"after",
		`
Examples:
	$ lex-pr init                           Initialize workspace with interactive setup
	$ lex-pr doctor                         Validate environment and configuration
	$ lex-pr config:inspect                 Display merged configuration with provenance map
	$ lex-pr discover                       Find open PRs matching scope
	$ lex-pr discover --suggest             Generate dependency suggestions with heuristics
	$ lex-pr plan --from-github             Generate merge plan from GitHub PRs
	$ lex-pr plan-review plan.json          Interactively review and edit plan
	$ lex-pr plan-diff plan1.json plan2.json  Compare two plans
	$ lex-pr execute plan.json              Run quality gates on plan
	$ lex-pr orchestrate analyze            Analyze issues for parallel work planning
	$ lex-pr orchestrate analyze --labels priority:P1 --json
	$ lex-pr security check-rotation        Check token rotation status
	$ lex-pr security scan-plan             Scan a plan file for secrets
	$ lex-pr security validate-secrets GITHUB_TOKEN OTHER_SECRET

Power User Commands:
	$ lex-pr view plan.json                 Interactive plan viewer
	$ lex-pr query plan.json --stats        Plan statistics and analysis
	$ lex-pr query plan.json "level eq 1"   Query items by criteria
	$ lex-pr retry --filter failed          Retry failed gates
	$ lex-pr completion bash                Generate bash completion script

Workflow:
	1. Discover:    lex-pr discover (optionally add --suggest for dependencies)
	2. Plan:        lex-pr plan --from-github --json > plan.json
	3. Review:      lex-pr plan-review plan.json
	4. Execute:     lex-pr execute plan.json
	5. Report:      lex-pr report artifacts --out md
`
	);

// Gate report validation command - modular implementation
registerGateReportCommand(program);

// Plan generation command - modular implementation
registerPlanCommand(program, {
	jsonModeActive: () => jsonModeActive,
	setJsonMode: (active: boolean) => {
		jsonModeActive = active;
	},
	exitWith,
});

// Config inspect command
program
	.command("config:inspect")
	.description("Display merged configuration with provenance map")
	.option("--json", "Output canonical JSON format")
	.action((opts) => {
		try {
			// Load configuration with provenance tracking
			const config = loadInputs();

			// Check both command-level and global JSON mode
			if (opts.json || jsonModeActive) {
				// Output deterministic JSON with sorted keys
				const output = {
					config: {
						items: config.items,
						target: config.target,
						version: config.version,
					},
					provenance: config.provenance || {},
					sources: config.sources.map((s) => ({
						exists: s.exists,
						file: s.file,
					})),
				};
				writeJsonOutput(output);
			} else {
				// Human-readable output
				console.log(chalk.bold("\n📋 Configuration Inspection\n"));

				console.log(chalk.cyan("Configuration:"));
				console.log(`  Version: ${config.version}`);
				console.log(`  Target: ${config.target}`);
				console.log(`  Items: ${config.items.length}\n`);

				if (config.provenance) {
					console.log(chalk.cyan("Provenance Map:"));
					const sortedKeys = Object.keys(config.provenance).sort();
					for (const key of sortedKeys) {
						console.log(
							`  ${key}: ${chalk.green(config.provenance[key])}`
						);
					}
					console.log("");
				}

				console.log(chalk.cyan("Configuration Sources:"));
				for (const source of config.sources) {
					const status = source.exists
						? chalk.green("✓")
						: chalk.gray("✗");
					console.log(`  ${status} ${source.file}`);
				}
				console.log("");
			}

			process.exit(0);
		} catch (error) {
			exitWith(error);
		} finally {
			// no audit finalization here
		}
	});

// Plan review command - Interactive plan validation and editing
program
	.command("plan-review")
	.description("Interactive plan review with human-in-the-loop validation")
	.option("--plan <file>", "Path to plan.json file")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option("--non-interactive", "Non-interactive mode (auto-approve)")
	.option("--profile-dir <dir>", "Profile directory for history tracking")
	.option("--save-history", "Save plan versions to history")
	.option("--output <file>", "Output file for approved/modified plan")
	.action(async (file: string | undefined, opts) => {
		const planFile = opts.plan || file;
		let auditEmitter: AuditEmitter | null = null;
		if (!planFile) {
			console.error(
				"Error: plan file is required (use --plan <file> or provide as argument)"
			);
			throwExit(1);
		}

		try {
			// Initialize audit emitter from global audit-profile flag if set
			const globalAudit = program.opts().auditProfile as
				| string
				| undefined;
			if (globalAudit && globalAudit !== "off") {
				const auditDir = path.join(
					resolveProfile(opts.profileDir).path,
					"deliverables",
					"audit"
				);
				const cliKey = program.opts().auditKey as string | undefined;
				const envKey = process.env.LEX_AUDIT_KEY_HEX;
				const keyToUse = cliKey || envKey;
				const phiFlag =
					globalAudit === "hipaa-strict" ||
					process.env.LEX_AUDIT_PHI === "1";
				auditEmitter = await initAuditEmitter({
					profile: globalAudit as any,
					dir: auditDir,
					phiRedaction: phiFlag,
					encryptionKeyHex: keyToUse,
				});
				await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, {
					command: "autopilot",
					argv: process.argv.slice(2),
				});
			}
			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);

			// Import interactive review module
			const { reviewPlan } = await import("./interactive/planReview.js");
			const { savePlanVersion, getPlanHistoryPath } = await import(
				"./interactive/planHistory.js"
			);

			// Run interactive review
			const result = await reviewPlan({
				plan,
				interactive: !opts.nonInteractive,
				autoApprove: opts.nonInteractive,
			});

			// Save to history if requested
			if (opts.saveHistory) {
				const profile = resolveProfile(opts.profileDir);
				const historyPath = getPlanHistoryPath(profile.path);
				savePlanVersion(historyPath, result.plan, {
					approved: result.approved,
					changes: result.changes,
					message: result.reason,
				});
				console.log(`\n✓ Saved to history: ${historyPath}`);
			}

			// Save approved/modified plan
			if (result.approved && opts.output) {
				fs.writeFileSync(
					opts.output,
					canonicalJSONStringify(result.plan)
				);
				console.log(`\n✓ Saved plan to: ${opts.output}`);
			}

			if (result.approved) {
				console.log("\n✅ Plan approved");
				if (result.modified) {
					console.log(`\n📝 Changes made:`);
					result.changes?.forEach((change) =>
						console.log(`  - ${change}`)
					);
				}
				throwExit(0);
			} else {
				console.log("\n❌ Plan rejected");
				if (result.reason) {
					console.log(`Reason: ${result.reason}`);
				}
				throwExit(1);
			}
		} catch (error) {
			exitWith(error);
		}
	});

// Merge order command - modular implementation
registerMergeOrderCommand(program, () => jsonModeActive, exitWith);

// Plan diff command - modular implementation
registerPlanDiffCommand(program, {
	jsonModeActive: () => jsonModeActive,
	exitWith,
});

// Autopilot command - modular implementation
registerAutopilotCommand(program, {
	jsonModeActive: () => jsonModeActive,
	exitWith,
	getAuditProfile: () => program.opts().auditProfile as string | undefined,
	getAuditKey: () => program.opts().auditKey as string | undefined,
	finalizeAuditGuard
});

// Execute plan command (replaces gate command)
program
	.command("execute")
	.description(
		"Execute plan with policy-aware gate running and status tracking"
	)
	.option("--plan <file>", "Path to plan.json file", "plan.json")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option(
		"--artifact-dir <dir>",
		"Output directory for artifacts",
		"./artifacts"
	)
	.option("--timeout <ms>", "Gate timeout in milliseconds", "30000")
	.option(
		"--dry-run",
		"Validate plan and show execution order without running gates"
	)
	.option("--json", "Output results in JSON format")
	.option("--status-table", "Generate status table for PR comments")
	.option(
		"--skip-input-validation",
		"Skip gate input schema validation (not recommended)"
	)
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
		"--audit <profile>",
		"Audit profile: off|basic|soc2|hipaa-strict",
		"off"
	)
	.option(
		"--audit-dir <path>",
		"Audit output directory (default: <deliverables>/audit)"
	)
	.option(
		"--audit-format <format>",
		"Audit format (reserved for future)",
		"jsonl"
	)
	.option("--audit-include-env <keys>", "Comma-separated env keys to include")
	.option("--audit-redact <regex>", "Custom redaction regex pattern")
	.option("--audit-hash-paths", "Hash file paths in audit events")
	.option(
		"--audit-signer <provider:keyref>",
		"Signature method: kms:<ARN> or gpg:<FINGERPRINT>"
	)
	.option("--audit-retain-days <days>", "Retention hint in days")
	.option("--audit-context <types>", "Context blocks: git,ci,os")
	.option(
		"--audit-sample <percent>",
		"Sampling percentage for noisy gates",
		"100"
	)
	.addHelpText(
		"after",
		`
Examples:
  $ lex-pr execute plan.json                    # Run all gates in plan
  $ lex-pr execute --dry-run                    # Validate plan without running gates
  $ lex-pr execute --json > results.json        # JSON output for CI/CD integration
  $ lex-pr execute --status-table               # Generate PR comment-ready status table
  $ lex-pr execute --timeout 60000              # Increase timeout to 60 seconds
  $ lex-pr execute --artifact-dir ./build       # Custom artifact location

Common Issues:
  • Gates timing out: Increase --timeout or check gate commands
  • Missing dependencies: Run 'lex-pr merge-order' to verify plan structure
  • Permission errors: Ensure artifact directory is writable`
	)
	.action(async (file: string | undefined, opts) => {
		const planFile = opts.plan || file || "plan.json";
		let auditEmitter: AuditEmitter | null = null;

		try {
			// Parse and validate autopilot configuration
			let autopilotConfig;
			try {
				autopilotConfig = parseAutopilotConfig({
					maxLevel: parseInt(opts.maxLevel),
					dryRun: opts.dryRun,
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
				!(opts.json || jsonModeActive) &&
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
				console.log("");
			}

			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);
			let auditEmitter: AuditEmitter | null = null;
			const timeoutMs = parseInt(opts.timeout);

			// Initialize audit emitter if profile is not 'off'
			if (opts.audit && opts.audit !== "off") {
				const auditDir =
					opts.auditDir || path.join(opts.artifactDir, "audit");
				const cliKey = program.opts().auditKey as string | undefined;
				const envKey = process.env.LEX_AUDIT_KEY_HEX;
				const keyToUse = cliKey || envKey;
				const phiFlag =
					opts.audit === "hipaa-strict" ||
					process.env.LEX_AUDIT_PHI === "1";
				const auditOptions: AuditOptions = {
					profile: opts.audit as "basic" | "soc2" | "hipaa-strict",
					dir: auditDir,
					format: opts.auditFormat,
					includeEnv: opts.auditIncludeEnv
						? opts.auditIncludeEnv.split(",")
						: undefined,
					redactRegex: opts.auditRedact,
					hashPaths: opts.auditHashPaths,
					context: opts.auditContext
						? (opts.auditContext.split(",") as (
								| "git"
								| "ci"
								| "os"
						  )[])
						: undefined,
					signer: opts.auditSigner,
					retainDays: opts.auditRetainDays
						? parseInt(opts.auditRetainDays)
						: undefined,
					sample: opts.auditSample
						? parseInt(opts.auditSample)
						: undefined,
					phiRedaction: phiFlag,
					encryptionKeyHex: keyToUse,
				};

				auditEmitter = await initAuditEmitter(auditOptions);

				// Emit command invocation event
				await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, {
					argv: process.argv.slice(2),
					cwd: process.cwd(),
				});

				// Emit plan discovered event
				const planHash = sha256(planContent);
				await emitEvent(auditEmitter, EVENT_TYPES.PLAN_DISCOVERED, {
					pr_ids: plan.items.map((item) => item.name),
					base: "main",
					head: plan.target,
					plan_hash: planHash,
				});

				// Emit plan validated event
				await emitEvent(auditEmitter, EVENT_TYPES.PLAN_VALIDATED, {
					schema_version: plan.schemaVersion,
					warnings: [],
				});
			}

			// Create execution state
			const executionState = new ExecutionState(plan);
			const evaluator = new MergeEligibilityEvaluator(
				plan,
				executionState
			);

			// Validate and show execution order
			const levels = computeMergeOrder(plan);

			// Emit merge order computed event
			if (auditEmitter) {
				await emitEvent(
					auditEmitter,
					EVENT_TYPES.MERGE_ORDER_COMPUTED,
					{
						levels: levels.length,
						items_per_level: levels.map((level) => level.length),
					}
				);
			}

			if (opts.dryRun) {
				if (opts.json || jsonModeActive) {
					const output = {
						dryRun: true,
						plan: {
							schemaVersion: plan.schemaVersion,
							target: plan.target,
							itemCount: plan.items.length,
						},
						execution: {
							levels: levels.map((level, index) => ({
								level: index + 1,
								items: level,
							})),
							policy: plan.policy
								? {
										maxWorkers: plan.policy.maxWorkers,
										retryConfigs: Object.keys(
											plan.policy.retries
										).length,
								  }
								: undefined,
						},
					};
					writeJsonOutput(output);
				} else {
					console.log("Dry run - Plan validation successful");
					console.log(
						`Plan contains ${plan.items.length} items in ${levels.length} levels:`
					);
					levels.forEach((level: string[], index: number) => {
						console.log(
							`  Level ${index + 1}: [${level.join(", ")}]`
						);
					});

					if (plan.policy) {
						console.log(
							`Policy: ${plan.policy.maxWorkers} max workers, ${
								Object.keys(plan.policy.retries).length
							} retry configs`
						);
					}
				}

				// Finalize audit emitter on dry-run so background tasks run and optional
				// at-rest encryption can occur when an encryption key is provided.
				if (auditEmitter) {
					try {
						await finalizeAuditGuard(auditEmitter, "dry-run");
					} catch (e) {
						if (
							e instanceof Error &&
							typeof e.message === "string" &&
							e.message.startsWith("HIPAA:")
						) {
							// Surface HIPAA failures as fatal
							exitWith(e as Error);
						}
						console.warn(
							"[lex-pr] audit: finalize on dry-run failed (ignored)",
							String(e)
						);
					}
				}

				return;
			}

			if (!(opts.json || jsonModeActive)) {
				console.log(
					`Executing plan: ${plan.items.length} items, ${levels.length} levels`
				);
			}

			// Check for input validation skip flag
			const skipValidation = opts.skipInputValidation ?? false;
			if (skipValidation && !(opts.json || jsonModeActive)) {
				console.warn(
					"⚠️  Gate input validation disabled - use at your own risk"
				);
			}

			// Create progress reporter (disabled in JSON mode)
			const progressReporter = new ProgressReporter({
				enabled: !jsonModeActive,
			});

			// Capture repository root at the start for stable gate execution
			const repoRoot = process.cwd();

			// Execute gates with policy
			await executeGatesWithPolicy(
				plan,
				executionState,
				opts.artifactDir,
				timeoutMs,
				progressReporter,
				skipValidation,
				repoRoot
			);

			// Get final results
			const results = executionState.getResults();
			const mergeSummary = evaluator.getMergeSummary();

			if (opts.json || jsonModeActive) {
				// Output JSON results
				const output = {
					plan: {
						schemaVersion: plan.schemaVersion,
						target: plan.target,
						itemCount: plan.items.length,
					},
					execution: {
						results: Object.fromEntries(results),
						mergeSummary,
						artifactDir: opts.artifactDir,
					},
				};
				writeJsonOutput(output);
			} else if (opts.statusTable) {
				// Generate status table for PR comments
				console.log(formatStatusTable(results, mergeSummary));
			} else {
				// Human-readable output
				console.log("\n=== Execution Results ===");
				for (const [name, result] of results) {
					const statusIcon = getStatusIcon(result.status);
					console.log(`${statusIcon} ${name}: ${result.status}`);

					if (result.gates.length > 0) {
						for (const gate of result.gates) {
							const gateIcon = getStatusIcon(gate.status);
							const duration = gate.duration
								? ` (${gate.duration}ms)`
								: "";
							console.log(
								`  ${gateIcon} ${gate.gate}${duration}`
							);
						}
					}
				}

				console.log("\n=== Merge Summary ===");
				console.log(
					`Eligible: ${
						mergeSummary.eligible.length
					} - [${mergeSummary.eligible.join(", ")}]`
				);
				console.log(
					`Pending: ${
						mergeSummary.pending.length
					} - [${mergeSummary.pending.join(", ")}]`
				);
				console.log(
					`Blocked: ${
						mergeSummary.blocked.length
					} - [${mergeSummary.blocked.join(", ")}]`
				);
				console.log(
					`Failed: ${
						mergeSummary.failed.length
					} - [${mergeSummary.failed.join(", ")}]`
				);
			}

			// Exit with appropriate code
			const hasFailures =
				mergeSummary.failed.length > 0 ||
				mergeSummary.blocked.length > 0;

			// Emit run summary if audit is enabled
			if (auditEmitter) {
				const totalGates = Array.from(results.values()).reduce(
					(sum, r) => sum + r.gates.length,
					0
				);
				const passedGates = Array.from(results.values()).reduce(
					(sum, r) =>
						sum + r.gates.filter((g) => g.status === "pass").length,
					0
				);
				const failedGates = Array.from(results.values()).reduce(
					(sum, r) =>
						sum + r.gates.filter((g) => g.status === "fail").length,
					0
				);

				// Build pass/fail matrix
				const passFailMatrix: Record<
					string,
					Record<string, string>
				> = {};
				for (const [name, result] of results) {
					passFailMatrix[name] = {};
					for (const gate of result.gates) {
						passFailMatrix[name][gate.gate] = gate.status;
					}
				}

				await emitEvent(auditEmitter, EVENT_TYPES.RUN_SUMMARY, {
					totals: {
						items: plan.items.length,
						gates: totalGates,
						passed: passedGates,
						failed: failedGates,
					},
					pass_fail_matrix: passFailMatrix,
					final_status: hasFailures ? "failed" : "success",
				});

				// Finalize audit
				await finalizeAuditGuard(
					auditEmitter,
					hasFailures ? "failed" : "success"
				);
			}

			if (hasFailures) {
				throwExit(1);
			}
			return;
		} catch (error) {
			// Finalize audit on error and delegate exit mapping to exitWith
			if (auditEmitter) {
				await emitEvent(
					auditEmitter,
					EVENT_TYPES.ERROR,
					{
						code: "EXECUTION_ERROR",
						message:
							error instanceof Error
								? error.message
								: String(error),
						where: "execute_command",
					},
					"error"
				);
				await finalizeAuditGuard(auditEmitter, "error");
			}

			exitWith(error);
		}
	});

// Status command - modularized in Phase 2.5
registerStatusCommand(program, () => jsonModeActive);

// Schema command - modularized in Phase 3.3
registerSchemaCommand(program, {
	jsonModeActive: () => jsonModeActive,
});

// Report command - modularized in Phase 3.4
registerReportCommand(program);

// Discover command - GitHub PR discovery
program
	.command("discover")
	.description("Discover open pull requests from GitHub")
	.option("--owner <owner>", "GitHub repository owner")
	.option("--repo <repo>", "GitHub repository name")
	.option("--state <state>", "PR state filter", "open")
	.option(
		"--suggest",
		"Generate dependency/grouping suggestions using heuristics"
	)
	.option("--json", "Output JSON format")
	.addHelpText(
		"after",
		`
Examples:
  $ lex-pr discover                             # Discover PRs from current repo
  $ lex-pr discover --suggest                   # Discover with dependency suggestions
  $ lex-pr discover --json > prs.json           # JSON output for processing
  $ lex-pr discover --owner org --repo project  # Specify repository explicitly
  $ lex-pr discover --state all                 # Include closed PRs

Common Issues:
  • "Could not detect repository": Set GITHUB_TOKEN or run from git repository
  • Rate limit errors: Wait or use authenticated token with higher limits
  • No PRs found: Check --state filter and repository permissions`
	)
	.action(async (opts) => {
		try {
			let githubAPI = await createGitHubAPI();

			// Override with command line options if provided
			if (opts.owner && opts.repo) {
				githubAPI = new GitHubAPI({
					owner: opts.owner,
					repo: opts.repo,
					token: process.env.GITHUB_TOKEN,
				});
			}

			if (!githubAPI) {
				console.error(
					"\n❌ Error: Could not detect GitHub repository\n"
				);
				console.error("Solutions:");
				console.error(
					"  1. Run from a Git repository with GitHub remote:"
				);
				console.error("     git remote -v");
				console.error("\n  2. Specify repository explicitly:");
				console.error(
					"     lex-pr discover --owner <owner> --repo <repo>\n"
				);
				console.error("💡 Tip: Initialize your workspace first:");
				console.error("   lex-pr init\n");
				throwExit(1);
			}
			const resolvedAPI = githubAPI!;

			// Check authentication
			const authStatus = await resolvedAPI.checkAuth();
			if (!authStatus.authenticated) {
				console.warn(
					"Warning: GitHub API not authenticated. Set GITHUB_TOKEN environment variable for better rate limits."
				);
			}

			// Fetch pull requests
			const pullRequests = await resolvedAPI.discoverPullRequests(
				opts.state as "open" | "closed" | "all"
			);

			if (opts.suggest) {
				// Generate dependency suggestions using heuristics
				const { createFileAnalyzer } = await import(
					"./planner/fileAnalysis.js"
				);

				// Reuse the existing Octokit instance from githubAPI
				const analyzer = createFileAnalyzer(
					resolvedAPI.getOctokit(),
					resolvedAPI.config.owner,
					resolvedAPI.config.repo
				);
				const prs = pullRequests.map((pr) => ({
					number: pr.number,
					name: `PR-${pr.number}`,
					sha: pr.sha,
				}));

				const suggestions =
					await analyzer.suggestDependenciesWithHeuristics(prs);

				if (opts.json) {
					console.log(
						canonicalJSONStringify({
							pullRequests,
							suggestions,
							total: pullRequests.length,
							suggestionsCount: suggestions.length,
							authenticated: authStatus.authenticated,
							user: authStatus.user,
						})
					);
				} else {
					console.log(
						`🔍 Discovered ${pullRequests.length} ${opts.state} pull requests`
					);
					if (authStatus.authenticated) {
						console.log(`✓ Authenticated as: ${authStatus.user}`);
					}
					console.log("");

					if (suggestions.length === 0) {
						console.log("No dependency suggestions found.");
					} else {
						console.log(
							`\n📊 Dependency Suggestions (${suggestions.length} found):\n`
						);
						console.log(
							"| From | To | Confidence | Heuristic | Reason |"
						);
						console.log(
							"|------|------|------------|-----------|--------|"
						);

						for (const suggestion of suggestions) {
							const confidence =
								(suggestion.confidence * 100).toFixed(0) + "%";
							const heuristic = suggestion.heuristic || "unknown";
							const reason =
								suggestion.reason.length > 50
									? suggestion.reason.substring(0, 47) + "..."
									: suggestion.reason;
							console.log(
								`| ${suggestion.from} | ${suggestion.to} | ${confidence} | ${heuristic} | ${reason} |`
							);
						}
					}
				}
			} else {
				// Original discover output
				if (opts.json) {
					console.log(
						canonicalJSONStringify({
							pullRequests,
							total: pullRequests.length,
							authenticated: authStatus.authenticated,
							user: authStatus.user,
						})
					);
				} else {
					console.log(
						`🔍 Discovered ${pullRequests.length} ${opts.state} pull requests`
					);
					if (authStatus.authenticated) {
						console.log(`✓ Authenticated as: ${authStatus.user}`);
					}
					console.log("");

					if (pullRequests.length === 0) {
						console.log("No pull requests found.");
					} else {
						console.log(
							"| PR# | Title | Branch | Author | Labels |"
						);
						console.log(
							"|-----|-------|--------|--------|--------|"
						);

						for (const pr of pullRequests) {
							const labels =
								pr.labels.length > 0
									? pr.labels.join(", ")
									: "none";
							const title =
								pr.title.length > 50
									? pr.title.substring(0, 47) + "..."
									: pr.title;
							console.log(
								`| #${pr.number} | ${title} | ${pr.branch} | ${pr.author} | ${labels} |`
							);
						}
					}
				}
			}
		} catch (error) {
			if (error instanceof GitHubAPIError) {
				console.error(`GitHub API Error: ${error.message}`);
				throwExit(1);
			}
			console.error(
				`Error discovering pull requests: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			throwExit(1);
		}
	});

// Merge command - Execute merge pyramid with git operations
registerMergeCommand(program, () => jsonModeActive, () => program.opts());


// Doctor command - modularized in Phase 4.4
registerDoctorCommand(program, () => jsonModeActive);

// Init command - Interactive workspace setup
program
	.command("init")
	.description(
		"Initialize lex-pr-runner workspace with interactive setup wizard"
	)
	.option("--force", "Overwrite existing configuration files")
	.option(
		"--non-interactive",
		"Run without prompts (use environment variables)"
	)
	.option("--github-token <token>", "GitHub token for authentication")
	.option(
		"--profile-dir <dir>",
		"Profile directory (default: .smartergpt.local)"
	)
	.action(async (opts) => {
		try {
			const result = await runInit({
				force: opts.force,
				nonInteractive: opts.nonInteractive,
				githubToken: opts.githubToken,
				profileDir: opts.profileDir,
			});

			if (!result.success) {
				console.error(`\n❌ ${result.message}\n`);
				throwExit(1);
			}

			return;
		} catch (error) {
			if (error instanceof WriteProtectionError) {
				console.error(`\n❌ ${error.message}\n`);
				throwExit(2);
			}
			console.error(
				`\n❌ Initialization failed: ${
					error instanceof Error ? error.message : String(error)
				}\n`
			);
			throwExit(1);
		}
	});

// Bootstrap command
program
	.command("bootstrap")
	.description("Create minimal workspace configuration")
	.option("--force", "Overwrite existing configuration files")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		try {
			const bootstrap = bootstrapWorkspace();
			const projectType = detectProjectType();

			if (opts.json) {
				if (bootstrap.hasConfiguration && !opts.force) {
					console.log(
						canonicalJSONStringify({
							status: "exists",
							message: "Configuration already exists",
							bootstrap,
							projectType,
						})
					);
				} else {
					createMinimalWorkspace();
					console.log(
						canonicalJSONStringify({
							status: "created",
							message: "Minimal configuration created",
							projectType,
							filesCreated: bootstrap.missingFiles,
						})
					);
				}
			} else {
				console.log("🚀 Bootstrapping workspace configuration");
				console.log(`📁 Project type detected: ${projectType}`);
				console.log("");

				if (bootstrap.hasConfiguration && !opts.force) {
					console.log("✓ Configuration already exists");
					console.log(`  ${bootstrap.profileDir}/`);
					console.log("");
					console.log("Use --force to overwrite existing files");
				} else {
					createMinimalWorkspace();
					console.log("✓ Created minimal configuration:");
					console.log(`  ${bootstrap.profileDir}/intent.md`);
					console.log(`  ${bootstrap.profileDir}/scope.yml`);
					console.log(`  ${bootstrap.profileDir}/deps.yml`);
					console.log(`  ${bootstrap.profileDir}/gates.yml`);
					console.log("");
					console.log("Next steps:");
					console.log(
						"1. Edit .smartergpt/intent.md to describe your project goals"
					);
					console.log(
						"2. Update .smartergpt/scope.yml for PR discovery rules"
					);
					console.log(
						"3. Configure .smartergpt/gates.yml for quality gates"
					);
					console.log(
						"4. Run 'lex-pr doctor' to verify configuration"
					);
				}
			}
		} catch (error) {
			if (error instanceof WriteProtectionError) {
				console.error(
					`Error bootstrapping workspace: ${error.message}`
				);
				throwExit(2); // Validation/config error
			}
			console.error(
				`Error bootstrapping workspace: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			throwExit(1);
		}
	});

program
	.command("init-local")
	.description(
		"Initialize local overlay directory with auto-detected project configuration"
	)
	.option("--force", "Force recreation even if local overlay exists")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		try {
			const result = initLocalOverlay(process.cwd(), opts.force);

			if (opts.json || jsonModeActive) {
				console.log(
					canonicalJSONStringify({
						created: result.created,
						path: result.path,
						config: result.config,
						copiedFiles: result.copiedFiles,
					})
				);
			} else {
				if (result.created) {
					console.log("🎉 Local overlay initialized successfully");
					console.log("");
					console.log(`📁 Created: ${result.path}/`);
					console.log(
						`🔧 Project type: ${result.config.projectType}`
					);
					console.log(`👤 Role: ${result.config.role}`);
					console.log("");

					if (result.copiedFiles.length > 0) {
						console.log("📋 Copied files from .smartergpt/:");
						result.copiedFiles.forEach((file) => {
							console.log(`  • ${file}`);
						});
						console.log("");
					}

					console.log("Next steps:");
					console.log(
						"1. Edit .smartergpt.local/ files to customize for local development"
					);
					console.log(
						"2. .smartergpt.local/ is gitignored and won't be committed"
					);
					console.log(
						"3. Run commands normally - local overlay takes precedence"
					);
				} else {
					console.log("ℹ️  Local overlay already exists");
					console.log("");
					console.log(`📁 Location: ${result.path}/`);
					console.log(
						`🔧 Project type: ${result.config.projectType}`
					);
					console.log(`👤 Role: ${result.config.role}`);
					console.log("");
					console.log("Use --force to recreate");
				}
			}
		} catch (error) {
			console.error(
				`Error initializing local overlay: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			throwExit(1);
		}
	});

// Interactive plan viewer command
program
	.command("view")
	.description("Interactive plan viewer with navigation and filtering")
	.option("--plan <file>", "Path to plan.json file")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option("--filter <text>", "Initial filter text")
	.option("--no-deps", "Hide dependencies by default")
	.option("--no-gates", "Hide gates by default")
	.action(async (file: string | undefined, opts) => {
		const planFile = opts.plan || file;
		if (!planFile) {
			console.error(
				"Error: plan file is required (use --plan <file> or provide as argument)"
			);
			throwExit(1);
		}

		try {
			const { InteractivePlanViewer } = await import(
				"./commands/planViewer.js"
			);
			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);

			const viewer = new InteractivePlanViewer(plan, {
				filter: opts.filter,
				showDeps: opts.deps,
				showGates: opts.gates,
			});

			await viewer.start();
			return;
		} catch (error) {
			exitWith(error);
		}
	});

// Deliverables list command
program
	.command("deliverables:list")
	.description("List all autopilot deliverables with metadata")
	.option("--profile-dir <dir>", "Profile directory (default: .smartergpt)")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		try {
			const profile = resolveProfile(opts.profileDir);
			const { DeliverablesManager } = await import(
				"./autopilot/index.js"
			);
			const manager = new DeliverablesManager(profile.path);
			const deliverables = await manager.listDeliverables();

			if (opts.json) {
				writeJsonOutput(deliverables);
			} else {
				if (deliverables.length === 0) {
					console.log("No deliverables found");
					return;
				}

				console.log(
					`\n📦 Deliverables in ${manager.getDeliverablesRoot()}\n`
				);

				deliverables.forEach((d, idx) => {
					console.log(`${idx + 1}. ${d.timestamp}`);
					console.log(`   Level: ${d.levelExecuted}`);
					console.log(
						`   Plan Hash: ${d.planHash.substring(0, 12)}...`
					);
					console.log(`   Artifacts: ${d.artifacts.length}`);
					console.log(
						`   Environment: ${d.executionContext.environment}`
					);
					if (d.executionContext.actor) {
						console.log(`   Actor: ${d.executionContext.actor}`);
					}
					console.log("");
				});

				const latest = manager.getLatestPath();
				if (latest) {
					console.log(`📍 Latest: ${path.basename(latest)}`);
				}
			}
		} catch (error) {
			console.error(
				`Error listing deliverables: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			throwExit(1);
		}
	});

// Deliverables cleanup command
program
	.command("deliverables:cleanup")
	.description("Clean up old deliverables based on retention policy")
	.option("--profile-dir <dir>", "Profile directory (default: .smartergpt)")
	.option(
		"--max-age <days>",
		"Maximum age in days (deletes older deliverables)"
	)
	.option("--max-count <count>", "Maximum number of deliverables to keep")
	.option(
		"--keep-latest",
		"Always keep the latest deliverables (default: true)",
		true
	)
	.option("--dry-run", "Preview cleanup without deleting")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		try {
			const profile = resolveProfile(opts.profileDir);
			const { DeliverablesManager } = await import(
				"./autopilot/index.js"
			);
			const manager = new DeliverablesManager(profile.path);

			const policy = {
				maxAge: opts.maxAge ? parseInt(opts.maxAge) : undefined,
				maxCount: opts.maxCount ? parseInt(opts.maxCount) : undefined,
				keepLatest: opts.keepLatest,
			};

			if (opts.dryRun) {
				// Preview mode - show what would be deleted
				const deliverables = await manager.listDeliverables();
				let toKeep = deliverables;

				if (policy.maxCount !== undefined && policy.maxCount > 0) {
					toKeep = toKeep.slice(0, policy.maxCount);
				}

				if (policy.maxAge !== undefined && policy.maxAge > 0) {
					const cutoffDate = new Date();
					cutoffDate.setDate(cutoffDate.getDate() - policy.maxAge);
					toKeep = toKeep.filter(
						(d) => new Date(d.timestamp) > cutoffDate
					);
				}

				if (
					policy.keepLatest &&
					deliverables.length > 0 &&
					!toKeep.includes(deliverables[0])
				) {
					toKeep = [deliverables[0], ...toKeep];
				}

				const keepSet = new Set(toKeep.map((d) => d.timestamp));
				const toRemove = deliverables.filter(
					(d) => !keepSet.has(d.timestamp)
				);

				if (opts.json) {
					console.log(
						canonicalJSONStringify({
							dryRun: true,
							policy,
							toKeep: toKeep.length,
							toRemove: toRemove.length,
							deliverables: toRemove,
						})
					);
				} else {
					console.log("\n🔍 Cleanup Preview (dry-run)\n");
					console.log(
						`Policy: ${
							policy.maxAge ? `max-age=${policy.maxAge}d` : ""
						} ${
							policy.maxCount
								? `max-count=${policy.maxCount}`
								: ""
						} keep-latest=${policy.keepLatest}`
					);
					console.log("");
					console.log(`Would keep: ${toKeep.length} deliverables`);
					console.log(
						`Would remove: ${toRemove.length} deliverables`
					);

					if (toRemove.length > 0) {
						console.log("\nTo be removed:");
						toRemove.forEach((d) => {
							const dirName = `weave-${d.timestamp
								.replace(/[:.]/g, "-")
								.replace("Z", "")}`;
							console.log(`  - ${dirName} (${d.timestamp})`);
						});
					}

					console.log("\nRun without --dry-run to apply changes");
				}
			} else {
				// Actual cleanup
				const result = await manager.cleanup(policy);

				if (opts.json) {
					writeJsonOutput(result);
				} else {
					console.log("\n🧹 Cleanup Complete\n");
					console.log(
						`Removed: ${result.removed.length} deliverables`
					);
					console.log(`Kept: ${result.kept.length} deliverables`);
					console.log(
						`Freed space: ${(result.freedSpace / 1024).toFixed(
							2
						)} KB`
					);

					if (result.removed.length > 0) {
						console.log("\nRemoved:");
						result.removed.forEach((path) => {
							console.log(`  - ${path}`);
						});
					}
				}
			}
		} catch (error) {
			console.error(
				`Error cleaning up deliverables: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			throwExit(1);
		}
	});

// Query command - modular implementation
registerQueryCommand(program, exitWith);

// Retry command
registerRetryCommand(program, () => jsonModeActive, exitWith);

// Completion command
registerCompletionCommand(program, throwExit, exitWith);

// Security operations command
// Register security subcommands once (modular implementation)
registerSecurityCommands(program);

// Orchestration commands
registerAnalyzeIssuesCommand(program, () => jsonModeActive);
registerPlanBatchCommand(program, () => jsonModeActive);
registerPinToolchainCommand(program);
registerPredictConflictsCommand(program, () => jsonModeActive);
registerGenerateDeliverablesCommand(program);
registerAssignBatchCommand(program);

// Audit operations command
registerAuditCommands(program);

export async function main(argv: string[] = process.argv): Promise<void> {
	try {
		await program.parseAsync(argv);
		if (process.exitCode === undefined || process.exitCode === null) {
			process.exitCode = 0;
		}
	} catch (error) {
		if (error instanceof CLIExitSignal) {
			process.exitCode = error.exitCode;
			// Don't output error message for successful exits
			if (error.exitCode !== 0) {
				// Only output custom messages, not the default "CLI exited with code N"
				if (
					error.message &&
					!error.message.startsWith("CLI exited with code")
				) {
					process.stderr.write(`${error.message}\n`);
				}
			}
			return;
		}
		if (error instanceof CommanderError) {
			// Already intercepted by exitOverride and converted to CLIExitSignal
			// This branch should never execute, but handle defensively
			const exitCode =
				typeof error.exitCode === "number" ? error.exitCode : 1;
			process.exitCode = exitCode;
			if (exitCode !== 0 && error.message) {
				process.stderr.write(`${error.message}\n`);
			}
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const prefix = jsonModeActive ? "[lex-pr]" : "❌";
		process.stderr.write(`${prefix} ${message}\n`);
		process.exitCode = 1;
	}
}

// ============================================================================
// Entry point detection (ESM/CJS compatible, cross-platform)
// ============================================================================
// CRITICAL: This must work in both ESM (.js) and CJS (.cjs) builds, and handle
// Windows paths, symlinks, and URL encoding correctly.
//
// - ESM build: import.meta is available and we check import.meta.url
// - CJS build: import.meta.url will be undefined/empty (tsup warning is expected)
//
// Using Node's pathToFileURL and resolve ensures:
// 1. Windows paths are normalized correctly (C:\... → file:///C:/...)
// 2. Symlinks are resolved consistently
// 3. URL encoding is handled (spaces, special chars)
//
// tsup will emit a warning about import.meta in CJS, but that's acceptable since:
// 1. The check prevents execution in CJS context
// 2. The warning is cosmetic and doesn't affect runtime behavior
// 3. Config-based suppression (tsup.config.ts) silences the noise
//
// DO NOT REFACTOR to simple string comparison - it breaks on Windows/symlinks.
// ============================================================================
const isDirectExec = (() => {
	try {
		if (typeof import.meta === "undefined") return false;
		const argHref = process.argv[1]
			? pathToFileURL(resolve(process.argv[1])).href
			: "";
		return import.meta.url === argHref;
	} catch {
		return false;
	}
})();

if (isDirectExec) {
	// Install global handlers before running main
	installSignalHandlers();
	installUnhandledRejectionHandler();
	
	void main().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`[lex-pr] fatal: ${message}\n`);
		process.exitCode = process.exitCode ?? 1;
	});
}

// ============================================================================
// MCP Server Exports
// ============================================================================
// These exports are used by mcp-server.mjs for the aligned stdio protocol.
// Keep functionality intact - only the protocol layer changes.
export {
	// Core functionality
	loadInputs,
	generatePlan,
	generateSnapshot,
	loadPlan,

	// Execution
	executeGatesWithPolicy,
	ExecutionState,
	MergeEligibilityEvaluator,

	// Configuration
	initLocalOverlay,
	resolveProfile,

	// Utilities
	canonicalJSONStringify,

	// Monitoring
	healthChecker,
};
