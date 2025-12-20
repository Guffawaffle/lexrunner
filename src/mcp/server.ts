#!/usr/bin/env node

/**
 * MCP server adapter for lexrunner
 * Exposes read-only tools for plan creation, gate execution, and merge operations
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadInputs, detectGitHubMode } from "../core/inputs.js";
import { generatePlan } from "../core/plan.js";
import { generateSnapshot, generateGitHubSnapshot } from "../core/snapshot.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { executeGatesWithPolicy } from "../gates.js";
import { ExecutionState } from "../executionState.js";
import { MergeEligibilityEvaluator } from "../mergeEligibility.js";
import {
	computeMergeOrder,
	CycleError,
	UnknownDependencyError,
} from "../mergeOrder.js";
import { loadPlan, validatePlan } from "../schema.js";
import { initLocalOverlay } from "../config/localOverlay.js";
import { healthChecker } from "../monitoring/health.js";
import { generatePlanFromGitHub } from "../core/githubPlan.js";
import { createGitHubClient } from "../github/index.js";
import { createGitHubAPI, GitHubAPI, GitHubAPIError } from "../github/api.js";
import { createGitOperations } from "../git/operations.js";
import {
	bootstrapWorkspace,
	detectProjectType,
	getEnvironmentSuggestions,
} from "../core/bootstrap.js";
import {
	getMCPEnvironment,
	PlanCreateArgs,
	GatesRunArgs,
	MergeApplyArgs,
	InitLocalArgs,
	ProfileResolveArgs,
	PlanCreateResult,
	GatesRunResult,
	MergeApplyResult,
	InitLocalResult,
	ProfileResolveResult,
	WorkflowGuideArgs,
	PrListArgs,
	PrListResult,
	PlanValidateArgs,
	PlanValidateResult,
	PlanAnalyzeArgs,
	PlanAnalyzeResult,
} from "./types.js";
import {
	resolveProfile,
	validateWriteOperation,
	WriteProtectionError,
} from "../config/profileResolver.js";
import {
	getCIMutationPolicy,
	validateCIEnvironment,
} from "../util/envUtils.js";

// Governance metrics imports
import {
	getGlobalMetricsCollector,
	METRIC_DEFINITIONS,
} from "../metrics/export.js";

// AXError imports for structured error responses
import {
	type AXError,
	mcpToolError,
	planNotFoundError,
	writeProtectionError,
	githubApiError,
	toAXError,
	ErrorCodes,
	cycleDetectedError,
	unknownDependencyError,
	AXErrorException,
	isAXErrorException,
} from "../errors/index.js";

import * as fs from "fs";
import * as path from "path";

// Hostility scoring imports
import { runEnvironmentQualityCheck } from "../hostility/index.js";

// Governance integration imports
import {
	buildGovernanceStatus,
	governanceStatusToJSON,
} from "../governance/index.js";

// Tier metrics imports
import { suggestTiersForPlan, calculateTierMetrics } from "../tiers/index.js";

// Senior Dev executor imports
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

// Run manager imports
import {
	createRunManager,
	StartRunInput,
	StartRunInputSchema,
	GetStatusInput,
	GetStatusInputSchema,
	RunNotFoundError,
	SubmitDecisionInput,
	SubmitDecisionInputSchema,
	submitDecision,
} from "../runs/index.js";

// RunStore imports
import {
	createRunStore,
	type RunStore,
	type ListRunsOptions,
} from "../store/index.js";
import { ulid } from "ulid";
import * as crypto from "crypto";

// Workflow guidance imports
import {
	createWorkflowGuide,
	type WorkflowPhase,
} from "./workflow/state-machine.js";
import type { WorkflowGuide } from "./types/guided-response.js";

// =============================================================================
// AXError MCP Helper
// =============================================================================

/**
 * Create an McpError with AXError-structured content in the message.
 *
 * Per AX-CONTRACT.md v0.1, Guarantee 2.3: All MCP tool failures should
 * return structured errors that agents can parse for recovery actions.
 *
 * The error message is JSON-serialized AXError for machine readability,
 * while remaining compatible with MCP's error format.
 */
function throwMcpAXError(mcpErrorCode: ErrorCode, axError: AXError): never {
	// Serialize the AXError as JSON in the message for structured parsing
	const structuredMessage = JSON.stringify(axError);
	throw new McpError(mcpErrorCode, structuredMessage);
}

/**
 * Create an McpError from a caught error, converting to AXError format.
 *
 * @param mcpErrorCode - The MCP error code to use (e.g., ErrorCode.InternalError)
 * @param tool - The MCP tool name
 * @param error - The caught error
 * @param operation - Optional operation description
 * @param axErrorCode - Optional AXError code (defaults to INTERNAL_ERROR)
 */
function throwMcpToolError(
	mcpErrorCode: ErrorCode,
	tool: string,
	error: unknown,
	operation?: string,
	axErrorCode: string = ErrorCodes.INTERNAL_ERROR
): never {
	const message = error instanceof Error ? error.message : String(error);
	const axError = mcpToolError(axErrorCode, `${tool} failed: ${message}`, {
		tool,
		operation,
	});
	throwMcpAXError(mcpErrorCode, axError);
}

/**
 * Options for creating the MCP server.
 */
export interface McpServerOptions {
	/**
	 * RunStore instance for persisting run lifecycle data.
	 * If not provided, a default SqliteRunStore will be created.
	 */
	runStore?: RunStore;
}

/**
 * Input schema for lexrunner.listRuns tool
 */
const ListRunsInputSchema = z.object({
	limit: z.number().int().positive().optional(),
	offset: z.number().int().nonnegative().optional(),
	state: z
		.enum(["pending", "running", "completed", "failed", "aborted"])
		.optional(),
});
type ListRunsInput = z.infer<typeof ListRunsInputSchema>;

/**
 * Create and configure the MCP server
 */
