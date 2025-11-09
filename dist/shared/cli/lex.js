#!/usr/bin/env node
// Lightweight launcher that invokes the built CLI entry in dist
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve to dist/cli.js from dist/shared/cli/lex.js -> ../../cli.js
const target = path.join(__dirname, "..", "..", "cli.js");

// Dynamic import so ESM works when executed as a bin
import(target).catch((err) => {
	// eslint-disable-next-line no-console
	console.error("Failed to run lex CLI:", err);
	process.exit(1);
});
