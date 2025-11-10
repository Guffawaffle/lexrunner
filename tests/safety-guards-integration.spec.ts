/**
 * Integration tests for safety mechanisms
 * 
 * Demonstrates how guards, path validation, and schema validation work together
 * to provide comprehensive safety for Issues-only commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertNoCreatePR, validateNoCreatePRFlags } from '../src/commands/guards.js';
import { validateOutputPath } from '../src/utils/paths.js';
import { validateOrThrow } from '../src/commands/validation.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Example schema for feature spec
const FeatureSpecSchema = z.object({
	title: z.string(),
	description: z.string(),
	features: z.array(z.string())
});

describe('Integration: Safety mechanisms for Issues-only commands', () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let testDir: string;
	
	beforeEach(async () => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		
		testDir = path.join(os.tmpdir(), 'lex-pr-integration-test-' + Date.now());
		await fs.mkdir(testDir, { recursive: true });
	});
	
	afterEach(async () => {
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});
	
	describe('Successful workflow simulation', () => {
		it('should allow safe command execution with all guards passing', async () => {
			// Simulate a safe command like 'lex-pr idea'
			const commandOptions = {
				title: 'New Feature',
				description: 'Add new feature',
				output: path.join(testDir, 'deliverables', '_session', 'idea.json')
			};
			
			// 1. Check no PR creation attempts
			expect(() => assertNoCreatePR('lex-pr idea')).not.toThrow();
			
			// 2. Validate no PR flags
			expect(() => validateNoCreatePRFlags(commandOptions)).not.toThrow();
			
			// 3. Validate output path
			await expect(validateOutputPath(commandOptions.output)).resolves.not.toThrow();
			
			// 4. Validate spec data
			const specData = {
				title: commandOptions.title,
				description: commandOptions.description,
				features: ['feature1', 'feature2']
			};
			
			const validatedSpec = validateOrThrow(specData, FeatureSpecSchema, 'Feature Spec');
			expect(validatedSpec).toEqual(specData);
		});
	});
	
	describe('Guard violations', () => {
		it('should prevent PR flag in command options', () => {
			const commandOptions = {
				title: 'New Feature',
				description: 'Add new feature',
				'create-pr': true // VIOLATION
			};
			
			expect(() => {
				assertNoCreatePR('lex-pr idea');
				validateNoCreatePRFlags(commandOptions); // Should throw here
			}).toThrow('SAFETY VIOLATION');
		});
		
		it('should prevent output to PR artifact directory', async () => {
			const commandOptions = {
				title: 'New Feature',
				description: 'Add new feature',
				output: '/path/to/artifacts/PR-123/spec.json' // VIOLATION
			};
			
			await expect(async () => {
				assertNoCreatePR('lex-pr idea');
				validateNoCreatePRFlags(commandOptions);
				await validateOutputPath(commandOptions.output); // Should throw here
			}).rejects.toThrow('SAFETY VIOLATION');
		});
		
		it('should prevent invalid schema data', () => {
			const invalidSpecData = {
				title: 'New Feature',
				description: 123, // Should be string - VIOLATION
				features: ['feature1']
			};
			
			expect(() => {
				assertNoCreatePR('lex-pr idea');
				validateNoCreatePRFlags({ title: 'Test' });
				validateOrThrow(invalidSpecData, FeatureSpecSchema, 'Feature Spec'); // Should throw here
			}).toThrow('Schema validation failed');
		});
	});
	
	describe('Multiple guard violations', () => {
		it('should catch first violation in sequence', async () => {
			const commandOptions = {
				title: 'New Feature',
				description: 'Add new feature',
				pr: 'main', // VIOLATION - PR flag
				output: '/artifacts/PR-123/spec.json' // VIOLATION - PR directory
			};
			
			// Should catch PR flag first
			expect(() => {
				assertNoCreatePR('lex-pr idea');
				validateNoCreatePRFlags(commandOptions);
			}).toThrow('SAFETY VIOLATION');
			expect(() => {
				validateNoCreatePRFlags(commandOptions);
			}).toThrow('--pr');
		});
	});
	
	describe('Real-world command simulation', () => {
		it('should validate a complete idea command workflow', async () => {
			// Simulate the full workflow of 'lex-pr idea' command
			const commandName = 'lex-pr idea';
			const options = {
				title: 'Add user authentication',
				description: 'Implement OAuth2 authentication flow',
				output: path.join(testDir, '.smartergpt.local', 'deliverables', '_session', 'idea-spec.json')
			};
			
			// Step 1: Assert no PR creation
			expect(() => assertNoCreatePR(commandName)).not.toThrow();
			
			// Step 2: Validate no PR flags
			expect(() => validateNoCreatePRFlags(options)).not.toThrow();
			
			// Step 3: Create spec data
			const specData = {
				title: options.title,
				description: options.description,
				features: [
					'OAuth2 provider integration',
					'User session management',
					'Token refresh mechanism'
				]
			};
			
			// Step 4: Validate spec against schema
			const validatedSpec = validateOrThrow(specData, FeatureSpecSchema, 'Feature Spec');
			expect(validatedSpec).toBeDefined();
			
			// Step 5: Validate output path
			await validateOutputPath(options.output);
			
			// Step 6: Write spec file (in real command)
			await fs.writeFile(options.output, JSON.stringify(validatedSpec, null, 2));
			
			// Verify file was created
			const fileExists = await fs.access(options.output).then(() => true).catch(() => false);
			expect(fileExists).toBe(true);
			
			// Verify file content
			const fileContent = await fs.readFile(options.output, 'utf-8');
			const parsedContent = JSON.parse(fileContent);
			expect(parsedContent).toEqual(validatedSpec);
		});
		
		it('should reject create-project command with PR flag', () => {
			const commandName = 'lex-pr create-project';
			const options = {
				spec: '/path/to/spec.json',
				'pull-request': true // VIOLATION
			};
			
			expect(() => {
				assertNoCreatePR(commandName);
				validateNoCreatePRFlags(options);
			}).toThrow('SAFETY VIOLATION');
			expect(() => {
				validateNoCreatePRFlags(options);
			}).toThrow('--pull-request');
		});
	});
});