function createServer(options?: McpServerOptions): Server {
	// Initialize RunStore (use provided or create default)
	const runStore = options?.runStore ?? createRunStore();
	const server = new Server(
		{
			name: "lexrunner",
			version: "0.1.0",
		},
		{
			capabilities: {
				tools: {},
			},
		}
	);

	// List available tools
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [
				{
					name: "plan_create",
					description:
						"Create a plan from configuration files or auto-discover from GitHub PRs. Requires GITHUB_TOKEN environment variable when using fromGithub mode.",
					inputSchema: {
						type: "object",
						properties: {
							json: {
								type: "boolean",
								description: "Output plan as JSON to stdout",
								default: false,
							},
							outDir: {
								type: "string",
								description:
									"Output directory for plan artifacts",
							},
							fromGithub: {
								type: "boolean",
								description:
									"Auto-discover PRs from GitHub API",
								default: false,
							},
							query: {
								type: "string",
								description:
									"GitHub search query (e.g., 'is:open label:stack:*')",
							},
							labels: {
								type: "array",
								description: "Filter PRs by labels",
								items: {
									type: "string",
								},
							},
							includeDrafts: {
								type: "boolean",
								description: "Include draft PRs in the plan",
								default: true,
							},
							excludePRs: {
								type: "array",
								description: "Exclude specific PRs by number",
								items: {
									type: "number",
								},
							},
							githubToken: {
								type: "string",
								description:
									"GitHub API token (or use GITHUB_TOKEN env var)",
							},
							owner: {
								type: "string",
								description:
									"GitHub repository owner (auto-detected from git remote)",
							},
							repo: {
								type: "string",
								description:
									"GitHub repository name (auto-detected from git remote)",
							},
							requiredGates: {
								type: "array",
								description:
									"List of required gates (default: lint,typecheck,test)",
								items: {
									type: "string",
								},
							},
							maxWorkers: {
								type: "number",
								description:
									"Maximum parallel workers for execution (default: 2)",
							},
							target: {
								type: "string",
								description:
									"Target branch for merging PRs (default: repo default branch)",
							},
						},
					},
				},
				{
					name: "pr_list",
					description:
						"List pull requests from GitHub without creating a plan. Useful for discovering PRs before plan generation.",
					inputSchema: {
						type: "object",
						properties: {
							owner: {
								type: "string",
								description:
									"GitHub repository owner (auto-detected from git remote if not provided)",
							},
							repo: {
								type: "string",
								description:
									"GitHub repository name (auto-detected from git remote if not provided)",
							},
							query: {
								type: "string",
								description:
									"GitHub search query (e.g., 'is:open label:stack:*')",
							},
							labels: {
								type: "array",
								description: "Filter PRs by labels",
								items: {
									type: "string",
								},
							},
							includeDrafts: {
								type: "boolean",
								description: "Include draft PRs in results",
								default: true,
							},
							excludePRs: {
								type: "array",
								description: "Exclude specific PRs by number",
								items: {
									type: "number",
								},
							},
							githubToken: {
								type: "string",
								description:
									"GitHub API token (or use GITHUB_TOKEN env var)",
							},
							state: {
								type: "string",
								description: "PR state filter (default: open)",
								enum: ["open", "closed", "all"],
								default: "open",
							},
						},
					},
				},
				{
					name: "plan_validate",
					description:
						"Validate a plan.json file without executing it. Checks schema compliance and logical consistency.",
					inputSchema: {
						type: "object",
						properties: {
							planFile: {
								type: "string",
								description:
									"Path to plan.json file (default: <profile>/runner/plan.json)",
							},
							planContent: {
								type: "string",
								description:
									"JSON string of plan content to validate (alternative to planFile)",
							},
						},
					},
				},
				{
					name: "plan_analyze",
					description:
						"Analyze a plan for potential conflicts and dependency issues. Performs dry-run dependency resolution and conflict detection.",
					inputSchema: {
						type: "object",
						properties: {
							planFile: {
								type: "string",
								description:
									"Path to plan.json file (default: <profile>/runner/plan.json)",
							},
						},
					},
				},
				{
					name: "gates_run",
					description: "Execute gates for plan items",
					inputSchema: {
						type: "object",
						properties: {
							planFile: {
								type: "string",
								description:
									"Path to external plan.json file (optional, uses internal state if not provided)",
							},
							onlyItem: {
								type: "string",
								description: "Run gates for specific item only",
							},
							onlyGate: {
								type: "string",
								description: "Run specific gate only",
							},
							outDir: {
								type: "string",
								description:
									"Output directory for gate results",
							},
						},
					},
				},
				{
					name: "merge_apply",
					description:
						"Apply merge operations (requires ALLOW_MUTATIONS=true)",
					inputSchema: {
						type: "object",
						properties: {
							dryRun: {
								type: "boolean",
								description:
									"Simulate merge without making changes",
								default: true,
							},
						},
					},
				},
				{
					name: "local_init",
					description:
						"Initialize local overlay directory with auto-detected project configuration",
					inputSchema: {
						type: "object",
						properties: {
							force: {
								type: "boolean",
								description:
									"Force recreation even if local overlay exists",
								default: false,
							},
						},
					},
				},
				{
					name: "profile_resolve",
					description:
						"Resolve profile directory using precedence chain (--profile-dir → LEX_PR_PROFILE_DIR → .smartergpt.local/ → .smartergpt/)",
					inputSchema: {
						type: "object",
						properties: {
							profileDir: {
								type: "string",
								description:
									"Optional profile directory override",
							},
						},
					},
				},
				{
					name: "health",
					description:
						"Get health status of the system with optional metrics",
					inputSchema: {
						type: "object",
						properties: {
							includeMetrics: {
								type: "boolean",
								description:
									"Include detailed metrics in response",
								default: false,
							},
						},
					},
				},
				// ─────────────────────────────────────────────────────────────────
				// Senior Dev Executor Tools
				// ─────────────────────────────────────────────────────────────────
				{
					name: "executor_prepare_context",
					description:
						"Phase 1: Gather deterministic artifacts for code review (lint, typecheck, tests, diff, PR metadata)",
					inputSchema: {
						type: "object",
						properties: {
							pr_number: {
								type: "string",
								description: "PR number to prepare context for",
							},
							base_branch: {
								type: "string",
								description:
									"Base branch for diff (default: main)",
								default: "main",
							},
							output_dir: {
								type: "string",
								description:
									"Output directory for artifacts (default: /tmp/senior-dev-review-...)",
							},
							skip_tests: {
								type: "boolean",
								description: "Skip running tests",
								default: false,
							},
							skip_lint: {
								type: "boolean",
								description: "Skip running lint",
								default: false,
							},
							skip_typecheck: {
								type: "boolean",
								description: "Skip running typecheck",
								default: false,
							},
						},
						required: ["pr_number"],
					},
				},
				{
					name: "executor_recall_context",
					description:
						"Phase 1: Recall relevant Frames from Lex memory (module reviews, developer history, patterns)",
					inputSchema: {
						type: "object",
						properties: {
							query_type: {
								type: "string",
								enum: ["module", "developer", "pattern", "pr"],
								description:
									"Type of query: module, developer, pattern, or pr",
							},
							query: {
								type: "string",
								description:
									"Query value (required for module, developer, pr; optional for pattern)",
							},
							limit: {
								type: "number",
								description:
									"Maximum frames to return (default: 10)",
								default: 10,
							},
						},
						required: ["query_type"],
					},
				},
				{
					name: "executor_capture_frame",
					description:
						"Phase 4: Capture review session as a Frame in Lex memory (the receipt)",
					inputSchema: {
						type: "object",
						properties: {
							pr_number: {
								type: "string",
								description: "PR number being reviewed",
							},
							module: {
								type: "string",
								description:
									"Primary module (must match lexmap.policy.json)",
							},
							summary: {
								type: "string",
								description:
									"One-line summary of review findings",
							},
							next_action: {
								type: "string",
								description: "Follow-up action required",
							},
							developer: {
								type: "string",
								description:
									"Developer name for tracking (default: unknown)",
								default: "unknown",
							},
							severity: {
								type: "string",
								enum: [
									"blocker",
									"must-fix",
									"should-fix",
									"nit",
									"praise",
									"review",
								],
								description:
									"Highest severity level (default: review)",
								default: "review",
							},
							jira: {
								type: "string",
								description: "Jira ticket ID if applicable",
							},
							blockers: {
								type: "array",
								items: { type: "string" },
								description: "List of blockers",
							},
						},
						required: [
							"pr_number",
							"module",
							"summary",
							"next_action",
						],
					},
				},
				{
					name: "executor_modes",
					description:
						"List available executor modes (triage, deep_review, pattern_mining, mentorship)",
					inputSchema: {
						type: "object",
						properties: {},
					},
				},
				// ─────────────────────────────────────────────────────────────────
				// LexRunner Run Management Tools
				// ─────────────────────────────────────────────────────────────────
				{
					name: "start_run",
					description:
						"Start a new LexRunner procedure run and return a runId",
					inputSchema: {
						type: "object",
						properties: {
							mode: {
								type: "string",
								description:
									"Persona mode (e.g., 'senior-dev', 'eager-pm')",
							},
							procedure: {
								type: "string",
								description:
									"Procedure identifier (e.g., 'merge-weave-main', 'pr-review')",
							},
							repo: {
								type: "string",
								description:
									"Repository in 'owner/repo' format",
							},
							task: {
								type: "string",
								description: "Human-readable task description",
							},
							params: {
								type: "object",
								description: "Procedure-specific parameters",
							},
						},
						required: ["mode", "procedure", "repo"],
					},
				},
				{
					name: "get_status",
					description:
						"Get current run state, summary, and next available actions",
					inputSchema: {
						type: "object",
						properties: {
							runId: {
								type: "string",
								description: "Unique run identifier",
							},
						},
						required: ["runId"],
					},
				},
				{
					name: "list_artifacts",
					description:
						"List runs from the store with optional filtering",
					inputSchema: {
						type: "object",
						properties: {
							limit: {
								type: "number",
								description: "Maximum number of runs to return",
							},
							offset: {
								type: "number",
								description:
									"Number of runs to skip (for pagination)",
							},
							state: {
								type: "string",
								enum: [
									"pending",
									"running",
									"completed",
									"failed",
									"aborted",
								],
								description: "Filter by run state",
							},
						},
					},
				},
				{
					name: "run_decision",
					description:
						"Submit an LLM decision for a pending action in a run",
					inputSchema: {
						type: "object",
						properties: {
							runId: {
								type: "string",
								description: "Unique run identifier",
							},
							action: {
								type: "string",
								description:
									"Action to submit (must match a nextOptions[x].action)",
							},
							response: {
								description:
									"Response data (validated against nextOptions[x].responseSchema)",
							},
							rationale: {
								type: "string",
								description:
									"Optional rationale for audit trail",
							},
						},
						required: ["runId", "action", "response"],
					},
				},
				// ─────────────────────────────────────────────────────────────────
				// MCP/CLI Parity Tools (AX-004)
				// ─────────────────────────────────────────────────────────────────
				{
					name: "discover",
					description:
						"Discover open pull requests from GitHub with optional dependency suggestions. Requires GITHUB_TOKEN environment variable.",
					inputSchema: {
						type: "object",
						properties: {
							owner: {
								type: "string",
								description: "GitHub repository owner",
							},
							repo: {
								type: "string",
								description: "GitHub repository name",
							},
							state: {
								type: "string",
								enum: ["open", "closed", "all"],
								description: "PR state filter (default: open)",
								default: "open",
							},
							suggest: {
								type: "boolean",
								description:
									"Generate dependency suggestions using heuristics",
								default: false,
							},
						},
					},
				},
				{
					name: "weave_status",
					description:
						"Show current execution status and merge eligibility for a plan",
					inputSchema: {
						type: "object",
						properties: {
							planFile: {
								type: "string",
								description:
									"Path to plan.json file (default: plan.json)",
								default: "plan.json",
							},
						},
					},
				},
				{
					name: "doctor",
					description:
						"Run environment and configuration sanity checks with optional hostility scoring",
					inputSchema: {
						type: "object",
						properties: {
							environmentQuality: {
								type: "boolean",
								description:
									"Include environmental hostility scoring in the check",
								default: false,
							},
						},
					},
				},
				{
					name: "merge_order",
					description:
						"Compute dependency levels and merge order using Kahn's algorithm",
					inputSchema: {
						type: "object",
						properties: {
							planFile: {
								type: "string",
								description:
									"Path to plan.json file (default: plan.json)",
								default: "plan.json",
							},
						},
					},
				},
				{
					name: "config_show",
					description:
						"Display configuration with precedence chain and provenance",
					inputSchema: {
						type: "object",
						properties: {
							key: {
								type: "string",
								description: "Show specific configuration key",
							},
						},
					},
				},
				// ─────────────────────────────────────────────────────────────────
				// Workflow Guidance Tools (LPR-037)
				// ─────────────────────────────────────────────────────────────────
				{
					name: "workflow_guide",
					description:
						"Get context-aware workflow guidance for the current phase. " +
						"Provides next steps, common issues, and recommendations.",
					inputSchema: {
						type: "object",
						properties: {
							phase: {
								type: "string",
								enum: [
									"initial",
									"post-plan-creation",
									"post-gates-run",
									"pre-merge",
									"post-merge",
									"error-recovery",
								],
								description:
									"Current workflow phase to get guidance for",
							},
						},
						required: ["phase"],
					},
				},
				// ─────────────────────────────────────────────────────────────────
				// Governance Metrics Tools (Wave 3)
				// ─────────────────────────────────────────────────────────────────
				{
					name: "metrics",
					description:
						"Get current governance metrics snapshot for observability dashboards",
					inputSchema: {
						type: "object",
						properties: {
							filter: {
								type: "string",
								description:
									"Filter metrics by name pattern (e.g., 'turn_cost', 'tier')",
							},
							format: {
								type: "string",
								enum: ["json", "prometheus"],
								description: "Output format (default: json)",
								default: "json",
							},
						},
					},
				},
			],
		};
	});

	// Handle tool calls
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		switch (name) {
			// Plan tools
			case "plan_create":
					case "lexrunner_plan_create": // deprecated alias
			case "plan.create": // Deprecated alias
				return await handlePlanCreate(args as PlanCreateArgs);

			case "pr_list":
				return await handlePrList(args as PrListArgs);

			case "plan_validate":
				return await handlePlanValidate(args as PlanValidateArgs);

			case "plan_analyze":
				return await handlePlanAnalyze(args as PlanAnalyzeArgs);

			// Gate tools
			case "gates_run":
					case "lexrunner_gate_run": // deprecated alias
			case "gates.run": // Deprecated alias
				return await handleGatesRun(args as GatesRunArgs);

			// Weave tools
			case "merge_apply":
					case "lexrunner_weave_apply": // deprecated alias
			case "merge.apply": // Deprecated alias
				return await handleMergeApply(args as MergeApplyArgs);

			case "discover":
					case "lexrunner_weave_discover": // deprecated alias
			case "discover": // Deprecated alias
				return await handleDiscover(
					args as {
						owner?: string;
						repo?: string;
						state?: string;
						suggest?: boolean;
					}
				);

			case "weave_status":
					case "lexrunner_weave_status": // deprecated alias
			case "status": // Deprecated alias
				return await handleStatus(args as { planFile?: string });

			case "merge_order":
					case "lexrunner_weave_order": // deprecated alias
			case "merge-order": // Deprecated alias
				return await handleMergeOrder(args as { planFile?: string });

			// Workspace tools
			case "local_init":
					case "lexrunner_workspace_init": // deprecated alias
			case "local.init": // Deprecated alias
				return await handleLocalInit(args as InitLocalArgs);

			case "profile_resolve":
					case "lexrunner_workspace_resolve": // deprecated alias
			case "profile.resolve": // Deprecated alias
				return await handleProfileResolve(args as ProfileResolveArgs);

			case "doctor":
					case "lexrunner_workspace_doctor": // deprecated alias
			case "doctor": // Deprecated alias
				return await handleDoctor(
					args as { environmentQuality?: boolean }
				);

			// Core tools
			case "health":
					case "lexrunner_core_health": // deprecated alias
			case "health": // Deprecated alias
				return await handleHealth(args as { includeMetrics?: boolean });

			case "config_show":
					case "lexrunner_core_config": // deprecated alias
			case "config.show": // Deprecated alias
				return await handleConfigShow(args as { key?: string });

			case "workflow_guide":
					case "lexrunner_core_guide": // deprecated alias
			case "workflow.guide": // Deprecated alias
				return await handleWorkflowGuide(args as WorkflowGuideArgs);

			case "metrics":
					case "lexrunner_core_metrics": // deprecated alias
			case "metrics": // Deprecated alias
				return await handleMetrics(
					args as { filter?: string; format?: string }
				);

			// Executor tools (Senior Dev)
			case "executor_prepare_context":
					case "lexrunner_executor_prepare_context": // deprecated alias
			case "senior-dev.prepare-context": // Deprecated alias
				return await handleSeniorDevPrepareContext(
					args as unknown as PrepareContextInput
				);

			case "executor_recall_context":
					case "lexrunner_executor_recall_context": // deprecated alias
			case "senior-dev.recall-context": // Deprecated alias
				return await handleSeniorDevRecallContext(
					args as unknown as RecallContextInput
				);

			case "executor_capture_frame":
					case "lexrunner_executor_capture_frame": // deprecated alias
			case "senior-dev.capture-frame": // Deprecated alias
				return await handleSeniorDevCaptureFrame(
					args as unknown as CaptureFrameInput
				);

			case "executor_modes":
					case "lexrunner_executor_modes": // deprecated alias
			case "senior-dev.modes": // Deprecated alias
				return await handleSeniorDevModes();

			// Run management tools
			case "start_run":
					case "lexrunner_run_start": // deprecated alias
			case "lexrunner.startRun": // Deprecated alias
				return await handleStartRun(
					args as unknown as StartRunInput,
					runStore
				);

			case "get_status":
					case "lexrunner_run_status": // deprecated alias
			case "lexrunner.getStatus": // Deprecated alias
				return await handleGetStatus(
					args as unknown as GetStatusInput,
					runStore
				);

			case "list_artifacts":
					case "lexrunner_run_list": // deprecated alias
			case "lexrunner.listRuns": // Deprecated alias
				return await handleListRuns(
					args as unknown as ListRunsInput,
					runStore
				);

			case "run_decision":
					case "lexrunner_run_decision": // deprecated alias
			case "lexrunner.submitDecision": // Deprecated alias
				return await handleSubmitDecision(
					args as unknown as SubmitDecisionInput
				);

			default:
				throw new McpError(
					ErrorCode.MethodNotFound,
					`Unknown tool: ${name}`
				);
		}
	});

	return server;
}

