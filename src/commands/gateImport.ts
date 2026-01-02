/**
 * Gate import command - Import gate results from external sources
 */

import { Command } from "commander";
import { throwExit } from "../cli/exitHandler.js";
import { GateReport, validateGateReport } from "../schema/gateReport.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Register the gate import command
 */
export function registerGateImportCommand(program: Command): void {
  program
    .command("import")
    .description("Import gate results from external JSON files or logs")
    .requiredOption("--item <name>", "Item name (e.g., PR number or branch name)")
    .requiredOption("--gate <name>", "Gate name")
    .requiredOption("--status <status>", "Gate status (pass or fail)")
    .option("--input <file>", "Input file to import (gate result JSON or log file)")
    .option("--duration <ms>", "Duration in milliseconds", "0")
    .option("--out-dir <dir>", "Output directory for gate results", ".smartergpt/gate-results")
    .option("--log <file>", "Path to log file to attach (optional)")
    .option("--meta <json>", "Additional metadata as JSON string (optional)")
    .action(async (opts) => {
      try {
        const itemName = opts.item;
        const gateName = opts.gate;
        const status = opts.status as "pass" | "fail";
        const inputFile = opts.input as string | undefined;
        const duration = parseInt(opts.duration, 10);
        const outDir = opts.outDir;
        const logFile = opts.log as string | undefined;
        const metaJson = opts.meta as string | undefined;

        // Validate status
        if (status !== "pass" && status !== "fail") {
          console.error(`Invalid status: ${status}. Must be 'pass' or 'fail'.`);
          throwExit(1);
        }

        let gateReport: GateReport;

        // If input file is provided, try to read it as a gate result JSON
        if (inputFile) {
          if (!fs.existsSync(inputFile)) {
            console.error(`Input file not found: ${inputFile}`);
            throwExit(1);
          }

          try {
            const content = fs.readFileSync(inputFile, "utf-8");
            const data = JSON.parse(content);

            // Validate the input as a gate report
            gateReport = validateGateReport(data);

            // Override item/gate/status if provided on command line
            gateReport.item = itemName;
            gateReport.gate = gateName;
            gateReport.status = status;

            console.log(`✅ Imported gate result from: ${inputFile}`);
          } catch (error) {
            console.error(`Failed to parse input file as gate report JSON: ${inputFile}`);
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
            throwExit(1);
          }
        } else {
          // Create a new gate report from command-line arguments
          const startedAt = new Date().toISOString();
          const meta: Record<string, string> = {
            source: "imported",
            imported_at: startedAt,
          };

          // Parse additional metadata if provided
          if (metaJson) {
            try {
              const additionalMeta = JSON.parse(metaJson);
              Object.assign(meta, additionalMeta);
            } catch (error) {
              console.error(`Invalid JSON in --meta: ${metaJson}`);
              throwExit(1);
            }
          }

          gateReport = {
            schemaVersion: "1.0.0",
            item: itemName,
            gate: gateName,
            status,
            duration_ms: duration,
            started_at: startedAt,
            meta,
          };
        }

        // Attach log file if provided
        if (logFile) {
          if (!fs.existsSync(logFile)) {
            console.error(`Log file not found: ${logFile}`);
            throwExit(1);
          }

          // Copy log file to output directory
          const logFilename = `${itemName}-${gateName}.log`;
          const logDestPath = path.join(outDir, logFilename);

          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
          }

          fs.copyFileSync(logFile, logDestPath);
          gateReport.stdout_path = logDestPath;
          console.log(`📄 Attached log file: ${logDestPath}`);
        }

        // Ensure output directory exists
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        // Write gate result file
        const filename = `${itemName}-${gateName}.json`;
        const filepath = path.join(outDir, filename);
        fs.writeFileSync(filepath, JSON.stringify(gateReport, null, 2), "utf-8");

        console.log(`✅ Imported gate result for '${itemName}' - '${gateName}'`);
        console.log(`   Status: ${status}`);
        console.log(`   Duration: ${duration}ms`);
        console.log(`   Output: ${filepath}`);
        console.log();
        console.log("💡 This gate result is now available for merge eligibility evaluation.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Import failed: ${message}`);
        throwExit(1);
      }
    });
}
