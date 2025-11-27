#!/usr/bin/env node

/**
 * CI Smoke Test for @smartergpt/lex Package Integration
 *
 * Purpose: Fast-fail CI guard to verify @smartergpt/lex presence and
 * prompt/schema resolution before the main build.
 *
 * This script:
 * 1. Resolves @smartergpt/lex package via ESM import.meta.resolve
 * 2. Checks for known schema files under the package
 * 3. Checks @smartergpt/lex/rules subpath export availability
 * 4. Prints the precedence chain locations tested
 *
 * Exit codes:
 * - 0: All checks passed
 * - 1: Package not found or critical checks failed
 *
 * @module scripts/ci-smoke
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as path from "path";

const require = createRequire(import.meta.url);

/**
 * ANSI color codes for terminal output
 */
const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
};

/**
 * Print success message
 */
function success(message) {
	console.log(`${colors.green}✓${colors.reset} ${message}`);
}

/**
 * Print failure message
 */
function failure(message) {
	console.log(`${colors.red}✗${colors.reset} ${message}`);
}

/**
 * Print info message
 */
function info(message) {
	console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

/**
 * Print section header
 */
function section(title) {
	console.log(`\n${colors.cyan}━━━ ${title} ━━━${colors.reset}`);
}

/**
 * Main smoke test function
 */
async function runSmokeTest() {
	const startTime = Date.now();
	const errors = [];

	console.log(`${colors.cyan}╔═══════════════════════════════════════════════╗${colors.reset}`);
	console.log(`${colors.cyan}║       CI Smoke Test: @smartergpt/lex          ║${colors.reset}`);
	console.log(`${colors.cyan}╚═══════════════════════════════════════════════╝${colors.reset}`);

	// ───────────────────────────────────────────────────────────────────────────
	// Step 1: Resolve @smartergpt/lex package
	// ───────────────────────────────────────────────────────────────────────────
	section("Step 1: Package Resolution");

	let lexPackagePath = null;
	let lexPackageDir = null;

	try {
		// Use ESM import.meta.resolve to find the package
		const resolvedUrl = import.meta.resolve("@smartergpt/lex");
		lexPackagePath = fileURLToPath(resolvedUrl);
		lexPackageDir = path.dirname(lexPackagePath);

		// Walk up to find the package root (where package.json is)
		let currentDir = lexPackageDir;
		while (currentDir !== path.dirname(currentDir)) {
			if (fs.existsSync(path.join(currentDir, "package.json"))) {
				const pkgJson = JSON.parse(
					fs.readFileSync(path.join(currentDir, "package.json"), "utf-8")
				);
				if (pkgJson.name === "@smartergpt/lex") {
					lexPackageDir = currentDir;
					break;
				}
			}
			currentDir = path.dirname(currentDir);
		}

		success(`@smartergpt/lex resolved`);
		info(`  Entry: ${lexPackagePath}`);
		info(`  Package root: ${lexPackageDir}`);
	} catch (error) {
		failure(`@smartergpt/lex not found`);
		info(`  Error: ${error.message}`);
		errors.push("Package @smartergpt/lex not found");
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Step 2: Check package version
	// ───────────────────────────────────────────────────────────────────────────
	section("Step 2: Package Version Check");

	if (lexPackageDir) {
		try {
			const pkgJsonPath = path.join(lexPackageDir, "package.json");
			const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
			const version = pkgJson.version;
			success(`Package version: ${version}`);

			// Check if version is acceptable (must be 0.4.x or higher)
			const versionMatch = version.match(/^(\d+)\.(\d+)/);
			if (versionMatch) {
				const major = parseInt(versionMatch[1], 10);
				const minor = parseInt(versionMatch[2], 10);
				if (major === 0 && minor < 4) {
					failure(`Package version ${version} is below minimum (0.4.x)`);
					errors.push(`Package version ${version} is below minimum required version (0.4.x)`);
				} else {
					success(`Version ${version} meets minimum requirement (≥0.4.x)`);
				}
			}
		} catch (error) {
			failure(`Could not read package.json`);
			info(`  Error: ${error.message}`);
			errors.push("Could not read @smartergpt/lex package.json");
		}
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Step 3: Check for schema files
	// ───────────────────────────────────────────────────────────────────────────
	section("Step 3: Schema Files Check");

	const expectedSchemas = [
		"cli-output.v1.schema.json",
		"profile.schema.json",
		"feature-spec-v0.json",
	];

	if (lexPackageDir) {
		const schemasDir = path.join(lexPackageDir, "schemas");
		info(`Checking schemas in: ${schemasDir}`);

		for (const schemaFile of expectedSchemas) {
			const schemaPath = path.join(schemasDir, schemaFile);
			if (fs.existsSync(schemaPath)) {
				success(`Schema found: ${schemaFile}`);
			} else {
				failure(`Schema missing: ${schemaFile}`);
				errors.push(`Schema file missing: ${schemaFile}`);
			}
		}
	} else {
		failure(`Cannot check schemas - package not resolved`);
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Step 4: Check subpath exports
	// ───────────────────────────────────────────────────────────────────────────
	section("Step 4: Subpath Exports Check");

	const subpathExports = [
		{ path: "@smartergpt/lex/rules", description: "Rules module" },
		{ path: "@smartergpt/lex/prompts", description: "Prompts module" },
		{ path: "@smartergpt/lex/cli", description: "CLI module" },
	];

	for (const { path: exportPath, description } of subpathExports) {
		try {
			// Use require.resolve since it handles subpath exports better
			require.resolve(exportPath);
			success(`${description} (${exportPath})`);
		} catch (error) {
			failure(`${description} (${exportPath})`);
			info(`  Error: ${error.message}`);
			// Note: Not all subpath exports are critical, so we don't add to errors
		}
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Step 5: Check rules directory
	// ───────────────────────────────────────────────────────────────────────────
	section("Step 5: Rules Directory Check");

	if (lexPackageDir) {
		const rulesDir = path.join(lexPackageDir, "rules");
		if (fs.existsSync(rulesDir)) {
			const ruleFiles = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".json"));
			success(`Rules directory found with ${ruleFiles.length} rule files`);
			for (const ruleFile of ruleFiles) {
				info(`  • ${ruleFile}`);
			}
		} else {
			info(`Rules directory not found at ${rulesDir}`);
		}
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Step 6: Print precedence chain
	// ───────────────────────────────────────────────────────────────────────────
	section("Step 6: Prompt Resolution Precedence Chain");

	const cwd = process.cwd();
	const precedenceLocations = [
		{ path: "LEX_PROMPTS_DIR (env var)", status: process.env.LEX_PROMPTS_DIR ? "set" : "not set" },
		{
			path: path.join(cwd, ".smartergpt.local/prompts"),
			status: fs.existsSync(path.join(cwd, ".smartergpt.local/prompts")) ? "exists" : "not found",
		},
		{
			path: path.join(cwd, ".smartergpt/prompts"),
			status: fs.existsSync(path.join(cwd, ".smartergpt/prompts")) ? "exists" : "not found",
		},
		{
			path: "@smartergpt/lex package prompts",
			status: lexPackageDir && fs.existsSync(path.join(lexPackageDir, "prompts"))
				? "available"
				: "not available",
		},
	];

	console.log(`\n  Precedence order (highest → lowest):`);
	precedenceLocations.forEach((loc, index) => {
		const statusColor =
			loc.status === "exists" || loc.status === "set" || loc.status === "available"
				? colors.green
				: colors.dim;
		console.log(`    ${index + 1}. ${loc.path}`);
		console.log(`       ${statusColor}→ ${loc.status}${colors.reset}`);
	});

	// ───────────────────────────────────────────────────────────────────────────
	// Summary
	// ───────────────────────────────────────────────────────────────────────────
	section("Summary");

	const elapsed = Date.now() - startTime;
	console.log(`\n  Duration: ${elapsed}ms`);

	if (errors.length === 0) {
		console.log(`\n${colors.green}╔═══════════════════════════════════════════════╗${colors.reset}`);
		console.log(`${colors.green}║      ✓ All smoke tests passed!                ║${colors.reset}`);
		console.log(`${colors.green}╚═══════════════════════════════════════════════╝${colors.reset}\n`);
		process.exit(0);
	} else {
		console.log(`\n${colors.red}╔═══════════════════════════════════════════════╗${colors.reset}`);
		console.log(`${colors.red}║      ✗ Smoke tests failed!                    ║${colors.reset}`);
		console.log(`${colors.red}╚═══════════════════════════════════════════════╝${colors.reset}`);
		console.log(`\n${colors.red}Errors:${colors.reset}`);
		for (const error of errors) {
			console.log(`  ${colors.red}•${colors.reset} ${error}`);
		}
		console.log("");
		process.exit(1);
	}
}

// Run the smoke test
runSmokeTest().catch((error) => {
	console.error(`${colors.red}Unexpected error:${colors.reset}`, error);
	process.exit(1);
});
