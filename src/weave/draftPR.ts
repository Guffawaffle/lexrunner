/**
 * Draft PR creation for failed clusters
 * Opens a draft PR with failure artifacts and diagnostics
 */

import { GitHubAPI } from "../github/api.js";
import { ClusterFailureBundle } from "./clusterGates.js";
import fs from "fs";
import path from "path";

/**
 * Draft PR creation options
 */
export interface DraftPROptions {
	owner: string;
	repo: string;
	baseBranch: string;
	failureBranch: string;
	clusterIndex: number;
	failureBundle: ClusterFailureBundle;
	artifactPaths: string[];
}

/**
 * Result of draft PR creation
 */
export interface DraftPRResult {
	success: boolean;
	prNumber?: number;
	prUrl?: string;
	error?: string;
}

/**
 * Create a draft PR for a failed cluster with artifacts
 */
export async function createDraftPRForFailure(
	githubAPI: GitHubAPI,
	options: DraftPROptions
): Promise<DraftPRResult> {
	const { owner, repo, baseBranch, failureBranch, clusterIndex, failureBundle, artifactPaths } = options;

	try {
		// Generate PR title
		const title = `[DRAFT] Cluster ${clusterIndex} gate failures - ${failureBundle.items.join(", ")}`;

		// Generate PR body with failure details
		const body = generatePRBody(failureBundle, artifactPaths);

		// Create draft PR
		const octokit = githubAPI.getOctokit();
		const response = await octokit.rest.pulls.create({
			owner,
			repo,
			title,
			head: failureBranch,
			base: baseBranch,
			body,
			draft: true,
		});

		console.log(`✅ Draft PR created: ${response.data.html_url}`);

		return {
			success: true,
			prNumber: response.data.number,
			prUrl: response.data.html_url,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`❌ Failed to create draft PR: ${errorMessage}`);
		return {
			success: false,
			error: errorMessage,
		};
	}
}

/**
 * Generate PR body with failure details and artifacts
 */
function generatePRBody(bundle: ClusterFailureBundle, artifactPaths: string[]): string {
	const sections: string[] = [];

	// Header
	sections.push(`## ⚠️ Cluster ${bundle.clusterIndex} Gate Failures`);
	sections.push("");
	sections.push(`This is an automated draft PR created after gate failures during merge-weave execution.`);
	sections.push("");

	// Failure summary
	sections.push(`### 📊 Failure Summary`);
	sections.push("");
	sections.push(`- **Timestamp:** ${bundle.timestamp}`);
	sections.push(`- **Base Branch:** ${bundle.baseBranch}`);
	sections.push(`- **Integration Branch:** ${bundle.integrationBranch}`);
	sections.push(`- **Affected Items:** ${bundle.items.join(", ")}`);
	sections.push(`- **Rollback SHA:** \`${bundle.rollbackSha}\``);
	sections.push("");

	// Failed gates
	sections.push(`### ❌ Failed Gates`);
	sections.push("");
	sections.push("| Item | Gate | Exit Code | Error |");
	sections.push("|------|------|-----------|-------|");
	for (const failure of bundle.failedGates) {
		const exitCode = failure.exitCode !== undefined ? failure.exitCode : "N/A";
		const error = failure.stderr ? truncateString(failure.stderr, 100) : "See artifacts";
		sections.push(`| ${failure.item} | ${failure.gate} | ${exitCode} | ${error} |`);
	}
	sections.push("");

	// Artifacts
	sections.push(`### 📦 Artifacts`);
	sections.push("");
	sections.push(`The following artifacts have been stored in the \`.weave/\` directory:`);
	sections.push("");
	for (const artifactPath of artifactPaths) {
		const relativePath = path.relative(process.cwd(), artifactPath);
		sections.push(`- \`${relativePath}\``);
	}
	sections.push("");

	// Merge patch diff preview
	if (bundle.mergePatchDiff) {
		sections.push(`### 🔍 Merge Patch Diff Preview`);
		sections.push("");
		sections.push("```diff");
		sections.push(truncateString(bundle.mergePatchDiff, 2000));
		sections.push("```");
		sections.push("");
		sections.push(`Full diff available in \`.weave/cluster-${bundle.clusterIndex}-merge-patch.diff\``);
		sections.push("");
	}

	// Next steps
	sections.push(`### 🔧 Next Steps`);
	sections.push("");
	sections.push(`1. Review the failed gate logs in the \`.weave/\` directory`);
	sections.push(`2. Fix the issues in the affected PRs`);
	sections.push(`3. Re-run the merge-weave workflow`);
	sections.push(`4. Close this draft PR once resolved`);
	sections.push("");

	// Rollback instructions
	sections.push(`### ↩️ Rollback`);
	sections.push("");
	sections.push(`The cluster changes have already been rolled back to \`${bundle.rollbackSha}\`.`);
	sections.push(`No additional rollback action is needed.`);
	sections.push("");

	return sections.join("\n");
}

/**
 * Truncate string with ellipsis
 */
function truncateString(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str;
	}
	return str.substring(0, maxLength) + "...";
}

/**
 * Push failure branch to remote for PR creation
 */
export async function pushFailureBranch(
	branchName: string,
	workingDir: string = process.cwd()
): Promise<boolean> {
	try {
		const { simpleGit } = await import("simple-git");
		const git = simpleGit(workingDir);
		await git.push("origin", branchName, ["--force"]);
		console.log(`✅ Pushed failure branch: ${branchName}`);
		return true;
	} catch (error) {
		console.error(
			`❌ Failed to push failure branch: ${error instanceof Error ? error.message : String(error)}`
		);
		return false;
	}
}

/**
 * Create a failure branch from current state
 */
export async function createFailureBranch(
	clusterIndex: number,
	workingDir: string = process.cwd()
): Promise<string | null> {
	try {
		const { simpleGit } = await import("simple-git");
		const git = simpleGit(workingDir);
		
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const branchName = `weave/cluster-${clusterIndex}-failure-${timestamp}`;

		await git.checkoutLocalBranch(branchName);
		console.log(`✅ Created failure branch: ${branchName}`);
		return branchName;
	} catch (error) {
		console.error(
			`❌ Failed to create failure branch: ${error instanceof Error ? error.message : String(error)}`
		);
		return null;
	}
}
