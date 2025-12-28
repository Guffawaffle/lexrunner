import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { GateReport, safeValidateGateReport } from "../schema/gateReport.js";

/**
 * Gate aggregation result for an item
 */
export interface ItemGates {
  item: string;
  gates: GateReport[];
}

/**
 * Aggregated report result with stable ordering
 */
export interface AggregatedReport {
  items: ItemGates[];
  allGreen: boolean;
  levels?: string[][];
}

/**
 * Read gate directory and produce aggregated report with stable ordering
 * @param dir Directory containing *.json gate result files
 * @returns Aggregated report with stable, deterministic output
 */
export function readGateDir(dir: string): AggregatedReport {
  if (!fs.existsSync(dir)) {
    throw new Error(`Gate directory does not exist: ${dir}`);
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dir}`);
  }

  // Read all JSON files from directory
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort(); // Stable file ordering

  const gateReports: GateReport[] = [];
  const validationErrors: string[] = [];

  // Parse and validate each JSON file
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(content);

      const validation = safeValidateGateReport(data);
      if (validation.success) {
        gateReports.push(validation.data);
      } else {
        // validation.success is false, so error property exists
        const errorResult = validation as { success: false; error: z.ZodError };
        validationErrors.push(`${file}: ${errorResult.error.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      validationErrors.push(`${file}: ${message}`);
    }
  }

  // If there are validation errors, throw with details
  if (validationErrors.length > 0) {
    throw new Error(`Validation errors in gate reports:\n${validationErrors.join("\n")}`);
  }

  // Group by item with stable ordering
  const itemMap = new Map<string, GateReport[]>();

  for (const report of gateReports) {
    if (!itemMap.has(report.item)) {
      itemMap.set(report.item, []);
    }
    itemMap.get(report.item)!.push(report);
  }

  // Sort items by name for stable output
  const sortedItems = Array.from(itemMap.keys()).sort();

  const items: ItemGates[] = sortedItems.map((itemName) => ({
    item: itemName,
    gates: itemMap.get(itemName)!.sort((a, b) => {
      // Sort gates by gate name for stable ordering
      return a.gate.localeCompare(b.gate);
    }),
  }));

  // Determine if all gates are green (all pass)
  const allGreen = gateReports.every((report) => report.status === "pass");

  return {
    items,
    allGreen,
    // levels is optional - would be computed from dependency graph if available
    levels: undefined,
  };
}

/**
 * Generate markdown summary from aggregated report
 */
export function generateMarkdownSummary(report: AggregatedReport): string {
  const lines: string[] = [];

  lines.push("# Gate Report Summary");
  lines.push("");

  // Overall status
  const statusIcon = report.allGreen ? "✅" : "❌";
  const statusText = report.allGreen ? "All gates passed" : "Some gates failed";
  lines.push(`**Status**: ${statusIcon} ${statusText}`);
  lines.push("");

  // Summary stats
  const totalItems = report.items.length;
  const totalGates = report.items.reduce((sum, item) => sum + item.gates.length, 0);
  const passedGates = report.items.reduce(
    (sum, item) => sum + item.gates.filter((gate) => gate.status === "pass").length,
    0
  );
  const failedGates = totalGates - passedGates;

  lines.push(`**Summary**: ${totalItems} items, ${totalGates} gates total`);
  lines.push(`- ✅ Passed: ${passedGates}`);
  lines.push(`- ❌ Failed: ${failedGates}`);
  lines.push("");

  // Per-item details
  lines.push("## Items");
  lines.push("");

  for (const item of report.items) {
    const itemPassed = item.gates.every((gate) => gate.status === "pass");
    const itemIcon = itemPassed ? "✅" : "❌";

    lines.push(`### ${itemIcon} ${item.item}`);
    lines.push("");

    if (item.gates.length === 0) {
      lines.push("*No gates defined*");
    } else {
      lines.push("| Gate | Status | Duration |");
      lines.push("|------|--------|----------|");

      for (const gate of item.gates) {
        const statusIcon = gate.status === "pass" ? "✅" : "❌";
        lines.push(`| ${gate.gate} | ${statusIcon} ${gate.status} | ${gate.duration_ms}ms |`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
