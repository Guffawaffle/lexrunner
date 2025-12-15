#!/bin/bash
# lexrunner MCP Launcher for WSL
# This script ensures node is available by sourcing nvm

# Source nvm if it exists
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Execute the MCP server from the production location
exec node /srv/lex-mcp/lexrunner/mcp-server.mjs
