/**
 * CLI command for orchestrate:generate-deliverables
 * Generates structured deliverables with plan hashing and toolchain manifests
 */

import { Command } from "commander";
import * as path from "path";
import { generateDeliverables } from "../../orchestration/deliverablesGenerator.js";

export function registerGenerateDeliverablesCommand(program: Command): void {
	program
		.command("orchestrate:generate-deliverables")
		.description(
			"Generate merge-weave deliverables with plan hash and toolchain manifest (canonical: lex-pr weave report)"
		)
		.option("--batch <batchId>", "Batch identifier (e.g., batch3)")
		.option("--plan <path>", "Path to plan.json file", "plan.json")
		.option("--output-dir <path>", "Output directory for deliverables")
		.action(async (options) => {
			try {
				// Validate required options
				if (!options.batch) {
					console.error("❌ Error: --batch is required");
					console.error(
						"Example: lex-pr orchestrate:generate-deliverables --batch batch3 --plan plan.json"
					);
					process.exit(1);
				}

				// Determine output directory
				const outputDir =
					options.outputDir ||
					path.join(
						".smartergpt.local",
						"deliverables",
						options.batch
					);

				// Generate deliverables
				await generateDeliverables({
					batchId: options.batch,
					planPath: options.plan,
					outputDir,
				});

				// Success output
				console.log(`✅ Created: ${path.join(outputDir, "plan.json")}`);
				console.log(
					`✅ Created: ${path.join(outputDir, "plan-hash.txt")}`
				);
				console.log(
					`✅ Created: ${path.join(
						outputDir,
						"toolchain-manifest.json"
					)}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "GATE0_preflight.md")}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "GATE1_assignment.md")}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "GATE2_conflicts.md")}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "GATE3_merge.md")}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "GATE4_gates.md")}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "GATE5_cleanup.md")}`
				);
				console.log(
					`✅ Created: ${path.join(outputDir, "SUMMARY.md")}`
				);
				console.log("");

				// Read and display plan hash
				const fs = await import("fs");
				const planHashContent = fs.readFileSync(
					path.join(outputDir, "plan-hash.txt"),
					"utf-8"
				);
				const planHashMatch =
					planHashContent.match(/SHA256: ([a-f0-9]+)/);
				if (planHashMatch) {
					console.log(`Plan hash: ${planHashMatch[1]}`);
				}
			} catch (error: any) {
				console.error(
					`❌ Error generating deliverables: ${error.message}`
				);
				process.exit(1);
			}
		});
}
