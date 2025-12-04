/**
 * CLI command: orchestrate:predict-conflicts
 * Predict merge conflicts using conflict graphs, MIS, and git merge-tree
 */

import { Command } from "commander";
import { predictConflicts } from "../../orchestration/index.js";
import type { PRWithFiles } from "../../orchestration/index.js";
import { writeJsonOutput } from "../../cli/output.js";
import chalk from "chalk";

interface PredictConflictsOptions {
	prs?: string;
	base?: string;
	skipMergeTree?: boolean;
	enableClustering?: boolean;
	writeWeaveConflicts?: boolean;
	json?: boolean;
}

/**
 * Register the orchestrate:predict-conflicts command
 */
export function registerPredictConflictsCommand(
	program: Command,
	jsonModeActive: () => boolean
): void {
	program
		.command("orchestrate:predict-conflicts")
		.description(
			"Predict merge conflicts using conflict graphs and MIS computation (canonical: lex-pr weave analyze)"
		)
		.option(
			"--prs <numbers>",
			"Comma-separated list of PR numbers (e.g., 166,167,168)"
		)
		.option("--base <branch>", "Base branch for conflict analysis", "main")
		.option("--skip-merge-tree", "Skip git merge-tree simulation")
		.option(
			"--enable-clustering",
			"Enable conflict clustering by file and symbol"
		)
		.option(
			"--write-weave-conflicts",
			"Write clustered conflicts to .weave/conflicts.json"
		)
		.option("--json", "Output JSON format")
		.action(async (options: PredictConflictsOptions) => {
			try {
				const useJson = options.json || jsonModeActive();

				// Parse PR numbers
				if (!options.prs) {
					if (useJson) {
						writeJsonOutput({ error: "--prs flag is required" });
					} else {
						console.error("Error: --prs flag is required");
					}
					process.exit(1);
				}

				const prNumbers = options.prs.split(",").map((n) => n.trim());

				// For now, create mock PR data (in real usage, fetch from GitHub)
				const prs: PRWithFiles[] = prNumbers.map((num) => ({
					number: parseInt(num),
					files: [],
					head: `pr-${num}-head`,
				}));

				// TODO: Add GitHub API integration to fetch actual file lists
				// This would require proper authentication and be done in a follow-up enhancement

				// Create PR heads map
				const prHeads = new Map<string, string>();
				prs.forEach((pr) => {
					if (pr.head) {
						prHeads.set(String(pr.number), pr.head);
					}
				});

				// Predict conflicts
				const report = await predictConflicts({
					prs,
					baseBranch: options.base || "main",
					prHeads: options.skipMergeTree ? undefined : prHeads,
					skipMergeTreeSimulation: options.skipMergeTree,
					enableClustering: options.enableClustering,
					writeWeaveConflicts: options.writeWeaveConflicts,
				});

				// Output
				if (useJson) {
					writeJsonOutput(report);
				} else {
					printHumanReadableReport(report);
				}
			} catch (error) {
				const useJsonError = options.json || jsonModeActive();
				if (useJsonError) {
					writeJsonOutput({
						error:
							error instanceof Error
								? error.message
								: String(error),
					});
				} else {
					console.error("Error predicting conflicts:", error);
				}
				process.exit(1);
			}
		});
}

/**
 * Print human-readable conflict report
 */
