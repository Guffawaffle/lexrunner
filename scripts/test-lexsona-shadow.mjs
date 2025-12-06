#!/usr/bin/env node
/**
 * LexSona Shadow Governance Smoke Test
 *
 * Run with: node scripts/test-lexsona-shadow.mjs
 */

import {
	getLexSonaConfig,
	isLexSonaEnabled,
	deriveShadowConstraints,
	createGovernanceComparisonLog,
	writeGovernanceLog,
	formatGovernanceLog,
} from "../src/lexsona/index.js";

async function main() {
	console.log("=== LexSona Shadow Governance Smoke Test ===\n");

	// Set up env for testing
	process.env.LEXSONA_MODE = "shadow";
	process.env.LEXSONA_PERSONA = "quality-first_engineering";

	// Step 1: Get config
	const config = getLexSonaConfig();
	console.log("1. Configuration:");
	console.log(`   Mode: ${config.mode}`);
	console.log(`   Persona: ${config.personaId}`);
	console.log(`   Lex Connection: ${config.hasLexConnection}`);
	console.log(`   Enabled: ${isLexSonaEnabled(config)}`);
	console.log("");

	// Step 2: Build workflow context
	const context = {
		workflowId: "merge-weave",
		stepKind: "execute",
		repo: "lex-pr-runner",
		branch: "main",
		hints: {
			task: "smoke-test",
			itemCount: 2,
		},
	};
	console.log("2. Workflow Context:");
	console.log(`   Workflow: ${context.workflowId}`);
	console.log(`   Step: ${context.stepKind}`);
	console.log(`   Repo: ${context.repo}`);
	console.log("");

	// Step 3: Derive shadow constraints
	console.log("3. Deriving shadow constraints...");
	const result = await deriveShadowConstraints(context, config);
	console.log(`   Success: ${result.success}`);
	console.log(`   Persona: ${result.personaId}`);
	console.log(`   Offline Mode: ${result.offlineMode}`);
	if (result.confidenceCeiling) {
		console.log(`   Confidence Ceiling: ${result.confidenceCeiling}`);
	}
	if (result.error) {
		console.log(`   Error: ${result.error}`);
	}
	if (result.constraintSet) {
		console.log(`   Constraints: ${result.constraintSet.constraintCount}`);
		console.log(`   Principles: ${result.constraintSet.principleCount}`);
	}
	console.log("");

	// Step 4: Create governance comparison log
	console.log("4. Creating governance comparison log...");
	const runnerSignals = {
		gatesRequired: ["lint", "typecheck", "test"],
		mergeEligible: true,
		hostilityScore: 0.3,
		suggestedTier: "mid",
	};

	const log = createGovernanceComparisonLog(
		context,
		result,
		runnerSignals,
		config.mode
	);
	console.log(`   Log ID: ${log.id}`);
	console.log("");

	// Step 5: Write log to disk
	console.log("5. Writing log to disk...");
	const logPath = writeGovernanceLog(log);
	console.log(`   Saved to: ${logPath}`);
	console.log("");

	// Step 6: Show formatted log
	console.log("6. Formatted Log Output:");
	console.log("─".repeat(50));
	console.log(formatGovernanceLog(log));
	console.log("─".repeat(50));
	console.log("");

	console.log("✅ Smoke test complete!");
}

main().catch((err) => {
	console.error("❌ Smoke test failed:", err);
	process.exit(1);
});
