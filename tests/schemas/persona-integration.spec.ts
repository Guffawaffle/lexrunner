import { describe, it, expect } from 'vitest';
import { parsePersona, validatePersona } from '../../src/schemas/persona.js';
import { parse as parseYaml } from 'yaml';
import * as fs from 'fs';
import * as path from 'path';

const PERSONA_DIR = path.join(__dirname, '../../.smartergpt/personas');

describe('Persona Integration', () => {
	it('validates the example persona file', () => {
		const examplePath = path.join(PERSONA_DIR, 'example.md');
		const content = fs.readFileSync(examplePath, 'utf-8');

		// Extract frontmatter between --- markers
		const parts = content.split('---\n');
		expect(parts.length).toBeGreaterThanOrEqual(3); // Before, frontmatter, after

		const frontmatter = parts[1];
		const metadata = parseYaml(frontmatter);

		// Validate the persona
		const result = validatePersona(metadata);
		expect(result.success).toBe(true);

		if (result.success) {
			expect(result.data.name).toBe('Example Persona');
			expect(result.data.version).toBe('1.0.0');
			expect(result.data.triggers).toContain('example mode');
			expect(result.data.triggers).toContain('activate example');
			expect(result.data.role.title).toBe('Example Agent');
			expect(result.data.role.scope).toBe('Demonstrate persona foundation structure');
			expect(result.data.ritual).toBe('EXAMPLE-PERSONA READY');
			expect(result.data.duties.must_do.length).toBeGreaterThan(0);
			expect(result.data.duties.must_not_do.length).toBeGreaterThan(0);
			expect(result.data.gates).toContain('lint');
			expect(result.data.gates).toContain('typecheck');
		}
	});

	it('parses the example persona without throwing', () => {
		const examplePath = path.join(PERSONA_DIR, 'example.md');
		const content = fs.readFileSync(examplePath, 'utf-8');

		const parts = content.split('---\n');
		const frontmatter = parts[1];
		const metadata = parseYaml(frontmatter);

		// Should not throw
		const persona = parsePersona(metadata);
		expect(persona.name).toBe('Example Persona');
	});

	it('demonstrates production persona structure', () => {
		// Check that production personas exist
		const seniorDevPath = path.join(PERSONA_DIR, 'senior-dev.md');
		const eagerPmPath = path.join(PERSONA_DIR, 'eager-pm.md');

		expect(fs.existsSync(seniorDevPath)).toBe(true);
		expect(fs.existsSync(eagerPmPath)).toBe(true);

		// Note: Production personas don't need frontmatter yet
		// They're markdown-only until we build advanced persona workflows
	});
});
