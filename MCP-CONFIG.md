# MCP Configuration for lexrunner

## Configuration Entry

Add this to your MCP configuration file (e.g., `mcp.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "lexrunner": {
      "command": "wsl",
      "args": [
        "--",
        "/home/guff/lexrunner/lexrunner-launcher.sh"
      ],
      "env": {
        "LEX_PR_PROFILE_DIR": "/home/guff/lexrunner/.smartergpt",
        "LEX_PR_WORKSPACE": "/home/guff/lexrunner",
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
sudo mkdir -p /srv/lex-mcp/lexrunner
sudo chown $USER:$USER /srv/lex-mcp/lexrunner

# Copy files (run from lexrunner repo root)
cp -r dist/ /srv/lex-mcp/lexrunner/
cp mcp-server.mjs /srv/lex-mcp/lexrunner/
cp lexrunner-launcher.sh /srv/lex-mcp/lexrunner/
cp package.json /srv/lex-mcp/lexrunner/
cp -r node_modules/ /srv/lex-mcp/lexrunner/

# Update MCP config to use production path
# Change launcher path to: /srv/lex-mcp/lexrunner/lexrunner-launcher.sh
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

### lexrunner
```json
"lexrunner": {
  "command": "wsl",
  "args": ["--", "/home/guff/lexrunner/lexrunner-launcher.sh"],
  "env": {
    "LEX_PR_PROFILE_DIR": "/home/guff/lexrunner/.smartergpt",
    "LEX_PR_WORKSPACE": "/home/guff/lexrunner"
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
cd /home/guff/lexrunner
npm run mcp

# Production mode (using built files)
node /home/guff/lexrunner/mcp-server.mjs

# Via launcher script
bash /home/guff/lexrunner/lexrunner-launcher.sh
```

The server should output:
```
[lexrunner] Starting MCP server
[lexrunner] Profile: /home/guff/lexrunner/.smartergpt
[lexrunner] Workspace: /home/guff/lexrunner
[lexrunner] Mutations: disabled (read-only)
[lexrunner] MCP server loaded successfully
```
