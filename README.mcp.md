# MCP Server for lexrunner

The Model Context Protocol (MCP) server for lexrunner provides read-only tools for plan creation, gate execution, and merge operations.

**Architecture:** This server is aligned with LexBrain and LexMap MCP implementations, using direct stdio JSON-RPC 2.0 protocol handling for consistency and maintainability across the Lex ecosystem.

## Tool Naming Convention

Per [Lex NAMING_CONVENTIONS.md](https://github.com/Guffawaffle/lex/blob/main/docs/NAMING_CONVENTIONS.md), all MCP tools follow the pattern:

```
mcp_lexrunner_{category}_{action}
```

**Categories:**
| Category | Purpose |
|----------|---------|
| `plan` | Plan creation and validation |
| `gate` | CI/gate execution |
| `weave` | Merge-weave orchestration |
| `workspace` | Local workspace management |
| `run` | Run lifecycle management |
| `executor` | Executor tools (Senior Dev, etc.) |
| `core` | Cross-cutting utilities |

**Deprecated Aliases:** Old tool names (e.g., `plan.create`, `discover`) still work but are deprecated. Use canonical names for new integrations.

## Quick Start

### Configuration

See [MCP-CONFIG.md](./MCP-CONFIG.md) for complete configuration details and alignment with lex-brain and lex-map.

**Quick MCP Config Entry:**
```json
{
  "mcpServers": {
    "lexrunner": {
      "command": "node",
      "args": ["/srv/lex-mcp/lexrunner/mcp-server.mjs"],
      "env": {
        "LEX_PR_PROFILE_DIR": "/path/to/.smartergpt"
      }
    }
  }
}
```

### Starting the Server

```bash
# Production mode (recommended)
npm run mcp

# Or directly
node mcp-server.mjs

# Via launcher script (for specific environments)
bash lexrunner-launcher.sh
```

The server communicates via stdio using the MCP JSON-RPC 2.0 protocol, aligned with LexBrain and LexMap.

### Environment Configuration

The MCP server respects these environment variables:

- `LEX_PR_PROFILE_DIR`: Directory containing configuration files (default: auto-resolved via precedence chain)
- `ALLOW_MUTATIONS`: Enable destructive operations like merging (default: `false`)

```bash
# Example with custom configuration
LEX_PR_PROFILE_DIR=/custom/profile ALLOW_MUTATIONS=true npm run mcp
```

## Architecture Alignment

This MCP server follows the same architectural pattern as LexBrain and LexMap:

1. **Direct stdio JSON-RPC 2.0**: No SDK abstraction, simple line-delimited protocol
2. **Single entry point**: `mcp-server.mjs` handles protocol and imports built core functions
3. **Core separation**: Business logic in TypeScript (`src/**`), protocol adapter in JavaScript
4. **Consistent error handling**: JSON-RPC error codes (-32700, -32601, -32603)
5. **Graceful shutdown**: SIGINT/SIGTERM handlers

## Available Tools

### mcp_lexrunner_plan_create

Creates a plan from configuration files or auto-discovers from GitHub PRs. This is a **convenience wrapper** that combines PR discovery (`pr_list`), plan generation, validation, and file writing into a single operation.

> **Deprecated alias:** `plan.create`
>
> **Note:** For more granular control, use `pr_list`, `plan_validate`, and `plan_analyze` tools individually.

**Parameters:**
- `json` (boolean, optional): Output plan as JSON to stdout
- `outDir` (string, optional): Output directory for plan artifacts

**GitHub Auto-Discovery Parameters:**
- `fromGithub` (boolean, optional): Enable auto-discovery of PRs from GitHub API
- `query` (string, optional): GitHub search query (e.g., 'is:open label:feature')
- `labels` (array of strings, optional): Filter PRs by labels
- `includeDrafts` (boolean, optional): Include draft PRs (default: true)
- `excludePRs` (array of numbers, optional): Exclude specific PR numbers
- `githubToken` (string, optional): GitHub API token (or use GITHUB_TOKEN env var)
- `owner` (string, optional): GitHub repository owner (auto-detected from git remote)
- `repo` (string, optional): GitHub repository name (auto-detected from git remote)
- `requiredGates` (array of strings, optional): Required gates (default: ["lint", "typecheck", "test"])
- `maxWorkers` (number, optional): Maximum parallel workers (default: 2)
- `target` (string, optional): Target branch for merging PRs (default: repo default branch)

**Returns:**
```json
{
  "plan": { ... },
  "outDir": "/path/to/output"
}
```

**Example - Traditional Mode (from configuration files):**
```json
{
  "name": "mcp_lexrunner_plan_create",
  "arguments": {
    "json": true,
    "outDir": ".smartergpt/runner"
  }
}
```

**Example - Auto-Detected GitHub Mode (from scope.yml):**

When `scope.yml` contains GitHub discovery filters (labels or query), the tool automatically enables GitHub mode:

```yaml
# .smartergpt/scope.yml
version: 1
target: main
sources:
  - query: "is:open label:stack:*"
selectors:
  include_labels: ["ready-merge"]
  exclude_labels: ["WIP"]
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
```

Then call `mcp_lexrunner_plan_create` without any parameters - it will auto-detect and use GitHub mode:
```json
{
  "name": "mcp_lexrunner_plan_create",
  "arguments": {}
}
```

The tool will:
1. Detect that scope.yml has GitHub filters
2. Automatically enable GitHub mode
3. Use filters from scope.yml (`query`, `labels`, `target`)
4. Log to stderr: `[mcp:mcp_lexrunner_plan_create] Auto-detected GitHub mode from scope.yml filters`
5. Discover PRs matching the filters
6. Generate plan.json with discovered PRs

**Example - GitHub Auto-Discovery Mode (explicit):**
```json
{
  "name": "mcp_lexrunner_plan_create",
  "arguments": {
    "fromGithub": true,
    "labels": ["feature", "bugfix"],
    "excludePRs": [123, 456],
    "requiredGates": ["lint", "test", "security"],
    "maxWorkers": 4,
    "target": "develop",
    "outDir": "/tmp/lexrunner-plan"
  }
}
```

**Example - Complex GitHub Query:**
```json
{
  "name": "mcp_lexrunner_plan_create",
  "arguments": {
    "fromGithub": true,
    "query": "is:open label:stack:* -label:wip",
    "includeDrafts": false,
    "githubToken": "ghp_...",
    "owner": "myorg",
    "repo": "myrepo"
  }
}
```

### pr_list

Lists pull requests from GitHub without creating a plan. This is a granular tool that allows agents to discover PRs independently before deciding whether to create a plan.

**Parameters:**
- `owner` (string, optional): GitHub repository owner (auto-detected from git remote if not provided)
- `repo` (string, optional): GitHub repository name (auto-detected from git remote if not provided)
- `query` (string, optional): GitHub search query (e.g., 'is:open label:stack:*')
- `labels` (array of strings, optional): Filter PRs by labels
- `includeDrafts` (boolean, optional): Include draft PRs in results (default: true)
- `excludePRs` (array of numbers, optional): Exclude specific PR numbers
- `githubToken` (string, optional): GitHub API token (or use GITHUB_TOKEN env var)
- `state` (string, optional): PR state filter - "open", "closed", or "all" (default: "open")

**Returns:**
```json
{
  "pullRequests": [
    {
      "number": 123,
      "title": "Add feature X",
      "branch": "feature/x",
      "author": "developer",
      "labels": ["feature", "ready"],
      "sha": "abc123def456",
      "draft": false
    }
  ],
  "total": 10,
  "filtered": 5,
  "owner": "myorg",
  "repo": "myrepo"
}
```

**Example:**
```json
{
  "name": "pr_list",
  "arguments": {
    "labels": ["ready-merge"],
    "includeDrafts": false,
    "excludePRs": [100, 101]
  }
}
```

**Use Cases:**
- **Pre-flight checks**: List PRs to verify what would be included before creating a plan
- **Human review**: Show PRs to user for manual selection before plan creation
- **Custom workflows**: Build multi-step workflows where PR discovery is separate from planning

### plan_validate

Validates a plan.json file for schema compliance and logical consistency without executing it. This granular tool allows checking plan validity independently of creation or execution.

**Parameters:**
- `planFile` (string, optional): Path to plan.json file (default: `<profile>/runner/plan.json`)
- `planContent` (string, optional): JSON string of plan content to validate (alternative to planFile)

**Returns:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["Plan contains no items"],
  "plan": {
    "schemaVersion": "1.0.0",
    "target": "main",
    "itemCount": 5
  }
}
```

If validation fails:
```json
{
  "valid": false,
  "errors": [
    {
      "path": "items",
      "message": "Duplicate item names found: PR-1",
      "code": "DUPLICATE_NAMES"
    }
  ]
}
```

**Example (validate existing file):**
```json
{
  "name": "plan_validate",
  "arguments": {
    "planFile": "/tmp/test-plan.json"
  }
}
```

**Example (validate plan content directly):**
```json
{
  "name": "plan_validate",
  "arguments": {
    "planContent": "{\"schemaVersion\":\"1.0.0\",\"target\":\"main\",\"items\":[]}"
  }
}
```

**Use Cases:**
- **Pre-execution validation**: Check a plan before running gates
- **CI validation**: Validate plans in CI/CD pipelines
- **Manual plan editing**: Validate hand-edited plan.json files

### plan_analyze

Analyzes a plan for potential conflicts and dependency issues. Performs dry-run dependency resolution and conflict detection without execution. This granular tool provides detailed analysis of plan structure and dependencies.

**Parameters:**
- `planFile` (string, optional): Path to plan.json file (default: `<profile>/runner/plan.json`)

**Returns:**
```json
{
  "valid": true,
  "mergeOrder": [
    ["PR-1", "PR-2"],
    ["PR-3"]
  ],
  "conflicts": [],
  "dependencies": {
    "total": 2
  },
  "summary": {
    "totalItems": 3,
    "maxParallelism": 2,
    "hasIssues": false
  }
}
```

If issues are found:
```json
{
  "valid": false,
  "conflicts": [
    {
      "type": "cycle",
      "message": "Dependency cycle detected: PR-1 -> PR-2 -> PR-1",
      "items": ["PR-1", "PR-2"]
    }
  ],
  "dependencies": {
    "total": 3,
    "cycles": [["PR-1", "PR-2", "PR-1"]],
    "unknown": ["PR-99"]
  },
  "summary": {
    "totalItems": 3,
    "maxParallelism": 0,
    "hasIssues": true
  }
}
```

**Example:**
```json
{
  "name": "plan_analyze",
  "arguments": {
    "planFile": ".smartergpt/runner/plan.json"
  }
}
```

**Use Cases:**
- **Dependency validation**: Verify no circular dependencies before execution
- **Parallelism planning**: Understand maximum parallelism potential
- **Conflict prediction**: Identify potential merge conflicts early

### mcp_lexrunner_gate_run

Executes gates for plan items. Can work with either an internal plan (created via `mcp_lexrunner_plan_create`) or an external plan file.

> **Deprecated alias:** `gates.run`

**Parameters:**
- `planFile` (string, optional): Path to external plan.json file. If not provided, uses internal state from the profile directory.
- `onlyItem` (string, optional): Run gates for specific item only
- `onlyGate` (string, optional): Run specific gate only
- `outDir` (string, optional): Output directory for gate results

**Returns:**
```json
{
  "items": [
    {
      "name": "item1",
      "status": "pass",
      "gates": [
        {
          "name": "test",
          "status": "pass"
        }
      ]
    }
  ],
  "allGreen": true
}
```

**Example (using internal plan):**
```json
{
  "name": "mcp_lexrunner_gate_run",
  "arguments": {
    "onlyItem": "api-endpoints",
    "outDir": ".smartergpt/runner/gates"
  }
}
```

**Example (using external plan):**
```json
{
  "name": "mcp_lexrunner_gate_run",
  "arguments": {
    "planFile": "/tmp/batch5-plan.json",
    "outDir": "/tmp/gate-results"
  }
}
```

**Use Cases:**
- **Internal state**: Run gates on a plan created via `mcp_lexrunner_plan_create` (default behavior)
- **External orchestration**: Run gates on programmatically-created or externally-managed plan files
- **Parallel workflows**: Execute gates on multiple independent plans in parallel merge-weave operations

### mcp_lexrunner_weave_apply

Applies merge operations with environment-based gating.

> **Deprecated alias:** `merge.apply`

**Parameters:**
- `dryRun` (boolean, optional): Simulate merge without making changes (default: `true`)

**Returns:**
```json
{
  "allowed": false,
  "message": "Mutations not allowed. Set ALLOW_MUTATIONS=true or use dryRun=true."
}
```

**Example:**
```json
{
  "name": "mcp_lexrunner_weave_apply",
  "arguments": {
    "dryRun": true
  }
}
```

## Safety Features

### Read-Only by Default

The MCP server is read-only by default:
- `mcp_lexrunner_weave_apply` requires `ALLOW_MUTATIONS=true` for actual merging
- All operations default to safe, non-destructive behavior
- Dry-run mode is available for testing merge eligibility

### Environment Gating

Destructive operations are gated by environment variables:
- `ALLOW_MUTATIONS=false` (default): Only read operations and dry runs
- `ALLOW_MUTATIONS=true`: Enables actual merge operations

### Error Handling

The server provides clear error messages for:
- Missing plan files (run `mcp_lexrunner_plan_create` first)
- Invalid parameters (validated using Zod schemas)
- Environment restrictions (mutations blocked when disabled)

## Integration Examples

### With MCP Client

```javascript
// Connect to the MCP server
const client = new Client({
  command: "npm",
  args: ["run", "mcp"],
  cwd: "/path/to/lexrunner"
});

