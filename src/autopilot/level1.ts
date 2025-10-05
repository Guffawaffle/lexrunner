/**
 * Autopilot Level 1 - Artifact Writers (JSON/MD deliverables)
 * Extends Level 0 with artifact generation to .smartergpt/deliverables/
 */

import { AutopilotLevel0, AutopilotResult } from "./base.js";
import {
	ArtifactWriter,
	AnalysisData,
	GatePrediction,
	ConflictPrediction
} from "./artifacts.js";
import { DeliverablesManager } from "./deliverables.js";
import * as path from "path";

/**
 * Level 1 autopilot - Artifact generation
 * Generates structured JSON and Markdown deliverables
 */
export class AutopilotLevel1 extends AutopilotLevel0 {
	getLevel(): number {
		return 1;
	}

	async execute(customDeliverablesDir?: string): Promise<AutopilotResult> {
		try {
			const plan = this.context.plan;
			const mergeOrder = this.computeMergeOrder();
			const recommendations = this.generateRecommendations();

			// Get runner version
			const runnerVersion = this.getRunnerVersion();

			// Generate timestamp for this execution
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");

			// Initialize deliverables manager
			const deliverables = new DeliverablesManager(
				this.context.profilePath,
				customDeliverablesDir
			);

			// Create deliverables directory with manifest
			const deliverableDir = await deliverables.createDeliverables(
				plan,
				this.getLevel(),
				runnerVersion,
				timestamp
			);

			// Create artifact writer with same timestamp
			const writer = new ArtifactWriter(
				this.context.profilePath,
				this.context.profileRole,
				timestamp,
				customDeliverablesDir
			);

			// Initialize output directory (validates write permissions)
			await writer.initialize();

			// Generate analysis data
			const analysisData: AnalysisData = {
				schemaVersion: "1.0.0",
				timestamp: new Date().toISOString(),
				plan: {
					nodes: plan.items,
					policy: plan.policy || {}
				},
				mergeOrder,
				conflicts: this.predictConflicts(),
				recommendations
			};

			// Generate gate predictions
			const gatePredictions = this.generateGatePredictions();

			// Write all artifacts and register them
			const artifacts: string[] = [];
			
			const analysisPath = await writer.writeAnalysis(analysisData);
			artifacts.push(analysisPath);
			await deliverables.registerArtifact(deliverableDir, analysisPath, "json");

			const reportPath = await writer.writeWeaveReport(plan, mergeOrder, recommendations);
			artifacts.push(reportPath);
			await deliverables.registerArtifact(deliverableDir, reportPath, "markdown");

			const predictionsPath = await writer.writeGatePredictions(gatePredictions);
			artifacts.push(predictionsPath);
			await deliverables.registerArtifact(deliverableDir, predictionsPath, "json");

			const logPath = await writer.writeExecutionLog(plan, mergeOrder);
			artifacts.push(logPath);
			await deliverables.registerArtifact(deliverableDir, logPath, "markdown");

			const metadataPath = await writer.writeMetadata(this.getLevel());
			artifacts.push(metadataPath);
			await deliverables.registerArtifact(deliverableDir, metadataPath, "json");

			// Update latest symlink
			await deliverables.updateLatestSymlink(deliverableDir);

			const message = [
				"Level 1: Artifact generation complete",
				`Generated ${artifacts.length} artifacts in ${writer.getOutputDir()}`,
				"",
				"Artifacts created:",
				...artifacts.map(a => `  - ${a}`),
				"",
				"Deliverables manifest: " + path.join(deliverableDir, "manifest.json"),
				"Latest symlink: " + path.join(deliverables.getDeliverablesRoot(), "latest"),
				"",
				"Next steps:",
				"  - Review weave-report.md for execution recommendations",
				"  - Check gate-predictions.json for expected gate outcomes",
				"  - Use execution-log.md as a manual execution template"
			].join("\n");

			return {
				level: 1,
				success: true,
				message,
				artifacts
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				level: 1,
				success: false,
				message: `Level 1 execution failed: ${errorMessage}`
			};
		}
	}

	/**
	 * Get runner version from package.json
	 */
	private getRunnerVersion(): string {
		try {
			const packageJsonPath = path.resolve(process.cwd(), "package.json");
			const packageJson = JSON.parse(require("fs").readFileSync(packageJsonPath, "utf8"));
			return packageJson.version || "unknown";
		} catch {
			return "unknown";
		}
	}

	/**
	 * Predict potential conflicts based on file overlap analysis
	 * This is a simplified heuristic - Level 2+ will use AST-based analysis
	 */
	private predictConflicts(): ConflictPrediction[] {
		const conflicts: ConflictPrediction[] = [];

		// For now, return empty array - actual conflict detection requires
		// file analysis which is beyond Level 1 scope
		// Future: integrate with diffgraph analyzer

		return conflicts;
	}

	/**
	 * Generate gate predictions based on plan structure
	 */
	private generateGatePredictions(): GatePrediction[] {
		const predictions: GatePrediction[] = [];
		const plan = this.context.plan;

		for (const item of plan.items) {
			for (const gate of item.gates) {
				// Predict pass for all gates by default
				// Actual execution will verify these predictions
				predictions.push({
					item: item.name,
					gate: gate.name,
					expectedStatus: "pass",
					reason: "Gate defined in plan - execution required for verification"
				});
			}

			// If no gates defined, add a note
			if (item.gates.length === 0) {
				predictions.push({
					item: item.name,
					gate: "none",
					expectedStatus: "skip",
					reason: "No gates defined for this item"
				});
			}
		}

		return predictions;
	}
}
