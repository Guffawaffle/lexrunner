/**
 * Create Project Command
 * Implements `lex-pr create-project` command
 *
 * Generates Execution Plan v1 from Feature Spec v0, creates Epic + Sub-Issues
 */

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs/promises";
import * as path from "path";
import { Octokit } from "@octokit/rest";
import { loadAndValidate, validate } from "../utils/validation.js";
import { expandTokens, getGitContext } from "../utils/tokens.js";
import { normalizePath, ensureDir, isSafeArtifactPath } from "../utils/paths.js";
import {
  FeatureSpecV0Schema,
  ExecutionPlanV1Schema,
  type FeatureSpecV0,
  type ExecutionPlanV1,
  type SubIssue,
} from "../schemas/project.js";

/**
 * Command options interface
 */
interface CreateProjectOptions {
  spec: string;
  dryRun: boolean;
  output?: string;
  repo?: string;
  project?: string;
  epicLabels: string[];
  issueLabels: string[];
  link: boolean;
}

/**
 * Register the create-project command
 */
export function registerCreateProjectCommand(program: Command): void {
  program
    .command("create-project")
    .description("Generate Execution Plan v1 from Feature Spec v0, create Epic + Sub-Issues")
    .requiredOption("--spec <path>", "Feature Spec v0 file path")
    .option("--dry-run", "Generate plan without creating Issues", false)
    .option("--output <path>", "Output path for Execution Plan v1")
    .option("--repo <owner/repo>", "Target repository")
    .option("--project <name/num>", "Link to GitHub Project")
    .option("--epic-labels <labels>", "Additional Epic labels (comma-separated)", parseLabels, [])
    .option(
      "--issue-labels <labels>",
      "Additional sub-issue labels (comma-separated)",
      parseLabels,
      []
    )
    .option("--no-link", "Skip sub-issue linking to Epic", false)
    .action(runCreateProjectCommand);
}

/**
 * Parse comma-separated labels
 */
function parseLabels(value: string): string[] {
  return value
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Run the create-project command
 */
async function runCreateProjectCommand(options: CreateProjectOptions): Promise<void> {
  try {
    // Validate environment
    if (!options.dryRun && !process.env.GITHUB_TOKEN) {
      console.error(chalk.red("Error: GITHUB_TOKEN required for Issue creation"));
      console.error(chalk.yellow("Hint: Set GITHUB_TOKEN environment variable or use --dry-run"));
      process.exit(1);
    }

    // Load and validate Feature Spec v0
    const specPath = normalizePath(options.spec);
    console.log(chalk.blue(`Loading Feature Spec: ${specPath}`));

    const spec = (await loadAndValidate(specPath, FeatureSpecV0Schema)) as FeatureSpecV0;
    console.log(chalk.green(`✓ Feature Spec v0 validated`));
    console.log(chalk.gray(`  Title: ${spec.title}`));
    console.log(chalk.gray(`  Repository: ${spec.repo}`));

    // Generate Execution Plan v1
    const plan = generateExecutionPlan(spec);
    const validatedPlan = validate(plan, ExecutionPlanV1Schema) as ExecutionPlanV1;

    console.log(chalk.blue(`\nGenerated Execution Plan:`));
    console.log(chalk.gray(`  Epic: ${validatedPlan.epic.title}`));
    console.log(chalk.gray(`  Sub-issues: ${validatedPlan.subIssues.length}`));
    console.log(chalk.gray(`  Dependencies: ${countDependencies(validatedPlan)}`));

    // Determine output path
    const outputPath = await determineOutputPath(options, spec);
    const normalizedOutput = normalizePath(outputPath);

    // Validate write path
    if (!isSafeArtifactPath(normalizedOutput)) {
      console.error(chalk.red("Error: Cannot write to PR artifact directories"));
      console.error(chalk.yellow(`Attempted path: ${normalizedOutput}`));
      process.exit(1);
    }

    // Write Execution Plan to file
    await ensureDir(path.dirname(normalizedOutput));
    await fs.writeFile(normalizedOutput, JSON.stringify(validatedPlan, null, 2), "utf-8");
    console.log(chalk.green(`✓ Execution Plan v1 written to: ${normalizedOutput}`));

    // Create Epic + Sub-Issues
    if (!options.dryRun) {
      await createIssuesOnGitHub(validatedPlan, options, spec);
    } else {
      console.log(chalk.yellow("\nDry run: No Issues created"));
      console.log(chalk.gray("Run without --dry-run to create actual GitHub Issues"));
    }

    console.log(chalk.green("\n✓ Command completed successfully"));
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`\nError: ${error.message}`));
    } else {
      console.error(chalk.red(`\nUnknown error occurred`));
    }
    process.exit(1);
  }
}

