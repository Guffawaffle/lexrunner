/**
 * DEPRECATED: This file is no longer used.
 *
 * The MCP server has been migrated to align with LexBrain and LexMap architecture.
 * See: /srv/lex-mcp/lexrunner/mcp-server.mjs
 *
 * Migration Date: 2025-11-02
 *
 * Architecture Changes:
 * - SDK-based implementation → Direct stdio JSON-RPC 2.0
 * - TypeScript server.ts → JavaScript mcp-server.mjs
 * - Complex abstractions → Simple, aligned protocol handling
 *
 * Functionality Preserved:
 * All tools remain functional with identical interfaces:
 * - plan.create
 * - gates.run
 * - merge.apply
 * - local.init
 * - profile.resolve
 * - health
 *
 * Why the change?
 * - Architectural alignment with LexBrain and LexMap
 * - Easier cross-project bug fixes
 * - Simpler maintenance
 * - No breaking changes to tool APIs
 *
 * This file will be removed in a future cleanup.
 */

export {};
