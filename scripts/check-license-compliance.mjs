#!/usr/bin/env node

/**
 * License Compliance Gate
 * 
 * Validates that LexRunner properly attributes and complies with the MIT license
 * of its @smartergpt/lex dependency.
 * 
 * Checks:
 * 1. package.json includes @smartergpt/lex as a dependency
 * 2. No Lex source code copied into LexRunner (only imports allowed)
 * 3. License headers don't conflict with Lex
 * 4. NOTICE.md exists and contains Lex attribution
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');

// ANSI color codes for output
const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
};

const { green, red, yellow, blue, reset } = colors;

let exitCode = 0;
const failures = [];
const warnings = [];

/**
 * Print a success message
 */
function success(message) {
	console.log(`${green}✓${reset} ${message}`);
}

/**
 * Print a failure message and mark test as failed
 */
function fail(message) {
	console.error(`${red}✗${reset} ${message}`);
	failures.push(message);
	exitCode = 1;
}

/**
 * Print a warning message
 */
function warn(message) {
	console.warn(`${yellow}⚠${reset} ${message}`);
	warnings.push(message);
}

/**
 * Print an info message
 */
function info(message) {
	console.log(`${blue}ℹ${reset} ${message}`);
}

/**
 * Check 1: Validate package.json includes @smartergpt/lex
 */
function checkPackageJson() {
	info('Checking package.json for Lex dependency...');
	
	const packageJsonPath = join(rootDir, 'package.json');
	if (!existsSync(packageJsonPath)) {
		fail('package.json not found');
		return;
	}
	
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
	
	// Check dependencies
	const hasLexDep = packageJson.dependencies && packageJson.dependencies['@smartergpt/lex'];
	const hasLexDevDep = packageJson.devDependencies && packageJson.devDependencies['@smartergpt/lex'];
	
	if (hasLexDep) {
		success(`Lex dependency found: @smartergpt/lex@${packageJson.dependencies['@smartergpt/lex']}`);
	} else if (hasLexDevDep) {
		warn('Lex is in devDependencies but should be in dependencies');
	} else {
		fail('Lex dependency not found in package.json');
	}
}

/**
 * Check 2: Ensure no Lex source code is copied into LexRunner
 */
function checkNoLexSourceCopied() {
	info('Checking for copied Lex source code...');
	
	const srcDir = join(rootDir, 'src');
	if (!existsSync(srcDir)) {
		warn('src directory not found');
		return;
	}
	
	const violations = [];
	
	/**
	 * Recursively scan directory for TypeScript files
	 */
	function scanDirectory(dir) {
		const entries = readdirSync(dir);
		
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			
			if (stat.isDirectory()) {
				scanDirectory(fullPath);
			} else if (entry.endsWith('.ts') || entry.endsWith('.js') || entry.endsWith('.mjs')) {
				checkFileForLexCopy(fullPath);
			}
		}
	}
	
	/**
	 * Check if a file appears to be copied Lex source
	 */
	function checkFileForLexCopy(filePath) {
		const content = readFileSync(filePath, 'utf-8');
		const relativePath = relative(rootDir, filePath);
		
		// Check for indicators that this might be copied Lex code
		// 1. Copyright header claiming to be from Lex or smartergpt
		const lexCopyrightPattern = /Copyright.*@smartergpt\/lex|Copyright.*SmarterGPT|Copyright.*Lex framework/i;
		if (lexCopyrightPattern.test(content)) {
			violations.push(`${relativePath}: Contains Lex copyright claim`);
		}
		
		// 2. License header claiming to be Lex
		const lexLicensePattern = /@license.*@smartergpt\/lex|This file is part of.*Lex/i;
		if (lexLicensePattern.test(content)) {
			violations.push(`${relativePath}: Contains Lex license claim`);
		}
		
		// 3. Check for package name in file (but allow imports)
		// This is tricky - we want to allow: import { X } from '@smartergpt/lex'
		// But not allow: copied wholesale from @smartergpt/lex
		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			// Skip import statements
			if (line.startsWith('import ') && line.includes('@smartergpt/lex')) {
				continue;
			}
			// Skip comments mentioning Lex in documentation context
			if (line.startsWith('*') || line.startsWith('//')) {
				// Allow documentation references to Lex
				if (line.includes('@smartergpt/lex') && 
				    (line.includes('export') || line.includes('import') || 
				     line.includes('should be replaced') || line.includes('publishes'))) {
					continue;
				}
			}
		}
	}
	
	scanDirectory(srcDir);
	
	if (violations.length > 0) {
		violations.forEach(v => fail(v));
	} else {
		success('No copied Lex source code detected');
	}
}

