#!/usr/bin/env node
import { Command } from "commander";
import { Plan, loadPlan, SchemaValidationError } from "./schema.js";
import { computeMergeOrder, CycleError, UnknownDependencyError } from "./mergeOrder.js";
import { executeGatesWithPolicy } from "./gates.js";
import { ExecutionState } from "./executionState.js";
import { MergeEligibilityEvaluator } from "./mergeEligibility.js";
import { loadInputs } from "./core/inputs.js";
import { generatePlan, generateEmptyPlan } from "./core/plan.js";
import { generateSnapshot, generatePlanSummary, generateGitHubSnapshot } from "./core/snapshot.js";
import { generatePlanFromGitHub } from "./core/githubPlan.js";
import { createGitHubClient } from "./github/index.js";
import { canonicalJSONStringify } from "./util/canonicalJson.js";
import { readGateDir, generateMarkdownSummary } from "./report/aggregate.js";
import { createGitHubAPI, GitHubAPI, GitHubAPIError } from "./github/api.js";
import { createGitOperations, GitOperationError } from "./git/operations.js";
import { bootstrapWorkspace, createMinimalWorkspace, detectProjectType, getEnvironmentSuggestions } from "./core/bootstrap.js";
import { initLocalOverlay, hasLocalOverlay } from "./config/localOverlay.js";
import { WriteProtectionError, resolveProfile, validateWriteOperation } from "./config/profileResolver.js";
import { parseAutopilotConfig, AutopilotConfigError, getAutopilotLevelDescription, AutopilotLevel } from "./autopilot/index.js";
import { createLogger, Logger, generateCorrelationId } from "./monitoring/index.js";
import { runInit } from "./commands/init.js";
import * as fs from "fs";
import * as path from "path";

/**
 * CLI exit discipline with proper error codes
 */
function exitWith(e: unknown, schemaCode = "ESCHEMA") {
  const err: any = e;
  if (err?.code === schemaCode && Array.isArray(err.issues)) {
    console.log(JSON.stringify({ errors: err.issues }, null, 2));
    console.error(err.message);
    process.exit(2);
  }
  if (e instanceof SchemaValidationError || e instanceof CycleError || e instanceof UnknownDependencyError || e instanceof WriteProtectionError || e instanceof AutopilotConfigError) {
    console.error(`\n❌ Error: ${String(err?.message ?? e)}\n`);

    // Add helpful suggestions based on error type
    if (e instanceof WriteProtectionError) {
      console.error("💡 Tip: Use a local profile directory for development:");
      console.error("   lex-pr init --profile-dir .smartergpt.local\n");
    } else if (e instanceof CycleError) {
      console.error("💡 Tip: Check your dependency declarations in PR descriptions");
      console.error("   Look for circular dependencies like: A→B→C→A\n");
    } else if (e instanceof UnknownDependencyError) {
      console.error("💡 Tip: Ensure all referenced PRs exist and are included in your plan");
      console.error("   Run 'lex-pr discover' to find available PRs\n");
    } else if (e instanceof SchemaValidationError) {
      console.error("💡 Tip: Validate your configuration files:");
      console.error("   lex-pr schema validate plan.json\n");
    }

    process.exit(2); // Validation errors
  }
  console.error(`\n❌ Unexpected error: ${String(err?.message ?? e)}\n`);
  console.error("💡 Tip: Run 'lex-pr doctor' to check your environment\n");
  process.exit(1); // Unexpected failures
}

// Global logger instance
let logger: Logger;

const program = new Command();
program
	.name("lex-pr")
	.description("Lex-PR Runner - Fan-out PRs, compute merge pyramid, run gates, and weave merges cleanly")
	.version("0.1.0")
	.option("--log-format <format>", "Log output format: 'json' or 'human'", process.env.LOG_FORMAT || 'human')
	.addHelpText('after', `
Examples:
  $ lex-pr init                          Initialize workspace with interactive setup
  $ lex-pr doctor                        Validate environment and configuration
  $ lex-pr discover                      Find open PRs matching scope
  $ lex-pr plan --from-github            Generate merge plan from GitHub PRs
  $ lex-pr execute plan.json             Run quality gates on plan
  $ lex-pr merge plan.json --dry-run     Preview merge operations

Quick Start:
  1. Initialize:  lex-pr init
  2. Validate:    lex-pr doctor
  3. Discover:    lex-pr discover
  4. Plan:        lex-pr plan --from-github
  5. Execute:     lex-pr execute plan.json
  6. Merge:       lex-pr merge plan.json

Documentation: https://github.com/Guffawaffle/lex-pr-runner/blob/main/docs/quickstart.md
`)
	.hook('preAction', (thisCommand) => {
		// Initialize logger based on global option
		const opts = thisCommand.opts();
		logger = createLogger({
			format: opts.logFormat as 'json' | 'human',
			correlationId: generateCorrelationId()
		});
	});

