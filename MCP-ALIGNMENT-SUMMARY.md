# MCP Alignment Summary

**Date:** November 2, 2025
**Status:** ✅ Complete and Tested

## Objective

Align lex-pr-runner's MCP server implementation with LexBrain and LexMap's architecture to ensure consistency across the Lex ecosystem and make bug fixes easier to apply uniformly.

## What Was Done

### 1. Rewrote MCP Server (`mcp-server.mjs`)

**Before:**
- SDK-based implementation using `@modelcontextprotocol/sdk`
- Launcher script importing `dist/server.js`
- Different pattern from LexBrain/LexMap

**After:**
- Direct stdio JSON-RPC 2.0 implementation
- Single-file protocol handler importing `dist/cli.js`
- Identical pattern to LexBrain/LexMap

**Key Changes:**
- Line-delimited JSON protocol handling
- Simple buffer management for partial messages
- Inline tool definitions with async handlers
- Direct imports of core functions from built CLI
- Consistent error handling with JSON-RPC codes

### 2. Updated CLI Exports (`src/cli.ts`)

Added exports for MCP server use:
```typescript
export {
  // Core functionality
  loadInputs,
  generatePlan,
  generateSnapshot,
  loadPlan,

  // Execution
  executeGatesWithPolicy,
  ExecutionState,
  MergeEligibilityEvaluator,

  // Configuration
  initLocalOverlay,
  resolveProfile,

  // Utilities
  canonicalJSONStringify,

  // Monitoring
  healthChecker,
};
```

### 3. Simplified Build Process (`package.json`)

**Before:**
```json
"mcp": "tsx src/mcp/server.ts",
"build": "tsup src/cli.ts ... && tsup src/mcp/server.ts ..."
```

**After:**
```json
"mcp": "node mcp-server.mjs",
"build": "tsup src/cli.ts --format esm,cjs --dts --out-dir dist"
```

## Changes Made

### 1. Created `mcp-server.mjs` (Root Entry Point)
- **Purpose**: Standalone MCP server entry point that mirrors lex-brain and lex-map structure
- **Location**: `/home/guff/lex-pr-runner/mcp-server.mjs`
- **Features**:
  - Reads environment variables for configuration
  - Logs startup information to stderr
  - Dynamically imports the built TypeScript MCP server (`dist/server.js`)
  - Executable with shebang (`#!/usr/bin/env node`)

**Environment Variables Supported**:
- `LEX_PR_PROFILE_DIR`: Profile directory path (default: `./.smartergpt`)
- `LEX_PR_PLAN`: Optional specific plan.json path
- `LEX_PR_WORKSPACE`: Workspace root (default: current directory)
- `ALLOW_MUTATIONS`: Enable write operations (default: `false`)

### 2. Created `lex-pr-runner-launcher.sh` (WSL Launcher)
- **Purpose**: Ensures Node.js is available via nvm before starting the MCP server
- **Location**: `/home/guff/lex-pr-runner/lex-pr-runner-launcher.sh`
- **Features**:
  - Sources nvm if available
  - Supports both development path (`/home/guff/lex-pr-runner`) and production path (`/srv/lex-mcp/lex-pr-runner`)
  - Executable bash script

### 3. Updated `package.json`
- **Added bin entry**: `"lex-pr-runner-mcp": "./mcp-server.mjs"`
- Aligns with lex-brain (`lexbrain-mcp`) and lex-map (`lexmap-mcp`)

### 4. Created `MCP-CONFIG.md` (Configuration Guide)
- Complete MCP configuration documentation
- Environment variable reference
- Production installation instructions
- Comparison with lex-brain and lex-map configurations
- Testing procedures

### 5. Updated `README.mcp.md`
- Added quick-start MCP configuration example
- Updated environment variable documentation
- Added reference to MCP-CONFIG.md
- Clarified startup methods (dev, production, launcher)

## Alignment with lex-brain and lex-map

All three lex-* services now follow the same pattern:

| Aspect | lex-brain | lex-map | lex-pr-runner |
|--------|-----------|---------|---------------|
| **Launcher Script** | `lexbrain-launcher.sh` | `lexmap-launcher.sh` | `lex-pr-runner-launcher.sh` |
| **MCP Entry Point** | `mcp-server.mjs` | `mcp-server.mjs` | `mcp-server.mjs` |
| **Bin Name** | `lexbrain-mcp` | `lexmap-mcp` | `lex-pr-runner-mcp` |
| **Config Method** | Environment variables | Environment variables | Environment variables |
| **Protocol** | MCP stdio | MCP stdio | MCP stdio |
| **Node Setup** | nvm sourcing | nvm sourcing | nvm sourcing |