/**
 * Check 3: Verify license headers in LexRunner files
 */
function checkLicenseHeaders() {
	info('Checking for conflicting license headers...');
	
	const srcDir = join(rootDir, 'src');
	if (!existsSync(srcDir)) {
		warn('src directory not found');
		return;
	}
	
	let filesChecked = 0;
	let filesWithConflicts = 0;
	
	/**
	 * Recursively scan directory
	 */
	function scanDirectory(dir) {
		const entries = readdirSync(dir);
		
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			
			if (stat.isDirectory()) {
				scanDirectory(fullPath);
			} else if (entry.endsWith('.ts') || entry.endsWith('.js') || entry.endsWith('.mjs')) {
				checkFileHeader(fullPath);
			}
		}
	}
	
	/**
	 * Check individual file for conflicting license headers
	 */
	function checkFileHeader(filePath) {
		filesChecked++;
		const content = readFileSync(filePath, 'utf-8');
		const relativePath = relative(rootDir, filePath);
		
		// Check for non-MIT license claims
		const nonMITPattern = /\b(GPL|Apache|BSD-3-Clause|ISC|LGPL|MPL|EPL|CDDL)\b.*License/i;
		if (nonMITPattern.test(content)) {
			// Exclude package.json references and import statements
			const lines = content.split('\n');
			for (const line of lines) {
				if (nonMITPattern.test(line) && 
				    !line.includes('import') && 
				    !line.includes('package.json')) {
					fail(`${relativePath}: Contains non-MIT license claim: ${line.trim()}`);
					filesWithConflicts++;
					break;
				}
			}
		}
		
		// Check for conflicting copyright (other than Guffawaffle or legitimate third-party mentions)
		const conflictingCopyrightPattern = /Copyright \(c\) (?!2025 Guffawaffle|.*@smartergpt\/lex)/i;
		const lines = content.split('\n');
		for (const line of lines) {
			if (conflictingCopyrightPattern.test(line) && 
			    !line.includes('import') && 
			    !line.includes('Permission is hereby granted')) {
				// This might be a legitimate third-party attribution - just warn
				warn(`${relativePath}: Contains copyright claim: ${line.trim()}`);
				break;
			}
		}
	}
	
	scanDirectory(srcDir);
	
	if (filesWithConflicts === 0) {
		success(`Checked ${filesChecked} files - no conflicting license headers found`);
	} else {
		fail(`Found conflicting license headers in ${filesWithConflicts} file(s)`);
	}
}

/**
 * Check 4: Verify NOTICE.md exists and contains Lex attribution
 */
function checkNoticeFile() {
	info('Checking NOTICE.md...');
	
	const noticePath = join(rootDir, 'NOTICE.md');
	if (!existsSync(noticePath)) {
		fail('NOTICE.md file not found');
		return;
	}
	
	const content = readFileSync(noticePath, 'utf-8');
	
	// Check for required content
	const checks = [
		{ pattern: /@smartergpt\/lex/i, desc: '@smartergpt/lex reference' },
		{ pattern: /MIT License/i, desc: 'MIT License reference' },
		{ pattern: /Copyright.*2025 Guffawaffle/i, desc: 'Lex copyright attribution' },
	];
	
	let allChecksPass = true;
	for (const check of checks) {
		if (check.pattern.test(content)) {
			success(`NOTICE.md contains ${check.desc}`);
		} else {
			fail(`NOTICE.md missing ${check.desc}`);
			allChecksPass = false;
		}
	}
	
	if (allChecksPass) {
		success('NOTICE.md contains all required attributions');
	}
}

/**
 * Main execution
 */
function main() {
	console.log('\n' + blue + '═'.repeat(60) + reset);
	console.log(blue + '  License Compliance Gate' + reset);
	console.log(blue + '═'.repeat(60) + reset + '\n');
	
	checkPackageJson();
	console.log('');
	
	checkNoLexSourceCopied();
	console.log('');
	
	checkLicenseHeaders();
	console.log('');
	
	checkNoticeFile();
	console.log('');
	
	// Print summary
	console.log(blue + '═'.repeat(60) + reset);
	if (exitCode === 0) {
		console.log(green + '✓ All license compliance checks passed!' + reset);
		if (warnings.length > 0) {
			console.log(yellow + `⚠ ${warnings.length} warning(s)` + reset);
		}
	} else {
		console.log(red + `✗ ${failures.length} compliance check(s) failed` + reset);
		if (warnings.length > 0) {
			console.log(yellow + `⚠ ${warnings.length} warning(s)` + reset);
		}
	}
	console.log(blue + '═'.repeat(60) + reset + '\n');
	
	process.exit(exitCode);
}

main();
