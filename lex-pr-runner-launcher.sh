#!/bin/bash
# lex-pr-runner MCP Launcher for WSL
# This script ensures node is available by sourcing nvm

# Source nvm if it exists
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Determine the installation path
# Try production location first, fall back to development
if [ -f "/srv/lex-mcp/lex-pr-runner/mcp-server.mjs" ]; then
    SCRIPT_PATH="/srv/lex-mcp/lex-pr-runner/mcp-server.mjs"
else
    SCRIPT_PATH="/home/guff/lex-pr-runner/mcp-server.mjs"
fi

# Execute the MCP server
exec node "$SCRIPT_PATH"
