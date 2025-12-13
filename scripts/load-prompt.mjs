#!/usr/bin/env node

/**
 * Smoke script for prompt resolution
 * 
 * Demonstrates the 5-level precedence chain:
 * 1. LEX_PROMPTS_DIR (env var)
 * 2. .smartergpt.local/prompts (local overlay)
 * 3. .smartergpt/prompts (workspace)
 * 4. @smartergpt/lex/prompts (package defaults)
 * 5. @smartergpt/lex/canon/prompts (canonical fallback)
 * 
 * Usage:
 *   npx tsx scripts/load-prompt.mjs --name=remember.md
 *   LEX_PROMPTS_DIR=/custom/path npx tsx scripts/load-prompt.mjs --name=idea.md
 * 
 * @see Guffawaffle/LexRunner#371 (R-LOADER)
 */

import { resolvePromptsDir, loadPrompt } from '../src/config/promptsResolver.js';
import * as fs from 'fs';

/**
 * Parse command line arguments
 * @returns {{name?: string, help: boolean}}
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const result = { name: undefined, help: false };

	for (const arg of args) {
		if (arg === '--help' || arg === '-h') {
			result.help = true;
		} else if (arg.startsWith('--name=')) {
			result.name = arg.slice('--name='.length);
		}
	}

	return result;
}

/**
 * Show help message
 */
function showHelp() {
	console.log(`
load-prompt.mjs - Smoke script for prompt resolution

USAGE:
  node scripts/load-prompt.mjs [OPTIONS]

OPTIONS:
  --name=<prompt>     Name of the prompt to load (without .md extension)
  --help, -h          Show this help message

ENVIRONMENT:
  LEX_PROMPTS_DIR     Override prompts directory (highest precedence)

PRECEDENCE CHAIN (highest to lowest):
  1. LEX_PROMPTS_DIR environment variable
  2. .smartergpt.local/prompts (local overlay)
  3. .smartergpt/prompts (workspace)
  4. @smartergpt/lex/prompts (package defaults)
  5. @smartergpt/lex/canon/prompts (canonical fallback)

EXAMPLES:
  # Resolve prompts directory without loading a specific prompt
  node scripts/load-prompt.mjs

  # Load a specific prompt by name
  node scripts/load-prompt.mjs --name=remember

  # Override prompts directory via environment variable
  LEX_PROMPTS_DIR=/custom/prompts node scripts/load-prompt.mjs --name=idea

  # Load prompt from Lex package (if no local prompts exist)
  node scripts/load-prompt.mjs --name=idea
`);
}

/**
 * Main function
 */
async function main() {
	const args = parseArgs();

	if (args.help) {
		showHelp();
		process.exit(0);
	}

	console.log('=== Prompt Resolution Smoke Test ===\n');

	// Show environment info
	console.log('Environment:');
	console.log(`  LEX_PROMPTS_DIR: ${process.env.LEX_PROMPTS_DIR || '(not set)'}`);
	console.log(`  Working directory: ${process.cwd()}\n`);

	// Resolve prompts directory
	try {
		const resolved = resolvePromptsDir(process.cwd());
		console.log('Resolved prompts directory:');
		console.log(`  Path: ${resolved.path}`);
		console.log(`  Source: ${resolved.source}`);

		// List available prompts
		const files = fs.readdirSync(resolved.path)
			.filter(f => f.endsWith('.md'))
			.sort();
		console.log(`  Available prompts: ${files.length > 0 ? files.join(', ') : '(none)'}\n`);

		// Load specific prompt if requested
		if (args.name) {
			console.log(`Loading prompt: ${args.name}\n`);
			
			const prompt = loadPrompt(args.name, process.cwd());
			
			console.log('Prompt metadata:');
			console.log(`  Name: ${prompt.metadata.name}`);
			if (prompt.metadata.version) {
				console.log(`  Version: ${prompt.metadata.version}`);
			}
			if (prompt.metadata.schemaVersion) {
				console.log(`  Schema version: ${prompt.metadata.schemaVersion}`);
			}
			if (prompt.metadata.description) {
				console.log(`  Description: ${prompt.metadata.description}`);
			}
			console.log(`  File: ${prompt.path}`);
			console.log('\nPrompt content (first 500 chars):');
			console.log('-'.repeat(50));
			console.log(prompt.content.slice(0, 500));
			if (prompt.content.length > 500) {
				console.log(`\n... (${prompt.content.length - 500} more characters)`);
			}
		}

		console.log('\n✅ Prompt resolution successful!');
	} catch (error) {
		console.error('\n❌ Prompt resolution failed:');
		console.error(`  ${error.message}`);
		process.exit(1);
	}
}

main();
