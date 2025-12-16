#!/usr/bin/env node
/**
 * lexrunner MCP Server
 *
 * A Model Context Protocol (MCP) server for merge pyramid orchestration.
 * Speaks MCP over stdio, aligned with LexBrain and LexMap architecture.
 *
 * Usage:
 *   lexrunner-mcp
 *   npx -y /srv/lex-mcp/lexrunner
 *
 * Environment variables:
 *   LEX_PR_PROFILE_DIR   - Path to profile directory (default: auto-resolve)
 *   ALLOW_MUTATIONS      - Enable write operations (default: false, use with caution)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration from environment
const config = {
	profileDir: process.env.LEX_PR_PROFILE_DIR,
	allowMutations: process.env.ALLOW_MUTATIONS === "true",
};

console.error(`[lexrunner] Starting MCP server`);
console.error(
	`[lexrunner] Mutations: ${
		config.allowMutations ? "ENABLED" : "disabled (read-only)"
	}`
);

// Import core functionality from built dist
let core;
try {
	core = await import("./dist/cli.js");
	console.error(`[lexrunner] Core module loaded successfully`);
} catch (err) {
	console.error(
		`[lexrunner] ERROR: Failed to load core module: ${err.message}`
	);
	console.error(
		`[lexrunner] Hint: Run 'npm run build' to compile TypeScript sources`
	);
	process.exit(1);
}

// MCP Tool implementations
const tools = {
	"plan.create": {
		description: "Create a plan from configuration files or auto-discover from GitHub PRs",
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
					description: "Output directory for plan artifacts",
				},
				fromGithub: {
					type: "boolean",
					description: "Auto-discover PRs from GitHub API",
					default: false,
				},
				query: {
					type: "string",
					description: "GitHub search query (e.g., 'is:open label:stack:*')",
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
					description: "GitHub API token (or use GITHUB_TOKEN env var)",
				},
				owner: {
					type: "string",
					description: "GitHub repository owner (auto-detected from git remote)",
				},
				repo: {
					type: "string",
					description: "GitHub repository name (auto-detected from git remote)",
				},
				requiredGates: {
					type: "array",
					description: "List of required gates (default: lint,typecheck,test)",
					items: {
						type: "string",
					},
				},
				maxWorkers: {
					type: "number",
					description: "Maximum parallel workers for execution (default: 2)",
				},
				target: {
					type: "string",
					description: "Target branch for merging PRs (default: repo default branch)",
				},
			},
		},
		call: async (args) => {
			try {
				// Resolve profile directory
				const { resolveProfile } = await import("./dist/cli.js");
				const resolved = resolveProfile(
					config.profileDir,
					process.cwd()
				);
				const profilePath = resolved.path;
				const role = resolved.manifest.role;

				// Check write permissions
				if (role === "workspace-template") {
					throw new Error(
						"Cannot write to workspace-template profile. Initialize local overlay first."
					);
				}

				let plan;
				let inputs = null;

				if (args.fromGithub) {
					// GitHub mode: auto-discover PRs
					const {
						createGitHubClient,
						generatePlanFromGitHub,
					} = await import("./dist/cli.js");

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
				} else {
					// Traditional mode: load from configuration files
					const {
						loadInputs,
						generatePlan,
					} = await import("./dist/cli.js");
					inputs = loadInputs(profilePath);
					plan = generatePlan(inputs);
				}

				// Determine output directory
				const outDir = args.outDir || resolve(profilePath, "runner");

				// Ensure output directory exists
				if (!existsSync(outDir)) {
					mkdirSync(outDir, { recursive: true });
				}

				// Write plan.json
				const { canonicalJSONStringify } = await import(
					"./dist/cli.js"
				);
				const planPath = resolve(outDir, "plan.json");
				const planJson = canonicalJSONStringify(plan);
				writeFileSync(planPath, planJson + "\n");

				// Generate snapshot - use GitHub snapshot for GitHub mode
				const {
					generateSnapshot,
					generateGitHubSnapshot,
				} = await import("./dist/cli.js");
				let snapshot;
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
				const snapshotPath = resolve(outDir, "snapshot.md");
				writeFileSync(snapshotPath, snapshot);

				const result = {
					plan: plan,
					outDir: outDir,
					files: {
						plan: planPath,
						snapshot: snapshotPath,
					},
				};

				return {
					content: [
						{
							type: "text",
							text: `Plan created successfully:\n${JSON.stringify(
								result,
								null,
								2
							)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to create plan: ${error.message}`);
			}
		},
	},

	"gates.run": {
		description: "Execute gates for plan items",
		inputSchema: {
			type: "object",
			properties: {
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
					description: "Output directory for gate results",
				},
			},
		},
		call: async (args) => {
			try {
				// Resolve profile directory
				const { resolveProfile } = await import("./dist/cli.js");
				const resolved = resolveProfile(
					config.profileDir,
					process.cwd()
				);

				// Load plan
				const planPath = resolve(resolved.path, "runner", "plan.json");
				if (!existsSync(planPath)) {
					throw new Error("No plan found. Run plan.create first.");
				}

				const { loadPlan, ExecutionState, executeGatesWithPolicy } =
					await import("./dist/cli.js");
				const planContent = readFileSync(planPath, "utf-8");
				const plan = loadPlan(planContent);

				// Create execution state
				const executionState = new ExecutionState(plan);

				// Determine output directory
				const outDir =
					args.outDir || resolve(resolved.path, "runner", "gates");

				// Execute gates
				await executeGatesWithPolicy(plan, executionState, outDir);

				// Get results
				const results = executionState.getResults();
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
								(gate) =>
									!args.onlyGate ||
									gate.gate === args.onlyGate
							)
							.map((gate) => ({
								name: gate.gate,
								status: gate.status,
							})) || [];

					items.push({
						name: itemName,
						status: nodeResult.status || "unknown",
						gates: gates,
					});

					if (nodeResult.status !== "pass") {
						allGreen = false;
					}
				}

				const result = {
					items,
					allGreen,
					outDir,
				};

				return {
					content: [
						{
							type: "text",
							text: `Gates execution complete:\n${JSON.stringify(
								result,
								null,
								2
							)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to run gates: ${error.message}`);
			}
		},
	},

	"merge.apply": {
		description: "Apply merge operations (requires ALLOW_MUTATIONS=true)",
		inputSchema: {
			type: "object",
			properties: {
				dryRun: {
					type: "boolean",
					description: "Simulate merge without making changes",
					default: true,
				},
			},
		},
		call: async (args) => {
			try {
				// Check if mutations are allowed
				if (!config.allowMutations && !args.dryRun) {
					return {
						content: [
							{
								type: "text",
								text: `Mutations not allowed. Set ALLOW_MUTATIONS=true or use dryRun=true.`,
							},
						],
					};
				}

				// Resolve profile directory
				const { resolveProfile } = await import("./dist/cli.js");
				const resolved = resolveProfile(
					config.profileDir,
					process.cwd()
				);

				// Load plan
				const planPath = resolve(resolved.path, "runner", "plan.json");
				if (!existsSync(planPath)) {
					throw new Error("No plan found. Run plan.create first.");
				}

				const { loadPlan, ExecutionState, MergeEligibilityEvaluator } =
					await import("./dist/cli.js");
				const planContent = readFileSync(planPath, "utf-8");
				const plan = loadPlan(planContent);

				const executionState = new ExecutionState(plan);
				const evaluator = new MergeEligibilityEvaluator(
					plan,
					executionState
				);
				const decisions = evaluator.evaluateAllNodes();
				const summary = evaluator.getMergeSummary();

				const result = {
					allowed: config.allowMutations && !args.dryRun,
					dryRun: args.dryRun || false,
					eligible: summary.eligible.length,
					failed: summary.failed.length,
					blocked: summary.blocked.length,
					message: args.dryRun
						? `Dry run: ${summary.eligible.length} items eligible, ${summary.failed.length} failed, ${summary.blocked.length} blocked`
						: config.allowMutations
						? `Ready to merge ${summary.eligible.length} eligible items`
						: "Mutations disabled. Set ALLOW_MUTATIONS=true to enable merging.",
				};

				return {
					content: [
						{
							type: "text",
							text: `Merge evaluation complete:\n${JSON.stringify(
								result,
								null,
								2
							)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to apply merge: ${error.message}`);
			}
		},
	},

	"local.init": {
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
		call: async (args) => {
			try {
				const { initLocalOverlay } = await import("./dist/cli.js");
				const force = args.force ?? false;
				const result = initLocalOverlay(process.cwd(), force);

				const output = {
					created: result.created,
					path: result.path,
					config: result.config,
					copiedFiles: result.copiedFiles,
				};

				return {
					content: [
						{
							type: "text",
							text: `Local overlay initialized:\n${JSON.stringify(
								output,
								null,
								2
							)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(
					`Failed to initialize local overlay: ${error.message}`
				);
			}
		},
	},

	"profile.resolve": {
		description:
			"Resolve profile directory using precedence chain (--profile-dir → LEX_PR_PROFILE_DIR → .smartergpt.local/ → .smartergpt/)",
		inputSchema: {
			type: "object",
			properties: {
				profileDir: {
					type: "string",
					description: "Optional profile directory override",
				},
			},
		},
		call: async (args) => {
			try {
				const { resolveProfile } = await import("./dist/cli.js");
				const profileDirOverride = args.profileDir || config.profileDir;
				const resolved = resolveProfile(
					profileDirOverride,
					process.cwd()
				);

				const output = {
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
							text: `Profile resolved:\n${JSON.stringify(
								output,
								null,
								2
							)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to resolve profile: ${error.message}`);
			}
		},
	},

	health: {
		description: "Get health status of the system with optional metrics",
		inputSchema: {
			type: "object",
			properties: {
				includeMetrics: {
					type: "boolean",
					description: "Include detailed metrics in response",
					default: false,
				},
			},
		},
		call: async (args) => {
			try {
				const { healthChecker } = await import("./dist/cli.js");
				const health = healthChecker.getHealth(
					args.includeMetrics || false
				);

				return {
					content: [
						{
							type: "text",
							text: `Health check:\n${JSON.stringify(
								health,
								null,
								2
							)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(
					`Failed to get health status: ${error.message}`
				);
			}
		},
	},

	"lexrunner.startRun": {
		description: "Start a new LexRunner procedure run and return a runId",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					description: "Persona mode (e.g., 'senior-dev', 'eager-pm')",
				},
				procedure: {
					type: "string",
					description: "Procedure identifier (e.g., 'merge-weave-main', 'pr-review')",
				},
				repo: {
					type: "string",
					description: "Repository in 'owner/repo' format",
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
		call: async (args) => {
			try {
				const { createRunManager } = await import("./dist/cli.js");
				const manager = createRunManager();
				const result = manager.startRun(args);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to start run: ${error.message}`);
			}
		},
	},

	"lexrunner.getStatus": {
		description: "Get current run state, summary, and next available actions",
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
		call: async (args) => {
			try {
				const { createRunManager } = await import("./dist/cli.js");
				const manager = createRunManager();
				const status = manager.getStatus(args);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(status, null, 2),
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to get status: ${error.message}`);
			}
		},
	},

	"lexrunner.listArtifacts": {
		description: "List and inspect artifacts and receipts for a run",
		inputSchema: {
			type: "object",
			properties: {
				runId: {
					type: "string",
					description: "Unique run identifier",
				},
				type: {
					type: "string",
					description: 'Filter by type: "plan", "decision", "failure", "gate", "report", "log"',
					enum: ["plan", "decision", "failure", "gate", "report", "log"],
				},
				path: {
					type: "string",
					description: "Filter by path pattern (supports * and ** wildcards)",
				},
				latestOnly: {
					type: "boolean",
					description: "Only return the most recent artifact of each type",
				},
				inline: {
					type: "boolean",
					description: "Include content for small artifacts (< 10KB)",
				},
			},
			required: ["runId"],
		},
		call: async (args) => {
			try {
				const { createRunManager } = await import("./dist/cli.js");
				const manager = createRunManager();
				const result = manager.listArtifacts(args);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to list artifacts: ${error.message}`);
			}
		},
	},

	// ─────────────────────────────────────────────────────────────────────────────
	// MCP/CLI Parity Tools (AX-004)
	// ─────────────────────────────────────────────────────────────────────────────

	"discover": {
		description: "Discover open pull requests from GitHub with optional dependency suggestions",
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
					description: "Generate dependency suggestions using heuristics",
					default: false,
				},
			},
		},
		call: async (args) => {
			try {
				const { createGitHubAPI, GitHubAPI } = await import("./dist/cli.js");

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
					throw new Error(
						"Could not detect GitHub repository. Provide owner and repo parameters or run from a git repository with GitHub remote."
					);
				}

				// Check authentication
				const authStatus = await githubAPI.checkAuth();

				// Fetch pull requests
				const state = args.state || "open";
				const pullRequests = await githubAPI.discoverPullRequests(state);

				let result;

				if (args.suggest) {
					const { createFileAnalyzer } = await import("./dist/cli.js");

					const analyzer = createFileAnalyzer(
						githubAPI.getOctokit(),
						githubAPI.config.owner,
						githubAPI.config.repo
					);
					const prs = pullRequests.map((pr) => ({
						number: pr.number,
						name: `PR-${pr.number}`,
						sha: pr.sha,
					}));

					const suggestions = await analyzer.suggestDependenciesWithHeuristics(prs);

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
							text: `Pull requests discovered:\n${JSON.stringify(result, null, 2)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to discover PRs: ${error.message}`);
			}
		},
	},

	"status": {
		description: "Show current execution status and merge eligibility for a plan",
		inputSchema: {
			type: "object",
			properties: {
				planFile: {
					type: "string",
					description: "Path to plan.json file (default: plan.json)",
					default: "plan.json",
				},
			},
		},
		call: async (args) => {
			try {
				const planFile = args.planFile || "plan.json";

				if (!existsSync(planFile)) {
					throw new Error(`Plan file not found: ${planFile}`);
				}

				const { loadPlan, ExecutionState, MergeEligibilityEvaluator } =
					await import("./dist/cli.js");
				const planContent = readFileSync(planFile, "utf-8");
				const plan = loadPlan(planContent);

				const executionState = new ExecutionState(plan);
				const evaluator = new MergeEligibilityEvaluator(plan, executionState);
				const mergeSummary = evaluator.getMergeSummary();

				const result = {
					plan: {
						schemaVersion: plan.schemaVersion,
						target: plan.target,
						itemCount: plan.items.length,
						policy: plan.policy,
					},
					mergeSummary,
				};

				return {
					content: [
						{
							type: "text",
							text: `Plan status:\n${JSON.stringify(result, null, 2)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to get status: ${error.message}`);
			}
		},
	},

	"doctor": {
		description: "Run environment and configuration sanity checks",
		inputSchema: {
			type: "object",
			properties: {},
		},
		call: async (args) => {
			try {
				const { bootstrapWorkspace, detectProjectType, getEnvironmentSuggestions, createGitHubAPI, createGitOperations } =
					await import("./dist/cli.js");

				const checks = {
					hasErrors: false,
					issues: [],
					suggestions: [],
				};

				// Node.js version check
				try {
					const nvmrcContent = readFileSync(".nvmrc", "utf-8").trim();
					const currentVersion = process.version.slice(1);
					const expectedVersion = nvmrcContent;

					if (currentVersion === expectedVersion) {
						checks.nodejs = { status: "ok", current: process.version, expected: `v${expectedVersion}` };
					} else {
						checks.nodejs = { status: "mismatch", current: process.version, expected: `v${expectedVersion}` };
						checks.hasErrors = true;
						checks.issues.push(`Node.js version mismatch: ${process.version} vs v${expectedVersion}`);
					}
				} catch {
					checks.nodejs = { status: "no_constraint", current: process.version };
					checks.suggestions.push("Consider adding .nvmrc file for Node.js version consistency");
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
					checks.github = { detected: false, error: error.message };
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
						error: error.message,
					};
					checks.hasErrors = true;
					checks.issues.push(`Git operations failed: ${error.message}`);
				}

				return {
					content: [
						{
							type: "text",
							text: `Doctor checks:\n${JSON.stringify(checks, null, 2)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to run doctor: ${error.message}`);
			}
		},
	},

	"merge-order": {
		description: "Compute dependency levels and merge order using Kahn's algorithm",
		inputSchema: {
			type: "object",
			properties: {
				planFile: {
					type: "string",
					description: "Path to plan.json file (default: plan.json)",
					default: "plan.json",
				},
			},
		},
		call: async (args) => {
			try {
				const planFile = args.planFile || "plan.json";

				if (!existsSync(planFile)) {
					throw new Error(`Plan file not found: ${planFile}`);
				}

				const { loadPlan, computeMergeOrder } = await import("./dist/cli.js");
				const planContent = readFileSync(planFile, "utf-8");
				const plan = loadPlan(planContent);

				// Compute merge order using Kahn's algorithm
				const levels = computeMergeOrder(plan);

				const result = {
					levels,
					totalItems: plan.items.length,
					maxParallelism: Math.max(...levels.map(level => level.length)),
				};

				return {
					content: [
						{
							type: "text",
							text: `Merge order:\n${JSON.stringify(result, null, 2)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to compute merge order: ${error.message}`);
			}
		},
	},

	"config.show": {
		description: "Display configuration with precedence chain and provenance",
		inputSchema: {
			type: "object",
			properties: {
				key: {
					type: "string",
					description: "Show specific configuration key",
				},
			},
		},
		call: async (args) => {
			try {
				const { loadInputs } = await import("./dist/cli.js");

				// Load configuration with provenance tracking
				const config = loadInputs();

				const output = {
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
					let value = output.config;
					for (const k of keys) {
						if (value && typeof value === "object" && k in value) {
							value = value[k];
						} else {
							value = undefined;
							break;
						}
					}
					return {
						content: [
							{
								type: "text",
								text: `Configuration:\n${JSON.stringify({ key: args.key, value }, null, 2)}`,
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `Configuration:\n${JSON.stringify(output, null, 2)}`,
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to show config: ${error.message}`);
			}
		},
	},

	"workflow.guide": {
		description: "Get context-aware workflow guidance for the current phase. Provides next steps, common issues, and recommendations.",
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
					description: "Current workflow phase to get guidance for",
				},
			},
			required: ["phase"],
		},
		call: async (args) => {
			try {
				const { createWorkflowGuide } = await import("./dist/cli.js");
				const guide = createWorkflowGuide(args.phase);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(guide, null, 2),
						},
					],
				};
			} catch (error) {
				throw new Error(`Failed to get workflow guide: ${error.message}`);
			}
		},
	},
};

// MCP Protocol handler - JSON-RPC 2.0 over stdio
async function handleRequest(request) {
	const { id, method, params } = request;

	try {
		// MCP initialization handshake
		if (method === "initialize") {
			return {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: "lexrunner",
						version: "0.1.0",
					},
				},
			};
		}

		// After initialization, client sends initialized notification
		if (method === "notifications/initialized") {
			// No response needed for notifications
			return null;
		}

		// Tool listing
		if (method === "tools/list") {
			return {
				jsonrpc: "2.0",
				id,
				result: {
					tools: Object.entries(tools).map(([name, spec]) => ({
						name,
						description: spec.description,
						inputSchema: spec.inputSchema,
					})),
				},
			};
		}

		// Tool execution
		if (method === "tools/call") {
			const { name, arguments: args } = params;
			const tool = tools[name];

			if (!tool) {
				return {
					jsonrpc: "2.0",
					id,
					error: {
						code: -32601,
						message: `Unknown tool: ${name}`,
					},
				};
			}

			try {
				const result = await tool.call(args);
				return {
					jsonrpc: "2.0",
					id,
					result,
				};
			} catch (error) {
				return {
					jsonrpc: "2.0",
					id,
					error: {
						code: -32603,
						message: error.message,
					},
				};
			}
		}

		// Unknown method
		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: -32601,
				message: `Method not found: ${method}`,
			},
		};
	} catch (error) {
		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: -32603,
				message: error.message,
			},
		};
	}
}

// Stdio message loop - line-delimited JSON
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\n");
	buffer = lines.pop() || ""; // Keep incomplete line in buffer

	for (const line of lines) {
		if (!line.trim()) continue;

		try {
			const request = JSON.parse(line);
			const response = await handleRequest(request);

			// Only send response for requests (not notifications)
			if (response) {
				console.log(JSON.stringify(response));
			}
		} catch (error) {
			console.log(
				JSON.stringify({
					jsonrpc: "2.0",
					error: {
						code: -32700,
						message: `Parse error: ${error.message}`,
					},
				})
			);
		}
	}
});

process.stdin.on("end", () => {
	console.error("[lexrunner] Shutting down...");
	process.exit(0);
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.error("[lexrunner] Shutting down...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.error("[lexrunner] Shutting down...");
	process.exit(0);
});

process.on("uncaughtException", (error) => {
	console.error(`[lexrunner] Uncaught exception: ${error.message}`);
	console.error(error.stack);
	process.exit(1);
});