function printHumanReadableReport(report: any): void {
	console.log(chalk.bold("\n🔍 Conflict Analysis\n"));
	console.log(chalk.bold("=".repeat(60)));

	// Conflict Graph
	console.log(chalk.bold("\n📊 Conflict Graph:"));
	if (report.conflictGraph.edges.length === 0) {
		console.log(
			chalk.green(
				"  ✓ No conflicts detected - all PRs can merge in parallel"
			)
		);
	} else {
		for (const edge of report.conflictGraph.edges) {
			const files = edge.sharedFiles.slice(0, 3).join(", ");
			const more =
				edge.sharedFiles.length > 3
					? ` (+${edge.sharedFiles.length - 3} more)`
					: "";
			console.log(`  - #${edge.from} ↔ #${edge.to}: ${files}${more}`);
		}
	}

	// MIS Batches
	console.log(chalk.bold("\n🔀 MIS Batches (safe parallel groups):"));
	for (const batch of report.misBatches) {
		const prs = batch.prs.map((n: string) => `#${n}`).join(", ");
		console.log(`  - ${batch.id}: [${prs}]`);
		console.log(`    ${chalk.gray(batch.reason)}`);
	}

	// Merge-tree Simulation
	if (Object.keys(report.mergeTreeSimulation).length > 0) {
		console.log(chalk.bold("\n🧪 git merge-tree Simulation:"));
		for (const [pair, result] of Object.entries(
			report.mergeTreeSimulation
		)) {
			const [pr1, pr2] = pair.split("-");
			const status =
				(result as any).status === "clean"
					? chalk.green("✅ Clean merge")
					: chalk.red("❌ Conflict");
			console.log(`  - #${pr1} + #${pr2}: ${status}`);

			if (
				(result as any).status === "conflict" &&
				(result as any).conflicts.length > 0
			) {
				for (const conflict of (result as any).conflicts) {
					console.log(
						`    ${chalk.yellow(
							`↳ ${conflict.file} (${conflict.type})`
						)}`
					);
				}
			}
		}
	}

	// Recommendations
	console.log(chalk.bold("\n💡 Recommendations:"));
	if (report.recommendations.safeBatch.length > 0) {
		const prs = report.recommendations.safeBatch
			.map((n: string) => `#${n}`)
			.join(", ");
		console.log(chalk.green(`  ✓ Safe parallel batch: ${prs}`));
	}
	if (report.recommendations.sequential.length > 0) {
		const prs = report.recommendations.sequential
			.map((n: string) => `#${n}`)
			.join(", ");
		console.log(chalk.yellow(`  ⚠ Merge sequentially: ${prs}`));
	}

	// Clustered Conflicts (if available)
	if (report.clusteredReport) {
		console.log(chalk.bold("\n🔬 Conflict Clustering Analysis:"));
		console.log(
			chalk.gray(
				`  Analyzed ${report.clusteredReport.summary.totalClusters} conflict cluster(s) across ${report.clusteredReport.summary.fileCount} file(s)`
			)
		);
		console.log(
			chalk.gray(
				`  Affected ${report.clusteredReport.summary.symbolCount} symbol(s)`
			)
		);

		if (report.clusteredReport.clusters.length > 0) {
			console.log(chalk.bold("\n  Top Conflict Clusters:"));

			// Show up to 5 clusters
			const topClusters = report.clusteredReport.clusters.slice(0, 5);
			for (const cluster of topClusters) {
				const typeIcon =
					cluster.conflictType === "rename"
						? "🔄"
						: cluster.conflictType === "whitespace"
						? "⎵"
						: cluster.conflictType === "mixed"
						? "🔀"
						: "⚠️";

				console.log(
					`  ${typeIcon} ${cluster.file} (${cluster.conflictType})`
				);
				console.log(
					chalk.gray(`    Lines: ${cluster.details.lineRange}`)
				);

				if (cluster.symbols.length > 0) {
					const symbolList = cluster.symbols.slice(0, 3).join(", ");
					const more =
						cluster.symbols.length > 3
							? ` (+${cluster.symbols.length - 3} more)`
							: "";
					console.log(
						chalk.gray(`    Symbols: ${symbolList}${more}`)
					);
				}
			}

			if (report.clusteredReport.clusters.length > 5) {
				console.log(
					chalk.gray(
						`  ... and ${
							report.clusteredReport.clusters.length - 5
						} more cluster(s)`
					)
				);
			}
		}

		// Show conflict type breakdown
		console.log(chalk.bold("\n  Conflict Type Breakdown:"));
		for (const [type, count] of Object.entries(
			report.clusteredReport.summary.conflictTypes
		)) {
			console.log(`    - ${type}: ${count}`);
		}
	}

	console.log();
}
