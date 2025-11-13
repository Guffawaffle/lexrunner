/**
 * Config command - Configuration inspection and debugging
 */

import { Command } from 'commander';
import { writeJsonOutput } from '../cli/output.js';
import { throwExit } from '../cli/exitHandler.js';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { getEnvWithAlias } from '../util/envUtils.js';

/**
 * Configuration source level in precedence chain
 */
interface ConfigSourceLevel {
	level: string;
	path?: string;
	checked: boolean;
	found: boolean;
	overridden?: boolean;
}

/**
 * Configuration value with source attribution
 */
interface ConfigValue {
	key: string;
	value: any;
	source: string;
	overrides?: {
		source: string;
		value: any;
	};
	precedence: ConfigSourceLevel[];
}

/**
 * Complete configuration with precedence information
 */
interface ConfigShowResult {
	precedenceChain: {
		level: string;
		source?: string;
		path?: string;
	}[];
	resolved: ConfigValue[];
}

/**
 * Load configuration file if it exists
 */
function loadConfigFile(filePath: string): any | null {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		return YAML.parse(content);
	} catch {
		return null;
	}
}

/**
 * Resolve configuration with full precedence tracking
 */
function resolveConfigWithPrecedence(baseDir: string = process.cwd()): ConfigShowResult {
	// Determine profile directories in precedence order
	const envProfileDir = getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');
	const localProfileDir = path.resolve(baseDir, '.smartergpt.local');
	const workspaceProfileDir = path.resolve(baseDir, '.smartergpt');

	const precedenceChain: { level: string; source?: string; path?: string }[] = [];
	const configFiles = ['scope.yml', 'stack.yml', 'deps.yml', 'gates.yml', 'merge-policy.yml'];
	
	// Build precedence chain
	if (envProfileDir) {
		precedenceChain.push({
			level: 'env',
			source: 'LEX_PR_PROFILE_DIR',
			path: envProfileDir
		});
	}
	
	if (fs.existsSync(localProfileDir)) {
		precedenceChain.push({
			level: 'local',
			source: '.smartergpt.local/',
			path: localProfileDir
		});
	}
	
	precedenceChain.push({
		level: 'workspace',
		source: '.smartergpt/',
		path: workspaceProfileDir
	});
	
	precedenceChain.push({
		level: 'defaults',
		source: 'built-in defaults'
	});

	// Collect all configuration values with sources
	const configMap = new Map<string, ConfigValue>();
	
	// Process directories in reverse precedence (lowest to highest priority)
	const profileDirs = [
		{ level: 'workspace', path: workspaceProfileDir, source: '.smartergpt/' },
		{ level: 'local', path: localProfileDir, source: '.smartergpt.local/' },
		...(envProfileDir ? [{ level: 'env', path: envProfileDir, source: 'LEX_PR_PROFILE_DIR' }] : [])
	].filter(d => d.path && fs.existsSync(d.path));

	// Add defaults first
	const defaults = {
		'target': 'main',
		'version': 1,
		'defaults.strategy': 'merge-weave',
		'defaults.base': 'main',
		'pin_commits': false
	};
	
	for (const [key, value] of Object.entries(defaults)) {
		configMap.set(key, {
			key,
			value,
			source: 'built-in defaults',
			precedence: []
		});
	}

	// Load from each profile directory
	for (const dir of profileDirs) {
		for (const configFile of configFiles) {
			const filePath = path.join(dir.path, configFile);
			const config = loadConfigFile(filePath);
			
			if (!config) continue;
			
			// Determine source reference based on directory level
			let sourceRef: string;
			if (dir.level === 'env') {
				sourceRef = `LEX_PR_PROFILE_DIR${configFile}`;
			} else {
				sourceRef = `${dir.source}${configFile}`;
			}
			
			// Flatten configuration object to key-value pairs
			const flatConfig = flattenObject(config, configFile.replace('.yml', ''));
			
			for (const [key, value] of Object.entries(flatConfig)) {
				const fullKey = key;
				
				if (configMap.has(fullKey)) {
					// Value is being overridden
					const existing = configMap.get(fullKey)!;
					configMap.set(fullKey, {
						key: fullKey,
						value,
						source: sourceRef,
						overrides: {
							source: existing.source,
							value: existing.value
						},
						precedence: []
					});
				} else {
					// New value
					configMap.set(fullKey, {
						key: fullKey,
						value,
						source: sourceRef,
						precedence: []
					});
				}
			}
		}
	}

	// Build precedence tracking for each value
	for (const [key, configValue] of configMap.entries()) {
		const precedence: ConfigSourceLevel[] = [];
		
		// Check environment variables
		const envFound = envProfileDir && configValue.source.startsWith('LEX_PR_PROFILE_DIR');
		precedence.push({
			level: 'env',
			checked: true,
			found: envFound || false,
			path: envProfileDir
		});
		
		// Check each profile directory
		for (const dir of profileDirs) {
			if (dir.level === 'env') continue; // Already handled above
			
			const found = configValue.source.startsWith(dir.source);
			const overridden = configValue.overrides?.source.startsWith(dir.source) || false;
			
			precedence.push({
				level: dir.level,
				path: dir.path,
				checked: true,
				found,
				overridden
			});
		}
		
		configValue.precedence = precedence;
	}

	const resolved = Array.from(configMap.values()).sort((a, b) => 
		a.key.localeCompare(b.key)
	);

	return {
		precedenceChain,
		resolved
	};
}

