#!/usr/bin/env node
/**
 * Example: Analyze file changes across open PRs
 *
 * Usage:
 *   GITHUB_TOKEN=your_token node examples/analyze-pr-files.js
 *
 * This example demonstrates:
 * 1. Fetching open PRs from a repository
 * 2. Analyzing file changes across PRs
 * 3. Identifying potential conflicts and dependencies
 */

import { createGitHubClient } from "../src/github/client.js";
import { analyzeGitHubPRFiles } from "../src/core/githubPlan.js";

async function main() {
  try {
    // Create GitHub client (auto-detects repo from git remote)
    const client = await createGitHubClient({
      token: process.env.GITHUB_TOKEN,
    });

    // Validate repository access
    const repo = await client.validateRepository();
    console.log(`\nAnalyzing repository: ${repo.url}`);
    console.log(`Default branch: ${repo.defaultBranch}\n`);

    // Fetch open PRs
    const prs = await client.listOpenPRs({ state: "open" });
    console.log(`Found ${prs.length} open PRs`);

    if (prs.length === 0) {
      console.log("No open PRs to analyze");
      return;
    }

    // Get detailed PR information
    const prDetails = await Promise.all(prs.map((pr) => client.getPRDetails(pr.number)));

    console.log("\nAnalyzing file changes...\n");

    // Analyze file changes across PRs
    const analysis = await analyzeGitHubPRFiles(client, prDetails);

    // Display results
    console.log("=== File Intersection Analysis ===\n");

    if (analysis.fileIntersections.length === 0) {
      console.log("No file intersections detected");
    } else {
      for (const intersection of analysis.fileIntersections) {
        console.log(`${intersection.prs.join(" ↔️ ")}`);
        console.log(`  Shared files: ${intersection.files.join(", ")}`);
        console.log(`  Confidence: ${(intersection.confidence * 100).toFixed(0)}%`);
        console.log();
      }
    }

    console.log("\n=== Dependency Suggestions ===\n");

    if (analysis.suggestions.length === 0) {
      console.log("No dependency suggestions");
    } else {
      for (const suggestion of analysis.suggestions) {
        console.log(`${suggestion.from} → ${suggestion.to}`);
        console.log(`  Reason: ${suggestion.reason}`);
        console.log(`  Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`);
        console.log(`  Shared files: ${suggestion.sharedFiles.join(", ")}`);
        console.log();
      }
    }

    console.log("\n=== Potential Conflicts ===\n");

    if (analysis.conflicts.length === 0) {
      console.log("No potential conflicts detected ✅");
    } else {
      for (const conflict of analysis.conflicts) {
        const emoji = conflict.severity === "high" ? "🔴" : "🟡";
        console.log(`${emoji} ${conflict.prs.join(" vs ")}`);
        console.log(`  Severity: ${conflict.severity}`);
        console.log(`  Reason: ${conflict.reason}`);
        console.log(`  Files: ${conflict.files.join(", ")}`);
        console.log();
      }
    }

    console.log("\n=== Summary ===\n");
    console.log(`Total PRs analyzed: ${prDetails.length}`);
    console.log(`File intersections: ${analysis.fileIntersections.length}`);
    console.log(`Dependency suggestions: ${analysis.suggestions.length}`);
    console.log(`Potential conflicts: ${analysis.conflicts.length}`);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
