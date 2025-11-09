/**
 * Example: How to use safety mechanisms in Issues-only commands
 * 
 * This example demonstrates the recommended pattern for implementing
 * Issues-only commands that create GitHub Issues without PRs.
 * 
 * @example
 * // Run this example:
 * // npm run cli -- idea --title "Feature" --description "Add feature" --output ./output.json
 */

import { assertNoCreatePR, validateNoCreatePRFlags } from '../src/commands/guards.js';
import { validateOutputPath } from '../src/utils/paths.js';
import { validateOrThrow } from '../src/commands/validation.js';
import { z } from 'zod';
import * as fs from 'fs/promises';

// Define the schema for the feature spec
const FeatureSpecV0Schema = z.object({
	schemaVersion: z.literal('0.1.0'),
	title: z.string().min(1, 'Title is required'),
	description: z.string().min(1, 'Description is required'),
	features: z.array(z.string()).default([]),
	acceptanceCriteria: z.array(z.string()).default([]),
	technicalNotes: z.string().optional()
});

type FeatureSpecV0 = z.infer<typeof FeatureSpecV0Schema>;

interface IdeaCommandOptions {
	title: string;
	description: string;
	output?: string;
	'dry-run'?: boolean;
	[key: string]: unknown;
}

/**
 * Example implementation of an Issues-only command
 * 
 * This simulates the 'lex-pr idea' command that will be implemented in Issue #355
 */
async function exampleIdeaCommand(options: IdeaCommandOptions): Promise<void> {
	console.log('🛡️  Running safety checks...\n');
	
	// ====== SAFETY LAYER 1: PR Prevention Guards ======
	
	console.log('1️⃣  Checking for PR creation attempts...');
	assertNoCreatePR('lex-pr idea');
	console.log('   ✅ No PR creation detected\n');
	
	console.log('2️⃣  Validating command flags...');
	validateNoCreatePRFlags(options);
	console.log('   ✅ No PR flags detected\n');
	
	// ====== SAFETY LAYER 2: Data Validation ======
	
	console.log('3️⃣  Validating feature spec data...');
	const specData: FeatureSpecV0 = {
		schemaVersion: '0.1.0',
		title: options.title,
		description: options.description,
		features: [],
		acceptanceCriteria: []
	};
	
	const validatedSpec = validateOrThrow(specData, FeatureSpecV0Schema, 'Feature Spec v0');
	console.log('   ✅ Spec data validated\n');
	
	// ====== SAFETY LAYER 3: Path Validation ======
	
	console.log('4️⃣  Validating output path...');
	const outputPath = options.output || '.smartergpt.local/deliverables/_session/feature-spec.json';
	await validateOutputPath(outputPath);
	console.log(`   ✅ Output path validated: ${outputPath}\n`);
	
	// ====== COMMAND EXECUTION ======
	
	if (options['dry-run']) {
		console.log('🔍 DRY RUN: Would write spec to:', outputPath);
		console.log('\nSpec content:');
		console.log(JSON.stringify(validatedSpec, null, 2));
		return;
	}
	
	console.log('5️⃣  Writing feature spec...');
	await fs.writeFile(outputPath, JSON.stringify(validatedSpec, null, 2));
	console.log(`   ✅ Feature spec written to ${outputPath}\n`);
	
	// Future: Create GitHub Issue here (not implemented in this PR)
	console.log('6️⃣  Creating GitHub Issue...');
	console.log('   ⚠️  GitHub Issue creation not yet implemented (Issue #355)');
	console.log('   📝 Use spec file to manually create issue for now\n');
	
	console.log('✅ Command completed successfully!');
}

/**
 * Example of a command that would be rejected by safety guards
 */
async function exampleUnsafeCommand(): Promise<void> {
	console.log('🚨 Example: Unsafe command execution\n');
	
	try {
		const unsafeOptions = {
			title: 'Test',
			description: 'Test',
			'create-pr': true, // ❌ This will be caught
			output: 'artifacts/PR-123/spec.json' // ❌ This will also be caught
		};
		
		console.log('Attempting to run with PR flags...');
		validateNoCreatePRFlags(unsafeOptions);
	} catch (error) {
		console.error('❌ CAUGHT:', (error as Error).message);
		console.log('\n✅ Safety guard prevented unsafe operation!\n');
	}
	
	try {
		const unsafeOutput = 'artifacts/PR-456/output.json';
		console.log('Attempting to write to PR artifact directory...');
		await validateOutputPath(unsafeOutput);
	} catch (error) {
		console.error('❌ CAUGHT:', (error as Error).message);
		console.log('\n✅ Path validation prevented unsafe write!\n');
	}
}

/**
 * Example of schema validation catching errors
 */
async function exampleSchemaValidation(): Promise<void> {
	console.log('🔍 Example: Schema validation\n');
	
	try {
		console.log('Attempting to validate invalid spec...');
		const invalidSpec = {
			schemaVersion: '0.1.0',
			title: '', // ❌ Title cannot be empty
			description: 123, // ❌ Should be string
			features: 'not-an-array' // ❌ Should be array
		};
		
		validateOrThrow(invalidSpec, FeatureSpecV0Schema, 'Feature Spec v0');
	} catch (error) {
		console.error('❌ CAUGHT:', (error as Error).message);
		console.log('\n✅ Schema validation prevented invalid data!\n');
	}
}

// Main execution
async function main(): Promise<void> {
	console.log('═══════════════════════════════════════════════════════');
	console.log('  Safety Mechanisms Example');
	console.log('═══════════════════════════════════════════════════════\n');
	
	// Example 1: Safe command execution
	console.log('━━━ Example 1: Safe Command Execution ━━━\n');
	await exampleIdeaCommand({
		title: 'Add user authentication',
		description: 'Implement OAuth2 authentication flow',
		output: '.smartergpt.local/deliverables/_session/example-spec.json',
		'dry-run': true
	});
	
	console.log('\n\n');
	
	// Example 2: Unsafe command (demonstrates guards)
	console.log('━━━ Example 2: Unsafe Command (Safety Guards) ━━━\n');
	await exampleUnsafeCommand();
	
	console.log('\n');
	
	// Example 3: Schema validation
	console.log('━━━ Example 3: Schema Validation ━━━\n');
	await exampleSchemaValidation();
	
	console.log('═══════════════════════════════════════════════════════');
	console.log('  All Examples Complete');
	console.log('═══════════════════════════════════════════════════════\n');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
}

export {
	exampleIdeaCommand,
	exampleUnsafeCommand,
	exampleSchemaValidation
};
