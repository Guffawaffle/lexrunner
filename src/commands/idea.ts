/**
 * Idea command - Capture feature ideas and create Idea Issues
 */

import { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import * as fs from "fs/promises";
import * as path from "path";
import { Octokit } from "@octokit/rest";
import { validate } from "../utils/validation.js";
import { expandTokens, getGitContext } from "../utils/tokens.js";
import { normalizePath, ensureDir, isSafeArtifactPath } from "../utils/paths.js";
import {
  generateFingerprint,
  extractFingerprint,
  injectFingerprint,
} from "../utils/fingerprint.js";
import { FeatureSpecV0Schema, FeatureSpecV0 } from "../schemas/feature-spec-v0.js";

interface IdeaOptions {
  title?: string;
  description?: string;
  interactive: boolean;
  dryRun: boolean;
  template?: string;
  output?: string;
  repo?: string;
  label: string[];
  updateIssue?: number;
}

export function registerIdeaCommand(program: Command): void {
  program
    .command("idea")
    .description("Capture feature idea, generate Feature Spec v0, create/update Idea Issue")
    .option("--title <string>", "Idea title")
    .option("--description <string>", "Brief description")
    .option("--interactive", "Force interactive mode", false)
    .option("--dry-run", "Generate spec without creating Issue", false)
    .option("--template <path>", "Custom prompt template path")
    .option("--output <path>", "Output path for Feature Spec v0")
    .option("--repo <owner/repo>", "Target repository")
    .option("--label <label>", "Additional labels (repeatable)", collect, [])
    .option("--update-issue <num>", "Update existing Issue", parseInt)
    .action(runIdeaCommand);
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function runIdeaCommand(options: IdeaOptions): Promise<void> {
  // Validate environment
  if (!options.dryRun && !process.env.GITHUB_TOKEN) {
    console.error(chalk.red("Error: GITHUB_TOKEN environment variable required"));
    console.error(chalk.yellow("Set GITHUB_TOKEN or use --dry-run to generate spec only"));
    process.exit(1);
  }

  // Detect repository context
  const gitContext = await getGitContext(process.cwd());
  const repo = options.repo || (await detectCurrentRepo());
  const [owner, repoName] = repo.split("/");

  // Interactive prompts if flags not provided
  const interactive = options.interactive || (!options.title && !options.description);

  let title = options.title;
  let description = options.description;
  let acceptanceCriteria: string[] = [];
  let technicalContext = "";
  let constraints = "";

  if (interactive) {
    console.log(chalk.blue("\n🎯 Feature Idea Capture\n"));

    const answers = await promptInteractive({
      title,
      description,
    });

    title = answers.title;
    description = answers.description;
    acceptanceCriteria = answers.acceptanceCriteria;
    technicalContext = answers.technicalContext;
    constraints = answers.constraints;
  }

  if (!title || !description) {
    console.error(chalk.red("Error: Title and description are required"));
    console.error(chalk.yellow("Use --title and --description flags, or run in interactive mode"));
    process.exit(1);
  }

  // Generate Feature Spec v0
  const spec: FeatureSpecV0 = {
    schemaVersion: "0.1.0",
    title: title!,
    description: description!,
    acceptanceCriteria,
    technicalContext,
    constraints,
    repo,
    createdAt: new Date().toISOString(),
  };

  // Validate against schema
  const validatedSpec = validate(spec, FeatureSpecV0Schema);

  // Generate fingerprint
  const fingerprint = generateFingerprint({
    title: validatedSpec.title,
    description: validatedSpec.description,
    acceptanceCriteria: validatedSpec.acceptanceCriteria,
  });

  console.log(chalk.blue(`\nFingerprint: ${fingerprint}`));

  // Write to output file
  const outputPath =
    options.output ||
    expandTokens(".smartergpt.local/deliverables/_session/idea-{timestamp}.json", {
      timestamp: new Date().toISOString().replace(/[:.]/g, "-"),
      repo,
      ...gitContext,
    });
  const normalizedOutput = normalizePath(outputPath);

  if (!isSafeArtifactPath(normalizedOutput)) {
    console.error(chalk.red("Error: Cannot write to PR artifact directories"));
    process.exit(1);
  }

  await ensureDir(path.dirname(normalizedOutput));
  await fs.writeFile(normalizedOutput, JSON.stringify(validatedSpec, null, 2), "utf-8");
  console.log(chalk.green(`✓ Feature Spec v0 written to: ${normalizedOutput}`));

  // Create or update GitHub Issue
  if (!options.dryRun) {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const issueBody = formatIssueBody(validatedSpec, fingerprint);

    if (options.updateIssue) {
      // Update existing Issue (check fingerprint first)
      const { data: existingIssue } = await octokit.issues.get({
        owner,
        repo: repoName,
        issue_number: options.updateIssue,
      });

      const existingFingerprint = extractFingerprint(existingIssue.body || "");

      if (existingFingerprint !== fingerprint) {
        console.log(chalk.yellow(`\nUpdating Issue #${options.updateIssue} (fingerprint changed)`));
        await octokit.issues.update({
          owner,
          repo: repoName,
          issue_number: options.updateIssue,
          title: validatedSpec.title,
          body: issueBody,
        });
        console.log(chalk.green(`✓ Issue #${options.updateIssue} updated`));
      } else {
        console.log(chalk.blue(`Issue #${options.updateIssue} unchanged (fingerprint match)`));
      }
    } else {
      // Create new Issue
      const { data: newIssue } = await octokit.issues.create({
        owner,
        repo: repoName,
        title: `[IDEA] ${validatedSpec.title}`,
        body: issueBody,
        labels: ["idea", "needs-triage", ...options.label],
      });

      console.log(chalk.green(`\n✓ Idea Issue created: ${newIssue.html_url}`));
      console.log(chalk.blue(`  Issue #${newIssue.number}`));
    }
  } else {
    console.log(chalk.yellow("\nDry run: Issue not created/updated"));
    console.log(chalk.gray("\nIssue body preview:"));
    console.log(chalk.gray("─".repeat(60)));
    console.log(formatIssueBody(validatedSpec, fingerprint));
    console.log(chalk.gray("─".repeat(60)));
  }
}

async function promptInteractive(defaults: { title?: string; description?: string }): Promise<{
  title: string;
  description: string;
  acceptanceCriteria: string[];
  technicalContext: string;
  constraints: string;
}> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const title = defaults.title || (await question("Feature title: "));
  if (!title) {
    rl.close();
    throw new Error("Title is required");
  }

  const description = defaults.description || (await question("Brief description: "));
  if (!description) {
    rl.close();
    throw new Error("Description is required");
  }

  console.log("\nAcceptance criteria (enter one per line, empty line to finish):");
  const acceptanceCriteria: string[] = [];
  let criteriaIndex = 1;
  while (true) {
    const criterion = await question(`  ${criteriaIndex}. `);
    if (!criterion) break;
    acceptanceCriteria.push(criterion);
    criteriaIndex++;
  }

  const technicalContext = await question("\nTechnical context (optional, press Enter to skip): ");
  const constraints = await question("Constraints (optional, press Enter to skip): ");

  rl.close();

  return {
    title,
    description,
    acceptanceCriteria,
    technicalContext,
    constraints,
  };
}

function formatIssueBody(spec: FeatureSpecV0, fingerprint: string): string {
  let body = `## Description\n\n${spec.description}\n\n`;

  if (spec.acceptanceCriteria.length > 0) {
    body += `## Acceptance Criteria\n\n${spec.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")}\n\n`;
  }

  if (spec.technicalContext) {
    body += `## Technical Context\n\n${spec.technicalContext}\n\n`;
  }

  if (spec.constraints) {
    body += `## Constraints\n\n${spec.constraints}\n\n`;
  }

  body += `## Metadata\n\n`;
  body += `- **Repo:** ${spec.repo}\n`;
  body += `- **Created:** ${spec.createdAt}\n`;
  body += `- **Schema:** Feature Spec v${spec.schemaVersion}`;

  return injectFingerprint(body, fingerprint);
}

async function detectCurrentRepo(): Promise<string> {
  const { execa } = await import("execa");
  try {
    const { stdout } = await execa("git", ["remote", "get-url", "origin"]);
    const match = stdout.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) throw new Error("Cannot parse repo from git remote");
    return match[1];
  } catch {
    throw new Error(
      "Not a git repository or no origin remote configured. Use --repo flag to specify repository."
    );
  }
}