// Schema validation command
program
	.command("schema")
	.description("Schema operations")
	.addCommand(
		new Command("validate")
			.description("Validate plan.json against schema")
			.option("--plan <file>", "Path to plan.json file")
			.argument("[file]", "Path to plan.json file (alternative to --plan)")
			.option("--json", "Output machine-readable JSON errors")
			.action((file: string | undefined, opts) => {
				const planFile = opts.plan || file;
				if (!planFile) {
					console.error("\n❌ Error: Plan file is required\n");
					console.error("Usage:");
					console.error("  lex-pr schema validate plan.json");
					console.error("  lex-pr schema validate --plan plan.json\n");
					console.error("💡 Tip: Generate a plan first with 'lex-pr plan --from-github'\n");
					process.exit(1);
				}

				try {
					const planContent = fs.readFileSync(planFile, "utf-8");
					const plan = loadPlan(planContent);

					if (opts.json) {
						console.log(JSON.stringify({ valid: true }));
					} else {
						console.log(`✓ ${planFile} is valid`);
					}
					process.exit(0);
				} catch (error) {
					if (error instanceof SchemaValidationError) {
						if (opts.json) {
							const errorJson = error.toJSON();
							console.log(JSON.stringify({ valid: false, errors: errorJson.errors }, null, 2));
						} else {
							console.error(`✗ ${planFile} validation failed:`);
							error.issues.forEach(issue => {
								console.error(`  ${issue.path.join('.')}: ${issue.message}`);
							});
						}
						process.exit(1);
					} else {
						const message = error instanceof Error ? error.message : String(error);
						if (opts.json) {
							console.log(JSON.stringify({ valid: false, errors: [message] }));
						} else {
							console.error(`Error validating ${planFile}: ${message}`);
						}
						process.exit(1);
					}
				}
			})
	);

// Plan generation command
program
	.command("plan")
	.description("Generate plan from configuration sources or GitHub PRs")
	.option("--out <dir>", "Output directory for artifacts (default: <profile>/runner)")
	.option("--json", "Output canonical plan JSON to stdout only")
	.option("--dry-run", "Validate inputs and show what would be written")
	.option("--from-github", "Auto-discover PRs from GitHub API")
	.option("--query <query>", "GitHub search query (e.g., 'is:open label:stack:*')")
	.option("--labels <labels>", "Filter PRs by comma-separated labels")
	.option("--include-drafts", "Include draft PRs in the plan")
	.option("--github-token <token>", "GitHub API token (or use GITHUB_TOKEN env var)")
	.option("--owner <owner>", "GitHub repository owner (auto-detected from git remote)")
	.option("--repo <repo>", "GitHub repository name (auto-detected from git remote)")
	.action(async (opts) => {
		try {
			// Resolve profile first to determine default output directory
			const resolved = resolveProfile(undefined, process.cwd());
			const defaultOutDir = path.join(resolved.path, "runner");
			const outDir = opts.out || defaultOutDir;

			let plan: Plan;
			let inputs: any = null;

			if (opts.fromGithub) {
				// GitHub mode: auto-discover PRs
				const client = await createGitHubClient({
					token: opts.githubToken,
					owner: opts.owner,
					repo: opts.repo
				});

				// Parse labels if provided
				const labels = opts.labels ? opts.labels.split(',').map((l: string) => l.trim()) : undefined;

				// Generate plan from GitHub
				plan = await generatePlanFromGitHub(client, {
					query: opts.query,
					labels,
					includeDrafts: opts.includeDrafts,
					policy: {
						requiredGates: ["lint", "typecheck", "test"],
						maxWorkers: 2
					}
				});

				if (!opts.json) {
					console.log(`✓ Auto-discovered ${plan.items.length} PRs from GitHub`);
				}
			} else {
				// Traditional mode: load from configuration files
				inputs = loadInputs();
				plan = inputs.items.length > 0 ? generatePlan(inputs) : generateEmptyPlan(inputs.target);
			}

			// Validate plan structure
			const validatedPlan = loadPlan(canonicalJSONStringify(plan));

			if (opts.json) {
				// JSON mode: output only canonical plan to stdout, write nothing else
				process.stdout.write(canonicalJSONStringify(validatedPlan));
				process.exit(0);
			}

			// Generate artifacts
			const planJSON = canonicalJSONStringify(validatedPlan);
			const snapshot = opts.fromGithub
				? generateGitHubSnapshot(validatedPlan)
				: generateSnapshot(validatedPlan, inputs);

			if (opts.dryRun) {
				console.log("Dry run - would generate:");
				console.log(`📁 ${path.join(outDir, "plan.json")} (${planJSON.length} bytes)`);
				console.log(`📁 ${path.join(outDir, "snapshot.md")} (${snapshot.length} bytes)`);
				console.log("");
				console.log(generatePlanSummary(validatedPlan));
				process.exit(0);
			}

			// Write artifacts - validate write permissions first

			// Check if output directory is within a profile and validate write permissions
			const absOutDir = path.resolve(outDir);
			const profilePath = resolved.path;

			// If output directory is inside the profile, validate write permissions
			if (absOutDir.startsWith(profilePath)) {
				validateWriteOperation(profilePath, resolved.manifest.role, "write plan artifacts");
			}

			fs.mkdirSync(outDir, { recursive: true });

			const planPath = path.join(outDir, "plan.json");
			const snapshotPath = path.join(outDir, "snapshot.md");

			fs.writeFileSync(planPath, planJSON);
			fs.writeFileSync(snapshotPath, snapshot);

			console.log(`✓ Generated plan artifacts:`);
			console.log(`  📁 ${planPath}`);
			console.log(`  📁 ${snapshotPath}`);
			console.log("");
			console.log(generatePlanSummary(validatedPlan));

			process.exit(0);
		} catch (error) {
			exitWith(error);
		}
	});

// Merge order command
program
	.command("merge-order")
	.description("Compute dependency levels and merge order")
	.option("--plan <file>", "Path to plan.json file")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option("--json", "Output JSON format")
	.action((file: string | undefined, opts) => {
		const planFile = opts.plan || file;
		if (!planFile) {
			console.error("Error: plan file is required (use --plan <file> or provide as argument)");
			process.exit(1);
		}

		try {
			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);
			const levels = computeMergeOrder(plan);

			if (opts.json) {
				console.log(canonicalJSONStringify({ levels }));
			} else {
				console.log(`Merge order for ${plan.items.length} items:`);
				levels.forEach((level: string[], index: number) => {
					console.log(`Level ${index + 1}: [${level.join(', ')}]`);
				});
			}
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (opts.json) {
				console.log(canonicalJSONStringify({ error: message }));
			} else {
				console.error(`Error computing merge order: ${message}`);
			}
			exitWith(error);
		}
	});

