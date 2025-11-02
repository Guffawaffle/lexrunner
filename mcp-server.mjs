#!/usr/bin/env node
/**
 * lex-pr-runner MCP Server
 *
 * A Model Context Protocol (MCP) server for merge pyramid orchestration.
 * Exposes read-only tools for plan creation, gate execution, and merge operations.
 *
 * Usage:
 *   lex-pr-runner-mcp
 *   npx -y /home/guff/lex-pr-runner
 *
 * Environment variables:
 *   LEX_PR_PROFILE_DIR   - Path to profile directory (default: ./.smartergpt)
 *   LEX_PR_PLAN          - Path to plan.json file (optional)
 *   LEX_PR_WORKSPACE     - Workspace root (default: current directory)
 *   ALLOW_MUTATIONS      - Enable write operations (default: false, use with caution)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration from environment
const config = {
  profileDir: process.env.LEX_PR_PROFILE_DIR || resolve(process.cwd(), ".smartergpt"),
  planPath: process.env.LEX_PR_PLAN,
  workspaceRoot: process.env.LEX_PR_WORKSPACE || process.cwd(),
  allowMutations: process.env.ALLOW_MUTATIONS === "true",
};

console.error(`[lex-pr-runner] Starting MCP server`);
console.error(`[lex-pr-runner] Profile: ${config.profileDir}`);
console.error(`[lex-pr-runner] Workspace: ${config.workspaceRoot}`);
console.error(`[lex-pr-runner] Mutations: ${config.allowMutations ? "ENABLED" : "disabled (read-only)"}`);

if (config.planPath) {
  console.error(`[lex-pr-runner] Plan: ${config.planPath}`);
}

// Import and run the actual MCP server implementation
import("./dist/server.js")
  .then((module) => {
    console.error(`[lex-pr-runner] MCP server loaded successfully`);
  })
  .catch((err) => {
    console.error(`[lex-pr-runner] ERROR: Failed to load MCP server: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
