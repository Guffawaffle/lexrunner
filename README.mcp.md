# MCP Server for lex-pr-runner

The Model Context Protocol (MCP) server for lex-pr-runner provides read-only tools for plan creation, gate execution, and merge operations.

## Quick Start

### Configuration

See [MCP-CONFIG.md](./MCP-CONFIG.md) for complete configuration details and alignment with lex-brain and lex-map.

**Quick MCP Config Entry:**
```json
{
  "mcpServers": {
    "lex-pr-runner": {
      "command": "wsl",
      "args": ["--", "/home/guff/lex-pr-runner/lex-pr-runner-launcher.sh"],
      "env": {
        "LEX_PR_PROFILE_DIR": "/home/guff/lex-pr-runner/.smartergpt",
        "LEX_PR_WORKSPACE": "/home/guff/lex-pr-runner"
      }
    }
  }
}
```

### Starting the Server

```bash
# Development mode (via tsx)
npm run mcp

# Production mode (via built files)
node mcp-server.mjs

# Via launcher script (recommended for MCP clients)
bash lex-pr-runner-launcher.sh
```

The server listens on stdio and communicates using the MCP protocol.

### Environment Configuration

The MCP server respects these environment variables:

- `LEX_PR_PROFILE_DIR`: Directory containing configuration files (default: `.smartergpt`)
- `LEX_PR_WORKSPACE`: Workspace root directory (default: current directory)
- `LEX_PR_PLAN`: Optional path to a specific plan.json file
- `ALLOW_MUTATIONS`: Enable destructive operations like merging (default: `false`)

```bash
# Example with custom configuration
LEX_PR_PROFILE_DIR=/custom/profile ALLOW_MUTATIONS=true npm run mcp
```

## Available Tools

### plan.create

Creates a plan from configuration files in the profile directory.

**Parameters:**
- `json` (boolean, optional): Output plan as JSON to stdout
- `outDir` (string, optional): Output directory for plan artifacts

**Returns:**
```json
{
  "plan": { ... },
  "outDir": "/path/to/output"
}
```

**Example:**
```json
{
  "name": "plan.create",
  "arguments": {
    "json": true,
    "outDir": ".smartergpt/runner"
  }
}
```

### gates.run

Executes gates for plan items based on the current plan.

**Parameters:**
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

**Example:**
```json
{
  "name": "gates.run",
  "arguments": {
    "onlyItem": "api-endpoints",
    "outDir": ".smartergpt/runner/gates"
  }
}
```

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

// Create a plan
const planResult = await client.callTool("plan.create", {
  outDir: ".smartergpt/runner"
});

// Run gates
const gatesResult = await client.callTool("gates.run", {
  outDir: ".smartergpt/runner/gates"
});

// Check merge eligibility (dry run)
const mergeResult = await client.callTool("merge.apply", {
  dryRun: true
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
