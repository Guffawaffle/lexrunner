/**
 * Weave Fanout CLI Commands
 *
 * Commands for managing fanout templates and Yellow Brick pipeline:
 * - weave fanout harvest: D0 - Harvest external state into pinned bundle
 * - weave fanout analyze: D1 - Analyze harvest bundle into facts pool
 * - weave fanout show: Display loaded templates
 * - weave fanout validate: Validate template file
 * - weave fanout scan: Scan a PR for matches
 * - weave fanout preview: Preview issues that would be created
 *
 * @module
 */

import { Command } from "commander";
import * as path from "node:path";
import { registerHarvestCommand } from "./fanout-harvest.js";
import { registerAnalyzeCommand } from "./fanout-analyze.js";
import {
  discoverFanoutTemplates,
  loadFanoutTemplates,
  validateFanoutTemplatesContent,
  matchTemplatesAgainstDiff,
  deduplicateMatches,
  generateIssues,
  formatIssuesPreview,
  type FanoutTemplates,
  type PRDiffFile,
  type SubstitutionContext,
} from "../weave/fanout/index.js";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getWorkspaceRoot(): string {
  return process.cwd();
}

function formatTemplatesList(templates: FanoutTemplates): string {
  if (templates.templates.length === 0) {
    return "No templates defined.";
  }

  const lines: string[] = [`Fanout Templates (version ${templates.version})`, "=".repeat(50), ""];

  for (const t of templates.templates) {
    const status = t.enabled ? "✓" : "✗";
    const judgment = t.trigger.requires_judgment ? " [D2]" : " [D1]";
    lines.push(`${status} ${t.id}${judgment}`);
    if (t.description) {
      lines.push(`  ${t.description}`);
    }
    lines.push(`  Pattern: ${t.trigger.pattern.slice(0, 50)}...`);
    lines.push(`  Files: ${t.trigger.files.join(", ")}`);
    lines.push(`  → ${t.issue.title}`);
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// COMMANDS
// =============================================================================

export function registerFanoutCommands(weaveCommand: Command): void {
  const fanout = weaveCommand
    .command("fanout")
    .description("Yellow Brick pipeline: harvest → analyze → plan → execute");

  // D0: Harvest command
  registerHarvestCommand(fanout);

  // D1: Analyze command
  registerAnalyzeCommand(fanout);

  // Show command
  fanout
    .command("show")
    .description("Display loaded fanout templates")
    .option("-f, --file <path>", "Path to templates file")
    .action(async (options: { file?: string }) => {
      try {
        let templates: FanoutTemplates;

        if (options.file) {
          templates = await loadFanoutTemplates(options.file);
          console.log(`Loaded from: ${options.file}\n`);
        } else {
          const result = await discoverFanoutTemplates(getWorkspaceRoot());
          if (!result) {
            console.log("No fanout templates found in default locations.");
            console.log("Create .smartergpt/fanout-templates.yml to get started.");
            return;
          }
          templates = result.templates;
          console.log(`Loaded from: ${result.path}\n`);
        }

        console.log(formatTemplatesList(templates));
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  // Validate command
  fanout
    .command("validate")
    .description("Validate fanout templates file")
    .option("-f, --file <path>", "Path to templates file")
    .action(async (options: { file?: string }) => {
      const fs = await import("node:fs/promises");

      try {
        let filePath: string;

        if (options.file) {
          filePath = options.file;
        } else {
          const result = await discoverFanoutTemplates(getWorkspaceRoot());
          if (!result) {
            console.log("No fanout templates found in default locations.");
            return;
          }
          filePath = result.path;
        }

        const content = await fs.readFile(filePath, "utf-8");
        const result = validateFanoutTemplatesContent(content);

        if (result.valid) {
          console.log(`✓ Valid: ${filePath}`);
          console.log(`  ${result.templates?.templates.length ?? 0} templates defined`);
        } else {
          console.log(`✗ Invalid: ${filePath}`);
          for (const error of result.errors ?? []) {
            console.log(`  - ${error}`);
          }
          process.exit(1);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  // Scan command - scan a PR diff for matches
  fanout
    .command("scan")
    .description("Scan a PR diff for template matches")
    .requiredOption("-p, --pr <number>", "PR number to scan")
    .option("-r, --repo <owner/name>", "Repository (defaults to current)")
    .option("-f, --file <path>", "Path to templates file")
    .option("--json", "Output as JSON")
    .action(async (options: { pr: string; repo?: string; file?: string; json?: boolean }) => {
      try {
        // Load templates
        let templates: FanoutTemplates;
        if (options.file) {
          templates = await loadFanoutTemplates(options.file);
        } else {
          const result = await discoverFanoutTemplates(getWorkspaceRoot());
          if (!result) {
            console.error("No fanout templates found.");
            process.exit(1);
          }
          templates = result.templates;
        }

        // Determine repo
        const repo = options.repo ?? "current";

        console.log(`Scanning PR #${options.pr} in ${repo} for fanout triggers...`);
        console.log("(Note: Actual PR scanning requires GitHub API integration)");
        console.log("");

        // For now, show what templates would be checked
        console.log("Templates that would be checked:");
        for (const t of templates.templates) {
          if (t.enabled) {
            console.log(`  - ${t.id}: ${t.trigger.pattern.slice(0, 40)}...`);
          }
        }

        console.log("");
        console.log("To fully implement scanning, integrate with GitHub PR files API.");
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });

  // Preview command - show issues that would be created
  fanout
    .command("preview")
    .description("Preview issues that would be created (dry-run)")
    .option("-f, --file <path>", "Path to templates file")
    .option("--sample", "Use sample diff data for demonstration")
    .action(async (options: { file?: string; sample?: boolean }) => {
      try {
        // Load templates
        let templates: FanoutTemplates;
        if (options.file) {
          templates = await loadFanoutTemplates(options.file);
        } else {
          const result = await discoverFanoutTemplates(getWorkspaceRoot());
          if (!result) {
            console.error("No fanout templates found.");
            process.exit(1);
          }
          templates = result.templates;
        }

        if (options.sample) {
          // Demo with sample diff data
          const sampleFiles: PRDiffFile[] = [
            {
              filename: "src/mcp/tools.ts",
              status: "modified",
              additions: 15,
              deletions: 2,
              patch: `@@ -100,6 +100,21 @@ export function registerTools(server: Server) {
+  tools.push({
+    name: "weave_fanout_preview",
+    description: "Preview fanout issues",
+    inputSchema: z.object({}).strict(),
+  });
`,
            },
            {
              filename: "src/cli/commands/weave.ts",
              status: "modified",
              additions: 10,
              deletions: 0,
              patch: `@@ -50,6 +50,16 @@ export function registerWeaveCommands() {
+  weave
+    .command("fanout")
+    .description("Manage fanout templates")
`,
            },
          ];

          const matches = matchTemplatesAgainstDiff(templates, sampleFiles);
          const deduped = deduplicateMatches(matches);

          const prInfo: Partial<SubstitutionContext> = {
            pr_number: "123",
            pr_title: "feat: Add fanout templates",
            pr_url: "https://github.com/example/repo/pull/123",
            pr_author: "developer",
            repo_owner: "Guffawaffle",
            repo_name: "lexrunner",
            branch_name: "feat/fanout",
          };

          const issues = generateIssues(templates, deduped, prInfo);

          console.log("=== FANOUT PREVIEW (SAMPLE DATA) ===\n");
          console.log(formatIssuesPreview(issues));
        } else {
          console.log("Use --sample to see a demonstration with sample data.");
          console.log("");
          console.log("For real PR scanning:");
          console.log("  lexrunner weave fanout scan --pr <number>");
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });
}