// Autopilot command
program
	.command("autopilot")
	.description("Run autopilot analysis and artifact generation")
	.option("--plan <file>", "Path to plan.json file")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option("--level <level>", "Autopilot level (0=report-only, 1=artifacts)", "1")
	.option("--profile-dir <dir>", "Profile directory (default: .smartergpt)")
	.option("--deliverables-dir <dir>", "Custom deliverables directory (overrides default profile/deliverables)")
	.option("--json", "Output JSON format")
	.action(async (file: string | undefined, opts) => {
		const planFile = opts.plan || file;
		if (!planFile) {
			console.error("Error: plan file is required (use --plan <file> or provide as argument)");
			process.exit(1);
		}

		try {
			// Load plan
			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);

			// Resolve profile
			const profile = resolveProfile(opts.profileDir);

			// Import autopilot modules
			const { AutopilotLevel0, AutopilotLevel1, AutopilotLevel2 } = await import("./autopilot/index.js");

			// Create autopilot context
			const context = {
				plan,
				profilePath: profile.path,
				profileRole: profile.manifest.role
			};

			// Select and execute autopilot level
			const level = parseInt(opts.level);
			let autopilot;

			if (level === 0) {
				autopilot = new AutopilotLevel0(context);
			} else if (level === 1) {
				autopilot = new AutopilotLevel1(context);
			} else if (level === 2) {
				autopilot = new AutopilotLevel2(context);
			} else {
				console.error(`Error: unsupported autopilot level ${level} (supported: 0, 1, 2)`);
				process.exit(1);
			}

			// Execute with optional custom deliverables directory
			const result = await autopilot.execute(opts.deliverablesDir);

			if (opts.json) {
				console.log(canonicalJSONStringify(result));
			} else {
				console.log(result.message);
			}

			process.exit(result.success ? 0 : 1);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (opts.json) {
				console.log(canonicalJSONStringify({ success: false, error: message }));
			} else {
				console.error(`Error running autopilot: ${message}`);
			}
			exitWith(error);
		}
	});

// Execute plan command (replaces gate command)
program
	.command("execute")
	.description("Execute plan with policy-aware gate running and status tracking")
	.option("--plan <file>", "Path to plan.json file", "plan.json")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option("--artifact-dir <dir>", "Output directory for artifacts", "./artifacts")
	.option("--timeout <ms>", "Gate timeout in milliseconds", "30000")
	.option("--dry-run", "Validate plan and show execution order without running gates")
	.option("--json", "Output results in JSON format")
	.option("--status-table", "Generate status table for PR comments")
	.option("--max-level <level>", "Maximum autopilot level (0-4)", "0")
	.option("--open-pr", "Open pull requests for integration branches (Level 3+)")
	.option("--close-superseded", "Close superseded PRs after integration (Level 4)")
	.option("--comment-template <path>", "Path to PR comment template (Level 2+)")
	.option("--branch-prefix <prefix>", "Prefix for integration branch names", "integration/")
	.action(async (file: string | undefined, opts) => {
		const planFile = opts.plan || file || "plan.json";

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
					branchPrefix: opts.branchPrefix
				});
			} catch (error) {
				if (error instanceof AutopilotConfigError) {
					console.error(`Configuration Error: ${error.message}`);
					process.exit(2);
				}
				throw error;
			}

			// Show autopilot configuration if not in JSON mode
			if (!opts.json && autopilotConfig.maxLevel > AutopilotLevel.ReportOnly) {
				console.log(`🤖 Autopilot Level ${autopilotConfig.maxLevel}: ${getAutopilotLevelDescription(autopilotConfig.maxLevel)}`);
				if (autopilotConfig.dryRun) {
					console.log("   Mode: Dry run (preview only)");
				}
				console.log("");
			}

			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);
			const timeoutMs = parseInt(opts.timeout);

			// Create execution state
			const executionState = new ExecutionState(plan);
			const evaluator = new MergeEligibilityEvaluator(plan, executionState);

			// Validate and show execution order
			const levels = computeMergeOrder(plan);

			if (opts.dryRun) {
				if (opts.json) {
					const output = {
						dryRun: true,
						plan: {
							schemaVersion: plan.schemaVersion,
							target: plan.target,
							itemCount: plan.items.length
						},
						execution: {
							levels: levels.map((level, index) => ({
								level: index + 1,
								items: level
							})),
							policy: plan.policy ? {
								maxWorkers: plan.policy.maxWorkers,
								retryConfigs: Object.keys(plan.policy.retries).length
							} : undefined
						}
					};
					console.log(canonicalJSONStringify(output));
				} else {
					console.log("Dry run - Plan validation successful");
					console.log(`Plan contains ${plan.items.length} items in ${levels.length} levels:`);
					levels.forEach((level: string[], index: number) => {
						console.log(`  Level ${index + 1}: [${level.join(', ')}]`);
					});

					if (plan.policy) {
						console.log(`Policy: ${plan.policy.maxWorkers} max workers, ${Object.keys(plan.policy.retries).length} retry configs`);
					}
				}

				process.exit(0);
			}

			if (!opts.json) {
				console.log(`Executing plan: ${plan.items.length} items, ${levels.length} levels`);
			}

			// Execute gates with policy
			await executeGatesWithPolicy(plan, executionState, opts.artifactDir, timeoutMs);

			// Get final results
			const results = executionState.getResults();
			const mergeSummary = evaluator.getMergeSummary();

			if (opts.json) {
				// Output JSON results
				const output = {
					plan: {
						schemaVersion: plan.schemaVersion,
						target: plan.target,
						itemCount: plan.items.length
					},
					execution: {
						results: Object.fromEntries(results),
						mergeSummary,
						artifactDir: opts.artifactDir
					}
				};
				console.log(canonicalJSONStringify(output));
			} else if (opts.statusTable) {
				// Generate status table for PR comments
				generateStatusTable(results, mergeSummary);
			} else {
				// Human-readable output
				console.log("\n=== Execution Results ===");
				for (const [name, result] of results) {
					const statusIcon = getStatusIcon(result.status);
					console.log(`${statusIcon} ${name}: ${result.status}`);

					if (result.gates.length > 0) {
						for (const gate of result.gates) {
							const gateIcon = getStatusIcon(gate.status);
							const duration = gate.duration ? ` (${gate.duration}ms)` : '';
							console.log(`  ${gateIcon} ${gate.gate}${duration}`);
						}
					}
				}

				console.log("\n=== Merge Summary ===");
				console.log(`Eligible: ${mergeSummary.eligible.length} - [${mergeSummary.eligible.join(', ')}]`);
				console.log(`Pending: ${mergeSummary.pending.length} - [${mergeSummary.pending.join(', ')}]`);
				console.log(`Blocked: ${mergeSummary.blocked.length} - [${mergeSummary.blocked.join(', ')}]`);
				console.log(`Failed: ${mergeSummary.failed.length} - [${mergeSummary.failed.join(', ')}]`);
			}

			// Exit with appropriate code
			const hasFailures = mergeSummary.failed.length > 0 || mergeSummary.blocked.length > 0;
			process.exit(hasFailures ? 1 : 0);

		} catch (error) {
			console.error(`Error executing plan: ${error instanceof Error ? error.message : String(error)}`);
			// Use exit code 2 for validation errors, 1 for others
			if (error instanceof SchemaValidationError || error instanceof CycleError || error instanceof UnknownDependencyError) {
				process.exit(2);
			} else {
				process.exit(1);
			}
		}
	});