/**
 * Flatten nested object to dot-notation keys
 */
function flattenObject(obj: any, prefix: string = ''): Record<string, any> {
	const result: Record<string, any> = {};
	
	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			// Recursively flatten nested objects
			const nested = flattenObject(value, fullKey);
			Object.assign(result, nested);
		} else {
			// Store primitive values and arrays as-is
			result[fullKey] = value;
		}
	}
	
	return result;
}

/**
 * Format configuration value for display
 */
function formatValue(value: any): string {
	if (typeof value === 'string') {
		return `"${value}"`;
	} else if (Array.isArray(value)) {
		return `[${value.map(v => formatValue(v)).join(', ')}]`;
	} else if (typeof value === 'object' && value !== null) {
		return JSON.stringify(value);
	} else {
		return String(value);
	}
}

/**
 * Register the config command
 */
export function registerConfigCommand(
	program: Command,
	deps: {
		jsonModeActive: () => boolean;
	}
): void {
	const configCommand = program
		.command('config')
		.description('Configuration inspection and debugging');

	configCommand
		.command('show')
		.description('Display configuration with precedence chain')
		.option('--json', 'Output JSON format')
		.option('--key <name>', 'Show specific configuration key')
		.action((opts) => {
			try {
				const result = resolveConfigWithPrecedence();
				
				if (opts.json || deps.jsonModeActive()) {
					// JSON output
					if (opts.key) {
						// Single key lookup
						const configValue = result.resolved.find(v => v.key === opts.key);
						if (!configValue) {
							writeJsonOutput({
								error: `Configuration key not found: ${opts.key}`,
								available: result.resolved.map(v => v.key)
							});
							throwExit(1);
						}
						
						writeJsonOutput({
							key: configValue.key,
							value: configValue.value,
							source: configValue.source,
							...(configValue.overrides && {
								overrides: configValue.overrides
							}),
							precedence: configValue.precedence
						});
					} else {
						// Full configuration
						writeJsonOutput({
							precedenceChain: result.precedenceChain,
							configuration: result.resolved.map(v => ({
								key: v.key,
								value: v.value,
								source: v.source,
								...(v.overrides && {
									overrides: v.overrides
								})
							}))
						});
					}
				} else {
					// Human-readable output
					console.log(chalk.bold('\nConfiguration Precedence:'));
					result.precedenceChain.forEach((level, index) => {
						const num = index + 1;
						if (level.path) {
							console.log(`${num}. ${chalk.cyan(level.source || level.level)}: ${level.path}`);
						} else {
							console.log(`${num}. ${chalk.cyan(level.source || level.level)}`);
						}
					});
					
					console.log(chalk.bold('\nResolved Configuration:'));
					console.log('━'.repeat(60));
					
					const valuesToShow = opts.key 
						? result.resolved.filter(v => v.key === opts.key)
						: result.resolved;
					
					if (valuesToShow.length === 0) {
						console.log(chalk.yellow(`\nNo configuration found for key: ${opts.key}`));
						console.log(chalk.gray('\nAvailable keys:'));
						result.resolved.forEach(v => console.log(`  - ${v.key}`));
						throwExit(1);
					}
					
					for (const configValue of valuesToShow) {
						console.log(`  ${chalk.bold(configValue.key)}: ${formatValue(configValue.value)}`);
						console.log(`    ${chalk.gray('Source:')} ${chalk.green(configValue.source)}`);
						
						if (configValue.overrides) {
							console.log(`    ${chalk.gray('Original:')} ${formatValue(configValue.overrides.value)} ${chalk.gray(`(from ${configValue.overrides.source})`)}`);
						}
						
						console.log('');
					}
					
					console.log('━'.repeat(60));
				}
			} catch (error) {
				if (opts.json || deps.jsonModeActive()) {
					writeJsonOutput({
						error: error instanceof Error ? error.message : String(error)
					});
				} else {
					console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`));
				}
				throwExit(1);
			}
		});
}
