/**
 * Gate import-checks command - Import gate results from GitHub check runs
 */

import { Command } from "commander";
import { throwExit } from "../cli/exitHandler.js";
import { GateReport } from "../schema/gateReport.js";
import { createGitHubClient, GitHubClient } from "../github/client.js";
import {
  loadGateMappingConfig,
  createDefaultGateMappingConfig,
  type GateMappingConfig,
} from "../schema/gateMapping.js";
import { convertCheckRunsToGateResults } from "../gates/checkRunConverter.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Register the gate import-checks command
 */
export function registerGateImportChecksCommand(program: Command): void {
  program
    .command("import-checks")
    .description("Import gate results from GitHub check runs")
    .option("--ref <ref>", "Git reference (commit SHA, branch, or PR number)")
    .option("--item <name>", "Item name (defaults to ref value)")
    .option("--out-dir <dir>", "Output directory for gate results", ".smartergpt/gate-results")
    .option(
      "--mapping <file>",
      "Path to gate mapping configuration file",
      ".lexrunner/gate-mapping.yaml"
    )
    .option("--owner <owner>", "GitHub repository owner (auto-detected if not provided)")
    .option("--repo <repo>", "GitHub repository name (auto-detected if not provided)")
    .option("--token <token>", "GitHub token (uses GITHUB_TOKEN env var if not provided)")
    .option("--create-mapping", "Create default gate mapping configuration file and exit")
    .action(async (opts) => {
      try {
        // Handle --create-mapping flag
        if (opts.createMapping) {
          const mappingPath = opts.mapping;
          createDefaultGateMappingConfig(mappingPath);
          console.log(`✅ Created default gate mapping configuration: ${mappingPath}`);
          console.log();
          console.log("Edit this file to customize check name to gate name mappings.");
          return;
        }

        // Validate required options when not creating mapping
        if (!opts.ref) {
          console.error("❌ Error: --ref is required when not using --create-mapping");
          console.error();
          console.error("Usage:");
          console.error("  lex-pr gate import-checks --ref <ref>");
          console.error("  lex-pr gate import-checks --create-mapping");
          throwExit(1);
        }

        const ref = opts.ref;
        const itemName = opts.item || ref;
        const outDir = opts.outDir;
        const mappingPath = opts.mapping;
        const owner = opts.owner;
        const repo = opts.repo;
        const token = opts.token;

        // Load gate mapping configuration
        let mappingConfig: GateMappingConfig;
        try {
          mappingConfig = loadGateMappingConfig(mappingPath);
          console.log(`📋 Loaded gate mapping configuration from: ${mappingPath}`);
        } catch (error) {
          console.log(`⚠️  Using default gate mappings (no config file found at ${mappingPath})`);
          console.log(`   Run with --create-mapping to create a default configuration file.`);
          mappingConfig = {
            version: "1.0.0",
            mappings: [],
          };
          // Import defaults
          const { DEFAULT_GATE_MAPPINGS } = await import("../schema/gateMapping.js");
          mappingConfig.mappings = DEFAULT_GATE_MAPPINGS;
        }

        // Create GitHub client
        let githubClient: GitHubClient;
        try {
          githubClient = await createGitHubClient({
            token,
            owner,
            repo,
          });
          console.log(
            `🔗 Connected to GitHub: ${githubClient.getOwner()}/${githubClient.getRepo()}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ Failed to connect to GitHub: ${message}`);
          console.error();
          console.error("Make sure you have:");
          console.error("  - Set GITHUB_TOKEN environment variable, or");
          console.error("  - Provided --token flag, or");
          console.error("  - Provided --owner and --repo flags if auto-detection fails");
          throwExit(1);
        }

        // Resolve ref to commit SHA if it's a PR number
        let commitRef = ref;
        if (/^\d+$/.test(ref)) {
          // Ref is a PR number, get the head SHA
          console.log(`🔍 Resolving PR #${ref} to commit SHA...`);
          try {
            const prDetails = await githubClient.getPRDetails(parseInt(ref, 10));
            commitRef = prDetails.head.sha;
            console.log(`   → Commit: ${commitRef}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`❌ Failed to get PR details: ${message}`);
            throwExit(1);
          }
        }

        // Fetch check runs from GitHub
        console.log(`🔍 Fetching check runs for ref: ${commitRef}...`);
        let checks;
        try {
          checks = await githubClient.getCheckRuns(commitRef, {
            filter: "latest",
          });
          console.log(`   Found ${checks.length} check runs`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ Failed to fetch check runs: ${message}`);
          throwExit(1);
        }

        // Filter to completed checks
        const completedChecks = checks.filter((check) => check.status === "completed");
        console.log(`   ${completedChecks.length} completed checks`);

        if (completedChecks.length === 0) {
          console.log();
          console.log("⚠️  No completed check runs found.");
          console.log("   Check runs must be completed before they can be imported.");
          return;
        }

        // Convert check runs to gate results
        const gateResults = convertCheckRunsToGateResults(completedChecks, mappingConfig);
        console.log(`   Mapped to ${gateResults.length} gate results`);

        if (gateResults.length === 0) {
          console.log();
          console.log("⚠️  No check runs matched gate mappings.");
          console.log(`   Edit ${mappingPath} to add mappings for your CI check names.`);
          console.log(`   Or run with --create-mapping to create a default configuration.`);
          return;
        }

        // Ensure output directory exists
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        // Write gate results to files
        console.log();
        console.log(`💾 Saving gate results to: ${outDir}`);
        for (const result of gateResults) {
          // Skip saving gates with 'skipped' status - GateReport only accepts pass/fail
          if (result.status === "skipped") {
            console.log(`   ⊘ ${result.gate}: skipped (not saved)`);
            continue;
          }

          const gateReport: GateReport = {
            schemaVersion: "1.0.0",
            item: itemName,
            gate: result.gate,
            status: result.status as "pass" | "fail",
            duration_ms: result.duration || 0,
            started_at: new Date().toISOString(), // Use current time since we don't have the actual start time
            meta: {
              source: "github-checks",
              check_url: result.artifacts?.[0] || "",
              completed_at: result.lastAttempt || "",
            },
          };

          const filename = `${itemName}-${result.gate}.json`;
          const filepath = path.join(outDir, filename);
          fs.writeFileSync(filepath, JSON.stringify(gateReport, null, 2), "utf-8");

          const statusIcon = result.status === "pass" ? "✅" : "❌";
          console.log(`   ${statusIcon} ${result.gate}: ${result.status} (${filename})`);
        }

        console.log();
        console.log(`✅ Imported ${gateResults.length} gate results from GitHub check runs`);
        console.log("💡 These gate results are now available for merge eligibility evaluation.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Import failed: ${message}`);
        if (error instanceof Error && error.stack) {
          console.error(error.stack);
        }
        throwExit(1);
      }
    });
}