/**
 * Check if GitHub token is available and throw helpful error if not
 */
function ensureGitHubToken(providedToken?: string): void {
	const token = providedToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	
	if (!token) {
		const axError = githubApiError({
			status: 401,
			message: 
				'GitHub authentication required. Set GITHUB_TOKEN environment variable.\n' +
				'\n' +
				'To fix:\n' +
				'  export GITHUB_TOKEN=ghp_...\n' +
				'\n' +
				'See: https://github.com/Guffawaffle/lexrunner#authentication'
		});
		throwMcpAXError(ErrorCode.InvalidRequest, axError);
	}
}

/**
 * Handle plan.create tool
 */
async function handlePlanCreate(
	args: PlanCreateArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const env = getMCPEnvironment();

		// Resolve profile and validate write permissions
		const resolved = resolveProfile(undefined, process.cwd());
		const profilePath = resolved.path;
		const role = resolved.manifest.role;

		let plan;
		let inputs = null;
		let autoDetectedGitHubMode = false;

		// Auto-detect GitHub mode from scope.yml if fromGithub not explicitly set
		if (!args.fromGithub) {
			const detection = detectGitHubMode(profilePath);
			if (detection.shouldUseGitHub) {
				autoDetectedGitHubMode = true;
				// Merge scope.yml filters with args (args take precedence)
				args.fromGithub = true;
				if (!args.query && detection.scopeConfig?.query) {
					args.query = detection.scopeConfig.query;
				}
				if (
					!args.labels &&
					detection.scopeConfig?.labels &&
					detection.scopeConfig.labels.length > 0
				) {
					args.labels = detection.scopeConfig.labels;
				}
				if (!args.target && detection.scopeConfig?.target) {
					args.target = detection.scopeConfig.target;
				}

				console.error(
					"[mcp:plan.create] Auto-detected GitHub mode from scope.yml filters"
				);
			}
		}

		if (args.fromGithub) {
			// Check for GitHub authentication before making API calls
			ensureGitHubToken(args.githubToken);
			
			// GitHub mode: auto-discover PRs
			const client = await createGitHubClient({
				token: args.githubToken,
				owner: args.owner,
				repo: args.repo,
			});

			// Parse required gates if provided
			const requiredGates = args.requiredGates || [
				"lint",
				"typecheck",
				"test",
			];

			// Parse max workers if provided
			const maxWorkers = args.maxWorkers || 2;

			// Generate plan from GitHub
			plan = await generatePlanFromGitHub(client, {
				query: args.query,
				labels: args.labels,
				excludePRs: args.excludePRs,
				includeDrafts: args.includeDrafts,
				target: args.target,
				policy: {
					requiredGates,
					maxWorkers,
				},
			});

			// Log discovery results to stderr
			const repoDiag = `${client.getOwner()}/${client.getRepo()}`;
			const filterInfo = args.labels
				? ` labels=${args.labels.join(",")}`
				: "";
			const queryInfo = args.query ? ` query="${args.query}"` : "";
			console.error(
				`[mcp:plan.create] repo=${repoDiag}${filterInfo}${queryInfo} discovered=${plan.items.length} PRs`
			);

			if (plan.items.length === 0) {
				console.error(
					`[mcp:plan.create] Warning: No PRs found matching criteria. Check filters and repository state.`
				);
			} else {
				const prNumbers = plan.items
					.map((item) => item.name)
					.join(", ");
				console.error(`[mcp:plan.create] PRs included: ${prNumbers}`);
			}
		} else {
			// Traditional mode: load from configuration files
			inputs = loadInputs(profilePath);
			plan = generatePlan(inputs);
		}

		// Determine output directory
		const outDir = args.outDir || path.join(profilePath, "runner");

		// Validate write operation is allowed
		validateWriteOperation(profilePath, role, "write plan artifacts");

		// Ensure output directory exists
		if (!fs.existsSync(outDir)) {
			fs.mkdirSync(outDir, { recursive: true });
		}

		// Write plan.json
		const planPath = path.join(outDir, "plan.json");
		const planJson = canonicalJSONStringify(plan);
		fs.writeFileSync(planPath, planJson + "\n");

		// Generate snapshot - use GitHub snapshot for GitHub mode
		let snapshot: string;
		if (args.fromGithub) {
			snapshot = generateGitHubSnapshot(plan);
		} else {
			// In traditional mode, inputs is guaranteed to be set
			if (!inputs) {
				const axError = mcpToolError(
					ErrorCodes.INTERNAL_ERROR,
					"Internal error: inputs not loaded in traditional mode",
					{ tool: "plan.create", operation: "generate snapshot" }
				);
				throwMcpAXError(ErrorCode.InternalError, axError);
			}
			snapshot = generateSnapshot(plan, inputs);
		}
		const snapshotPath = path.join(outDir, "snapshot.md");
		fs.writeFileSync(snapshotPath, snapshot);

		const result: PlanCreateResult = {
			plan: plan,
			outDir: outDir,
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof WriteProtectionError) {
			const axError = writeProtectionError(error.message, "plan.create");
			throwMcpAXError(ErrorCode.InvalidRequest, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"plan.create",
			error,
			"create plan"
		);
	}
}

