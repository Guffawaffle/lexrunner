# MCP Server for lex-pr-runner

The Model Context Protocol (MCP) server for lex-pr-runner provides read-only tools for plan creation, gate execution, and merge operations.

**Architecture:** This server is aligned with LexBrain and LexMap MCP implementations, using direct stdio JSON-RPC 2.0 protocol handling for consistency and maintainability across the Lex ecosystem.

## Quick Start

### Configuration

See [MCP-CONFIG.md](./MCP-CONFIG.md) for complete configuration details and alignment with lex-brain and lex-map.

**Quick MCP Config Entry:**
```json
{
  "mcpServers": {
    "lex-pr-runner": {
      "command": "node",
      "args": ["/srv/lex-mcp/lex-pr-runner/mcp-server.mjs"],
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
bash lex-pr-runner-launcher.sh
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

### plan.create

Creates a plan from configuration files or auto-discovers from GitHub PRs.

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
  "name": "plan.create",
  "arguments": {
    "json": true,
    "outDir": ".smartergpt/runner"
  }
}
```

**Example - GitHub Auto-Discovery Mode:**
```json
{
  "name": "plan.create",
  "arguments": {
    "fromGithub": true,
    "labels": ["feature", "bugfix"],
    "excludePRs": [123, 456],
    "requiredGates": ["lint", "test", "security"],
    "maxWorkers": 4,
    "target": "develop",
    "outDir": "/tmp/lex-pr-runner-plan"
  }
}
```

**Example - Complex GitHub Query:**
```json
{
  "name": "plan.create",
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

### gates.run

Executes gates for plan items. Can work with either an internal plan (created via `plan.create`) or an external plan file.

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
  "name": "gates.run",
  "arguments": {
    "onlyItem": "api-endpoints",
    "outDir": ".smartergpt/runner/gates"
  }
}
```

**Example (using external plan):**
```json
{
  "name": "gates.run",
  "arguments": {
    "planFile": "/tmp/batch5-plan.json",
    "outDir": "/tmp/gate-results"
  }
}
```

**Use Cases:**
- **Internal state**: Run gates on a plan created via `plan.create` (default behavior)
- **External orchestration**: Run gates on programmatically-created or externally-managed plan files
- **Parallel workflows**: Execute gates on multiple independent plans in parallel merge-weave operations

### merge.apply

Applies merge operations with environment-based gating.

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
  "name": "merge.apply",
  "arguments": {
    "dryRun": true
  }
}
```

## Safety Features

### Read-Only by Default

The MCP server is read-only by default:
- `merge.apply` requires `ALLOW_MUTATIONS=true` for actual merging
- All operations default to safe, non-destructive behavior
- Dry-run mode is available for testing merge eligibility

### Environment Gating

Destructive operations are gated by environment variables:
- `ALLOW_MUTATIONS=false` (default): Only read operations and dry runs
- `ALLOW_MUTATIONS=true`: Enables actual merge operations

### Error Handling

The server provides clear error messages for:
- Missing plan files (run `plan.create` first)
- Invalid parameters (validated using Zod schemas)
- Environment restrictions (mutations blocked when disabled)

## Integration Examples

### With MCP Client

```javascript
// Connect to the MCP server
const client = new Client({
  command: "npm",
  args: ["run", "mcp"],
  cwd: "/path/to/lex-pr-runner"
});

// Create a plan from configuration files (traditional mode)
const planResult = await client.callTool("plan.create", {
  outDir: ".smartergpt/runner"
});

// Create a plan from GitHub PRs (auto-discovery mode)
const githubPlanResult = await client.callTool("plan.create", {
  fromGithub: true,
  labels: ["feature", "priority:high"],
  excludePRs: [100, 200],
  requiredGates: ["lint", "test", "security"],
  maxWorkers: 4,
  outDir: "/tmp/lex-pr-runner-plan"
});

// Run gates on internal plan
const gatesResult = await client.callTool("gates.run", {
  outDir: ".smartergpt/runner/gates"
});

// Or run gates on external plan file
const externalGatesResult = await client.callTool("gates.run", {
  planFile: "/tmp/merge-batch/plan.json",
  outDir: "/tmp/merge-batch/gates"
});

// Check merge eligibility (dry run)
const mergeResult = await client.callTool("merge.apply", {
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
const result = await client.callTool("gates.run", {
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
2. **Plan**: Use `plan.create` to generate execution plan
3. **Execute**: Use `gates.run` to run gates and collect results
4. **Merge**: Use `merge.apply` to check eligibility or perform merges

The MCP server maintains the same deterministic behavior as the CLI, ensuring consistent results across different interfaces.