// Status command
program
	.command("status")
	.description("Show current execution status and merge eligibility")
	.option("--plan <file>", "Path to plan.json file", "plan.json")
	.argument("[file]", "Path to plan.json file (alternative to --plan)")
	.option("--json", "Output JSON format")
	.action((file: string | undefined, opts) => {
		const planFile = opts.plan || file || "plan.json";

		try {
			const planContent = fs.readFileSync(planFile, "utf-8");
			const plan = loadPlan(planContent);

			// For now, show plan structure and policy
			// In a full implementation, this would load execution state from artifacts
			const executionState = new ExecutionState(plan);
			const evaluator = new MergeEligibilityEvaluator(plan, executionState);
			const mergeSummary = evaluator.getMergeSummary();

			if (opts.json) {
				console.log(canonicalJSONStringify({
					plan: {
						schemaVersion: plan.schemaVersion,
						target: plan.target,
						itemCount: plan.items.length,
						policy: plan.policy
					},
					mergeSummary
				}));
			} else {
				console.log(`Plan: ${plan.items.length} items targeting ${plan.target}`);
				console.log(`Schema version: ${plan.schemaVersion}`);
				if (plan.policy) {
					console.log(`Policy: ${plan.policy.maxWorkers} max workers, merge rule: ${plan.policy.mergeRule.type}`);
				}
				console.log(`Status: ${mergeSummary.eligible.length} eligible, ${mergeSummary.pending.length} pending, ${mergeSummary.failed.length} failed`);
			}
		} catch (error) {
			console.error(`Error getting status: ${error instanceof Error ? error.message : String(error)}`);
			// Use exit code 2 for validation errors, 1 for others
			if (error instanceof SchemaValidationError || error instanceof CycleError || error instanceof UnknownDependencyError) {
				process.exit(2);
			} else {
				process.exit(1);
			}
		}
	});