/**
 * Generate Execution Plan v1 from Feature Spec v0
 */
function generateExecutionPlan(spec: FeatureSpecV0): ExecutionPlanV1 {
  // Ensure schemaVersion has a value (defaults should already be applied by validation)
  const sourceSpec: FeatureSpecV0 = {
    ...spec,
    schemaVersion: spec.schemaVersion || "0.1.0",
    labels: spec.labels || [],
    priority: spec.priority || "medium",
  };

  // Preserve authored context in every generated work description, without treating
  // prose requirements as execution authority or enforcement.
  const context = formatAuthoredContext(sourceSpec);

  // Create Epic from Feature Spec
  const epic = {
    title: sourceSpec.title,
    description: sourceSpec.description + context,
    acceptanceCriteria: sourceSpec.acceptanceCriteria,
  };

  // Decompose into Sub-Issues
  const subIssues: SubIssue[] = [
    {
      id: "feature-impl",
      title: `Implement ${sourceSpec.title}`,
      description: `Core implementation of feature: ${sourceSpec.description}${context}`,
      type: "feature" as const,
      acceptanceCriteria: sourceSpec.acceptanceCriteria,
      dependsOn: [],
    },
    {
      id: "tests",
      title: `Add tests for ${sourceSpec.title}`,
      description: `Unit and integration tests for ${sourceSpec.description}${context}`,
      type: "testing" as const,
      acceptanceCriteria: ["Unit tests pass", "Integration tests pass", "Coverage > 80%"],
      dependsOn: ["feature-impl"],
    },
    {
      id: "docs",
      title: `Document ${sourceSpec.title}`,
      description: `User-facing documentation for ${sourceSpec.description}${context}`,
      type: "docs" as const,
      acceptanceCriteria: ["README updated", "Examples added", "API docs complete"],
      dependsOn: ["feature-impl"],
    },
  ];

  return {
    schemaVersion: "1.0.0",
    sourceSpec,
    epic,
    subIssues,
    createdAt: new Date().toISOString(),
  };
}

function formatAuthoredContext(spec: FeatureSpecV0): string {
  let context = "";
  if (spec.technicalContext) {
    context += `\n\n### Supplied technical context\n\n${spec.technicalContext}`;
  }
  if (spec.constraints) {
    context += `\n\n### Supplied constraints\n\n${spec.constraints}`;
  }
  return context;
}

/**
 * Determine output path for Execution Plan
 */
async function determineOutputPath(
  options: CreateProjectOptions,
  spec: FeatureSpecV0
): Promise<string> {
  if (options.output) {
    return options.output;
  }

  // Default path with token expansion
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const template = ".smartergpt.local/deliverables/_session/plan-{timestamp}.json";

  return expandTokens(template, {
    timestamp,
    repo: spec.repo.split("/")[1],
  });
}

/**
 * Create Epic and Sub-Issues on GitHub
 */
