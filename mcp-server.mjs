#!/usr/bin/env node
import "dotenv/config";
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
 *   GITHUB_TOKEN         - GitHub API token for authentication
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
  `[lexrunner] Mutations: ${config.allowMutations ? "ENABLED" : "disabled (read-only)"}`
);

// Import core functionality from built dist
let core;
try {
  core = await import("./dist/cli.js");
  console.error(`[lexrunner] Core module loaded successfully`);
} catch (err) {
  console.error(`[lexrunner] ERROR: Failed to load core module: ${err.message}`);
  console.error(`[lexrunner] Hint: Run 'npm run build' to compile TypeScript sources`);
  process.exit(1);
}

const attemptLifecycleHandlers = core.createAttemptLifecycleHandlers();
const attemptWorkerHandlers = core.createAttemptWorkerHandlers();
const attemptReceiptHandlers = core.createAttemptReceiptHandlers();
const attemptVerificationHandlers = core.createAttemptVerificationHandlers();

// MCP Tool implementations
const tools = {
  verify_attempt: {
    description: "Run packet-declared engine verification for one fenced Attempt",
    inputSchema: core.AttemptVerificationRunRequestJsonSchema,
    call: async (args) =>
      mutationToolCall("verify an Attempt", () => attemptVerificationHandlers.run(args)),
  },

  get_attempt_verification: {
    description: "Get compact verification status, with explicit optional diagnostics",
    inputSchema: core.AttemptVerificationStatusRequestJsonSchema,
    call: async (args) => canonicalToolResult(await attemptVerificationHandlers.status(args)),
  },

  accept_attempt: {
    description: "Apply LexRunner's strict acceptance policy to verified evidence",
    inputSchema: core.AttemptAcceptanceApplyRequestJsonSchema,
    call: async (args) =>
      mutationToolCall("accept an Attempt", () =>
        attemptVerificationHandlers.applyAcceptance(args)
      ),
  },

  get_attempt_acceptance: {
    description: "Get bounded policy-acceptance status for one Attempt",
    inputSchema: core.AttemptAcceptanceStatusRequestJsonSchema,
    call: async (args) =>
      canonicalToolResult(await attemptVerificationHandlers.acceptanceStatus(args)),
  },

  submit_attempt_receipt: {
    description: "Persist one bounded AgentTaskReceipt v2 claim for an Attempt",
    inputSchema: core.AttemptReceiptSubmitRequestJsonSchema,
    call: async (args) =>
      mutationToolCall("submit an Attempt receipt", () => attemptReceiptHandlers.submit(args)),
  },

  get_attempt_receipt: {
    description: "Get bounded, read-only status for one persisted Attempt receipt",
    inputSchema: core.AttemptReceiptStatusRequestJsonSchema,
    call: async (args) => canonicalToolResult(await attemptReceiptHandlers.status(args)),
  },

  attach_attempt_worker: {
    description: "Attach a native worker session to an authorized Attempt",
    inputSchema: core.AttemptWorkerAttachRequestJsonSchema,
    call: async (args) =>
      mutationToolCall("attach an Attempt worker", () => attemptWorkerHandlers.attach(args)),
  },

  heartbeat_attempt_worker: {
    description: "Record a fenced heartbeat for an attached Attempt worker",
    inputSchema: core.AttemptWorkerHeartbeatRequestJsonSchema,
    call: async (args) =>
      mutationToolCall("heartbeat an Attempt worker", () => attemptWorkerHandlers.heartbeat(args)),
  },

  end_attempt_worker: {
    description: "End an attached Attempt worker session",
    inputSchema: core.AttemptWorkerEndRequestJsonSchema,
    call: async (args) =>
      mutationToolCall("end an Attempt worker", () => attemptWorkerHandlers.end(args)),
  },

  get_attempt_worker: {
    description: "Get bounded, read-only status for an attached Attempt worker",
    inputSchema: core.AttemptWorkerStatusRequestJsonSchema,
    call: async (args) => {
      const result = await attemptWorkerHandlers.status(args);
      return canonicalToolResult(result);
    },
  },

  prepare_attempt: {
    description:
      "Prepare an ADR-010 assisted launch packet and envelope (requires ALLOW_MUTATIONS=true)",
    inputSchema: core.AttemptPrepareRequestJsonSchema,
    call: async (args) => {
      if (!config.allowMutations) {
        return {
          content: [
            {
              type: "text",
              text: core.canonicalJSONStringify({
                ok: false,
                error: {
                  code: "mutations_disabled",
                  message: "Mutations not allowed. Set ALLOW_MUTATIONS=true to prepare an Attempt.",
                },
              }),
            },
          ],
        };
      }
      const result = await attemptLifecycleHandlers.prepare(args);
      return {
        content: [{ type: "text", text: core.canonicalJSONStringify(result) }],
      };
    },
  },

  start_attempt: {
    description:
      "Start or safely resume an ADR-010 agent-work Attempt (requires ALLOW_MUTATIONS=true)",
    inputSchema: core.AttemptStartRequestJsonSchema,
    call: async (args) => {
      if (!config.allowMutations) {
        return {
          content: [
            {
              type: "text",
              text: core.canonicalJSONStringify({
                ok: false,
                error: {
                  code: "mutations_disabled",
                  message: "Mutations not allowed. Set ALLOW_MUTATIONS=true to start an Attempt.",
                },
              }),
            },
          ],
        };
      }
      const result = await attemptLifecycleHandlers.start(args);
      return {
        content: [{ type: "text", text: core.canonicalJSONStringify(result) }],
      };
    },
  },

  get_attempt_status: {
    description: "Get bounded, read-only status for an ADR-010 agent-work Attempt",
    inputSchema: core.AttemptStatusInputJsonSchema,
    call: async (args) => {
      const result = await attemptLifecycleHandlers.status(args);
      return {
        content: [{ type: "text", text: core.canonicalJSONStringify(result) }],
      };
    },
  },

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
        const resolved = resolveProfile(config.profileDir, process.cwd());
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
          const { createGitHubClient, PlanCreationService } = await import("./dist/cli.js");

          const client = await createGitHubClient({
            token: args.githubToken,
            owner: args.owner,
            repo: args.repo,
          });

          // Parse required gates if provided
          const requiredGates = args.requiredGates || ["lint", "typecheck", "test"];

          // Parse max workers if provided
          const maxWorkers = args.maxWorkers || 2;

          // Generate plan from GitHub
          plan = await new PlanCreationService().fromGitHub(client, {
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
          const { loadInputs, PlanCreationService } = await import("./dist/cli.js");
          inputs = loadInputs(profilePath);
          plan = new PlanCreationService().fromInputs(inputs);
        }

        // Determine output directory
        const outDir = args.outDir || resolve(profilePath, "runner");

        // Ensure output directory exists
        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }

        // Write plan.json
        const { canonicalJSONStringify } = await import("./dist/cli.js");
        const planPath = resolve(outDir, "plan.json");
        const planJson = canonicalJSONStringify(plan);
        writeFileSync(planPath, planJson + "\n");

        // Generate snapshot - use GitHub snapshot for GitHub mode
        const { generateSnapshot, generateGitHubSnapshot } = await import("./dist/cli.js");
        let snapshot;
        if (args.fromGithub) {
          snapshot = generateGitHubSnapshot(plan);
        } else {
          // In traditional mode, inputs is guaranteed to be set
          if (!inputs) {
            throw new Error("Internal error: inputs not loaded in traditional mode");
          }
          snapshot = generateSnapshot(plan, inputs);
        }
        const snapshotPath = resolve(outDir, "snapshot.md");
        writeFileSync(snapshotPath, snapshot);

        const result = {
          contract: "bounded-ax-v1",
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
              text: JSON.stringify(result, null, 2),
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
        const resolved = resolveProfile(config.profileDir, process.cwd());

        // Load plan
        const planPath = resolve(resolved.path, "runner", "plan.json");
        if (!existsSync(planPath)) {
          throw new Error("No plan found. Run plan.create first.");
        }

        const { loadPlan, GateExecutionService } = await import("./dist/cli.js");
        const planContent = readFileSync(planPath, "utf-8");
        const plan = loadPlan(planContent);

        // Determine output directory
        const outDir = args.outDir || resolve(resolved.path, "runner", "gates");

        const result = (
          await new GateExecutionService().run({
            plan,
            artifactDir: outDir,
            onlyItem: args.onlyItem,
            onlyGate: args.onlyGate,
          })
        ).summary;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
        // Resolve profile directory
        const { resolveProfile } = await import("./dist/cli.js");
        const resolved = resolveProfile(config.profileDir, process.cwd());

        // Load plan
        const planPath = resolve(resolved.path, "runner", "plan.json");
        if (!existsSync(planPath)) {
          throw new Error("No plan found. Run plan.create first.");
        }

        const { loadPlan, MergeApplicationService } = await import("./dist/cli.js");
        const planContent = readFileSync(planPath, "utf-8");
        const plan = loadPlan(planContent);

        const result = (
          await new MergeApplicationService().run({
            plan,
            workingDir: process.cwd(),
            dryRun: args.dryRun ?? true,
            mutationAuthorized: config.allowMutations,
          })
        ).summary;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error?.name === "MergeApplicationServiceError" && typeof error.code === "string") {
          const { mcpToolError } = await import("./dist/errors/index.js");
          throw new Error(
            core.canonicalJSONStringify(
              mcpToolError(error.code, error.message, { tool: "merge.apply" })
            )
          );
        }
        throw new Error(`Failed to apply merge: ${error.message}`);
      }
    },
  },

  "local.init": {
    description: "Initialize local overlay directory with auto-detected project configuration",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Force recreation even if local overlay exists",
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
              text: `Local overlay initialized:\n${JSON.stringify(output, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to initialize local overlay: ${error.message}`);
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
        const resolved = resolveProfile(profileDirOverride, process.cwd());

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
              text: `Profile resolved:\n${JSON.stringify(output, null, 2)}`,
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
        const health = healthChecker.getHealth(args.includeMetrics || false);

        return {
          content: [
            {
              type: "text",
              text: `Health check:\n${JSON.stringify(health, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to get health status: ${error.message}`);
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

  discover: {
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
        const { createGitHubAPI, GitHubAPI, DiscoveryQueryService } = await import("./dist/cli.js");

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

        const result = await new DiscoveryQueryService().run({
          github: githubAPI,
          state: args.state || "open",
          suggest: args.suggest,
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
        throw new Error(`Failed to discover PRs: ${error.message}`);
      }
    },
  },

  status: {
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

        const { loadPlan, IntegrationStatusQueryService } = await import("./dist/cli.js");
        const planContent = readFileSync(planFile, "utf-8");
        const plan = loadPlan(planContent);

        const result = new IntegrationStatusQueryService().run(plan);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to get status: ${error.message}`);
      }
    },
  },

  doctor: {
    description: "Run environment and configuration sanity checks",
    inputSchema: {
      type: "object",
      properties: {},
    },
    call: async (args) => {
      try {
        const {
          bootstrapWorkspace,
          detectProjectType,
          getEnvironmentSuggestions,
          createGitHubAPI,
          createGitOperations,
        } = await import("./dist/cli.js");

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
            checks.issues.push(
              `Node.js version mismatch: ${process.version} vs v${expectedVersion}`
            );
          }
        } catch {
          checks.nodejs = {
            status: "no_constraint",
            current: process.version,
          };
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

        const { loadPlan, MergeOrderQueryService } = await import("./dist/cli.js");
        const planContent = readFileSync(planFile, "utf-8");
        const plan = loadPlan(planContent);

        const result = new MergeOrderQueryService().run(plan);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
    description:
      "Get context-aware workflow guidance for the current phase. Provides next steps, common issues, and recommendations.",
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

function canonicalToolResult(result) {
  return {
    content: [{ type: "text", text: core.canonicalJSONStringify(result) }],
  };
}

async function mutationToolCall(action, call) {
  if (!config.allowMutations) {
    return canonicalToolResult({
      ok: false,
      error: {
        code: "mutations_disabled",
        message: `Mutations not allowed. Set ALLOW_MUTATIONS=true to ${action}.`,
      },
    });
  }
  return canonicalToolResult(await call());
}

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