/**
 * Handle pr_list tool
 * Lists pull requests from GitHub without creating a plan
 */
async function handlePrList(
	args: PrListArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Check for GitHub authentication early
		ensureGitHubToken(args.githubToken);

		// Create GitHub client
		const client = await createGitHubClient({
			token: args.githubToken,
			owner: args.owner,
			repo: args.repo,
		});

		// Validate repository access
		const repoInfo = await client.validateRepository();

		// Get state parameter (default to "open")
		const state = args.state || "open";

		// Discover PRs based on query/filters
		const prs = await client.listOpenPRs({
			state,
			labels: args.labels,
			...(args.query ? { query: args.query } : {})
		});

		// Default behavior: include drafts unless explicitly disabled
		const includeDrafts = args.includeDrafts === undefined ? true : Boolean(args.includeDrafts);
		const filteredPRs = includeDrafts ? prs : prs.filter(pr => !pr.draft);

		// Exclude specific PRs if requested
		const excludePRs = args.excludePRs || [];
		const finalPRs = excludePRs.length > 0
			? filteredPRs.filter(pr => !excludePRs.includes(pr.number))
			: filteredPRs;

		// Transform to result format
		const result: PrListResult = {
			pullRequests: finalPRs.map(pr => ({
				number: pr.number,
				title: pr.title,
				branch: pr.headRef,
				author: pr.author,
				labels: pr.labels,
				sha: pr.sha,
				draft: pr.draft
			})),
			total: prs.length,
			filtered: finalPRs.length,
			owner: client.getOwner(),
			repo: client.getRepo()
		};

		// Log discovery results to stderr
		const repoDiag = `${client.getOwner()}/${client.getRepo()}`;
		const filterInfo = args.labels ? ` labels=${args.labels.join(",")}` : "";
		const queryInfo = args.query ? ` query="${args.query}"` : "";
		console.error(
			`[mcp:pr_list] repo=${repoDiag}${filterInfo}${queryInfo} found=${result.filtered}/${result.total} PRs`
		);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof GitHubAPIError) {
			const axError = githubApiError({
				message: error.message,
				statusCode: error.statusCode,
			});
			throwMcpAXError(ErrorCode.InternalError, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"pr_list",
			error,
			"list pull requests"
		);
	}
}

