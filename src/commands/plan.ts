/**
 * Plan command - Generate plan from configuration sources or GitHub PRs
 */

import { Command } from "commander";
import { Plan, loadPlan } from "../schema.js";
import { computeMergeOrder, CycleError, UnknownDependencyError } from "../mergeOrder.js";
import { loadInputs, detectGitHubMode } from "../core/inputs.js";
import { generatePlan, generateEmptyPlan } from "../core/plan.js";
import { generateSnapshot, generatePlanSummary, generateGitHubSnapshot } from "../core/snapshot.js";
import { generatePlanFromGitHub } from "../core/githubPlan.js";
import { createGitHubClient } from "../github/index.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { resolveProfile, validateWriteOperation } from "../config/profileResolver.js";
import { throwExit } from "../cli/exitHandler.js";
import { FileAnalyzer } from "../planner/fileAnalysis.js";
import { scoreDependencies } from "../planner/dependencyScoring.js";
import { formatSuggestions, type SuggestionFormat } from "../cli/formatSuggestions.js";
import { parseTierOverrides, calculateTierMetrics, formatTierMetrics } from "../tiers/index.js";
import * as fs from "fs";
import * as path from "path";

interface PlanCommandDeps {
  jsonModeActive: () => boolean;
  setJsonMode: (active: boolean) => void;
  exitWith: (e: unknown) => void;
}

/**
 * Register the plan command
 */
export function registerPlanCommand(program: Command, deps: PlanCommandDeps): void {
  program
    .command("plan")
    .description(
      "Generate plan from configuration sources or GitHub PRs (canonical: lex-pr weave plan)"
    )
    .option("--out <dir>", "Output directory for artifacts (default: <profile>/runner)")
    .option("--json", "Output canonical plan JSON to stdout only")
    .option("--dry-run", "Validate inputs and show what would be written")
    .option("--from-github", "Auto-discover PRs from GitHub API")
    .option("--query <query>", "GitHub search query (e.g., 'is:open label:stack:*')")
    .option("--labels <labels>", "Filter PRs by comma-separated labels")
    .option("--include-drafts", "Include draft PRs in the plan")
    .option("--exclude-prs <numbers>", "Exclude specific PRs by comma-separated PR numbers")
    .option("--github-token <token>", "GitHub API token (or use GITHUB_TOKEN env var)")
    .option("--owner <owner>", "GitHub repository owner (auto-detected from git remote)")
    .option("--repo <repo>", "GitHub repository name (auto-detected from git remote)")
    .option(
      "--required-gates <gates>",
      "Comma-separated list of required gates (default: lint,typecheck,test)"
    )
    .option("--max-workers <n>", "Maximum parallel workers for execution (default: 2)", parseInt)
    .option("--target <branch>", "Target branch for merging PRs (default: repo default branch)")
    .option("--validate-cycles", "Enable dependency cycle detection (default: true)")
    .option("--optimize", "Optimize plan for parallel execution")
    .option(
      "--suggest-deps",
      "Output dependency suggestions for review (does not generate plan.json)"
    )
    .option(
      "--threshold <number>",
      "Filter suggestions below this score (default: 0.3)",
      parseFloat
    )
    .option("--format <format>", "Output format: table|json|markdown (default: table)")
    .option("--output <file>", "Write suggestions to file instead of stdout")
    .option(
      "--tier-override <overrides>",
      "Override tier for specific items (format: item=tier, comma-separated)"
    )
    .option("--show-tiers", "Show suggested tiers for plan items")
    .addHelpText(
      "after",
      `
Examples:
  $ lex-pr plan --from-github --json > plan.json    # Generate plan from GitHub PRs
  $ lex-pr plan --dry-run                           # Preview plan without writing
  $ lex-pr plan --labels "feature,bugfix"           # Filter by labels
  $ lex-pr plan --exclude-prs 123,456               # Exclude specific PRs
  $ lex-pr plan --target staging                    # Target different branch
  $ lex-pr plan --required-gates lint,test,e2e      # Custom gate requirements
  $ lex-pr plan --from-github --suggest-deps        # Review dependency suggestions
  $ lex-pr plan --from-github --suggest-deps --format=json  # JSON suggestions for tooling
  $ lex-pr plan --from-github --suggest-deps --threshold=0.7  # High-confidence only

Common Issues:
  • GitHub API errors: Set GITHUB_TOKEN environment variable
  • Cycle detection failures: Review dependencies in scope.yml or PR descriptions
  • Missing configuration: Run 'lex-pr init' to set up workspace`
    )
    .action(async (opts) => {
      const previousJsonMode = deps.jsonModeActive();
      // jsonModeActive is already set by preAction hook from global --json
      // Command-level --json flag also sets it for backwards compatibility
      if (opts.json) {
        deps.setJsonMode(true);
      }
      try {
        await executePlan(opts, deps);
      } catch (error) {
        deps.exitWith(error);
      } finally {
        deps.setJsonMode(previousJsonMode);
      }
    });
}