## MCP Configuration Example

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

This matches the pattern used for lex-brain and lex-map exactly.

## Testing Results

✅ **Direct MCP server execution**:
```bash
$ node mcp-server.mjs
[lex-pr-runner] Starting MCP server
[lex-pr-runner] Profile: /home/guff/lex-pr-runner/.smartergpt
[lex-pr-runner] Workspace: /home/guff/lex-pr-runner
[lex-pr-runner] Mutations: disabled (read-only)
[lex-pr-runner] MCP server loaded successfully
```

✅ **Launcher script execution**:
```bash
$ bash lex-pr-runner-launcher.sh
[lex-pr-runner] Starting MCP server
[lex-pr-runner] Profile: /home/guff/lex-pr-runner/.smartergpt
[lex-pr-runner] Workspace: /home/guff/lex-pr-runner
[lex-pr-runner] Mutations: disabled (read-only)
[lex-pr-runner] MCP server loaded successfully
```

## Files Modified/Created

- ✅ **NEW**: `mcp-server.mjs` - Root MCP entry point
- ✅ **NEW**: `lex-pr-runner-launcher.sh` - WSL launcher script
- ✅ **NEW**: `MCP-CONFIG.md` - Configuration documentation
- ✅ **MODIFIED**: `package.json` - Added bin entry for `lex-pr-runner-mcp`
- ✅ **MODIFIED**: `README.mcp.md` - Updated with configuration examples

## Benefits

1. **Consistent Configuration**: Same mcp.json pattern across all lex-* services
2. **Production Ready**: Supports deployment to `/srv/lex-mcp/` if desired
3. **Development Friendly**: Works from current development path
4. **Environment Isolation**: Configuration via environment variables
5. **WSL Compatible**: Launcher handles nvm/Node.js setup automatically
6. **Read-Only by Default**: Safe mutations toggle via `ALLOW_MUTATIONS`

## Next Steps (Optional)

If you want to install to production location:

```bash
sudo mkdir -p /srv/lex-mcp/lex-pr-runner
sudo chown $USER:$USER /srv/lex-mcp/lex-pr-runner
cd /home/guff/lex-pr-runner
cp -r dist/ mcp-server.mjs lex-pr-runner-launcher.sh package.json node_modules/ \
  /srv/lex-mcp/lex-pr-runner/
```

Then update mcp.json launcher path to `/srv/lex-mcp/lex-pr-runner/lex-pr-runner-launcher.sh`.

## Compliance

✅ Follows AGENTS.md principles (two-track separation, deterministic, portable)
✅ Uses `replace_string_in_file` for edits (no sed/awk violations)
✅ Matches canonical terms from docs/TERMS.md
✅ TypeScript-first with proper build pipeline
✅ No workspace artifacts in core runner path

## Summary of November 2, 2025 Updates

### Architecture Migration Complete ✅

**What Changed:**
- Migrated from SDK-based MCP implementation to direct stdio JSON-RPC 2.0
- Now fully aligned with LexBrain and LexMap architecture patterns
- All 6 tools preserved with identical interfaces

**Files Modified:**
- `mcp-server.mjs` - Complete rewrite using stdio protocol
- `src/cli.ts` - Added function exports for MCP server
- `package.json` - Simplified build and mcp scripts
- `README.mcp.md` - Updated with alignment documentation

**New Files:**
- `docs/MCP-MIGRATION.md` - Comprehensive migration guide
- `src/mcp/DEPRECATED.md` - Deprecation notice
- `test-mcp.mjs` - Integration test script

**Testing:**
- ✅ TypeScript compilation passes
- ✅ Build succeeds
- ✅ MCP server starts correctly
- ✅ All 6 tools functional
- ✅ Protocol alignment verified

**Benefits:**
- Same architecture as LexBrain and LexMap
- Easier cross-project bug fixes
- Simpler maintenance
- No breaking changes

**See:** `docs/MCP-MIGRATION.md` for detailed migration documentation.
