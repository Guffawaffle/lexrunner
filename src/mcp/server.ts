#!/usr/bin/env node

/**
 * MCP server adapter for lex-pr-runner
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

import { loadInputs, detectGitHubMode } from "../core/inputs.js";
import { generatePlan } from "../core/plan.js";
import { generateSnapshot, generateGitHubSnapshot } from "../core/snapshot.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { executeGatesWithPolicy } from "../gates.js";
import { ExecutionState } from "../executionState.js";
import { MergeEligibilityEvaluator } from "../mergeEligibility.js";
import { loadPlan, validatePlan } from "../schema.js";
import { initLocalOverlay } from "../config/localOverlay.js";
import { healthChecker } from "../monitoring/health.js";
import { generatePlanFromGitHub } from "../core/githubPlan.js";
import { createGitHubClient } from "../github/index.js";
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

import * as fs from "fs";
import * as path from "path";

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

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
	const server = new Server(
		{
			name: "lex-pr-runner",
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
					name: "plan.create",
					description:
						"Create a plan from configuration files or auto-discover from GitHub PRs",
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
					name: "gates.run",
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
					name: "merge.apply",
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
					name: "local.init",
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
					name: "profile.resolve",
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
					name: "senior-dev.prepare-context",
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
					name: "senior-dev.recall-context",
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
					name: "senior-dev.capture-frame",
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
					name: "senior-dev.modes",
					description:
						"List available executor modes (triage, deep_review, pattern_mining, mentorship)",
					inputSchema: {
						type: "object",
						properties: {},
					},
				},
			],
		};
	});

	// Handle tool calls
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		switch (name) {
			case "plan.create":
				return await handlePlanCreate(args as PlanCreateArgs);

			case "gates.run":
				return await handleGatesRun(args as GatesRunArgs);

			case "merge.apply":
				return await handleMergeApply(args as MergeApplyArgs);

			case "local.init":
				return await handleLocalInit(args as InitLocalArgs);

			case "profile.resolve":
				return await handleProfileResolve(args as ProfileResolveArgs);

			case "health":
				return await handleHealth(args as { includeMetrics?: boolean });

			// Senior Dev executor tools
			case "senior-dev.prepare-context":
				return await handleSeniorDevPrepareContext(
					args as unknown as PrepareContextInput
				);

			case "senior-dev.recall-context":
				return await handleSeniorDevRecallContext(
					args as unknown as RecallContextInput
				);

			case "senior-dev.capture-frame":
				return await handleSeniorDevCaptureFrame(
					args as unknown as CaptureFrameInput
				);

			case "senior-dev.modes":
				return await handleSeniorDevModes();

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
				throw new Error(
					"Internal error: inputs not loaded in traditional mode"
				);
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
			throw new McpError(ErrorCode.InvalidRequest, error.message);
		}
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to create plan: ${
				error instanceof Error ? error.message : String(error)
			}`
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
				throw new Error(`Plan file not found: ${args.planFile}`);
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
				throw new Error(
					"No plan found. Run plan.create first or provide planFile parameter."
				);
			}

			outDirBase = path.join(resolved.path, "runner");
		}

		let planContent: string;
		try {
			planContent = fs.readFileSync(planPath, "utf-8");
		} catch (error) {
			throw new Error(
				`Failed to read plan file ${planPath}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to run gates: ${
				error instanceof Error ? error.message : String(error)
			}`
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
			throw new Error("No plan found. Run plan.create first.");
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to apply merge: ${
				error instanceof Error ? error.message : String(error)
			}`
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to initialize local overlay: ${
				error instanceof Error ? error.message : String(error)
			}`
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to resolve profile: ${
				error instanceof Error ? error.message : String(error)
			}`
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
	const server = createServer();
	const transport = new StdioServerTransport();

	// Connect the server to stdio transport
	await server.connect(transport);

	// Log to stderr so it doesn't interfere with MCP protocol
	console.error("MCP server started for lex-pr-runner");

	// Keep the process alive by setting up event handlers
	// The event loop will keep running while the stdio transport is active
	process.stdin.resume();

	// Handle graceful shutdown when stdin closes
	process.stdin.on("end", () => {
		console.error("MCP server shutting down");
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to prepare review context: ${(error as Error).message}`
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to recall context: ${(error as Error).message}`
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
		throw new McpError(
			ErrorCode.InternalError,
			`Failed to capture frame: ${(error as Error).message}`
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