// Report command
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
				console.log(canonicalJSONStringify(report));
			} else {
				console.error(`Invalid output format: ${opts.out}. Use 'json' or 'md'.`);
				process.exit(1);
			}

			// Exit with error code if not all green
			process.exit(report.allGreen ? 0 : 1);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Error aggregating gate reports: ${message}`);
			process.exit(1);
		}
	});

// Discover command - GitHub PR discovery
program
	.command("discover")
	.description("Discover open pull requests from GitHub")
	.option("--owner <owner>", "GitHub repository owner")
	.option("--repo <repo>", "GitHub repository name")
	.option("--state <state>", "PR state filter", "open")
	.option("--json", "Output JSON format")
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
				console.error("\n❌ Error: Could not detect GitHub repository\n");
				console.error("Solutions:");
				console.error("  1. Run from a Git repository with GitHub remote:");
				console.error("     git remote -v");
				console.error("\n  2. Specify repository explicitly:");
				console.error("     lex-pr discover --owner <owner> --repo <repo>\n");
				console.error("💡 Tip: Initialize your workspace first:");
				console.error("   lex-pr init\n");
				process.exit(1);
			}

			// Check authentication
			const authStatus = await githubAPI.checkAuth();
			if (!authStatus.authenticated) {
				console.warn("Warning: GitHub API not authenticated. Set GITHUB_TOKEN environment variable for better rate limits.");
			}

			// Fetch pull requests
			const pullRequests = await githubAPI.discoverPullRequests(opts.state as "open" | "closed" | "all");

			if (opts.json) {
				console.log(canonicalJSONStringify({
					pullRequests,
					total: pullRequests.length,
					authenticated: authStatus.authenticated,
					user: authStatus.user
				}));
			} else {
				console.log(`🔍 Discovered ${pullRequests.length} ${opts.state} pull requests`);
				if (authStatus.authenticated) {
					console.log(`✓ Authenticated as: ${authStatus.user}`);
				}
				console.log("");

				if (pullRequests.length === 0) {
					console.log("No pull requests found.");
				} else {
					console.log("| PR# | Title | Branch | Author | Labels |");
					console.log("|-----|-------|--------|--------|--------|");

					for (const pr of pullRequests) {
						const labels = pr.labels.length > 0 ? pr.labels.join(", ") : "none";
						const title = pr.title.length > 50 ? pr.title.substring(0, 47) + "..." : pr.title;
						console.log(`| #${pr.number} | ${title} | ${pr.branch} | ${pr.author} | ${labels} |`);
					}
				}
			}
		} catch (error) {
			if (error instanceof GitHubAPIError) {
				console.error(`GitHub API Error: ${error.message}`);
				process.exit(1);
			}
			console.error(`Error discovering pull requests: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	});

// Merge command - Execute merge pyramid with git operations
program
	.command("merge")
	.description("Execute merge pyramid with git operations")
	.option("--plan <file>", "Path to plan.json file", "plan.json")
	.option("--dry-run", "Show what would be merged without executing", true)
	.option("--execute", "Actually perform merge operations")
	.option("--cleanup", "Clean up integration branches after execution")
	.option("--json", "Output JSON format")
	.option("--max-level <level>", "Maximum autopilot level (0-4)", "0")
	.option("--open-pr", "Open pull requests for integration branches (Level 3+)")
	.option("--close-superseded", "Close superseded PRs after integration (Level 4)")
	.option("--comment-template <path>", "Path to PR comment template (Level 2+)")
	.option("--branch-prefix <prefix>", "Prefix for integration branch names", "integration/")
	.action(async (opts) => {
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
					process.exit(2);
				}
				throw error;
			}

			// Show autopilot configuration if not in JSON mode
			if (!opts.json && autopilotConfig.maxLevel > AutopilotLevel.ReportOnly) {
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
				process.exit(1);
			}

			const planContent = fs.readFileSync(opts.plan, "utf-8");
			const plan = loadPlan(planContent);

			// Compute merge order
			const levels = computeMergeOrder(plan);

			// Initialize git operations
			const gitOps = createGitOperations();

			// Check git status
			const isClean = await gitOps.isClean();
			if (!isClean && opts.execute) {
				console.error("Error: Working directory is not clean. Please commit or stash changes.");
				process.exit(1);
			}

			const currentBranch = await gitOps.getCurrentBranch();

			if (opts.dryRun && !opts.execute) {
				// Dry run mode (default)
				if (opts.json) {
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
				if (opts.json) {
					console.log(canonicalJSONStringify({ mode: "execute", status: "starting" }));
				} else {
					console.log(`🚀 EXECUTE MODE - Starting merge pyramid execution`);
					console.log(`Target: ${plan.target}`);
					console.log(`Items: ${plan.items.length}`);
					console.log(`Levels: ${levels.length}`);
					console.log("");
				}

				// Execute weave
				const result = await gitOps.executeWeave(plan, levels);

				if (opts.json) {
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
						process.exit(1);
					} else {
						console.log("");
						console.log("✅ Merge pyramid execution completed successfully");
					}
				}

				// Cleanup if requested
				if (opts.cleanup) {
					await gitOps.cleanup();
					if (!opts.json) {
						console.log("🧹 Cleaned up integration branches");
					}
				}
			}

		} catch (error) {
			if (error instanceof GitOperationError) {
				console.error(`Git Operation Error: ${error.message}`);
				process.exit(1);
			}
			console.error(`Error executing merge: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	});