/**
 * Handle plan_validate tool
 * Validates a plan.json file for schema compliance and logical consistency
 */
async function handlePlanValidate(
	args: PlanValidateArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		let planContent: string;
		let planPath: string | undefined;

		// Get plan content either from file or direct content
		if (args.planContent) {
			planContent = args.planContent;
		} else {
			// Resolve plan file path
			if (args.planFile) {
				planPath = args.planFile;
			} else {
				const resolved = resolveProfile(undefined, process.cwd());
				planPath = path.join(resolved.path, "runner", "plan.json");
			}

			// Check if plan file exists
			if (!fs.existsSync(planPath)) {
				throwMcpAXError(
					ErrorCode.InvalidParams,
					planNotFoundError(planPath)
				);
			}

			planContent = fs.readFileSync(planPath, "utf-8");
		}

		// Try to validate the plan
		const result: PlanValidateResult = {
			valid: true,
			warnings: []
		};

		try {
			const plan = loadPlan(planContent);

			// Basic validation passed
			result.plan = {
				schemaVersion: plan.schemaVersion,
				target: plan.target,
				itemCount: plan.items.length
			};

			// Additional logical validations
			if (plan.items.length === 0) {
				result.warnings?.push("Plan contains no items");
			}

			// Check for duplicate item names
			const names = new Set<string>();
			const duplicates: string[] = [];
			for (const item of plan.items) {
				if (names.has(item.name)) {
					duplicates.push(item.name);
				}
				names.add(item.name);
			}
			if (duplicates.length > 0) {
				result.valid = false;
				result.errors = result.errors || [];
				result.errors.push({
					path: "items",
					message: `Duplicate item names found: ${duplicates.join(", ")}`,
					code: "DUPLICATE_NAMES"
				});
			}

			console.error(
				`[mcp:plan_validate] validated plan with ${plan.items.length} items, valid=${result.valid}`
			);
		} catch (error) {
			result.valid = false;
			result.errors = [];

			if (error instanceof AXErrorException) {
				result.errors.push({
					path: "root",
					message: error.message,
					code: error.code
				});
			} else if (error instanceof Error) {
				result.errors.push({
					path: "root",
					message: error.message
				});
			}

			console.error(`[mcp:plan_validate] validation failed: ${error}`);
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"plan_validate",
			error,
			"validate plan"
		);
	}
}

/**
 * Handle plan_analyze tool
 * Analyzes a plan for conflicts and dependency issues (dry-run)
 */
