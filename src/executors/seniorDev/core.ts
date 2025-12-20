/**
 * Senior Dev Executor — Core Implementation
 *
 * This module implements the core logic for the Senior Dev executor.
 * It is the canonical implementation used by both CLI and MCP.
 *
 * Functions:
 * - prepareReviewContext: Phase 1 deterministic artifact gathering
 * - recallSeniorDevContext: Phase 1 memory recall from Lex
 * - captureSeniorDevFrame: Phase 4 Frame capture (receipt)
 */

import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getCurrentBranch as getGitBranch } from "../../shared/git/runGit.js";
import type {
	PrepareContextInput,
	PrepareContextResult,
	RecallContextInput,
	RecallContextResult,
	CaptureFrameInput,
	CaptureFrameResult,
	CommandResult,
	FramePayload,
	Frame,
	RecallQueryType,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function getTimestamp(): string {
	return new Date().toISOString();
}

function getTimestampForPath(): string {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; timeout?: number } = {}
): { success: boolean; output: string; duration_ms: number } {
	const startTime = Date.now();
	try {
		const output = execSync(`${command} ${args.join(" ")}`, {
			cwd: options.cwd,
			timeout: options.timeout ?? 60000,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return {
			success: true,
			output: output.trim(),
			duration_ms: Date.now() - startTime,
		};
	} catch (error) {
		const err = error as {
			stdout?: Buffer;
			stderr?: Buffer;
			message?: string;
		};
		const output =
			err.stdout?.toString() ??
			err.stderr?.toString() ??
			err.message ??
			"";
		return {
			success: false,
			output: output.trim(),
			duration_ms: Date.now() - startTime,
		};
	}
}

function getCurrentBranch(cwd?: string): string {
	const branch = getGitBranch(cwd);
	return branch || "unknown";
}

function detectModulesFromFiles(files: string[]): string[] {
	const modules = new Set<string>();
	for (const file of files) {
		const dir = path.dirname(file);
		if (dir && dir !== ".") {
			// Use first two path segments as module identifier
			const parts = dir.split(path.sep);
			if (parts.length >= 2) {
				modules.add(`${parts[0]}/${parts[1]}`);
			} else if (parts.length === 1) {
				modules.add(parts[0]);
			}
		}
	}
	return Array.from(modules).sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// prepareReviewContext
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 1: Deterministic artifact gathering for code review.
 *
 * Runs lint, typecheck, tests, captures diff, and gathers PR metadata.
 * All operations are deterministic and logged.
 */
export async function prepareReviewContext(
	input: PrepareContextInput
): Promise<PrepareContextResult> {
	const { pr_number, base_branch = "main" } = input;
	const timestamp = getTimestampForPath();
	const outputDir =
		input.output_dir ?? `/tmp/senior-dev-review-${pr_number}-${timestamp}`;

	// Ensure output directory exists
	fs.mkdirSync(outputDir, { recursive: true });

	const commandsRun: CommandResult[] = [];
	const cwd = process.cwd();

	// 1. PR Metadata
	const prMetadataResult = runCommand("gh", [
		"pr",
		"view",
		pr_number,
		"--json",
		"title,body,author,labels,files,additions,deletions,changedFiles",
	]);
	const prMetadataPath = path.join(outputDir, "pr-metadata.json");
	if (prMetadataResult.success) {
		fs.writeFileSync(prMetadataPath, prMetadataResult.output);
		commandsRun.push({
			command: "gh pr view --json",
			status: "success",
			duration_ms: prMetadataResult.duration_ms,
		});
	} else {
		fs.writeFileSync(
			prMetadataPath,
			JSON.stringify({ error: "PR not found or gh CLI error" })
		);
		commandsRun.push({
			command: "gh pr view --json",
			status: "error",
			output: prMetadataResult.output,
			duration_ms: prMetadataResult.duration_ms,
		});
	}

	// 1b. PR Description
	const prDescResult = runCommand("gh", ["pr", "view", pr_number]);
	const prDescPath = path.join(outputDir, "pr-description.md");
	fs.writeFileSync(
		prDescPath,
		prDescResult.output || "# No description available"
	);

	// 2. Git Diff
	const diffResult = runCommand("git", ["diff", `${base_branch}...HEAD`], {
		cwd,
	});
	const diffPath = path.join(outputDir, "changes.diff");
	fs.writeFileSync(
		diffPath,
		diffResult.output || "# Could not generate diff"
	);
	commandsRun.push({
		command: "git diff",
		status: diffResult.success ? "success" : "error",
		duration_ms: diffResult.duration_ms,
	});

	// 2b. Diff Summary
	const diffSummaryResult = runCommand(
		"git",
		["diff", "--stat", `${base_branch}...HEAD`],
		{ cwd }
	);
	const diffSummaryPath = path.join(outputDir, "changes-summary.txt");
	fs.writeFileSync(
		diffSummaryPath,
		diffSummaryResult.output || "# No summary"
	);

	// 3. Changed Files
	const changedFilesResult = runCommand(
		"git",
		["diff", "--name-only", `${base_branch}...HEAD`],
		{ cwd }
	);
	const changedFilesPath = path.join(outputDir, "changed-files.txt");
	const changedFiles = changedFilesResult.success
		? changedFilesResult.output.split("\n").filter((f) => f.trim())
		: [];
	fs.writeFileSync(changedFilesPath, changedFiles.join("\n"));
	commandsRun.push({
		command: "git diff --name-only",
		status: changedFilesResult.success ? "success" : "error",
		duration_ms: changedFilesResult.duration_ms,
	});

	// 4. Lint (unless skipped)
	const lintPath = path.join(outputDir, "lint-output.txt");
	if (input.skip_lint) {
		fs.writeFileSync(lintPath, "# Lint skipped by user");
		commandsRun.push({ command: "npm run lint", status: "skipped" });
	} else {
		const lintResult = runCommand("npm", ["run", "lint"], {
			cwd,
			timeout: 120000,
		});
		fs.writeFileSync(lintPath, lintResult.output || "# No lint output");
		commandsRun.push({
			command: "npm run lint",
			status: lintResult.success ? "success" : "warning",
			duration_ms: lintResult.duration_ms,
		});
	}

	// 5. Typecheck (unless skipped)
	const typecheckPath = path.join(outputDir, "typecheck-output.txt");
	if (input.skip_typecheck) {
		fs.writeFileSync(typecheckPath, "# Typecheck skipped by user");
		commandsRun.push({ command: "npm run typecheck", status: "skipped" });
	} else {
		const typecheckResult = runCommand("npm", ["run", "typecheck"], {
			cwd,
			timeout: 120000,
		});
		fs.writeFileSync(
			typecheckPath,
			typecheckResult.output || "# No typecheck output"
		);
		commandsRun.push({
			command: "npm run typecheck",
			status: typecheckResult.success ? "success" : "warning",
			duration_ms: typecheckResult.duration_ms,
		});
	}

	// 6. Tests (unless skipped)
	const testsPath = path.join(outputDir, "test-output.txt");
	if (input.skip_tests) {
		fs.writeFileSync(testsPath, "# Tests skipped by user");
		commandsRun.push({ command: "npm test", status: "skipped" });
	} else {
		const testResult = runCommand("npm", ["test"], {
			cwd,
			timeout: 300000,
		});
		fs.writeFileSync(testsPath, testResult.output || "# No test output");
		commandsRun.push({
			command: "npm test",
			status: testResult.success ? "success" : "warning",
			duration_ms: testResult.duration_ms,
		});
	}

	// 7. Recall related Frames (best effort)
	const framesPath = path.join(outputDir, "related-frames.txt");
	const modulesDetected = detectModulesFromFiles(changedFiles);
	let framesOutput = `# Recalled Frames for modules: ${modulesDetected.join(
		", "
	)}\n\n`;

	for (const module of modulesDetected.slice(0, 3)) {
		const recallResult = runCommand(
			"lex",
			["recall", `reviews for ${module}`],
			{ cwd }
		);
		framesOutput += `## Module: ${module}\n`;
		framesOutput += recallResult.success
			? recallResult.output
			: "No frames found or lex CLI not available";
		framesOutput += "\n\n";
	}
	fs.writeFileSync(framesPath, framesOutput);
	commandsRun.push({
		command: "lex recall",
		status: modulesDetected.length > 0 ? "success" : "skipped",
	});

	// Build result
	const result: PrepareContextResult = {
		executor: "senior-dev",
		phase: "deterministic-prep",
		pr_number,
		base_branch,
		timestamp: getTimestamp(),
		output_dir: outputDir,
		artifacts: {
			pr_metadata: "pr-metadata.json",
			pr_description: "pr-description.md",
			diff: "changes.diff",
			diff_summary: "changes-summary.txt",
			changed_files: "changed-files.txt",
			lint: "lint-output.txt",
			typecheck: "typecheck-output.txt",
			tests: "test-output.txt",
			frames: "related-frames.txt",
		},
		commands_run: commandsRun,
		modules_detected: modulesDetected,
	};

	// Write context.json manifest
	const contextPath = path.join(outputDir, "context.json");
	fs.writeFileSync(contextPath, JSON.stringify(result, null, 2));

	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// recallSeniorDevContext
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 1: Recall relevant Frames from Lex memory.
 *
 * This function delegates to the Lex CLI (`lex recall`) to query the Lex memory
 * system. It provides executor-specific workflow integration (query types, parsing,
 * prompt suggestions) but ultimately accesses the same database as the Lex MCP
 * server's `mcp_lex_frame_recall` tool.
 *
 * For direct access to Lex memory features, use the Lex MCP server tools instead.
 * See docs/MEMORY_TOOLS.md for guidance on when to use which tool.
 *
 * Queries Lex for prior reviews, developer history, or patterns.
 */
export async function recallSeniorDevContext(
	input: RecallContextInput
): Promise<RecallContextResult> {
	const { query_type, query, limit = 10 } = input;

	// Validate query for types that require it
	if (query_type !== "pattern" && !query) {
		throw new Error(`Query type '${query_type}' requires a query argument`);
	}

	const frames: Frame[] = [];
	const relatedFrames: Frame[] = [];
	let suggestedPrompt: string | undefined;

	// Build the appropriate lex command based on query type
	switch (query_type) {
		case "module": {
			// Query Frames related to this module
			const result = runCommand("lex", [
				"recall",
				`reviews for ${query}`,
			]);
			if (result.success && result.output) {
				// Parse frames from output (simplified - real implementation would parse JSON)
				frames.push(
					...parseFramesFromLexOutput(result.output, query_type)
				);
			}

			// Also get related patterns
			const patternResult = runCommand("lex", [
				"list_frames",
				"--keyword",
				"pattern",
			]);
			if (patternResult.success && patternResult.output) {
				const allPatterns = parseFramesFromLexOutput(
					patternResult.output,
					"pattern"
				);
				relatedFrames.push(
					...allPatterns.filter((f) =>
						f.reference_point
							.toLowerCase()
							.includes(query?.toLowerCase() ?? "")
					)
				);
			}

			suggestedPrompt = "prompts/code-review.prompt.md";
			break;
		}

		case "developer": {
			// Query Frames for this developer
			const result = runCommand("lex", [
				"recall",
				"--keyword",
				`developer:${query}`,
			]);
			if (result.success && result.output) {
				frames.push(
					...parseFramesFromLexOutput(result.output, query_type)
				);
			}

			// Also get learning path
			const pathResult = runCommand("lex", [
				"recall",
				`Developer ${query} learning path`,
			]);
			if (pathResult.success && pathResult.output) {
				relatedFrames.push(
					...parseFramesFromLexOutput(
						pathResult.output,
						"learning-path"
					)
				);
			}

			suggestedPrompt = "prompts/mentorship-feedback.prompt.md";
			break;
		}

		case "pattern": {
			// Query pattern library
			const result = runCommand("lex", [
				"list_frames",
				"--keyword",
				"pattern",
			]);
			if (result.success && result.output) {
				frames.push(
					...parseFramesFromLexOutput(result.output, query_type)
				);
			}

			// Also get recent reviews for pattern mining
			const reviewResult = runCommand("lex", [
				"list_frames",
				"--keyword",
				"review",
				"--limit",
				"20",
			]);
			if (reviewResult.success && reviewResult.output) {
				relatedFrames.push(
					...parseFramesFromLexOutput(reviewResult.output, "review")
				);
			}

			suggestedPrompt = "prompts/pattern-recognition.prompt.md";
			break;
		}

		case "pr": {
			// Query specific PR review
			const result = runCommand("lex", ["recall", `PR-${query} review`]);
			if (result.success && result.output) {
				frames.push(
					...parseFramesFromLexOutput(result.output, query_type)
				);
			}

			suggestedPrompt = "prompts/code-review.prompt.md";
			break;
		}
	}

	return {
		executor: "senior-dev",
		phase: "recall",
		query_type,
		query: query ?? null,
		timestamp: getTimestamp(),
		frames: frames.slice(0, limit),
		related_frames:
			relatedFrames.length > 0 ? relatedFrames.slice(0, 5) : undefined,
		suggested_prompt: suggestedPrompt,
	};
}

/**
 * Parse Frames from lex CLI output.
 * This is a simplified parser - actual implementation would handle JSON output.
 */
function parseFramesFromLexOutput(output: string, _queryType: string): Frame[] {
	// Attempt to parse as JSON array first
	try {
		const parsed = JSON.parse(output);
		if (Array.isArray(parsed)) {
			return parsed as Frame[];
		}
		if (parsed.frames && Array.isArray(parsed.frames)) {
			return parsed.frames as Frame[];
		}
	} catch {
		// Not JSON, try to parse text output
	}

	// Fallback: Create a synthetic frame from text output
	if (output.trim()) {
		return [
			{
				id: `synthetic-${Date.now()}`,
				timestamp: getTimestamp(),
				reference_point: "Parsed from lex output",
				summary_caption: output.slice(0, 200),
				module_scope: [],
				status_snapshot: { next_action: "Review parsed content" },
			},
		];
	}

	return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// captureSeniorDevFrame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 4: Capture review session as a Frame in Lex memory.
 *
 * This function delegates to the Lex CLI (`lex remember`) to write Frames to
 * the Lex memory system. It provides executor-specific workflow integration
 * (reference point formatting, keyword conventions) but ultimately writes to
 * the same database as the Lex MCP server's `mcp_lex_frame_remember` tool.
 *
 * For direct access to Lex memory features, use the Lex MCP server tools instead.
 * See docs/MEMORY_TOOLS.md for guidance on when to use which tool.
 *
 * Writes the "receipt" of the review session.
 */
export async function captureSeniorDevFrame(
	input: CaptureFrameInput
): Promise<CaptureFrameResult> {
	const {
		pr_number,
		module,
		summary,
		next_action,
		developer = "unknown",
		severity = "review",
		jira,
		blockers = [],
	} = input;

	// Build reference point per MEMORY_INTEGRATION.md Pattern A
	const referencePoint = `PR-${pr_number} review ${module}`;

	// Build keywords per convention
	const keywords = ["senior-dev", "review", `pr-${pr_number}`, severity];
	if (developer !== "unknown") {
		keywords.push(`developer:${developer}`);
	}

	// Get current branch
	const branch = getCurrentBranch();

	// Build Frame payload
	const framePayload: FramePayload = {
		reference_point: referencePoint,
		summary_caption: summary,
		module_scope: [module],
		status_snapshot: {
			next_action,
			blockers: blockers.length > 0 ? blockers : undefined,
		},
		keywords,
		branch,
		jira,
	};

	// Attempt to write to Lex
	let success = false;
	let frameId: string | undefined;
	let error: string | undefined;

	const args = [
		"remember",
		"--reference-point",
		referencePoint,
		"--summary",
		summary,
		"--next",
		next_action,
		"--modules",
		module,
		"--keywords",
		keywords.join(","),
		"--branch",
		branch,
	];

	if (jira) {
		args.push("--jira", jira);
	}

	const result = runCommand("lex", args);
	if (result.success) {
		success = true;
		// Try to extract frame ID from output
		const idMatch = result.output.match(
			/frame[_-]?id[:\s]+([a-zA-Z0-9-]+)/i
		);
		if (idMatch) {
			frameId = idMatch[1];
		}
	} else {
		error = result.output || "Failed to write Frame to Lex";
	}

	return {
		executor: "senior-dev",
		phase: "frame-capture",
		timestamp: getTimestamp(),
		frame_payload: framePayload,
		frame_id: frameId,
		success,
		error,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { EXECUTOR_MODES } from "./types.js";
