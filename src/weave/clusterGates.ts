/**
 * Cluster-aware gate execution with rollback mechanism
 * Runs gates after each resolved cluster; reverts and opens draft PR on failure
 */

import { Plan, PlanItem, Policy, GateResult } from "../schema.js";
import { ExecutionState } from "../executionState.js";
import { executeItemGates } from "../gates.js";
import { GitOperations, WeaveResult } from "../git/operations.js";
import { emitFailureReceipt } from "../receipts/emit.js";
import fs from "fs";
import path from "path";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { createDraftPRForFailure, createFailureBranch, pushFailureBranch } from "./draftPR.js";
import { createGitHubAPI } from "../github/api.js";

/**
 * Cluster execution context
 */
export interface ClusterContext {
	clusterIndex: number;
	items: PlanItem[];
	baseBranch: string;
	integrationBranch: string;
	weaveDir: string;
}

/**
 * Result of cluster execution including gate results and rollback info
 */
export interface ClusterExecutionResult {
	clusterIndex: number;
	success: boolean;
	gatesPassed: boolean;
	mergeResults: WeaveResult[];
	gateResults: GateResult[];
	rollbackPerformed: boolean;
	rollbackSha?: string;
	artifactsStored: boolean;
	artifactPaths: string[];
	error?: string;
}

/**
 * Cluster failure bundle stored in .weave directory
 */
export interface ClusterFailureBundle {
	clusterIndex: number;
	timestamp: string;
	baseBranch: string;
	integrationBranch: string;
	items: string[];
	failedGates: Array<{
		item: string;
		gate: string;
		status: string;
		exitCode?: number;
		stderr?: string;
	}>;
	mergePatchDiff: string;
	rollbackSha: string;
	artifactPaths: string[];
}

/**
 * Execute gates for a cluster and rollback on failure
 */
export async function executeClusterWithGates(
	cluster: ClusterContext,
	plan: Plan,
	executionState: ExecutionState,
	gitOps: GitOperations,
	options?: {
		skipGates?: boolean;
		timeoutMs?: number;
		runId?: string;
		baseDir?: string;
	}
): Promise<ClusterExecutionResult> {
	const { clusterIndex, items, baseBranch, integrationBranch, weaveDir } = cluster;
	const policy = plan.policy || getDefaultPolicy();
	const timeoutMs = options?.timeoutMs || 30000;

	// Ensure .weave directory exists
	if (!fs.existsSync(weaveDir)) {
		fs.mkdirSync(weaveDir, { recursive: true });
	}

	const result: ClusterExecutionResult = {
		clusterIndex,
		success: false,
		gatesPassed: false,
		mergeResults: [],
		gateResults: [],
		rollbackPerformed: false,
		artifactsStored: false,
		artifactPaths: [],
	};

	try {
		// Capture pre-cluster state for rollback
		const preClusterSha = await gitOps.getCurrentHead();

		// Execute gates for each item in cluster
		if (!options?.skipGates) {
			const clusterArtifactDir = path.join(weaveDir, `cluster-${clusterIndex}`, "gates");
			if (!fs.existsSync(clusterArtifactDir)) {
				fs.mkdirSync(clusterArtifactDir, { recursive: true });
			}

			for (const item of items) {
				const itemGateResults = await executeItemGates(
					item,
					policy,
					executionState,
					clusterArtifactDir,
					timeoutMs,
					false,
					process.cwd(),
					{
						runId: options?.runId,
						baseDir: options?.baseDir,
					}
				);
				result.gateResults.push(...itemGateResults);
			}

			// Check if all gates passed
			const allGatesPassed = result.gateResults.every(
				(gr) => gr.status === "pass" || gr.status === "skipped"
			);
			result.gatesPassed = allGatesPassed;

			// If gates failed, perform rollback
			if (!allGatesPassed) {
				console.error(
					`❌ Cluster ${clusterIndex} gates failed - initiating rollback`
				);

				// Store merge-patch.diff before rollback
				const mergePatchDiff = await captureMergePatchDiff(
					gitOps,
					preClusterSha
				);
				const diffPath = path.join(weaveDir, `cluster-${clusterIndex}-merge-patch.diff`);
				fs.writeFileSync(diffPath, mergePatchDiff, "utf-8");
				result.artifactPaths.push(diffPath);

				// Perform rollback
				await rollbackCluster(gitOps, preClusterSha);
				result.rollbackPerformed = true;
				result.rollbackSha = preClusterSha;

				// Create failure bundle
				const failureBundle = createFailureBundle(
					cluster,
					result.gateResults,
					mergePatchDiff,
					preClusterSha
				);
				const bundlePath = await storeFailureBundle(
					weaveDir,
					clusterIndex,
					failureBundle
				);
				result.artifactPaths.push(bundlePath);
				result.artifactsStored = true;

				// Emit failure receipt
				emitClusterFailureReceipt(cluster, result, failureBundle);

				// Attempt to create draft PR with failure artifacts
				await createDraftPRForClusterFailure(
					cluster,
					result,
					failureBundle,
					options?.baseDir
				);

				result.error = `Gates failed for cluster ${clusterIndex}`;
				return result;
			}
		}

		result.success = true;
		result.gatesPassed = true;
		return result;
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);
		result.error = `Cluster execution failed: ${errorMessage}`;
		console.error(result.error);
		return result;
	}
}

/**
 * Capture merge-patch diff between current state and base
 */
async function captureMergePatchDiff(
	gitOps: GitOperations,
	baseSha: string
): Promise<string> {
	try {
		return await gitOps.getDiff(baseSha, "HEAD");
	} catch (error) {
		console.warn(
			`Failed to capture merge-patch diff: ${error instanceof Error ? error.message : String(error)}`
		);
		return "";
	}
}