async function executePlan(opts: any, deps: PlanCommandDeps): Promise<void> {
  // Resolve profile first to determine default output directory
  const resolved = resolveProfile(undefined, process.cwd());
  const defaultOutDir = path.join(resolved.path, "runner");
  const outDir = opts.out || defaultOutDir;

  let plan: Plan;
  let inputs: any = null;
  let autoDetectedGitHubMode = false;

  // Parse tier overrides from CLI
  const tierOverrides = opts.tierOverride ? parseTierOverrides(opts.tierOverride) : undefined;

  // Auto-detect GitHub mode from scope.yml if --from-github not explicitly set
  if (!opts.fromGithub) {
    const detection = detectGitHubMode(resolved.path);
    if (detection.shouldUseGitHub) {
      autoDetectedGitHubMode = true;
      // Merge scope.yml filters with CLI options (CLI takes precedence)
      opts.fromGithub = true;
      if (!opts.query && detection.scopeConfig?.query) {
        opts.query = detection.scopeConfig.query;
      }
      if (
        !opts.labels &&
        detection.scopeConfig?.labels &&
        detection.scopeConfig.labels.length > 0
      ) {
        opts.labels = detection.scopeConfig.labels.join(",");
      }
      if (!opts.target && detection.scopeConfig?.target) {
        opts.target = detection.scopeConfig.target;
      }

      if (!deps.jsonModeActive()) {
        console.error("[plan] Auto-detected GitHub mode from scope.yml filters");
      }
    }
  }

  if (opts.fromGithub) {
    // GitHub mode: auto-discover PRs
    const client = await createGitHubClient({
      token: opts.githubToken,
      owner: opts.owner,
      repo: opts.repo,
    });

    // Parse labels if provided
    const labels = opts.labels ? opts.labels.split(",").map((l: string) => l.trim()) : undefined;

    // Parse excluded PR numbers if provided
    const excludePRs = opts.excludePrs
      ? opts.excludePrs
          .split(",")
          .map((n: string) => parseInt(n.trim(), 10))
          .filter((n: number) => !isNaN(n))
      : undefined;

    // Handle --suggest-deps mode
    if (opts.suggestDeps) {
      // Discover PRs based on query/filters
      const prs = await client.listOpenPRs({
        state: "open",
        labels,
        ...(opts.query ? { query: opts.query } : {}),
      });

      // Default behavior: include drafts unless explicitly disabled
      const includeDrafts = opts.includeDrafts === undefined ? true : Boolean(opts.includeDrafts);
      const filteredPRs = includeDrafts ? prs : prs.filter((pr) => !pr.draft);

      // Exclude specific PRs if requested
      const finalPRs =
        excludePRs && excludePRs.length > 0
          ? filteredPRs.filter((pr) => !excludePRs.includes(pr.number))
          : filteredPRs;

      if (finalPRs.length === 0) {
        console.log("No PRs found matching the criteria.");
        return;
      }

      // Get detailed information for each PR
      const prDetails = await Promise.all(finalPRs.map((pr) => client.getPRDetails(pr.number)));

      // Create file analyzer
      const fileAnalyzer = new FileAnalyzer(
        client.getOctokit(),
        client.getOwner(),
        client.getRepo()
      );

      // Score dependencies
      const threshold = opts.threshold ?? 0.3;
      const scores = await scoreDependencies(
        prDetails.map((pr) => ({
          number: pr.number,
          name: `PR-${pr.number}`,
          body: pr.body,
          sha: pr.head.sha,
        })),
        fileAnalyzer,
        { threshold }
      );

      // Format output
      const format = (opts.format as SuggestionFormat) || "table";
      const output = formatSuggestions(scores, format, threshold);

      // Write to stdout or file
      if (opts.output) {
        fs.writeFileSync(opts.output, output, "utf-8");
        if (!deps.jsonModeActive()) {
          console.log(`✓ Suggestions written to ${opts.output}`);
        }
      } else {
        console.log(output);
      }

      // Exit without generating plan.json
      return;
    }

    // Parse required gates if provided
    const requiredGates = opts.requiredGates
      ? opts.requiredGates.split(",").map((g: string) => g.trim())
      : ["lint", "typecheck", "test"];

    // Parse max workers if provided
    const maxWorkers = opts.maxWorkers || 2;

    // Generate plan from GitHub
    plan = await generatePlanFromGitHub(client, {
      query: opts.query,
      labels,
      excludePRs,
      includeDrafts: opts.includeDrafts,
      target: opts.target,
      policy: {
        requiredGates,
        maxWorkers,
      },
      tierOverrides,
    });

    // If JSON mode is requested, keep non-JSON logs on stderr and emit a brief diagnostic
    if (deps.jsonModeActive()) {
      // diagnostics to stderr only
      const repoDiag = `${client.getOwner()}/${client.getRepo()}`;
      const filterInfo = labels ? ` labels=${labels.join(",")}` : "";
      const queryInfo = opts.query ? ` query="${opts.query}"` : "";
      console.error(
        `[from-github] repo=${repoDiag}${filterInfo}${queryInfo} discovered=${plan.items.length}`
      );
    } else {
      const modeLabel = autoDetectedGitHubMode ? "Auto-detected and discovered" : "Auto-discovered";
      console.log(`✓ ${modeLabel} ${plan.items.length} PRs from GitHub`);
      if (labels && labels.length > 0) {
        console.log(`  Filtered by labels: ${labels.join(", ")}`);
      }
      if (opts.query) {
        console.log(`  Using query: ${opts.query}`);
      }
      if (plan.items.length === 0) {
        console.log(`\n⚠️  No PRs found matching the criteria.`);
        console.log(`    Try adjusting filters or check that PRs exist in the repository.`);
      }
    }
  } else {
    // Traditional mode: load from configuration files
    inputs = loadInputs();
    plan =
      inputs.items.length > 0
        ? generatePlan(inputs, { tierOverrides })
        : generateEmptyPlan(inputs.target);
  }

  // Validate plan structure
  const validatedPlan = loadPlan(canonicalJSONStringify(plan));

  // Validate dependencies and detect cycles (default: enabled)
  if (opts.validateCycles !== false && validatedPlan.items.length > 0) {
    try {
      computeMergeOrder(validatedPlan);
      if (!deps.jsonModeActive()) {
        console.log(`✓ Dependency validation passed (no cycles detected)`);
      }
    } catch (error) {
      if (error instanceof CycleError) {
        const prefix = deps.jsonModeActive() ? "[lex-pr]" : "❌";
        console.error(`\n${prefix} Plan validation failed: ${error.message}`);
        throwExit(1);
      } else if (error instanceof UnknownDependencyError) {
        const prefix = deps.jsonModeActive() ? "[lex-pr]" : "❌";
        console.error(`\n${prefix} Plan validation failed: ${error.message}`);
        throwExit(1);
      }
      throw error;
    }
  }

  // Optimize plan if requested
  if (opts.optimize && validatedPlan.items.length > 0) {
    // Plan is already optimized by computeMergeOrder - just show info
    const levels = computeMergeOrder(validatedPlan);
    if (!deps.jsonModeActive()) {
      console.log(`✓ Plan optimized for parallel execution: ${levels.length} levels`);
      levels.forEach((level, idx) => {
        console.log(`  Level ${idx + 1}: ${level.join(", ")}`);
      });
    }
  }

  // Show tier information if requested
  if (opts.showTiers && validatedPlan.items.length > 0 && !deps.jsonModeActive()) {
    // Collect tier assignments from plan items
    const tierAssignments = new Map();
    for (const item of validatedPlan.items) {
      if (item.tier) {
        tierAssignments.set(item.name, item.tier);
      }
    }

    if (tierAssignments.size > 0) {
      const tierMetrics = calculateTierMetrics(tierAssignments);

      console.log("\n🏷️  Capability Tier Assignments");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      for (const [itemName, assignment] of tierAssignments) {
        const actual = assignment.actual || assignment.suggested;
        const marker = assignment.mismatch ? " (overridden)" : "";
        const escalatedMarker = assignment.escalated ? " ⬆️" : "";
        console.log(`  ${itemName}: ${actual}${marker}${escalatedMarker}`);
      }
      console.log("");
      console.log(formatTierMetrics(tierMetrics));
      console.log("");
    }
  }

  if (deps.jsonModeActive()) {
    // JSON mode: output only canonical plan to stdout, write nothing else
    // canonicalJSONStringify already includes trailing newline
    process.stdout.write(canonicalJSONStringify(validatedPlan));
    return;
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
    return;
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

  return;
}
