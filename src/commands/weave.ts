/**
 * Weave command group - Unified merge-weave workflow interface
 *
 * This provides the canonical `lex-pr weave` command group that orchestrates
 * the complete merge-weave workflow: discover → plan → apply
 *
 * ALN-003 Phase 2: Extended with additional subcommands (status, report, order)
 * to support full category-action pattern while maintaining PR #590 core workflow.
 */

import { Command } from "commander";
import { throwExit } from "../cli/exitHandler.js";
import { createGitHubAPI, GitHubAPI } from "../github/api.js";
import { createGitHubClient } from "../github/client.js";
import { generatePlanFromGitHub } from "../core/githubPlan.js";
import { loadPlan } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { createGitOperations } from "../git/operations.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { ExecutionState } from "../executionState.js";
import { executeGatesWithPolicy } from "../gates.js";
import { registerStatusCommand } from "./status.js";
import { registerReportCommand } from "./report.js";
import { registerMergeOrderCommand } from "./mergeOrder.js";
import { registerPolicyCommands } from "./weave-policy.js";
import { registerFanoutCommands } from "./weave-fanout.js";
import { registerCheckpointCommands } from "./weave-checkpoints.js";
import { loadCheckpoint, getLatestCheckpoint } from "../weave/checkpoint/storage.js";
import { LocalWeaveResumeDriver } from "../weave/local-resume-driver.js";
import { resumePersistedWeave } from "../weave/resume-service.js";
import fs from "fs";
import path from "path";

interface WeaveCommandDeps {
  jsonModeActive: () => boolean;
  getProgramOpts: () => any;
}

/**
 * Register the weave command group with subcommands
 */