async function handlePlanAnalyze(
	args: PlanAnalyzeArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		let planPath: string;

		// Resolve plan file path
		if (args.planFile) {
			planPath = args.planFile;
		} else {
			const resolved = resolveProfile(undefined, process.cwd());
			planPath = path.join(resolved.path, "runner", "plan.json");
		}

		// Check if plan file exists
		if (!fs.existsSync(planPath)) {
			throwMcpAXError(
				ErrorCode.InvalidParams,
				planNotFoundError(planPath)
			);
		}

		// Load and validate plan
		const planContent = fs.readFileSync(planPath, "utf-8");
		const plan = loadPlan(planContent);

		const result: PlanAnalyzeResult = {
			valid: true,
			conflicts: [],
			dependencies: {
				total: 0,
			},
			summary: {
				totalItems: plan.items.length,
				maxParallelism: 0,
				hasIssues: false
			}
		};

		// Count dependencies
		for (const item of plan.items) {
			if (item.dependsOn) {
				result.dependencies.total += item.dependsOn.length;
			}
		}

		// Try to compute merge order (will detect cycles and unknown deps)
		try {
			const levels = computeMergeOrder(plan.items);
			result.mergeOrder = levels;
			result.summary.maxParallelism = Math.max(...levels.map(l => l.length));

			console.error(
				`[mcp:plan_analyze] analyzed plan: ${plan.items.length} items, ${levels.length} levels, max parallelism=${result.summary.maxParallelism}`
			);
		} catch (error) {
			result.valid = false;
			result.summary.hasIssues = true;

			if (error instanceof CycleError) {
				result.dependencies.cycles = [[...error.cycle]];
				result.conflicts?.push({
					type: "cycle",
					message: `Dependency cycle detected: ${error.cycle.join(" -> ")}`,
					items: error.cycle
				});
				console.error(`[mcp:plan_analyze] cycle detected: ${error.cycle.join(" -> ")}`);
			} else if (error instanceof UnknownDependencyError) {
				result.dependencies.unknown = [error.dependency];
				result.conflicts?.push({
					type: "unknown_dependency",
					message: `Unknown dependency: ${error.dependency} referenced by ${error.item}`,
					items: [error.item, error.dependency]
				});
				console.error(`[mcp:plan_analyze] unknown dependency: ${error.dependency}`);
			} else {
				result.conflicts?.push({
					type: "analysis_error",
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"plan_analyze",
			error,
			"analyze plan"
		);
	}
}

/**
 * Handle gates.run tool
 */
async function handleGatesRun(
	args: GatesRunArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const env = getMCPEnvironment();

		let planPath: string;
		let outDirBase: string;

		// Use planFile if provided, otherwise fall back to internal state
		if (args.planFile) {
			// Validate that the plan file exists
			if (!fs.existsSync(args.planFile)) {
				throwMcpAXError(
					ErrorCode.InvalidParams,
					planNotFoundError(args.planFile)
				);
			}

			planPath = args.planFile;
			// For external plans, use the plan file's directory as the base for output
			outDirBase = path.dirname(args.planFile);
		} else {
			// Resolve profile directory for internal state
			const resolved = resolveProfile(
				env.LEX_PR_PROFILE_DIR,
				process.cwd()
			);

			// Load plan from resolved profile directory
			planPath = path.join(resolved.path, "runner", "plan.json");
			if (!fs.existsSync(planPath)) {
				throwMcpAXError(
					ErrorCode.InvalidParams,
					planNotFoundError(planPath)
				);
			}

			outDirBase = path.join(resolved.path, "runner");
		}

		let planContent: string;
		try {
			planContent = fs.readFileSync(planPath, "utf-8");
		} catch (error) {
			const axError = mcpToolError(
				ErrorCodes.PLAN_NOT_FOUND,
				`Failed to read plan file ${planPath}`,
				{ tool: "gates.run", operation: "read plan file" }
			);
			throwMcpAXError(ErrorCode.InternalError, axError);
		}

		const plan = loadPlan(planContent);

		// Create execution state
		const executionState = new ExecutionState(plan);

		// Determine output directory
		const outDir = args.outDir || path.join(outDirBase, "gates");

		// Execute gates (this modifies executionState in place)
		await executeGatesWithPolicy(plan, executionState, outDir);

		// Get results from execution state
		const results = executionState.getResults();

		// Transform results to expected format
		const items = [];
		let allGreen = true;

		for (const [itemName, nodeResult] of results) {
			// Filter by onlyItem if specified
			if (args.onlyItem && itemName !== args.onlyItem) {
				continue;
			}

			// Filter gates by onlyGate if specified
			const gates =
				nodeResult.gates
					?.filter(
						(gate) => !args.onlyGate || gate.gate === args.onlyGate
					)
					.map((gate: any) => ({
						name: gate.gate,
						status: gate.status,
					})) || [];

			const itemResult = {
				name: itemName,
				status: nodeResult.status || "unknown",
				gates: gates,
			};

			items.push(itemResult);

			if (nodeResult.status !== "pass") {
				allGreen = false;
			}
		}

		const result: GatesRunResult = {
			items,
			allGreen,
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		// Check for plan not found specifically
		const message = error instanceof Error ? error.message : String(error);
		if (
			message.includes("Plan file not found") ||
			message.includes("No plan found")
		) {
			throwMcpAXError(
				ErrorCode.InvalidParams,
				planNotFoundError(args.planFile)
			);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"gates.run",
			error,
			"run gates"
		);
	}
}

/**
 * Handle merge.apply tool
 */
async function handleMergeApply(
	args: MergeApplyArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const env = getMCPEnvironment();

		// Resolve profile directory first to check role
		const resolved = resolveProfile(env.LEX_PR_PROFILE_DIR, process.cwd());

		// Validate CI environment if role is 'ci'
		validateCIEnvironment(resolved.manifest);

		// Get CI-aware mutation policy
		const allowMutations = getCIMutationPolicy(resolved.manifest);

		// Check if mutations are allowed
		if (!allowMutations && !args.dryRun) {
			const result: MergeApplyResult = {
				allowed: false,
				message:
					"Mutations not allowed. Set ALLOW_MUTATIONS=true or use dryRun=true.",
			};

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(result, null, 2),
					},
				],
			};
		}

		// Load plan and execution state
		const planPath = path.join(resolved.path, "runner", "plan.json");
		if (!fs.existsSync(planPath)) {
			throwMcpAXError(
				ErrorCode.InvalidParams,
				planNotFoundError(planPath)
			);
		}

		const planContent = fs.readFileSync(planPath, "utf-8");
		const plan = loadPlan(planContent);

		const executionState = new ExecutionState(plan);

		// TODO: Load actual execution results if available
		// For now, assume we're in read-only mode

		const evaluator = new MergeEligibilityEvaluator(plan, executionState);
		const decisions = evaluator.evaluateAllNodes();

		const summary = evaluator.getMergeSummary();

		const result: MergeApplyResult = {
			allowed: allowMutations && !args.dryRun,
			message: args.dryRun
				? `Dry run: ${summary.eligible.length} items eligible, ${summary.failed.length} failed`
				: allowMutations
				? `Ready to merge ${summary.eligible.length} eligible items`
				: "Mutations disabled. Set ALLOW_MUTATIONS=true to enable merging.",
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("No plan found")) {
			throwMcpAXError(ErrorCode.InvalidParams, planNotFoundError());
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"merge.apply",
			error,
			"apply merge"
		);
	}
}

/**
 * Handle local.init tool
 */
async function handleLocalInit(
	args: InitLocalArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const force = args.force ?? false;
		const result = initLocalOverlay(process.cwd(), force);

		const output: InitLocalResult = {
			created: result.created,
			path: result.path,
			config: result.config,
			copiedFiles: result.copiedFiles,
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(output, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"local.init",
			error,
			"initialize local overlay"
		);
	}
}

/**
 * Handle profile.resolve tool
 */
async function handleProfileResolve(
	args: ProfileResolveArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const env = getMCPEnvironment();

		// Use profile directory from args, or fall back to env, or use resolveProfile default logic
		const profileDirOverride = args.profileDir || env.LEX_PR_PROFILE_DIR;
		const resolved = resolveProfile(profileDirOverride, process.cwd());

		const output: ProfileResolveResult = {
			path: resolved.path,
			source: resolved.source,
			manifest: {
				role: resolved.manifest.role,
				name: resolved.manifest.name,
				version: resolved.manifest.version,
			},
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(output, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"profile.resolve",
			error,
			"resolve profile"
		);
	}
}

/**
 * Handle health check
 */
async function handleHealth(args: {
	includeMetrics?: boolean;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	const health = healthChecker.getHealth(args.includeMetrics || false);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(health, null, 2),
			},
		],
	};
}

/**
 * Main server startup
 */
async function main() {
	// Create RunStore (will be closed on shutdown)
	const runStore = createRunStore();
	const server = createServer({ runStore });
	const transport = new StdioServerTransport();

	// Connect the server to stdio transport
	await server.connect(transport);

	// Log to stderr so it doesn't interfere with MCP protocol
	console.error("MCP server started for lexrunner");

	// Keep the process alive by setting up event handlers
	// The event loop will keep running while the stdio transport is active
	process.stdin.resume();

	// Handle graceful shutdown when stdin closes
	process.stdin.on("end", async () => {
		console.error("MCP server shutting down");
		try {
			await runStore.close();
		} catch (error) {
			console.error("Error closing RunStore:", error);
		}
		process.exit(0);
	});

	// Never return - let the event loop handle everything
	await new Promise<void>(() => {
		// This promise never resolves, keeping the process alive
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Senior Dev Executor Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle senior-dev.prepare-context tool
 */
async function handleSeniorDevPrepareContext(
	args: PrepareContextInput
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const result = await prepareReviewContext(args);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"senior-dev.prepare-context",
			error,
			"prepare review context"
		);
	}
}

/**
 * Handle senior-dev.recall-context tool
 */
async function handleSeniorDevRecallContext(
	args: RecallContextInput
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const result = await recallSeniorDevContext(args);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"senior-dev.recall-context",
			error,
			"recall context"
		);
	}
}

/**
 * Handle senior-dev.capture-frame tool
 */
async function handleSeniorDevCaptureFrame(
	args: CaptureFrameInput
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const result = await captureSeniorDevFrame(args);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"senior-dev.capture-frame",
			error,
			"capture frame"
		);
	}
}

/**
 * Handle senior-dev.modes tool
 */
async function handleSeniorDevModes(): Promise<{
	content: [{ type: "text"; text: string }];
}> {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(EXECUTOR_MODES, null, 2),
			},
		],
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// LexRunner Run Management Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a plan hash from run parameters for RunRecord storage.
 */
function generatePlanHash(input: StartRunInput): string {
	const hashContent = JSON.stringify({
		mode: input.mode,
		procedure: input.procedure,
		repo: input.repo,
		params: input.params,
	});
	return (
		"sha256:" +
		crypto.createHash("sha256").update(hashContent).digest("hex")
	);
}

