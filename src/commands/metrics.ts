/**
 * Metrics command - Export governance metrics in various formats
 *
 * Provides observability for the governance model including:
 * - Turn Cost trends
 * - Tier distribution
 * - Failure rates
 * - Budget consumption
 */

import { Command } from "commander";
import {
  createMetricsCollector,
  getGlobalMetricsCollector,
  type MetricsSnapshot,
} from "../metrics/export.js";
import { writeJsonOutput } from "../cli/output.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { throwExit } from "../cli/exitHandler.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Options for the metrics command
 */
interface MetricsCommandOptions {
  jsonModeActive: () => boolean;
}

/**
 * Register the metrics command with the CLI program
 */
export function registerMetricsCommand(program: Command, options: MetricsCommandOptions): void {
  const metricsCmd = program
    .command("metrics")
    .description(
      "Export governance metrics in Prometheus or JSON format for observability dashboards"
    )
    .addHelpText(
      "after",
      `
Examples:
  $ lex-pr metrics                          # Show current metrics as JSON
  $ lex-pr metrics --prometheus             # Export in Prometheus format
  $ lex-pr metrics --filter turn_cost       # Filter specific metrics
  $ lex-pr metrics --output metrics.json    # Save metrics to file

Metrics Provided:
  lex_turn_cost_total      Total Turn Cost from merge-weave operations
  lex_tier_distribution    Task distribution by capability tier
  lex_failure_rate         Gate failure rate (0-1)
  lex_budget_remaining     Remaining tokens and prompts

Dashboard Integration:
  Prometheus: lex-pr metrics --prometheus > /metrics
  Grafana:    Use JSON output with custom data source`
    );

  // Main metrics command - show all metrics as JSON
  metricsCmd
    .option("--prometheus", "Export in Prometheus text format")
    .option("--filter <pattern>", "Filter metrics by name pattern")
    .option("--output <file>", "Write metrics to file")
    .option("--from-artifacts <dir>", "Load metrics from artifacts directory")
    .action(async (opts) => {
      try {
        let collector = getGlobalMetricsCollector();

        // Load from artifacts if specified
        if (opts.fromArtifacts) {
          const artifactsDir = opts.fromArtifacts;
          collector = await loadMetricsFromArtifacts(artifactsDir);
        }

        // Get snapshot (optionally filtered)
        let snapshot: MetricsSnapshot;
        if (opts.filter) {
          snapshot = collector.getMetricsByName(opts.filter);
        } else {
          snapshot = collector.getSnapshot();
        }

        // Format output
        let output: string;
        if (opts.prometheus) {
          output = collector.exportPrometheus();
        } else {
          output = canonicalJSONStringify(snapshot);
        }

        // Write to file or stdout
        if (opts.output) {
          fs.writeFileSync(opts.output, output);
          if (!options.jsonModeActive()) {
            console.log(`Metrics written to ${opts.output}`);
          }
        } else {
          console.log(output);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error exporting metrics: ${message}`);
        throwExit(1);
      }
    });

  // Subcommand: metrics show - same as default
  metricsCmd
    .command("show")
    .description("Display current metrics snapshot")
    .option("--prometheus", "Export in Prometheus text format")
    .option("--filter <pattern>", "Filter metrics by name pattern")
    .action((opts) => {
      try {
        const collector = getGlobalMetricsCollector();

        let snapshot: MetricsSnapshot;
        if (opts.filter) {
          snapshot = collector.getMetricsByName(opts.filter);
        } else {
          snapshot = collector.getSnapshot();
        }

        if (opts.prometheus) {
          console.log(collector.exportPrometheus());
        } else {
          writeJsonOutput(snapshot);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error showing metrics: ${message}`);
        throwExit(1);
      }
    });

  // Subcommand: metrics definitions - show available metrics
  metricsCmd
    .command("definitions")
    .description("Show available metric definitions")
    .action(() => {
      const { METRIC_DEFINITIONS } = require("../metrics/export.js");
      if (options.jsonModeActive()) {
        writeJsonOutput(METRIC_DEFINITIONS);
      } else {
        console.log("\nAvailable Governance Metrics:\n");
        for (const [name, def] of Object.entries(METRIC_DEFINITIONS)) {
          const definition = def as {
            name: string;
            type: string;
            help: string;
            labels?: string[];
          };
          console.log(`  ${definition.name}`);
          console.log(`    Type:   ${definition.type}`);
          console.log(`    Help:   ${definition.help}`);
          if (definition.labels && definition.labels.length > 0) {
            console.log(`    Labels: ${definition.labels.join(", ")}`);
          }
          console.log("");
        }
      }
    });
}

/**
 * Load metrics from an artifacts directory
 */
async function loadMetricsFromArtifacts(
  artifactsDir: string
): Promise<ReturnType<typeof createMetricsCollector>> {
  const collector = createMetricsCollector();

  // Look for execution results
  const resultsPath = path.join(artifactsDir, "execution-results.json");
  if (fs.existsSync(resultsPath)) {
    try {
      const results = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));

      // Extract failure rate from gate results
      if (results.gates) {
        let failures = 0;
        let total = 0;
        for (const gate of results.gates) {
          total++;
          if (gate.status === "fail" || gate.status === "error") {
            failures++;
          }
        }
        collector.recordFailureRate(failures, total);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Look for tier assignments
  const tiersPath = path.join(artifactsDir, "tier-assignments.json");
  if (fs.existsSync(tiersPath)) {
    try {
      const tiers = JSON.parse(fs.readFileSync(tiersPath, "utf-8"));
      if (tiers.metrics) {
        collector.recordTierDistribution(tiers.metrics);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Look for budget summary
  const budgetPath = path.join(artifactsDir, "budget-summary.json");
  if (fs.existsSync(budgetPath)) {
    try {
      const budget = JSON.parse(fs.readFileSync(budgetPath, "utf-8"));
      collector.recordBudgetRemaining(budget);
    } catch {
      // Ignore parse errors
    }
  }

  // Look for turn cost summary
  const turnCostPath = path.join(artifactsDir, "turn-cost.json");
  if (fs.existsSync(turnCostPath)) {
    try {
      const turnCost = JSON.parse(fs.readFileSync(turnCostPath, "utf-8"));
      collector.recordTurnCost(turnCost);
    } catch {
      // Ignore parse errors
    }
  }

  return collector;
}