export function registerWeaveCommand(program: Command, deps: WeaveCommandDeps): void {
  const weave = program
    .command("weave")
    .description("Merge-weave workflow: discover → plan → apply")
    .addHelpText(
      "after",
      `
Examples:
  # Complete workflow
  $ lex-pr weave discover                  # Find open PRs
  $ lex-pr weave plan --from-github        # Generate merge plan
  $ lex-pr weave apply --dry-run           # Preview merge execution
  $ lex-pr weave apply                     # Execute merge

  # One-liner workflow
  $ lex-pr weave discover && lex-pr weave plan --from-github --output plan.json && lex-pr weave apply

  # Resume from checkpoint (after interruption)
  $ lex-pr weave resume --latest           # Resume most recent run
  $ lex-pr weave resume --run-id <id>      # Resume specific run

  # Checkpoint management
  $ lex-pr weave checkpoints list          # List all checkpoints
  $ lex-pr weave checkpoints show <id>     # Show checkpoint details
  $ lex-pr weave checkpoints clean         # Clean up old checkpoints

Subcommands:
  discover     Find open PRs from GitHub
  plan         Generate merge plan from PRs
  apply        Execute merge pyramid with gates
  resume       Resume from checkpoint after interruption
  checkpoints  Manage execution checkpoints
`
    );

  // weave discover - Find open PRs
  weave
    .command("discover")
    .description("Discover open pull requests from GitHub")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--state <state>", "PR state filter (open|closed|all)", "open")
    .option("--suggest", "Generate dependency/grouping suggestions using heuristics")
    .option("--json", "Output JSON format")
    .option("--output <file>", "Write output to file")
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
          console.error("  1. Run from a Git repository with GitHub remote");
          console.error("  2. Specify repository explicitly:");
          console.error("     lex-pr weave discover --owner <owner> --repo <repo>\n");
          throwExit(1);
        }

        // Check authentication
        const authStatus = await githubAPI.checkAuth();
        if (!authStatus.authenticated) {
          console.warn(
            "⚠️  Warning: GitHub API not authenticated. Set GITHUB_TOKEN for better rate limits.\n"
          );
        }

        // Fetch pull requests
        const pullRequests = await githubAPI.discoverPullRequests(
          opts.state as "open" | "closed" | "all"
        );

        let result: any = {
          pullRequests,
          total: pullRequests.length,
        };

        if (opts.suggest) {
          // Generate dependency suggestions using heuristics
          const { createFileAnalyzer } = await import("../planner/fileAnalysis.js");

          const analyzer = createFileAnalyzer(
            githubAPI.getOctokit(),
            githubAPI.config.owner,
            githubAPI.config.repo
          );

          const prs = pullRequests.map((pr) => ({
            number: pr.number,
            name: `PR-${pr.number}`,
            sha: pr.sha,
          }));

          const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

          result.suggestions = suggestions;
          result.suggestionsCount = suggestions.length;
        }

        // Output results
        const jsonOutput = canonicalJSONStringify(result);

        if (opts.output) {
          fs.writeFileSync(opts.output, jsonOutput + "\n");
          if (!opts.json && !deps.jsonModeActive()) {
            console.log(`✅ Results written to ${opts.output}`);
            console.log(`   Found ${result.total} pull request(s)`);
          }
        } else if (opts.json || deps.jsonModeActive()) {
          console.log(jsonOutput);
        } else {
          // Human-readable output
          console.log(`\n📋 Discovered ${result.total} Pull Request(s)\n`);

          if (result.total === 0) {
            console.log("No pull requests found.");
            console.log("\n💡 Try adjusting filters or check repository permissions.\n");
            return;
          }

          for (const pr of pullRequests) {
            const status = pr.state === "open" ? "🟢 OPEN" : "🔴 CLOSED";
            console.log(`${status} #${pr.number}: ${pr.title}`);
            console.log(`       Branch: ${pr.branch}`);
            if (pr.labels && pr.labels.length > 0) {
              console.log(`       Labels: ${pr.labels.join(", ")}`);
            }
            console.log("");
          }

          if (opts.suggest && result.suggestions) {
            console.log(`\n💡 Generated ${result.suggestionsCount} dependency suggestion(s)\n`);
          }

          console.log("Next step:");
          console.log("  lex-pr weave plan --from-github --output plan.json\n");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Discovery failed: ${message}\n`);
        throwExit(1);
      }
    });

  // weave plan - Generate merge plan
  weave
    .command("plan")
    .description("Generate merge plan from GitHub PRs or config files")
    .option("--from-github", "Auto-discover PRs from GitHub API")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--query <query>", "GitHub search query")
    .option("--labels <labels...>", "Filter PRs by labels")
    .option("--include-drafts", "Include draft PRs", true)
    .option("--exclude-prs <numbers...>", "Exclude specific PR numbers")
    .option("--target <branch>", "Target branch (default: repo default)")
    .option("--output <file>", "Output file path", "plan.json")
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        if (!opts.fromGithub) {
          console.error("\n❌ Error: --from-github is required for weave plan\n");
          console.error("Example:");
          console.error("  lex-pr weave plan --from-github --output plan.json\n");
          throwExit(1);
        }

        // Create GitHub client
        const client = await createGitHubClient({
          token: process.env.GITHUB_TOKEN,
          owner: opts.owner,
          repo: opts.repo,
        });

        // Generate plan from GitHub
        const plan = await generatePlanFromGitHub(client, {
          query: opts.query,
          labels: opts.labels,
          excludePRs: opts.excludePrs?.map((n: string) => parseInt(n, 10)),
          includeDrafts: opts.includeDrafts,
          target: opts.target,
          policy: {
            requiredGates: ["lint", "typecheck", "test"],
            maxWorkers: 2,
          },
        });

        // Write plan to file
        const planJson = canonicalJSONStringify(plan);
        fs.writeFileSync(opts.output, planJson + "\n");

        if (opts.json || deps.jsonModeActive()) {
          console.log(
            canonicalJSONStringify({
              success: true,
              planFile: opts.output,
              items: plan.items?.length || 0,
            })
          );
        } else {
          console.log(`\n✅ Plan generated successfully\n`);
          console.log(`   File: ${opts.output}`);
          console.log(`   Items: ${plan.items?.length || 0}`);
          console.log(`   Target: ${plan.target || "default branch"}`);
          console.log("");
          console.log("Next steps:");
          console.log(`  1. Review: lex-pr plan-review ${opts.output}`);
          console.log(`  2. Dry-run: lex-pr weave apply --plan ${opts.output} --dry-run`);
          console.log(`  3. Execute: lex-pr weave apply --plan ${opts.output}\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Plan generation failed: ${message}\n`);
        throwExit(1);
      }
    });

  // weave apply - Execute merge pyramid
  weave
    .command("apply")
    .description("Execute merge pyramid with gates and merging")
    .option("--plan <file>", "Path to plan.json file", "plan.json")
    .option("--dry-run", "Show what would happen without executing")
    .option("--no-constraints", "Skip constraint preview in dry-run mode")
    .option("--skip-gates", "Skip gate execution (not recommended)")
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        // Load plan
        if (!fs.existsSync(opts.plan)) {
          console.error(`\n❌ Error: Plan file not found: ${opts.plan}\n`);
          console.error("Generate a plan first:");
          console.error("  lex-pr weave plan --from-github --output plan.json\n");
          throwExit(1);
        }

        const planContent = fs.readFileSync(opts.plan, "utf-8");
        const plan = loadPlan(planContent);

        // Compute merge order
        const levels = computeMergeOrder(plan);

        if (opts.dryRun) {
          // Dry-run mode: show execution plan with constraint preview
          const showConstraints = opts.constraints !== false;

          if (opts.json || deps.jsonModeActive()) {
            const output: any = {
              dryRun: true,
              levels,
              totalItems: plan.items?.length || 0,
              maxParallelism: Math.max(...levels.map((level) => level.length)),
            };

            // Add constraint preview to JSON output if enabled
            if (showConstraints) {
              const { previewConstraints } = await import("../preview/constraints.js");
              const constraintPreview = await previewConstraints(plan);
              output.constraints = constraintPreview;
            }

            console.log(canonicalJSONStringify(output));
          } else {
            console.log(`\n🔍 Merge-Weave Dry Run\n`);

            // Show constraint preview first if enabled
            if (showConstraints) {
              const { previewConstraints, formatConstraintPreview } =
                await import("../preview/constraints.js");
              const constraintPreview = await previewConstraints(plan);
              console.log(formatConstraintPreview(constraintPreview));
            }

            console.log(`Plan: ${opts.plan}`);
            console.log(`Items: ${plan.items?.length || 0}`);
            console.log(`Target: ${plan.target || "main"}\n`);

            console.log("📦 Execution Plan\n");
            console.log("Execution Order (topological):\n");
            levels.forEach((level, idx) => {
              console.log(`  Level ${idx + 1}:`);
              level.forEach((item) => {
                console.log(`    - ${item}`);
              });
            });

            console.log("\nGates to run:");
            const gates = plan.policy?.requiredGates || ["lint", "typecheck", "test"];
            gates.forEach((gate) => {
              console.log(`  - ${gate}`);
            });

            console.log("\nTo execute:");
            console.log(`  lex-pr weave apply --plan ${opts.plan}\n`);
          }
        } else {
          // Execute mode
          if (!opts.json && !deps.jsonModeActive()) {
            console.log(`\n🚀 Executing Merge-Weave\n`);
            console.log(`Plan: ${opts.plan}`);
            console.log(`Items: ${plan.items?.length || 0}\n`);
          }

          // Execute gates if not skipped
          if (!opts.skipGates) {
            if (!opts.json && !deps.jsonModeActive()) {
              console.log("Running gates...\n");
            }

            const executionState = new ExecutionState(plan);
            const gatesDir = path.join(process.cwd(), ".smartergpt", "runner", "gates");

            await executeGatesWithPolicy(plan, executionState, gatesDir);

            const results = executionState.getResults();
            let allPassed = true;

            for (const [itemName, nodeResult] of results) {
              if (nodeResult.status !== "pass") {
                allPassed = false;
                if (!opts.json && !deps.jsonModeActive()) {
                  console.log(`❌ ${itemName}: ${nodeResult.status}`);
                }
              } else {
                if (!opts.json && !deps.jsonModeActive()) {
                  console.log(`✅ ${itemName}: passed`);
                }
              }
            }

            if (!allPassed) {
              console.error("\n❌ Some gates failed. Fix issues before merging.\n");
              throwExit(1);
            }

            if (!opts.json && !deps.jsonModeActive()) {
              console.log("\n✅ All gates passed!\n");
            }
          }

          // Note: Actual merge execution would be handled by merge command
          // For now, we show the next step
          if (!opts.json && !deps.jsonModeActive()) {
            console.log("Merge pyramid ready to execute.");
            console.log("\nNext step:");
            console.log(`  lex-pr merge --plan ${opts.plan} --execute\n`);
          } else {
            console.log(
              canonicalJSONStringify({
                success: true,
                gatesCompleted: !opts.skipGates,
                readyToMerge: true,
              })
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Apply failed: ${message}\n`);
        throwExit(1);
      }
    });

  // ALN-003 Phase 2: Add additional weave subcommands for full category coverage
  // These were originally intended to be added by PR #584
  // Note: discover, plan, and apply are implemented inline above.
  // We only add status, report, and order here.

  // weave status - Show execution status
  registerStatusCommand(weave, deps.jsonModeActive);

  // weave report - Generate gate reports
  registerReportCommand(weave, { jsonModeActive: deps.jsonModeActive });

  // weave order - Compute merge order (alias for merge-order)
  registerMergeOrderCommand(weave, deps.jsonModeActive, (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error: ${message}\n`);
    throwExit(1);
  });

  // weave policy - Policy-based merge-weave execution
  registerPolicyCommands(weave, { jsonModeActive: deps.jsonModeActive });

  // weave fanout - Fanout templates for follow-up issue creation
  registerFanoutCommands(weave);

  // weave resume - Resume from checkpoint
  weave
    .command("resume")
    .description("Resume merge-weave execution from a checkpoint")
    .option("--run-id <id>", "Resume from specific run ID")
    .option("--latest", "Resume from most recent checkpoint")
    .option("--json", "Output JSON format")
    .action(async (opts) => {
      try {
        // Determine which checkpoint to load
        let checkpoint;
        let runId: string;

        if (opts.runId) {
          runId = opts.runId;
          checkpoint = await loadCheckpoint(runId, { validatePlanHash: false });
        } else if (opts.latest) {
          checkpoint = await getLatestCheckpoint();
          if (!checkpoint) {
            console.error("\n❌ No checkpoints found\n");
            console.error("Start a new weave execution with:");
            console.error("  lex-pr weave apply --plan plan.json\n");
            throwExit(1);
          }
          runId = checkpoint.runId;
        } else {
          console.error("\n❌ Error: Must specify either --run-id or --latest\n");
          console.error("Examples:");
          console.error("  lex-pr weave resume --latest");
          console.error("  lex-pr weave resume --run-id <run-id>\n");
          throwExit(1);
        }

        if (!(opts.json || deps.jsonModeActive())) {
          console.log("\n🔄 Resuming merge-weave execution\n");
          console.log(`Run ID: ${runId}`);
          console.log(`Phase: ${checkpoint.phase}`);
        }
        const result = await resumePersistedWeave({
          runId,
          driver: new LocalWeaveResumeDriver(process.cwd()),
        });
        if (opts.json || deps.jsonModeActive()) {
          console.log(canonicalJSONStringify({ action: "resume", ...result }));
        } else if (result.ok) {
          console.log(
            `✅ ${result.outcome === "completed" ? "Execution completed" : "Execution paused"}`
          );
          console.log(
            `Completed: ${result.completed} | Pending: ${result.pending} | Failed: ${result.failed}\n`
          );
        } else {
          console.error(`\n❌ Cannot resume: ${result.reason}\n`);
          throwExit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ Resume failed: ${message}\n`);
        throwExit(1);
      }
    });

  // weave checkpoints - Checkpoint management
  registerCheckpointCommands(weave, { jsonModeActive: deps.jsonModeActive });
}
