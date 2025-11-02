/**
 * Plan-review command - Interactive plan review with human-in-the-loop validation
 */

import { Command } from 'commander';
import { loadPlan } from '../schema.js';
import { resolveProfile } from '../config/profileResolver.js';
import { canonicalJSONStringify } from '../util/canonicalJson.js';
import { throwExit } from '../cli/exitHandler.js';
import { initAuditEmitter, emitEvent, AuditEmitter, EVENT_TYPES } from '../audit/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface PlanReviewCommandDeps {
	exitWith: (e: unknown) => void;
	getProgramOpts: () => any;
}

/**
 * Register the plan-review command with the CLI program
 */
export function registerPlanReviewCommand(program: Command, deps: PlanReviewCommandDeps): void {
	program
		.command("plan-review")
		.description("Interactive plan review with human-in-the-loop validation")
		.option("--plan <file>", "Path to plan.json file")
		.argument("[file]", "Path to plan.json file (alternative to --plan)")
		.option("--non-interactive", "Non-interactive mode (auto-approve)")
		.option("--profile-dir <dir>", "Profile directory for history tracking")
		.option("--save-history", "Save plan versions to history")
		.option("--output <file>", "Output file for approved/modified plan")
		.action(async (file: string | undefined, opts) => {
			const planFile = opts.plan || file;
			let auditEmitter: AuditEmitter | null = null;
			if (!planFile) {
				console.error(
					"Error: plan file is required (use --plan <file> or provide as argument)"
				);
				throwExit(1);
			}

			try {
				// Initialize audit emitter from global audit-profile flag if set
				const programOpts = deps.getProgramOpts();
				const globalAudit = programOpts.auditProfile as
					| string
					| undefined;
				if (globalAudit && globalAudit !== "off") {
					const auditDir = path.join(
						resolveProfile(opts.profileDir).path,
						"deliverables",
						"audit"
					);
					const cliKey = programOpts.auditKey as string | undefined;
					const envKey = process.env.LEX_AUDIT_KEY_HEX;
					const keyToUse = cliKey || envKey;
					const phiFlag =
						globalAudit === "hipaa-strict" ||
						process.env.LEX_AUDIT_PHI === "1";
					auditEmitter = await initAuditEmitter({
						profile: globalAudit as any,
						dir: auditDir,
						phiRedaction: phiFlag,
						encryptionKeyHex: keyToUse,
					});
					await emitEvent(auditEmitter, EVENT_TYPES.COMMAND_INVOCATION, {
						command: "plan-review",
						argv: process.argv.slice(2),
					});
				}
				const planContent = fs.readFileSync(planFile, "utf-8");
				const plan = loadPlan(planContent);

				// Import interactive review module
				const { reviewPlan } = await import("../interactive/planReview.js");
				const { savePlanVersion, getPlanHistoryPath } = await import(
					"../interactive/planHistory.js"
				);

				// Run interactive review
				const result = await reviewPlan({
					plan,
					interactive: !opts.nonInteractive,
					autoApprove: opts.nonInteractive,
				});

				// Save to history if requested
				if (opts.saveHistory) {
					const profile = resolveProfile(opts.profileDir);
					const historyPath = getPlanHistoryPath(profile.path);
					savePlanVersion(historyPath, result.plan, {
						approved: result.approved,
						changes: result.changes,
						message: result.reason,
					});
					console.log(`\n✓ Saved to history: ${historyPath}`);
				}

				// Save approved/modified plan
				if (result.approved && opts.output) {
					fs.writeFileSync(
						opts.output,
						canonicalJSONStringify(result.plan)
					);
					console.log(`\n✓ Saved plan to: ${opts.output}`);
				}

				if (result.approved) {
					console.log("\n✅ Plan approved");
					if (result.modified) {
						console.log(`\n📝 Changes made:`);
						result.changes?.forEach((change) =>
							console.log(`  - ${change}`)
						);
					}
					throwExit(0);
				} else {
					console.log("\n❌ Plan rejected");
					if (result.reason) {
						console.log(`Reason: ${result.reason}`);
					}
					throwExit(1);
				}
			} catch (error) {
				deps.exitWith(error);
			}
		});
}
