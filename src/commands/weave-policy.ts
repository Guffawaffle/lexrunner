/**
 * Merge-Weave Policy Commands
 *
 * CLI commands for policy-based merge-weave execution.
 *
 * Commands:
 *   weave policy show     - Display loaded policy
 *   weave policy validate - Validate policy file
 *   weave policy run      - Execute merge-weave with policy
 *
 * @module
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
	loadPolicy,
	loadPolicyOrNull,
	PolicyLoadError,
} from "../weave/policy/index.js";
import {
	createInterventionPlan,
	getReadyInterventions,
	getInterventionsByDeterminism,
	type DiscoveredPR,
} from "../weave/planner/index.js";
import {
	executeD1Intervention,
	hasD1Handler,
	type ExecutionContext,
} from "../weave/executor/index.js";
import { createAuditLogger, createAuditEmitter } from "../weave/audit/index.js";
import { throwExit } from "../cli/exitHandler.js";

interface PolicyCommandDeps {
	jsonModeActive: () => boolean;
}

/**
 * Register policy subcommands under weave
 */
export function registerPolicyCommands(
	weaveCommand: Command,
	deps: PolicyCommandDeps
): void {
	const policy = weaveCommand
		.command("policy")
		.description("Policy-based merge-weave execution")
		.addHelpText(
			"after",
			`
Examples:
  # Show current policy
  $ lexrunner weave policy show

  # Validate policy file
  $ lexrunner weave policy validate --file .smartergpt/merge-weave-policy.yml

  # Run merge-weave with policy (dry run)
  $ lexrunner weave policy run --dry-run

  # Execute merge-weave
  $ lexrunner weave policy run
`
		);

	// weave policy show
	policy
		.command("show")
		.description("Display loaded merge-weave policy")
		.option("--file <path>", "Path to policy file")
		.option("--json", "Output as JSON")
		.action(async (opts) => {
			try {
				const result = await loadPolicy({ policyPath: opts.file });

				if (opts.json || deps.jsonModeActive()) {
					console.log(JSON.stringify(result.policy, null, 2));
				} else {
					console.log(`\n📋 Merge-Weave Policy`);
					console.log(`   File: ${result.resolvedPath}`);
					console.log(`   Version: ${result.policy.schemaVersion}`);
					console.log(`\n📦 Discovery`);
					console.log(
						`   Repos: ${result.policy.discovery.repos.length}`
					);
					for (const repo of result.policy.discovery.repos) {
						console.log(
							`     - ${repo.owner}/${repo.name} (priority: ${repo.priority})`
						);
					}
					if (result.policy.gates?.base_branch?.required) {
						console.log(`\n🔐 Gates`);
						console.log(
							`   Base branch: ${result.policy.gates.base_branch.required.length} required`
						);
						console.log(
							`   Per-PR CI: ${
								result.policy.gates?.per_pr?.require_ci_green
									? "required"
									: "optional"
							}`
						);
					}
					if (result.policy.merge) {
						console.log(`\n🔀 Merge`);
						console.log(`   Method: ${result.policy.merge.method}`);
						console.log(
							`   Admin authority: ${
								result.policy.merge.admin_authority?.enabled
									? "enabled"
									: "disabled"
							}`
						);
					}
					if (result.policy.model_handoff?.tiers) {
						console.log(`\n📊 Model Handoff`);
						for (const tier of result.policy.model_handoff.tiers) {
							const current = tier.current ? " (current)" : "";
							console.log(
								`   ${tier.id}: ${tier.name}${current}`
							);
						}
					}
				}
			} catch (err) {
				if (err instanceof PolicyLoadError) {
					console.error(`\n❌ Policy error: ${err.message}`);
					if (err.cause) {
						console.error(`   Cause: ${err.cause.message}`);
					}
					throwExit(1);
				}
				throw err;
			}
		});

	// weave policy validate
	policy
		.command("validate")
		.description("Validate a merge-weave policy file")
		.option("--file <path>", "Path to policy file")
		.action(async (opts) => {
			try {
				const result = await loadPolicy({ policyPath: opts.file });
				console.log(`\n✅ Policy valid: ${result.resolvedPath}`);
				console.log(
					`   Schema version: ${result.policy.schemaVersion}`
				);
				console.log(
					`   Repos: ${result.policy.discovery.repos.length}`
				);
				const gateCount =
					result.policy.gates?.base_branch?.required?.length ?? 0;
				console.log(`   Gates: ${gateCount} base branch gates`);
			} catch (err) {
				if (err instanceof PolicyLoadError) {
					console.error(`\n❌ Validation failed: ${err.message}`);
					if (err.cause) {
						console.error(`\nDetails:`);
						console.error(err.cause.message);
					}
					throwExit(1);
				}
				throw err;
			}
		});

	// weave policy plan
	policy
		.command("plan")
		.description("Create intervention plan from policy")
		.option("--file <path>", "Path to policy file")
		.option("--output <path>", "Output plan to file")
		.option("--json", "Output as JSON")
		.action(async (opts) => {
			try {
				const result = await loadPolicy({ policyPath: opts.file });

				// Create a plan with empty PRs (discovery would populate this)
				const prs: DiscoveredPR[] = [];
				const plan = createInterventionPlan({
					policy: result.policy,
					prs,
				});

				if (opts.json || deps.jsonModeActive()) {
					const output = JSON.stringify(plan, null, 2);
					if (opts.output) {
						const fs = await import("node:fs/promises");
						await fs.writeFile(opts.output, output, "utf-8");
						console.log(`Plan written to: ${opts.output}`);
					} else {
						console.log(output);
					}
				} else {
					console.log(`\n📋 Intervention Plan`);
					console.log(`   ID: ${plan.id}`);
					console.log(`   Generated: ${plan.generatedAt}`);
					console.log(`   Policy version: ${plan.policyVersion}`);
					console.log(`\n📊 Statistics`);
					console.log(`   Total interventions: ${plan.stats.total}`);
					console.log(`   By determinism:`);
					console.log(
						`     D1 (scriptable): ${plan.stats.byDeterminism.D1}`
					);
					console.log(
						`     D2 (bounded):    ${plan.stats.byDeterminism.D2}`
					);
					console.log(
						`     D3 (frontier):   ${plan.stats.byDeterminism.D3}`
					);
					console.log(`   By phase:`);
					for (const [phase, count] of Object.entries(
						plan.stats.byPhase
					)) {
						console.log(`     ${phase}: ${count}`);
					}

					if (opts.output) {
						const fs = await import("node:fs/promises");
						await fs.writeFile(
							opts.output,
							JSON.stringify(plan, null, 2),
							"utf-8"
						);
						console.log(`\nPlan written to: ${opts.output}`);
					}
				}
			} catch (err) {
				if (err instanceof PolicyLoadError) {
					console.error(`\n❌ Policy error: ${err.message}`);
					throwExit(1);
				}
				throw err;
			}
		});

	// weave policy run
	policy
		.command("run")
		.description("Execute merge-weave with policy")
		.option("--file <path>", "Path to policy file")
		.option("--dry-run", "Preview without executing side effects")
		.option("--d1-only", "Only execute D1 (deterministic) interventions")
		.option(
			"--output-dir <path>",
			"Directory for artifacts",
			".smartergpt/deliverables"
		)
		.action(async (opts) => {
			try {
				const result = await loadPolicy({ policyPath: opts.file });
				const runId = randomUUID();
				const outputDir = resolve(opts.outputDir);

				console.log(`\n🚀 Merge-Weave Policy Run`);
				console.log(`   Run ID: ${runId}`);
				console.log(`   Policy: ${result.resolvedPath}`);
				console.log(`   Mode: ${opts.dryRun ? "dry-run" : "live"}`);
				console.log(`   D1 only: ${opts.d1Only ? "yes" : "no"}`);

				// Create audit logger
				const auditPath = resolve(
					outputDir,
					`merge-weave-${runId}.ndjson`
				);
				const logger = createAuditLogger({
					logPath: auditPath,
					runId,
					policyVersion: result.policy.schemaVersion,
				});

				// Create plan
				const prs: DiscoveredPR[] = []; // Would be populated from discovery
				const plan = createInterventionPlan({
					policy: result.policy,
					prs,
				});

				await logger.logPlanCreated(plan);

				console.log(
					`\n📋 Plan created: ${plan.stats.total} interventions`
				);

				// Get interventions to execute
				let interventions = getReadyInterventions(plan);
				if (opts.d1Only) {
					interventions = interventions.filter((i) =>
						hasD1Handler(i.type)
					);
				}

				console.log(`   Ready to execute: ${interventions.length}`);

				if (opts.dryRun) {
					console.log(
						`\n🔍 Dry run - interventions that would execute:`
					);
					for (const i of interventions) {
						console.log(
							`   [${i.determinism}] ${i.type} → ${
								i.target ?? "base"
							}`
						);
					}
					console.log(`\n   Audit would be written to: ${auditPath}`);
				} else {
					console.log(`\n⚙️  Executing interventions...`);
					// Note: Full execution requires GitHub API and shell executor
					// This is the foundation - integration happens in next phase
					console.log(
						`   (Execution engine ready - requires API integration)`
					);
				}

				await logger.logSummary(plan.id, 0, plan.interventions);
				console.log(`\n✅ Run complete`);
				console.log(`   Audit log: ${auditPath}`);
			} catch (err) {
				if (err instanceof PolicyLoadError) {
					console.error(`\n❌ Policy error: ${err.message}`);
					throwExit(1);
				}
				throw err;
			}
		});
}
