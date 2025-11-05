#!/usr/bin/env node
/**
 * lex-pr-runner MCP Server
 *
 * A Model Context Protocol (MCP) server for merge pyramid orchestration.
 * Speaks MCP over stdio, aligned with LexBrain and LexMap architecture.
 *
 * Usage:
 *   lex-pr-runner-mcp
 *   npx -y /srv/lex-mcp/lex-pr-runner
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

console.error(`[lex-pr-runner] Starting MCP server`);
console.error(
	`[lex-pr-runner] Mutations: ${
		config.allowMutations ? "ENABLED" : "disabled (read-only)"
	}`
);

// Import core functionality from built dist
let core;
try {
	core = await import("./dist/cli.js");
	console.error(`[lex-pr-runner] Core module loaded successfully`);
} catch (err) {
	console.error(
		`[lex-pr-runner] ERROR: Failed to load core module: ${err.message}`
	);
	console.error(
		`[lex-pr-runner] Hint: Run 'npm run build' to compile TypeScript sources`
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
				const snapshot = args.fromGithub
					? generateGitHubSnapshot(plan)
					: generateSnapshot(plan, inputs);
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
						name: "lex-pr-runner",
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
	console.error("[lex-pr-runner] Shutting down...");
	process.exit(0);
});

// Graceful shutdown
process.on("SIGINT", () => {
	console.error("[lex-pr-runner] Shutting down...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.error("[lex-pr-runner] Shutting down...");
	process.exit(0);
});

process.on("uncaughtException", (error) => {
	console.error(`[lex-pr-runner] Uncaught exception: ${error.message}`);
	console.error(error.stack);
	process.exit(1);
});
