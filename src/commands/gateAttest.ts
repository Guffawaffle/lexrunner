/**
 * Gate attestation command - Manually attest gate results from external runs
 */

import { Command } from "commander";
import { throwExit } from "../cli/exitHandler.js";
import { GateReport } from "../schema/gateReport.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Register the gate attest command
 */
export function registerGateAttestCommand(program: Command): void {
  program
    .command("attest")
    .description("Attest that gates have passed for a PR/item (manual verification)")
    .requiredOption("--item <name>", "Item name (e.g., PR number or branch name)")
    .requiredOption("--gates <names>", "Comma-separated list of gate names to attest")
    .option("--status <status>", "Gate status (pass or fail)", "pass")
    .option("--reason <reason>", "Reason for attestation (required for manual override)")
    .option("--out-dir <dir>", "Output directory for gate results", ".smartergpt/gate-results")
    .option("--duration <ms>", "Duration in milliseconds", "0")
    .action(async (opts) => {
      try {
        const itemName = opts.item;
        const gateNames = opts.gates.split(",").map((g: string) => g.trim());
        const status = opts.status as "pass" | "fail";
        const reason = opts.reason as string | undefined;
        const outDir = opts.outDir;
        const duration = parseInt(opts.duration, 10);

        // Validate status
        if (status !== "pass" && status !== "fail") {
          console.error(`Invalid status: ${status}. Must be 'pass' or 'fail'.`);
          throwExit(1);
        }

        // Require reason for manual attestation
        if (!reason) {
          console.error(
            "❌ Error: --reason is required for manual attestation to maintain audit trail"
          );
          console.error("Example: --reason 'Verified manually in terminal'");
          throwExit(1);
        }

        // Ensure output directory exists
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        const startedAt = new Date().toISOString();
        const createdFiles: string[] = [];

        // Create a gate result file for each gate
        for (const gateName of gateNames) {
          const gateReport: GateReport = {
            schemaVersion: "1.0.0",
            item: itemName,
            gate: gateName,
            status,
            duration_ms: duration,
            started_at: startedAt,
            meta: {
              attestation: "manual",
              reason,
              attested_by: process.env.USER || "unknown",
              attested_at: startedAt,
            },
          };

          // Write gate result file
          const filename = `${itemName}-${gateName}.json`;
          const filepath = path.join(outDir, filename);
          fs.writeFileSync(filepath, JSON.stringify(gateReport, null, 2), "utf-8");
          createdFiles.push(filepath);
        }

        console.log(`✅ Attested ${gateNames.length} gate(s) for item '${itemName}'`);
        console.log(`   Status: ${status}`);
        console.log(`   Reason: ${reason}`);
        console.log(`   Files created:`);
        for (const file of createdFiles) {
          console.log(`     - ${file}`);
        }
        console.log();
        console.log("💡 These gate results are now available for merge eligibility evaluation.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Attestation failed: ${message}`);
        throwExit(1);
      }
    });
}
