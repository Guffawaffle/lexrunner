/**
 * Senior Dev Executor Types
 *
 * Type definitions derived from:
 * - executor-manifest.yaml (I/O contracts)
 * - MEMORY_INTEGRATION.md (Frame schema)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Frame Types (from MEMORY_INTEGRATION.md)
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusSnapshot {
	next_action: string;
	blockers?: string[];
	merge_blockers?: string[];
	tests_failing?: string[];
}

export interface FramePayload {
	reference_point: string;
	summary_caption: string;
	module_scope: string[];
	status_snapshot: StatusSnapshot;
	keywords?: string[];
	jira?: string;
	branch?: string;
}

export interface Frame extends FramePayload {
	id: string;
	timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandResult {
	command: string;
	status: "success" | "error" | "warning" | "skipped";
	output?: string;
	duration_ms?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PrepareContext Types (from executor-manifest.yaml io_contracts.pr_context)
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareContextInput {
	pr_number: string;
	base_branch?: string;
	output_dir?: string;
	skip_tests?: boolean;
	skip_lint?: boolean;
	skip_typecheck?: boolean;
}

export interface ArtifactPaths {
	pr_metadata: string;
	pr_description: string;
	diff: string;
	diff_summary: string;
	changed_files: string;
	lint: string;
	typecheck: string;
	tests: string;
	frames: string;
}

export interface PrepareContextResult {
	executor: "senior-dev";
	phase: "deterministic-prep";
	pr_number: string;
	base_branch: string;
	timestamp: string;
	output_dir: string;
	artifacts: ArtifactPaths;
	commands_run: CommandResult[];
	modules_detected: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RecallContext Types (from executor-manifest.yaml io_contracts.lex_frames)
// ─────────────────────────────────────────────────────────────────────────────

export type RecallQueryType = "module" | "developer" | "pattern" | "pr";

export interface RecallContextInput {
	query_type: RecallQueryType;
	query?: string;
	limit?: number;
}

export interface RecallContextResult {
	executor: "senior-dev";
	phase: "recall";
	query_type: RecallQueryType;
	query: string | null;
	timestamp: string;
	frames: Frame[];
	related_frames?: Frame[];
	suggested_prompt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CaptureFrame Types (from MEMORY_INTEGRATION.md Pattern A)
// ─────────────────────────────────────────────────────────────────────────────

export type Severity =
	| "blocker"
	| "must-fix"
	| "should-fix"
	| "nit"
	| "praise"
	| "review";

export interface CaptureFrameInput {
	pr_number: string;
	module: string;
	summary: string;
	next_action: string;
	developer?: string;
	severity?: Severity;
	jira?: string;
	blockers?: string[];
}

export interface CaptureFrameResult {
	executor: "senior-dev";
	phase: "frame-capture";
	timestamp: string;
	frame_payload: FramePayload;
	frame_id?: string;
	success: boolean;
	error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor Modes (from executor-manifest.yaml)
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutorMode =
	| "triage"
	| "deep_review"
	| "pattern_mining"
	| "mentorship";

export interface ModeConfig {
	display_name: string;
	prompt_file: string;
	purpose: string;
	prerequisites: string[];
	output_type: string;
}

export const EXECUTOR_MODES: Record<ExecutorMode, ModeConfig> = {
	triage: {
		display_name: "PR Triage",
		prompt_file: "prompts/pr-analysis.prompt.md",
		purpose: "Quick PR assessment before deep review",
		prerequisites: [
			"prepare-review-context.sh",
			"recall-context.sh (optional)",
		],
		output_type: "triage_report",
	},
	deep_review: {
		display_name: "Deep Code Review",
		prompt_file: "prompts/code-review.prompt.md",
		purpose: "Detailed code analysis with findings and teaching points",
		prerequisites: ["prepare-review-context.sh", "recall-context.sh"],
		output_type: "review_report",
	},
	pattern_mining: {
		display_name: "Pattern Recognition",
		prompt_file: "prompts/pattern-recognition.prompt.md",
		purpose: "Identify recurring issues across reviews",
		prerequisites: ["recall-context.sh (pattern query)"],
		output_type: "pattern_report",
	},
	mentorship: {
		display_name: "Mentorship Feedback",
		prompt_file: "prompts/mentorship-feedback.prompt.md",
		purpose: "Synthesize developer growth over time",
		prerequisites: ["recall-context.sh (developer query)"],
		output_type: "mentorship_report",
	},
};