// Doctor command
program
	.command("doctor")
	.description("Environment and config sanity checks")
	.option("--bootstrap", "Create minimal workspace configuration if missing")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		let hasErrors = false;
		const issues: string[] = [];
		const suggestions: string[] = [];

		if (opts.json) {
			// JSON mode for programmatic use
			const result = await performDoctorChecks();
			console.log(canonicalJSONStringify(result));
			if (result.hasErrors) {
				process.exit(1);
			}
			return;
		}

		console.log("🩺 Doctor - Environment and config sanity checks");
		console.log("");

		// Check Node.js version against .nvmrc
		try {
			const nvmrcContent = fs.readFileSync(".nvmrc", "utf-8").trim();
			const currentVersion = process.version.slice(1); // Remove 'v' prefix
			const expectedVersion = nvmrcContent;

			if (currentVersion === expectedVersion) {
				console.log(`✓ Node.js version: ${process.version} (matches .nvmrc)`);
			} else {
				console.log(`✗ Node.js version mismatch:`);
				console.log(`  Current: ${process.version}`);
				console.log(`  Expected: v${expectedVersion} (from .nvmrc)`);
				hasErrors = true;
			}
		} catch (error) {
			console.log("✗ .nvmrc file not found or unreadable");
			console.log("✓ Node.js version:", process.version, "(no .nvmrc constraint)");
			hasErrors = true;
		}

		// Check npm version against packageManager field
		try {
			const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
			const expectedNpmVersion = packageJson.packageManager?.replace("npm@", "");

			if (expectedNpmVersion) {
				const { spawn } = await import("child_process");
				const npmVersionProcess = spawn("npm", ["--version"], { stdio: "pipe" });

				let npmVersion = "";
				npmVersionProcess.stdout.on("data", (data) => {
					npmVersion += data.toString().trim();
				});

				await new Promise((resolve) => {
					npmVersionProcess.on("close", resolve);
				});

				if (npmVersion === expectedNpmVersion) {
					console.log(`✓ npm version: ${npmVersion} (matches packageManager)`);
				} else {
					console.log(`✗ npm version mismatch:`);
					console.log(`  Current: ${npmVersion}`);
					console.log(`  Expected: ${expectedNpmVersion} (from packageManager field)`);
					hasErrors = true;
				}
			} else {
				console.log("✓ npm version: no packageManager constraint in package.json");
			}
		} catch (error) {
			console.log("✗ Could not check npm version:", error instanceof Error ? error.message : String(error));
			hasErrors = true;
		}

		// Check git configuration
		try {
			const { spawn } = await import("child_process");

			// Check git user.name
			const gitNameProcess = spawn("git", ["config", "user.name"], { stdio: "pipe" });
			let gitName = "";
			gitNameProcess.stdout.on("data", (data) => {
				gitName += data.toString().trim();
			});

			await new Promise((resolve) => {
				gitNameProcess.on("close", resolve);
			});

			// Check git user.email
			const gitEmailProcess = spawn("git", ["config", "user.email"], { stdio: "pipe" });
			let gitEmail = "";
			gitEmailProcess.stdout.on("data", (data) => {
				gitEmail += data.toString().trim();
			});

			await new Promise((resolve) => {
				gitEmailProcess.on("close", resolve);
			});

			if (gitName && gitEmail) {
				console.log(`✓ Git config: user.name="${gitName}", user.email="${gitEmail}"`);
			} else {
				console.log("✗ Git configuration incomplete:");
				if (!gitName) console.log("  Missing user.name");
				if (!gitEmail) console.log("  Missing user.email");
				hasErrors = true;
			}
		} catch (error) {
			console.log("✗ Could not check git configuration:", error instanceof Error ? error.message : String(error));
			hasErrors = true;
		}

		// Check platform and working directory
		console.log(`✓ Platform: ${process.platform}`);
		console.log(`✓ Working directory: ${process.cwd()}`);

		// Check for plan.json and validate it
		const planExists = fs.existsSync("plan.json");
		if (planExists) {
			try {
				const planContent = fs.readFileSync("plan.json", "utf-8");
				const plan = loadPlan(planContent);
				console.log(`✓ plan.json: valid (${plan.items.length} items, schema ${plan.schemaVersion})`);
			} catch (error) {
				console.log("✗ plan.json validation failed:", error instanceof Error ? error.message : String(error));
				hasErrors = true;
			}
		} else {
			console.log("ℹ plan.json: not found (run 'lex-pr plan' to generate)");
		}

		// Check .smartergpt directory structure
		const smartergptDir = ".smartergpt";
		if (fs.existsSync(smartergptDir)) {
			const expectedFiles = ["intent.md", "scope.yml", "deps.yml", "gates.yml"];
			const missingFiles = expectedFiles.filter(file => !fs.existsSync(path.join(smartergptDir, file)));

			if (missingFiles.length === 0) {
				console.log(`✓ .smartergpt: all expected files present`);
			} else {
				console.log(`ℹ .smartergpt: missing optional files: ${missingFiles.join(", ")}`);
			}
		} else {
			console.log("ℹ .smartergpt: directory not found (create for project configuration)");
		}

		// Enhanced configuration checks with bootstrap
		const bootstrap = bootstrapWorkspace();
		const projectType = detectProjectType();
		const envSuggestions = getEnvironmentSuggestions();

		console.log(`📁 Project type: ${projectType}`);
		console.log("");

		// Configuration assessment
		if (bootstrap.hasConfiguration) {
			console.log("✓ .smartergpt: configuration complete");
		} else {
			console.log(`ℹ .smartergpt: missing ${bootstrap.missingFiles.length} files`);
			bootstrap.missingFiles.forEach(file => {
				console.log(`  - ${file}`);
			});

			if (opts.bootstrap) {
				console.log("");
				console.log("🔧 Creating minimal workspace configuration...");
				try {
					createMinimalWorkspace();
					console.log("✓ Minimal configuration created");
				} catch (error) {
					if (error instanceof WriteProtectionError) {
						console.error(`❌ ${error.message}`);
						process.exit(2);
					}
					throw error;
				}
			} else {
				console.log("");
				console.log("💡 Use --bootstrap to create minimal configuration");
			}
		}

		// Environment suggestions
		if (envSuggestions.length > 0) {
			console.log("");
			console.log("💡 Environment suggestions:");
			envSuggestions.forEach(suggestion => {
				console.log(`  - ${suggestion}`);
			});
		}

		// GitHub integration check
		try {
			const githubAPI = await createGitHubAPI();
			if (githubAPI) {
				const authStatus = await githubAPI.checkAuth();
				if (authStatus.authenticated) {
					console.log(`✓ GitHub: authenticated as ${authStatus.user}`);
				} else {
					console.log("ℹ GitHub: not authenticated (set GITHUB_TOKEN for API access)");
				}
			} else {
				console.log("ℹ GitHub: repository not detected or not GitHub-hosted");
			}
		} catch (error) {
			console.log(`ℹ GitHub: integration check failed (${error instanceof Error ? error.message : String(error)})`);
		}

		// Git operations check
		try {
			const gitOps = createGitOperations();
			const isClean = await gitOps.isClean();
			const currentBranch = await gitOps.getCurrentBranch();

			console.log(`✓ Git: working directory ${isClean ? 'clean' : 'has changes'}`);
			console.log(`✓ Git: current branch '${currentBranch}'`);
		} catch (error) {
			console.log(`✗ Git: operations check failed (${error instanceof Error ? error.message : String(error)})`);
			hasErrors = true;
		}

		console.log("");
		if (hasErrors) {
			console.log("❌ Doctor found issues that need attention");
			process.exit(1);
		} else {
			console.log("✅ All checks passed - environment looks good!");

			if (!bootstrap.hasConfiguration) {
				console.log("");
				console.log("Next steps:");
				console.log("1. Run 'lex-pr doctor --bootstrap' to create minimal configuration");
				console.log("2. Customize .smartergpt/ files for your project");
				console.log("3. Run 'lex-pr discover' to find open PRs");
			}

			process.exit(0);
		}
	});