// Create a plan from configuration files (traditional mode)
const planResult = await client.callTool("mcp_lexrunner_plan_create", {
  outDir: ".smartergpt/runner"
});

// Create a plan from GitHub PRs (auto-discovery mode)
const githubPlanResult = await client.callTool("mcp_lexrunner_plan_create", {
  fromGithub: true,
  labels: ["feature", "priority:high"],
  excludePRs: [100, 200],
  requiredGates: ["lint", "test", "security"],
  maxWorkers: 4,
  outDir: "/tmp/lexrunner-plan"
});

// Run gates on internal plan
const gatesResult = await client.callTool("mcp_lexrunner_gate_run", {
  outDir: ".smartergpt/runner/gates"
});

// Or run gates on external plan file
const externalGatesResult = await client.callTool("mcp_lexrunner_gate_run", {
  planFile: "/tmp/merge-batch/plan.json",
  outDir: "/tmp/merge-batch/gates"
});

// Check merge eligibility (dry run)
const mergeResult = await client.callTool("mcp_lexrunner_weave_apply", {
  dryRun: true
});
```

### External Plan Files (Merge-Weave Workflows)

The `planFile` parameter enables external orchestration workflows:

```javascript
// Programmatically create a plan
const externalPlan = {
  schemaVersion: "1.0.0",
  target: "main",
  items: [
    {
      name: "batch-item-1",
      deps: [],
      gates: [{ name: "lint", run: "npm run lint", env: {} }]
    }
  ]
};

// Write to disk
fs.writeFileSync("/tmp/batch1-plan.json", JSON.stringify(externalPlan));

// Execute gates on external plan
const result = await client.callTool("mcp_lexrunner_gate_run", {
  planFile: "/tmp/batch1-plan.json",
  outDir: "/tmp/batch1-gates"
});
```

### With Environment Variables

```bash
# Safe mode (default) - only read operations
npm run mcp

# Enable mutations for actual merging
ALLOW_MUTATIONS=true npm run mcp

# Custom profile directory
LEX_PROFILE_DIR=/my/project/.config npm run mcp
```

## Workflow

1. **Setup**: Configure your project in `LEX_PROFILE_DIR` (default: `.smartergpt/`)
2. **Plan**: Use `mcp_lexrunner_plan_create` to generate execution plan
3. **Execute**: Use `mcp_lexrunner_gate_run` to run gates and collect results
4. **Merge**: Use `mcp_lexrunner_weave_apply` to check eligibility or perform merges

The MCP server maintains the same deterministic behavior as the CLI, ensuring consistent results across different interfaces.