/**
 * Handle lexrunner.startRun tool
 *
 * Creates a run record in both the RunStore (for persistence) and RunManager
 * (for orchestration state).
 */
async function handleStartRun(
	args: StartRunInput,
	runStore: RunStore
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Validate input
		const validated = StartRunInputSchema.parse(args);

		// Create run manager and start the run (for orchestration state)
		const manager = createRunManager();
		const result = manager.startRun(validated);

		// Also create a record in the RunStore for persistence
		const now = new Date().toISOString();
		await runStore.createRun({
			runId: result.runId,
			planHash: generatePlanHash(validated),
			state: "pending", // RunStore uses its own state machine
			startedAt: now,
			metadata: {
				mode: validated.mode,
				procedure: validated.procedure,
				repo: validated.repo,
				task: validated.task,
			},
		});

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof Error && error.name === "ZodError") {
			const axError = mcpToolError(
				ErrorCodes.INVALID_INPUT,
				`Invalid startRun parameters: ${error.message}`,
				{ tool: "lexrunner.startRun", operation: "validate parameters" }
			);
			throwMcpAXError(ErrorCode.InvalidParams, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"lexrunner.startRun",
			error,
			"start run"
		);
	}
}

/**
 * Handle lexrunner.getStatus tool
 *
 * Queries run state from RunManager, and also fetches step/receipt data
 * from RunStore for enhanced status reporting.
 */
async function handleGetStatus(
	args: GetStatusInput,
	runStore: RunStore
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Validate input
		const validated = GetStatusInputSchema.parse(args);

		// Get orchestration status from run manager
		const manager = createRunManager();
		const status = manager.getStatus(validated);

		// Fetch additional data from RunStore if available
		const runRecord = await runStore.getRun(validated.runId);
		const steps = await runStore.getStepsForRun(validated.runId);
		const receipts = await runStore.getReceiptsForRun(validated.runId);

		// Enhance status with store data
		const enhancedStatus = {
			...status,
			store: runRecord
				? {
						runRecord,
						steps,
						receipts,
				  }
				: null,
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(enhancedStatus, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof RunNotFoundError) {
			const axError = mcpToolError(
				ErrorCodes.INTERNAL_ERROR,
				error.message,
				{ tool: "lexrunner.getStatus" },
				[
					"Check that runId is valid",
					"List available runs with 'lexrunner.listRuns'",
				]
			);
			throwMcpAXError(ErrorCode.InvalidParams, axError);
		}
		if (error instanceof Error && error.name === "ZodError") {
			const axError = mcpToolError(
				ErrorCodes.INVALID_INPUT,
				`Invalid getStatus parameters: ${error.message}`,
				{
					tool: "lexrunner.getStatus",
					operation: "validate parameters",
				}
			);
			throwMcpAXError(ErrorCode.InvalidParams, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"lexrunner.getStatus",
			error,
			"get status"
		);
	}
}

/**
 * Handle lexrunner.listRuns tool
 *
 * Queries the RunStore for run records with optional filtering and pagination.
 */
async function handleListRuns(
	args: ListRunsInput,
	runStore: RunStore
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Validate input
		const validated = ListRunsInputSchema.parse(args);

		// Query runs from the store
		const options: ListRunsOptions = {};
		if (validated.limit !== undefined) {
			options.limit = validated.limit;
		}
		if (validated.offset !== undefined) {
			options.offset = validated.offset;
		}
		if (validated.state !== undefined) {
			options.state = validated.state;
		}

		const runs = await runStore.listRuns(options);
		const count = await runStore.getRunCount(validated.state);

		const result = {
			runs,
			total: count,
			limit: validated.limit,
			offset: validated.offset ?? 0,
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof Error && error.name === "ZodError") {
			const axError = mcpToolError(
				ErrorCodes.INVALID_INPUT,
				`Invalid listRuns parameters: ${error.message}`,
				{ tool: "lexrunner.listRuns", operation: "validate parameters" }
			);
			throwMcpAXError(ErrorCode.InvalidParams, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"lexrunner.listRuns",
			error,
			"list runs"
		);
	}
}

/**
 * Handle lexrunner.submitDecision tool
 *
 * Validates and submits an LLM decision for a pending action in a run.
 */
async function handleSubmitDecision(
	args: SubmitDecisionInput
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Validate input
		const validated = SubmitDecisionInputSchema.parse(args);

		// Submit the decision (uses process.cwd() as baseDir)
		const result = submitDecision(validated);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof Error && error.name === "ZodError") {
			const axError = mcpToolError(
				ErrorCodes.INVALID_INPUT,
				`Invalid submitDecision parameters: ${error.message}`,
				{
					tool: "lexrunner.submitDecision",
					operation: "validate parameters",
				}
			);
			throwMcpAXError(ErrorCode.InvalidParams, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"lexrunner.submitDecision",
			error,
			"submit decision"
		);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP/CLI Parity Handlers (AX-004)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle discover tool - Discover open pull requests from GitHub
 */
async function handleDiscover(args: {
	owner?: string;
	repo?: string;
	state?: string;
	suggest?: boolean;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Check for GitHub authentication early
		ensureGitHubToken();
		
		let githubAPI = await createGitHubAPI();

		// Override with arguments if provided
		if (args.owner && args.repo) {
			githubAPI = new GitHubAPI({
				owner: args.owner,
				repo: args.repo,
				token: process.env.GITHUB_TOKEN,
			});
		}

		if (!githubAPI) {
			const axError = githubApiError({
				message:
					"Could not detect GitHub repository. Provide owner and repo parameters or run from a git repository with GitHub remote.",
			});
			throwMcpAXError(ErrorCode.InvalidRequest, axError);
		}

		// Check authentication
		const authStatus = await githubAPI.checkAuth();

		// Fetch pull requests
		const state = (args.state || "open") as "open" | "closed" | "all";
		const pullRequests = await githubAPI.discoverPullRequests(state);

		let result: Record<string, unknown>;

		if (args.suggest) {
			// Generate dependency suggestions using heuristics
			const { createFileAnalyzer } = await import(
				"../planner/fileAnalysis.js"
			);

			const analyzer = createFileAnalyzer(
				githubAPI.getOctokit(),
				githubAPI.config.owner,
				githubAPI.config.repo
			);
			const prs = pullRequests.map(
				(pr: { number: number; sha: string }) => ({
					number: pr.number,
					name: `PR-${pr.number}`,
					sha: pr.sha,
				})
			);

			const suggestions =
				await analyzer.suggestDependenciesWithHeuristics(prs);

			result = {
				pullRequests,
				suggestions,
				total: pullRequests.length,
				suggestionsCount: suggestions.length,
				authenticated: authStatus.authenticated,
				user: authStatus.user,
			};
		} else {
			result = {
				pullRequests,
				total: pullRequests.length,
				authenticated: authStatus.authenticated,
				user: authStatus.user,
			};
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof McpError) {
			throw error;
		}
		// Handle GitHub API errors specifically with status code context
		if (error instanceof GitHubAPIError) {
			const axError = githubApiError({
				status: error.status,
				message: error.message,
			});
			throwMcpAXError(ErrorCode.InternalError, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"discover",
			error,
			"discover PRs"
		);
	}
}

/**
 * Handle status tool - Show execution status and merge eligibility
 */
async function handleStatus(args: {
	planFile?: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const planFile = args.planFile || "plan.json";

		if (!fs.existsSync(planFile)) {
			throwMcpAXError(
				ErrorCode.InvalidParams,
				planNotFoundError(planFile)
			);
		}

		const planContent = fs.readFileSync(planFile, "utf-8");
		const plan = loadPlan(planContent);

		// Create execution state (for now, show plan structure)
		const executionState = new ExecutionState(plan);
		const evaluator = new MergeEligibilityEvaluator(plan, executionState);
		const mergeSummary = evaluator.getMergeSummary();

		// Calculate tier metrics from plan items
		const tierAssignments = suggestTiersForPlan(plan.items);
		const tierMetrics = calculateTierMetrics(tierAssignments);

		// Run environment quality check for hostility score
		const hostilityScore = runEnvironmentQualityCheck();

		// Build governance status
		const governanceStatus = buildGovernanceStatus(
			tierMetrics,
			undefined, // Turn cost tracked during actual runs
			hostilityScore
		);

		const result = {
			plan: {
				schemaVersion: plan.schemaVersion,
				target: plan.target,
				itemCount: plan.items.length,
				policy: plan.policy,
			},
			mergeSummary,
			governance: governanceStatusToJSON(governanceStatus),
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof McpError) {
			throw error;
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"status",
			error,
			"get status"
		);
	}
}

/**
 * Handle doctor tool - Environment and configuration sanity checks
 */
async function handleDoctor(args: {
	environmentQuality?: boolean;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const checks: Record<string, unknown> = {
			hasErrors: false,
			issues: [] as string[],
			suggestions: [] as string[],
		};

		// Node.js version check
		try {
			const nvmrcContent = fs.readFileSync(".nvmrc", "utf-8").trim();
			const currentVersion = process.version.slice(1);
			const expectedVersion = nvmrcContent;

			if (currentVersion === expectedVersion) {
				checks.nodejs = {
					status: "ok",
					current: process.version,
					expected: `v${expectedVersion}`,
				};
			} else {
				checks.nodejs = {
					status: "mismatch",
					current: process.version,
					expected: `v${expectedVersion}`,
				};
				checks.hasErrors = true;
				(checks.issues as string[]).push(
					`Node.js version mismatch: ${process.version} vs v${expectedVersion}`
				);
			}
		} catch {
			checks.nodejs = {
				status: "no_constraint",
				current: process.version,
			};
			(checks.suggestions as string[]).push(
				"Consider adding .nvmrc file for Node.js version consistency"
			);
		}

		// Configuration check
		const bootstrap = bootstrapWorkspace();
		checks.configuration = {
			hasConfiguration: bootstrap.hasConfiguration,
			missingFiles: bootstrap.missingFiles,
			suggestions: bootstrap.suggestions,
		};

		// Project type detection
		checks.projectType = detectProjectType();

		// Environment suggestions
		checks.environmentSuggestions = getEnvironmentSuggestions();

		// GitHub integration check
		try {
			const githubAPI = await createGitHubAPI();
			if (githubAPI) {
				const authStatus = await githubAPI.checkAuth();
				checks.github = {
					detected: true,
					authenticated: authStatus.authenticated,
					user: authStatus.user,
				};
			} else {
				checks.github = { detected: false };
			}
		} catch (error) {
			checks.github = {
				detected: false,
				error: (error as Error).message,
			};
		}

		// Git operations check
		try {
			const gitOps = createGitOperations();
			const isClean = await gitOps.isClean();
			const currentBranch = await gitOps.getCurrentBranch();

			checks.git = {
				status: "ok",
				isClean,
				currentBranch,
			};
		} catch (error) {
			checks.git = {
				status: "error",
				error: (error as Error).message,
			};
			checks.hasErrors = true;
			(checks.issues as string[]).push(
				`Git operations failed: ${(error as Error).message}`
			);
		}

		// Environment quality check (hostility scoring) if requested
		if (args.environmentQuality) {
			checks.environmentQuality = runEnvironmentQualityCheck();
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(checks, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"doctor",
			error,
			"run doctor"
		);
	}
}

/**
 * Handle merge-order tool - Compute dependency levels and merge order
 */
async function handleMergeOrder(args: {
	planFile?: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const planFile = args.planFile || "plan.json";

		if (!fs.existsSync(planFile)) {
			throwMcpAXError(
				ErrorCode.InvalidParams,
				planNotFoundError(planFile)
			);
		}

		const planContent = fs.readFileSync(planFile, "utf-8");
		const plan = loadPlan(planContent);

		// Compute merge order using Kahn's algorithm
		const levels = computeMergeOrder(plan);

		const result = {
			levels,
			totalItems: plan.items.length,
			maxParallelism: Math.max(...levels.map((level) => level.length)),
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof McpError) {
			throw error;
		}
		// Handle AXErrorException instances (including CycleError, UnknownDependencyError)
		if (isAXErrorException(error)) {
			const axError = error.toAXError();
			throwMcpAXError(ErrorCode.InvalidParams, axError);
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"merge-order",
			error,
			"compute merge order"
		);
	}
}

/**
 * Handle config.show tool - Display configuration with precedence chain
 */
async function handleConfigShow(args: {
	key?: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Load configuration with provenance tracking
		const config = loadInputs();

		const output: Record<string, unknown> = {
			config: {
				items: config.items,
				target: config.target,
				version: config.version,
			},
			provenance: config.provenance || {},
			sources: config.sources.map((s) => ({
				exists: s.exists,
				file: s.file,
			})),
		};

		// If specific key requested, extract just that value
		if (args.key) {
			const keys = args.key.split(".");
			let value: unknown = output.config;
			for (const k of keys) {
				if (value && typeof value === "object" && k in value) {
					value = (value as Record<string, unknown>)[k];
				} else {
					value = undefined;
					break;
				}
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ key: args.key, value }, null, 2),
					},
				],
			};
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(output, null, 2),
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"config.show",
			error,
			"show config"
		);
	}
}

