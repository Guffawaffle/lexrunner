#!/usr/bin/env node
/**
 * Governance Log Analysis Script (Thin Wrapper)
 *
 * DEPRECATED: This script delegates to the canonical CLI command.
 *
 * The single source of truth for governance analysis is:
 *   lex-pr governance:report
 *
 * This wrapper exists for backwards compatibility only.
 * All new development should use the CLI command directly.
 *
 * Usage:
 *   node scripts/analyze-governance-logs.mjs [options]
 *
 * Options are passed through to: lex-pr governance:report
 *
 * See: lex-pr governance:report --help
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Show deprecation notice
console.error(
	"[DEPRECATED] This script delegates to: lex-pr governance:report"
);
console.error("             Use the CLI command directly for full features.\n");

// Resolve the CLI entry point
const cliPath = join(__dirname, "..", "dist", "cli.js");

// Pass all arguments through to the CLI command
const args = ["governance:report", ...process.argv.slice(2)];

const child = spawn("node", [cliPath, ...args], {
	stdio: "inherit",
	cwd: process.cwd(),
});

child.on("error", (err) => {
	console.error(
		"[analyze-governance-logs] Failed to spawn CLI:",
		err.message
	);
	console.error("Tip: Run 'npm run build' first, then try again.");
	process.exit(1);
});

child.on("close", (code) => {
	process.exit(code ?? 0);
});