/**
 * Rollback cluster changes by resetting to previous state
 */
async function rollbackCluster(
	gitOps: GitOperations,
	targetSha: string
): Promise<void> {
	try {
		await gitOps.resetHard(targetSha);
		console.log(`✅ Rolled back to ${targetSha}`);
	} catch (error) {
		console.error(
			`❌ Rollback failed: ${error instanceof Error ? error.message : String(error)}`
		);
		throw error;
	}
}

/**
 * Create failure bundle with all relevant context
 */
function createFailureBundle(
	cluster: ClusterContext,
	gateResults: GateResult[],
	mergePatchDiff: string,
	rollbackSha: string
): ClusterFailureBundle {
	const failedGates = gateResults
		.filter((gr) => gr.status === "fail")
		.map((gr) => ({
			item: cluster.items.find((i) =>
				i.gates?.some((g) => g.name === gr.gate)
			)?.name || "unknown",
			gate: gr.gate,
			status: gr.status,
			exitCode: gr.exitCode,
			stderr: gr.stderr,
		}));

	return {
		clusterIndex: cluster.clusterIndex,
		timestamp: new Date().toISOString(),
		baseBranch: cluster.baseBranch,
		integrationBranch: cluster.integrationBranch,
		items: cluster.items.map((i) => i.name),
		failedGates,
		mergePatchDiff,
		rollbackSha,
		artifactPaths: [],
	};
}

/**
 * Store failure bundle to .weave directory
 */
async function storeFailureBundle(
	weaveDir: string,
	clusterIndex: number,
	bundle: ClusterFailureBundle
): Promise<string> {
	const bundlePath = path.join(
		weaveDir,
		`cluster-${clusterIndex}-failure-bundle.json`
	);
	const bundleJson = canonicalJSONStringify(bundle);
	fs.writeFileSync(bundlePath, bundleJson, "utf-8");
	console.log(`📦 Failure bundle stored: ${bundlePath}`);
	return bundlePath;
}

/**
 * Emit failure receipt for cluster failure
 */
function emitClusterFailureReceipt(
	cluster: ClusterContext,
	result: ClusterExecutionResult,
	bundle: ClusterFailureBundle
): void {
	const failedGateNames = bundle.failedGates
		.map((fg) => `${fg.item}:${fg.gate}`)
		.join(", ");

	emitFailureReceipt(
		{
			action: `execute cluster ${cluster.clusterIndex} gates`,
			rationale: `Gates failed: ${failedGateNames}`,
			confidence: "high",
			reversibility: "reversible",
			rollbackPath: "Cluster changes rolled back",
			rollbackCommand: `git reset --hard ${result.rollbackSha}`,
			uncertaintyNotes: [
				`Failed gates: ${failedGateNames}`,
				`Artifacts stored in .weave/`,
				`Merge patch diff captured`,
			],
			nextActions: [
				"Review gate failure logs in .weave/ artifacts",
				"Fix issues in PRs and retry cluster",
				"Open draft PR with failure artifacts for review",
			],
			escalationRequired: true,
			escalationReason: `Cluster ${cluster.clusterIndex} gate failures require manual review`,
			phase: "apply",
		},
		{ log: true, json: true }
	);
}

/**
 * Get default policy if none provided
 */
function getDefaultPolicy(): Policy {
	return {
		requiredGates: ["lint", "typecheck", "test"],
		optionalGates: [],
		maxWorkers: 1,
		retries: {},
		overrides: {},
		blockOn: [],
		mergeRule: { type: "strict-required" },
	};
}

/**
 * Create draft PR for cluster failure (best-effort)
 */
async function createDraftPRForClusterFailure(
	cluster: ClusterContext,
	result: ClusterExecutionResult,
	failureBundle: ClusterFailureBundle,
	baseDir?: string
): Promise<void> {
	try {
		// Create failure branch with artifacts committed
		const failureBranch = await createFailureBranch(
			cluster.clusterIndex,
			baseDir || process.cwd()
		);
		
		if (!failureBranch) {
			console.warn("⚠️  Could not create failure branch, skipping draft PR");
			return;
		}

		// Commit artifacts to failure branch
		const { simpleGit } = await import("simple-git");
		const git = simpleGit(baseDir || process.cwd());
		
		// Add .weave directory to git
		await git.add([cluster.weaveDir]);
		await git.commit(`Add cluster ${cluster.clusterIndex} failure artifacts`);

		// Push failure branch
		const pushed = await pushFailureBranch(failureBranch, baseDir || process.cwd());
		if (!pushed) {
			console.warn("⚠️  Could not push failure branch, skipping draft PR");
			return;
		}

		// Create draft PR
		const githubAPI = await createGitHubAPI();
		if (!githubAPI) {
			console.warn("⚠️  GitHub API not available, skipping draft PR");
			return;
		}

		const draftPRResult = await createDraftPRForFailure(githubAPI, {
			owner: githubAPI.config.owner,
			repo: githubAPI.config.repo,
			baseBranch: cluster.baseBranch,
			failureBranch,
			clusterIndex: cluster.clusterIndex,
			failureBundle,
			artifactPaths: result.artifactPaths,
		});

		if (draftPRResult.success) {
			console.log(`✅ Draft PR created: ${draftPRResult.prUrl}`);
		}
	} catch (error) {
		// Best-effort: don't fail the whole operation if draft PR fails
		console.warn(
			`⚠️  Failed to create draft PR: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
