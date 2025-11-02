# MCP Configuration for lex-pr-runner

## Configuration Entry

Add this to your MCP configuration file (e.g., `mcp.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "lex-pr-runner": {
      "command": "wsl",
      "args": [
        "--",
        "/home/guff/lex-pr-runner/lex-pr-runner-launcher.sh"
      ],
      "env": {
        "LEX_PR_PROFILE_DIR": "/home/guff/lex-pr-runner/.smartergpt",
        "LEX_PR_WORKSPACE": "/home/guff/lex-pr-runner",
        "ALLOW_MUTATIONS": "false"
      }
    }
  }
}
```

## Environment Variables

- **LEX_PR_PROFILE_DIR**: Path to profile directory containing `intent.md`, `scope.yml`, `deps.yml`, `gates.yml` (default: `./.smartergpt`)
- **LEX_PR_PLAN**: Optional path to a specific `plan.json` file
- **LEX_PR_WORKSPACE**: Workspace root directory (default: current directory)
- **ALLOW_MUTATIONS**: Enable write operations - `"true"` or `"false"` (default: `"false"`, read-only mode)

## Production Installation (Optional)

For alignment with other lex-* services, you can install to `/srv/lex-mcp`:

```bash
# Create installation directory
sudo mkdir -p /srv/lex-mcp/lex-pr-runner
sudo chown $USER:$USER /srv/lex-mcp/lex-pr-runner

# Copy files (run from lex-pr-runner repo root)
cp -r dist/ /srv/lex-mcp/lex-pr-runner/
cp mcp-server.mjs /srv/lex-mcp/lex-pr-runner/
cp lex-pr-runner-launcher.sh /srv/lex-mcp/lex-pr-runner/
cp package.json /srv/lex-mcp/lex-pr-runner/
cp -r node_modules/ /srv/lex-mcp/lex-pr-runner/

# Update MCP config to use production path
# Change launcher path to: /srv/lex-mcp/lex-pr-runner/lex-pr-runner-launcher.sh
```

## Alignment with lex-brain and lex-map

This MCP server configuration follows the same pattern as lex-brain and lex-map:

### lex-brain
```json
"lexbrain": {
  "command": "wsl",
  "args": ["--", "/srv/lex-mcp/lex-brain/lexbrain-launcher.sh"],
  "env": {
    "LEXBRAIN_DB": "/srv/lex-mcp/lex-brain/thoughts.db",
    "LEXBRAIN_MODE": "local"
  }
}
```

### lex-map
```json
"lexmap": {
  "command": "wsl",
  "args": ["--", "/srv/lex-mcp/lex-map/lexmap-launcher.sh"],
  "env": {
    "LEXMAP_POLICY": "/srv/lex-mcp/lex-map/lexmap.policy.json",
    "LEXMAP_CONFIG": "/srv/lex-mcp/lex-map/lexmap.config.json"
  }
}
```

### lex-pr-runner
```json
"lex-pr-runner": {
  "command": "wsl",
  "args": ["--", "/home/guff/lex-pr-runner/lex-pr-runner-launcher.sh"],
  "env": {
    "LEX_PR_PROFILE_DIR": "/home/guff/lex-pr-runner/.smartergpt",
    "LEX_PR_WORKSPACE": "/home/guff/lex-pr-runner"
  }
}
```

All three services:
1. Use a launcher shell script that sources nvm for Node.js availability
2. Execute an `mcp-server.mjs` entry point
3. Accept configuration via environment variables
4. Follow the MCP stdio protocol
5. Can be installed to `/srv/lex-mcp/` for consistent deployment

## Testing the Configuration

Test the MCP server directly:

```bash
# Development mode (using tsx)
cd /home/guff/lex-pr-runner
npm run mcp

# Production mode (using built files)
node /home/guff/lex-pr-runner/mcp-server.mjs

# Via launcher script
bash /home/guff/lex-pr-runner/lex-pr-runner-launcher.sh
```

The server should output:
```
[lex-pr-runner] Starting MCP server
[lex-pr-runner] Profile: /home/guff/lex-pr-runner/.smartergpt
[lex-pr-runner] Workspace: /home/guff/lex-pr-runner
[lex-pr-runner] Mutations: disabled (read-only)
[lex-pr-runner] MCP server loaded successfully
```