async function performDoctorChecks(): Promise<any> {
	const checks: any = {
		hasErrors: false,
		issues: [],
		suggestions: [],
	};

	// Node.js version check
	try {
		const nvmrcContent = fs.readFileSync(".nvmrc", "utf-8").trim();
		const currentVersion = process.version.slice(1);
		const expectedVersion = nvmrcContent;

		if (currentVersion === expectedVersion) {
			checks.nodejs = { status: "ok", current: process.version, expected: `v${expectedVersion}` };
		} else {
			checks.nodejs = { status: "mismatch", current: process.version, expected: `v${expectedVersion}` };
			checks.hasErrors = true;
			checks.issues.push(`Node.js version mismatch: ${process.version} vs v${expectedVersion}`);
		}
	} catch (error) {
		checks.nodejs = { status: "no_constraint", current: process.version };
		checks.suggestions.push("Consider adding .nvmrc file for Node.js version consistency");
	}

	// Configuration check
	const bootstrap = bootstrapWorkspace();
	checks.configuration = {
		hasConfiguration: bootstrap.hasConfiguration,
		missingFiles: bootstrap.missingFiles,
		suggestions: bootstrap.suggestions,
	};

	// Project type detection
	checks.projectType = detectProjectType();

	// Environment suggestions
	checks.environmentSuggestions = getEnvironmentSuggestions();

	// GitHub integration
	try {
		const githubAPI = await createGitHubAPI();
		if (githubAPI) {
			const authStatus = await githubAPI.checkAuth();
			checks.github = {
				detected: true,
				authenticated: authStatus.authenticated,
				user: authStatus.user,
			};
		} else {
			checks.github = { detected: false };
		}
	} catch (error) {
		checks.github = { detected: false, error: error instanceof Error ? error.message : String(error) };
	}

	// Git operations
	try {
		const gitOps = createGitOperations();
		const isClean = await gitOps.isClean();
		const currentBranch = await gitOps.getCurrentBranch();

		checks.git = {
			status: "ok",
			isClean,
			currentBranch,
		};
	} catch (error) {
		checks.git = {
			status: "error",
			error: error instanceof Error ? error.message : String(error)
		};
		checks.hasErrors = true;
		checks.issues.push(`Git operations failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	return checks;
}

// Init command - Interactive workspace setup
program
	.command("init")
	.description("Initialize lex-pr-runner workspace with interactive setup wizard")
	.option("--force", "Overwrite existing configuration files")
	.option("--non-interactive", "Run without prompts (use environment variables)")
	.option("--github-token <token>", "GitHub token for authentication")
	.option("--profile-dir <dir>", "Profile directory (default: .smartergpt.local)")
	.action(async (opts) => {
		try {
			const result = await runInit({
				force: opts.force,
				nonInteractive: opts.nonInteractive,
				githubToken: opts.githubToken,
				profileDir: opts.profileDir
			});

			if (!result.success) {
				console.error(`\n❌ ${result.message}\n`);
				process.exit(1);
			}

			process.exit(0);
		} catch (error) {
			if (error instanceof WriteProtectionError) {
				console.error(`\n❌ ${error.message}\n`);
				process.exit(2);
			}
			console.error(`\n❌ Initialization failed: ${error instanceof Error ? error.message : String(error)}\n`);
			process.exit(1);
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
					console.log(canonicalJSONStringify({
						status: "exists",
						message: "Configuration already exists",
						bootstrap,
						projectType,
					}));
				} else {
					createMinimalWorkspace();
					console.log(canonicalJSONStringify({
						status: "created",
						message: "Minimal configuration created",
						projectType,
						filesCreated: bootstrap.missingFiles,
					}));
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
					console.log("1. Edit .smartergpt/intent.md to describe your project goals");
					console.log("2. Update .smartergpt/scope.yml for PR discovery rules");
					console.log("3. Configure .smartergpt/gates.yml for quality gates");
					console.log("4. Run 'lex-pr doctor' to verify configuration");
				}
			}
		} catch (error) {
			if (error instanceof WriteProtectionError) {
				console.error(`Error bootstrapping workspace: ${error.message}`);
				process.exit(2); // Validation/config error
			}
			console.error(`Error bootstrapping workspace: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	});

program
	.command("init-local")
	.description("Initialize local overlay directory with auto-detected project configuration")
	.option("--force", "Force recreation even if local overlay exists")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		try {
			const result = initLocalOverlay(process.cwd(), opts.force);

			if (opts.json) {
				console.log(canonicalJSONStringify({
					created: result.created,
					path: result.path,
					config: result.config,
					copiedFiles: result.copiedFiles
				}));
			} else {
				if (result.created) {
					console.log("🎉 Local overlay initialized successfully");
					console.log("");
					console.log(`📁 Created: ${result.path}/`);
					console.log(`🔧 Project type: ${result.config.projectType}`);
					console.log(`👤 Role: ${result.config.role}`);
					console.log("");

					if (result.copiedFiles.length > 0) {
						console.log("📋 Copied files from .smartergpt/:");
						result.copiedFiles.forEach(file => {
							console.log(`  • ${file}`);
						});
						console.log("");
					}

					console.log("Next steps:");
					console.log("1. Edit .smartergpt.local/ files to customize for local development");
					console.log("2. .smartergpt.local/ is gitignored and won't be committed");
					console.log("3. Run commands normally - local overlay takes precedence");
				} else {
					console.log("ℹ️  Local overlay already exists");
					console.log("");
					console.log(`📁 Location: ${result.path}/`);
					console.log(`🔧 Project type: ${result.config.projectType}`);
					console.log(`👤 Role: ${result.config.role}`);
					console.log("");
					console.log("Use --force to recreate");
				}
			}
		} catch (error) {
			console.error(`Error initializing local overlay: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
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
			const { DeliverablesManager } = await import("./autopilot/index.js");
			const manager = new DeliverablesManager(profile.path);
			const deliverables = await manager.listDeliverables();

			if (opts.json) {
				console.log(canonicalJSONStringify(deliverables));
			} else {
				if (deliverables.length === 0) {
					console.log("No deliverables found");
					return;
				}

				console.log(`\n📦 Deliverables in ${manager.getDeliverablesRoot()}\n`);
				
				deliverables.forEach((d, idx) => {
					console.log(`${idx + 1}. ${d.timestamp}`);
					console.log(`   Level: ${d.levelExecuted}`);
					console.log(`   Plan Hash: ${d.planHash.substring(0, 12)}...`);
					console.log(`   Artifacts: ${d.artifacts.length}`);
					console.log(`   Environment: ${d.executionContext.environment}`);
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
			console.error(`Error listing deliverables: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	});

// Deliverables cleanup command
program
	.command("deliverables:cleanup")
	.description("Clean up old deliverables based on retention policy")
	.option("--profile-dir <dir>", "Profile directory (default: .smartergpt)")
	.option("--max-age <days>", "Maximum age in days (deletes older deliverables)")
	.option("--max-count <count>", "Maximum number of deliverables to keep")
	.option("--keep-latest", "Always keep the latest deliverables (default: true)", true)
	.option("--dry-run", "Preview cleanup without deleting")
	.option("--json", "Output JSON format")
	.action(async (opts) => {
		try {
			const profile = resolveProfile(opts.profileDir);
			const { DeliverablesManager } = await import("./autopilot/index.js");
			const manager = new DeliverablesManager(profile.path);

			const policy = {
				maxAge: opts.maxAge ? parseInt(opts.maxAge) : undefined,
				maxCount: opts.maxCount ? parseInt(opts.maxCount) : undefined,
				keepLatest: opts.keepLatest
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
					toKeep = toKeep.filter(d => new Date(d.timestamp) > cutoffDate);
				}

				if (policy.keepLatest && deliverables.length > 0 && !toKeep.includes(deliverables[0])) {
					toKeep = [deliverables[0], ...toKeep];
				}

				const keepSet = new Set(toKeep.map(d => d.timestamp));
				const toRemove = deliverables.filter(d => !keepSet.has(d.timestamp));

				if (opts.json) {
					console.log(canonicalJSONStringify({
						dryRun: true,
						policy,
						toKeep: toKeep.length,
						toRemove: toRemove.length,
						deliverables: toRemove
					}));
				} else {
					console.log("\n🔍 Cleanup Preview (dry-run)\n");
					console.log(`Policy: ${policy.maxAge ? `max-age=${policy.maxAge}d` : ''} ${policy.maxCount ? `max-count=${policy.maxCount}` : ''} keep-latest=${policy.keepLatest}`);
					console.log("");
					console.log(`Would keep: ${toKeep.length} deliverables`);
					console.log(`Would remove: ${toRemove.length} deliverables`);
					
					if (toRemove.length > 0) {
						console.log("\nTo be removed:");
						toRemove.forEach(d => {
							const dirName = `weave-${d.timestamp.replace(/[:.]/g, "-").replace("Z", "")}`;
							console.log(`  - ${dirName} (${d.timestamp})`);
						});
					}
					
					console.log("\nRun without --dry-run to apply changes");
				}
			} else {
				// Actual cleanup
				const result = await manager.cleanup(policy);

				if (opts.json) {
					console.log(canonicalJSONStringify(result));
				} else {
					console.log("\n🧹 Cleanup Complete\n");
					console.log(`Removed: ${result.removed.length} deliverables`);
					console.log(`Kept: ${result.kept.length} deliverables`);
					console.log(`Freed space: ${(result.freedSpace / 1024).toFixed(2)} KB`);
					
					if (result.removed.length > 0) {
						console.log("\nRemoved:");
						result.removed.forEach(path => {
							console.log(`  - ${path}`);
						});
					}
				}
			}
		} catch (error) {
			console.error(`Error cleaning up deliverables: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	});

program.parseAsync(process.argv);

/**
 * Helper functions for CLI output
 */

function getStatusIcon(status: string): string {
	switch (status) {
		case "pass": return "✓";
		case "fail": return "✗";
		case "blocked": return "⛔";
		case "skipped": return "⏭";
		case "retrying": return "🔄";
		default: return "?";
	}
}

function generateStatusTable(results: Map<string, any>, mergeSummary: any): void {
	console.log("\n## Execution Status Table");
	console.log("");
	console.log("| Node | Status | Gates | Eligible | Details |");
	console.log("|------|--------|-------|----------|---------|");

	for (const [name, result] of results) {
		const statusIcon = getStatusIcon(result.status);
		const gateCount = result.gates.length;
		const eligible = result.eligibleForMerge ? "✓" : "✗";

		let gateDetails = "";
		if (gateCount > 0) {
			const passed = result.gates.filter((g: any) => g.status === "pass").length;
			const failed = result.gates.filter((g: any) => g.status === "fail").length;
			gateDetails = `${passed}/${gateCount} passed`;
			if (failed > 0) gateDetails += `, ${failed} failed`;
		}

		console.log(`| ${name} | ${statusIcon} ${result.status} | ${gateCount} | ${eligible} | ${gateDetails} |`);
	}

	console.log("");
	console.log("### Summary");
	console.log(`- **Eligible**: ${mergeSummary.eligible.length} nodes ready for merge`);
	console.log(`- **Pending**: ${mergeSummary.pending.length} nodes waiting`);
	console.log(`- **Failed**: ${mergeSummary.failed.length} nodes with failures`);
	console.log(`- **Blocked**: ${mergeSummary.blocked.length} nodes blocked by dependencies`);
}