/**
 * Handle metrics tool - Get governance metrics snapshot
 */
async function handleMetrics(args: {
	filter?: string;
	format?: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		const collector = getGlobalMetricsCollector();

		// Get snapshot, optionally filtered
		const snapshot = args.filter
			? collector.getMetricsByName(args.filter)
			: collector.getSnapshot();

		// Format output
		let output: string;
		if (args.format === "prometheus") {
			output = collector.exportPrometheus();
		} else {
			output = JSON.stringify(snapshot, null, 2);
		}

		return {
			content: [
				{
					type: "text",
					text: output,
				},
			],
		};
	} catch (error) {
		throwMcpToolError(
			ErrorCode.InternalError,
			"metrics",
			error,
			"get metrics"
		);
	}
}

/**
 * Handle workflow.guide tool - Get context-aware workflow guidance
 */
async function handleWorkflowGuide(
	args: WorkflowGuideArgs
): Promise<{ content: [{ type: "text"; text: string }] }> {
	try {
		// Validate phase is a valid WorkflowPhase
		const validPhases: WorkflowPhase[] = [
			"initial",
			"post-plan-creation",
			"post-gates-run",
			"pre-merge",
			"post-merge",
			"error-recovery",
		];

		const phase = args.phase as WorkflowPhase;
		if (!validPhases.includes(phase)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Invalid workflow phase: ${
					args.phase
				}. Valid phases: ${validPhases.join(", ")}`
			);
		}

		// Create workflow guide for the requested phase
		const guide: WorkflowGuide = createWorkflowGuide(phase);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(guide, null, 2),
				},
			],
		};
	} catch (error) {
		if (error instanceof McpError) {
			throw error;
		}
		throwMcpToolError(
			ErrorCode.InternalError,
			"workflow.guide",
			error,
			"get workflow guide"
		);
	}
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled rejection at:", promise, "reason:", reason);
	process.exit(1);
});

// Start the server if run directly (ESM-only)
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("Failed to start MCP server:", error);
		process.exit(1);
	});
}

export { createServer, main };