async function createIssuesOnGitHub(
  plan: ExecutionPlanV1,
  options: CreateProjectOptions,
  spec: FeatureSpecV0
): Promise<void> {
  const repo = options.repo || spec.repo;
  const [owner, repoName] = repo.split("/");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // Create Epic
  console.log(chalk.blue(`\nCreating Epic Issue...`));
  const { data: epic } = await octokit.issues.create({
    owner,
    repo: repoName,
    title: plan.epic.title,
    body: formatEpicBody(plan),
    labels: ["epic", ...options.epicLabels],
  });

  console.log(chalk.green(`✓ Epic created: ${epic.html_url}`));
  console.log(chalk.blue(`  Issue #${epic.number}`));

  // Create Sub-Issues
  const subIssueMap = new Map<string, number>();

  for (const subIssue of plan.subIssues) {
    console.log(chalk.blue(`\nCreating Sub-Issue: ${subIssue.title}`));
    const { data: issue } = await octokit.issues.create({
      owner,
      repo: repoName,
      title: subIssue.title,
      body: formatSubIssueBody(subIssue, epic.number),
      labels: [subIssue.type, ...options.issueLabels],
    });

    console.log(chalk.green(`✓ Sub-Issue created: ${issue.html_url}`));
    console.log(chalk.blue(`  Issue #${issue.number}`));

    subIssueMap.set(subIssue.id, issue.number);
  }

  // Link Sub-Issues to Epic (if requested)
  if (options.link !== false) {
    console.log(chalk.blue(`\nLinking Sub-Issues to Epic #${epic.number}...`));

    for (const [subIssueId, issueNumber] of subIssueMap.entries()) {
      try {
        // Update sub-issue body to include parent epic reference
        const { data: currentIssue } = await octokit.issues.get({
          owner,
          repo: repoName,
          issue_number: issueNumber,
        });

        await octokit.issues.update({
          owner,
          repo: repoName,
          issue_number: issueNumber,
          body: currentIssue.body + `\n\n---\n**Parent Epic:** #${epic.number}`,
        });
        console.log(chalk.green(`✓ Linked #${issueNumber} → #${epic.number}`));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.warn(chalk.yellow(`⚠ Could not link #${issueNumber}: ${errorMessage}`));
      }
    }
  }

  // Link to GitHub Project (optional)
  if (options.project) {
    console.log(chalk.blue(`\nLinking to GitHub Project: ${options.project}`));
    console.warn(
      chalk.yellow("⚠ GitHub Projects linking not yet implemented (requires GraphQL API)")
    );
  }

  console.log(chalk.green(`\n✓ Project created successfully!`));
  console.log(chalk.gray(`  Epic: #${epic.number}`));
  console.log(
    chalk.gray(
      `  Sub-Issues: ${Array.from(subIssueMap.values())
        .map((n) => `#${n}`)
        .join(", ")}`
    )
  );
}

/**
 * Format Epic body for GitHub Issue
 */
function formatEpicBody(plan: ExecutionPlanV1): string {
  return (
    `## Description\n\n${plan.epic.description}\n\n` +
    `## Acceptance Criteria\n\n${plan.epic.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")}\n\n` +
    `## Sub-Issues\n\n` +
    plan.subIssues.map((si) => `- [ ] ${si.title} (${si.type})`).join("\n") +
    `\n\n## Metadata\n\n` +
    `- **Schema:** Execution Plan v${plan.schemaVersion}\n` +
    `- **Generated:** ${plan.createdAt}\n` +
    `- **Source Spec:** Feature Spec v${plan.sourceSpec.schemaVersion}`
  );
}

/**
 * Format Sub-Issue body for GitHub Issue
 */
function formatSubIssueBody(subIssue: SubIssue, epicNumber: number): string {
  return (
    `## Description\n\n${subIssue.description}\n\n` +
    `## Acceptance Criteria\n\n${subIssue.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")}\n\n` +
    (subIssue.dependsOn.length > 0
      ? `## Dependencies\n\n${subIssue.dependsOn.map((d) => `- ${d}`).join("\n")}\n\n`
      : "") +
    `---\n**Parent Epic:** #${epicNumber}`
  );
}

/**
 * Count total dependencies in the plan
 */
function countDependencies(plan: ExecutionPlanV1): number {
  return plan.subIssues.reduce((sum, si) => sum + si.dependsOn.length, 0);
}
