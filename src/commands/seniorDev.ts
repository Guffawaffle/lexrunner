/**
 * Senior Dev CLI Command
 *
 * Provides CLI subcommands for the Senior Dev executor:
 * - senior-dev prepare-context <pr-number>
 * - senior-dev recall-context <query-type> [query]
 * - senior-dev capture-frame <pr-number> <module> <summary> <next-action>
 */

import { Command } from "commander";
import {
	prepareReviewContext,
	recallSeniorDevContext,
	captureSeniorDevFrame,
	EXECUTOR_MODES,
} from "../executors/seniorDev/index.js";
import type {
	PrepareContextInput,
	RecallContextInput,
	CaptureFrameInput,
	RecallQueryType,
	Severity,
} from "../executors/seniorDev/index.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

/**
 * Register the senior-dev command group
 */
export function registerSeniorDevCommand(
	program: Command,
	jsonModeActive: () => boolean
): void {
	const seniorDev = program
		.command("senior-dev")
		.description("Senior Dev executor commands for code review workflow");

	// ─────────────────────────────────────────────────────────────────────────
	// prepare-context
	// ─────────────────────────────────────────────────────────────────────────
	seniorDev
		.command("prepare-context <pr-number>")
		.description("Phase 1: Gather deterministic artifacts for code review")
		.option("-b, --base-branch <branch>", "Base branch for diff", "main")
		.option("-o, --output-dir <dir>", "Output directory for artifacts")
		.option("--skip-tests", "Skip running tests")
		.option("--skip-lint", "Skip running lint")
		.option("--skip-typecheck", "Skip running typecheck")
		.option("--json", "Output as JSON only (no human-readable text)")
		.action(async (prNumber: string, options) => {
			const input: PrepareContextInput = {
				pr_number: prNumber,
				base_branch: options.baseBranch,
				output_dir: options.outputDir,
				skip_tests: options.skipTests,
				skip_lint: options.skipLint,
				skip_typecheck: options.skipTypecheck,
			};

			try {
				const result = await prepareReviewContext(input);

				if (options.json || jsonModeActive()) {
					console.log(canonicalJSONStringify(result));
				} else {
					printPrepareContextResult(result);
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
		});

	// ─────────────────────────────────────────────────────────────────────────
	// recall-context
	// ─────────────────────────────────────────────────────────────────────────
	seniorDev
		.command("recall-context <query-type> [query]")
		.description("Phase 1: Recall relevant Frames from Lex memory")
		.option(
			"-l, --limit <number>",
			"Maximum number of frames to return",
			"10"
		)
		.option("--json", "Output as JSON only")
		.action(
			async (queryType: string, query: string | undefined, options) => {
				// Validate query type
				const validTypes: RecallQueryType[] = [
					"module",
					"developer",
					"pattern",
					"pr",
				];
				if (!validTypes.includes(queryType as RecallQueryType)) {
					console.error(`Invalid query type: ${queryType}`);
					console.error(`Valid types: ${validTypes.join(", ")}`);
					process.exit(1);
				}

				// Validate query for types that require it
				if (queryType !== "pattern" && !query) {
					console.error(
						`Query type '${queryType}' requires a query argument`
					);
					process.exit(1);
				}

				const input: RecallContextInput = {
					query_type: queryType as RecallQueryType,
					query,
					limit: parseInt(options.limit, 10),
				};

				try {
					const result = await recallSeniorDevContext(input);

					if (options.json || jsonModeActive()) {
						console.log(canonicalJSONStringify(result));
					} else {
						printRecallContextResult(result);
					}
				} catch (error) {
					console.error("Error:", (error as Error).message);
					process.exit(1);
				}
			}
		);

	// ─────────────────────────────────────────────────────────────────────────
	// capture-frame
	// ─────────────────────────────────────────────────────────────────────────
	seniorDev
		.command("capture-frame <pr-number> <module> <summary> <next-action>")
		.description("Phase 4: Capture review session as a Frame in Lex memory")
		.option(
			"-d, --developer <name>",
			"Developer name for tracking",
			"unknown"
		)
		.option(
			"-s, --severity <level>",
			"Highest severity: blocker|must-fix|should-fix|nit|praise|review",
			"review"
		)
		.option("-j, --jira <ticket>", "Jira ticket ID")
		.option("--blockers <items>", "Comma-separated list of blockers")
		.option("--json", "Output as JSON only")
		.action(
			async (
				prNumber: string,
				module: string,
				summary: string,
				nextAction: string,
				options
			) => {
				const input: CaptureFrameInput = {
					pr_number: prNumber,
					module,
					summary,
					next_action: nextAction,
					developer: options.developer,
					severity: options.severity as Severity,
					jira: options.jira,
					blockers: options.blockers
						? options.blockers.split(",")
						: undefined,
				};

				try {
					const result = await captureSeniorDevFrame(input);

					if (options.json || jsonModeActive()) {
						console.log(canonicalJSONStringify(result));
					} else {
						printCaptureFrameResult(result);
					}

					if (!result.success) {
						process.exit(1);
					}
				} catch (error) {
					console.error("Error:", (error as Error).message);
					process.exit(1);
				}
			}
		);

	// ─────────────────────────────────────────────────────────────────────────
	// modes (informational)
	// ─────────────────────────────────────────────────────────────────────────
	seniorDev
		.command("modes")
		.description("List available executor modes")
		.option("--json", "Output as JSON")
		.action((options: { json?: boolean }) => {
			if (options.json === true || jsonModeActive()) {
				console.log(canonicalJSONStringify(EXECUTOR_MODES));
				return;
			}
			console.log("\nSenior Dev Executor Modes\n");
			console.log("─".repeat(60));
			for (const [key, mode] of Object.entries(EXECUTOR_MODES)) {
				console.log(`\n${mode.display_name} (${key})`);
				console.log(`  Purpose: ${mode.purpose}`);
				console.log(`  Prompt:  ${mode.prompt_file}`);
				console.log(`  Prerequisites:`);
				for (const prereq of mode.prerequisites) {
					console.log(`    - ${prereq}`);
				}
			}
			console.log();
		});
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-Readable Output Formatters
// ─────────────────────────────────────────────────────────────────────────────

function printPrepareContextResult(
	result: Awaited<ReturnType<typeof prepareReviewContext>>
): void {
	console.log();
	console.log(
		"╔══════════════════════════════════════════════════════════════════════╗"
	);
	console.log(
		"║  SENIOR DEV EXECUTOR — Phase 1: Deterministic Prep                   ║"
	);
	console.log(
		"╚══════════════════════════════════════════════════════════════════════╝"
	);
	console.log();
	console.log(`PR:        #${result.pr_number}`);
	console.log(`Base:      ${result.base_branch}`);
	console.log(`Timestamp: ${result.timestamp}`);
	console.log(`Output:    ${result.output_dir}`);
	console.log();
	console.log("Commands executed:");
	console.log("─".repeat(60));
	for (const cmd of result.commands_run) {
		const icon =
			cmd.status === "success"
				? "✅"
				: cmd.status === "warning"
				? "⚠️"
				: cmd.status === "skipped"
				? "⏭️"
				: "❌";
		const duration = cmd.duration_ms ? ` (${cmd.duration_ms}ms)` : "";
		console.log(`  ${icon} ${cmd.command}${duration}`);
	}
	console.log();
	console.log(
		"Modules detected:",
		result.modules_detected.join(", ") || "(none)"
	);
	console.log();
	console.log("Artifacts created:");
	console.log("─".repeat(60));
	for (const [key, file] of Object.entries(result.artifacts)) {
		console.log(`  ${key}: ${file}`);
	}
	console.log();
	console.log(
		"────────────────────────────────────────────────────────────────────────"
	);
	console.log("NEXT STEPS (Phase 2: Executor Invocation)");
	console.log(
		"────────────────────────────────────────────────────────────────────────"
	);
	console.log();
	console.log("1. FOR TRIAGE (quick risk assessment):");
	console.log("   Load: prompts/pr-analysis.prompt.md");
	console.log(
		"   Attach: context.json, pr-metadata.json, changes-summary.txt"
	);
	console.log();
	console.log("2. FOR DEEP REVIEW (detailed analysis):");
	console.log("   Load: prompts/code-review.prompt.md");
	console.log("   Attach: context.json, changes.diff, lint-output.txt,");
	console.log(
		"           typecheck-output.txt, test-output.txt, related-frames.txt"
	);
	console.log();
	console.log(`3. AFTER REVIEW (Phase 4: Frame Capture):`);
	console.log(
		`   Run: lex-pr-runner senior-dev capture-frame ${result.pr_number} <module> <summary> <next>`
	);
	console.log();
}

function printRecallContextResult(
	result: Awaited<ReturnType<typeof recallSeniorDevContext>>
): void {
	console.log();
	console.log("# recall-context execution");
	console.log(`# Timestamp: ${result.timestamp}`);
	console.log(`# Query type: ${result.query_type}`);
	console.log(`# Query: ${result.query ?? "<none>"}`);
	console.log();
	console.log("## Frames Retrieved");
	console.log();

	if (result.frames.length === 0) {
		console.log("_No frames found_");
	} else {
		for (const frame of result.frames) {
			console.log(`### ${frame.reference_point}`);
			console.log(`- Summary: ${frame.summary_caption}`);
			console.log(
				`- Next: ${frame.status_snapshot?.next_action ?? "(none)"}`
			);
			if (frame.keywords?.length) {
				console.log(`- Keywords: ${frame.keywords.join(", ")}`);
			}
			console.log();
		}
	}

	if (result.related_frames && result.related_frames.length > 0) {
		console.log("## Related Frames");
		console.log();
		for (const frame of result.related_frames) {
			console.log(`- ${frame.reference_point}: ${frame.summary_caption}`);
		}
		console.log();
	}

	console.log("---");
	console.log("# Next steps:");
	console.log(`# Attach this output to ${result.suggested_prompt}`);
}

function printCaptureFrameResult(
	result: Awaited<ReturnType<typeof captureSeniorDevFrame>>
): void {
	console.log();
	console.log(
		"╔══════════════════════════════════════════════════════════════════════╗"
	);
	console.log(
		"║  SENIOR DEV EXECUTOR — Phase 4: Frame Capture                        ║"
	);
	console.log(
		"╚══════════════════════════════════════════════════════════════════════╝"
	);
	console.log();
	console.log("Frame payload:");
	console.log(
		"────────────────────────────────────────────────────────────────────────"
	);
	console.log(JSON.stringify(result.frame_payload, null, 2));
	console.log(
		"────────────────────────────────────────────────────────────────────────"
	);
	console.log();

	if (result.success) {
		console.log(
			"╔══════════════════════════════════════════════════════════════════════╗"
		);
		console.log(
			"║  ✅ Frame captured successfully                                      ║"
		);
		console.log(
			"╚══════════════════════════════════════════════════════════════════════╝"
		);
		console.log();
		console.log("Query this Frame later with:");
		console.log(`  lex recall "${result.frame_payload.reference_point}"`);
		const prKeyword = result.frame_payload.keywords?.find((k) =>
			k.startsWith("pr-")
		);
		if (prKeyword) {
			console.log(`  lex recall --keyword "${prKeyword}"`);
		}
		const devKeyword = result.frame_payload.keywords?.find((k) =>
			k.startsWith("developer:")
		);
		if (devKeyword) {
			console.log(`  lex recall --keyword "${devKeyword}"`);
		}
	} else {
		console.log("⚠️  Failed to capture Frame:", result.error);
		console.log();
		console.log("Manual capture command:");
		console.log();
		console.log(`lex remember \\`);
		console.log(
			`  --reference-point "${result.frame_payload.reference_point}" \\`
		);
		console.log(`  --summary "${result.frame_payload.summary_caption}" \\`);
		console.log(
			`  --next "${result.frame_payload.status_snapshot.next_action}" \\`
		);
		console.log(
			`  --modules "${result.frame_payload.module_scope.join(",")}" \\`
		);
		console.log(
			`  --keywords "${
				result.frame_payload.keywords?.join(",") ?? ""
			}" \\`
		);
		console.log(`  --branch "${result.frame_payload.branch ?? ""}"`);
	}
	console.log();
}
