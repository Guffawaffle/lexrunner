/**
 * Core inputs processing - reads and normalizes configuration sources
 * Maintains deterministic ordering and stable output
 */

import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";
import { z } from "zod";
import { stableSort } from "../util/canonicalJson.js";

/**
 * Configuration source types
 */
export interface ConfigSource {
	file: string;
	content: unknown;
	exists: boolean;
}

/**
 * Provenance map tracking source file for each configuration key
 */
export interface ProvenanceMap {
	[key: string]: string; // key -> source file name
}

/**
 * Normalized input configuration
 */
export interface InputConfig {
	version: number;
	target: string;
	items: InputItem[];
	sources: ConfigSource[];
	provenance?: ProvenanceMap;
}

export interface InputItem {
	id?: string; // Normalized to string internally
	name: string;
	branch?: string;
	sha?: string;
	deps: string[];
	strategy: "rebase-weave" | "merge-weave" | "squash-weave";
	gates?: InputGate[];
}

export interface InputGate {
	name: string;
	run: string;
	cwd?: string;
	env?: Record<string, string>;
	runtime?: "local" | "container" | "ci-service";
	artifacts?: string[];
}

/**
 * Configuration schemas for validation
 */
const StackConfig = z.object({
	version: z.number().default(1),
	target: z.string().default("main"),
	items: z.array(z.object({
		id: z.union([z.number(), z.string()]).optional(),
		name: z.string().optional(),
		branch: z.string(),
		sha: z.string().optional(),
		deps: z.array(z.string()).default([]),
		strategy: z.enum(["rebase-weave", "merge-weave", "squash-weave"]).default("merge-weave"),
		gates: z.array(z.object({
			name: z.string(),
			run: z.string(),
			cwd: z.string().optional(),
			env: z.record(z.string()).optional(),
			runtime: z.enum(["local", "container", "ci-service"]).optional(),
			artifacts: z.array(z.string()).optional()
		})).optional()
	})).default([])
}).strict();

const ScopeConfig = z.object({
	version: z.number().default(1),
	target: z.string().default("main"),
	sources: z.array(z.object({
		query: z.string()
	})).default([]),
	selectors: z.object({
		include_labels: z.array(z.string()).default([]),
		exclude_labels: z.array(z.string()).default([])
	}).default({}),
	defaults: z.object({
		strategy: z.enum(["rebase-weave", "merge-weave", "squash-weave"]).default("merge-weave"),
		base: z.string().default("main")
	}).default({}),
	pin_commits: z.boolean().default(false)
}).strict();

/**
 * Load configuration from file system with deterministic precedence
 * Returns normalized configuration with stable ordering
 */
export function loadInputs(baseDir: string = "."): InputConfig {
	const smartergptDir = path.join(baseDir, ".smartergpt");

	// Try configuration files in precedence order
	const configFiles = [
		"stack.yml",
		"scope.yml",
		"deps.yml"
	];

	const sources: ConfigSource[] = [];
	const provenance: ProvenanceMap = {};
	let config: InputConfig = {
		version: 1,
		target: "main",
		items: [],
		sources: [],
		provenance
	};

	// Load stack.yml (highest precedence)
	const stackPath = path.join(smartergptDir, "stack.yml");
	const stackSource = loadConfigFile(stackPath);
	sources.push(stackSource);

	if (stackSource.exists) {
		const stackConfig = StackConfig.parse(stackSource.content);
		config.version = stackConfig.version;
		config.target = stackConfig.target;
		provenance.version = stackSource.file;
		provenance.target = stackSource.file;
		config.items = stackConfig.items.map((item, index) => {
			const id = item.id ?? (index + 1);
			// Normalize all IDs to strings internally to prevent comparison bugs
			const normalizedId = String(id);
			return {
				id: normalizedId,
				name: item.name ?? normalizedId,
				branch: item.branch,
				sha: item.sha,
				deps: stableSort(item.deps),
				strategy: item.strategy,
				gates: item.gates?.map(gate => ({
					name: gate.name,
					run: gate.run,
					cwd: gate.cwd,
					env: gate.env ? sortRecord(gate.env) : {},
					runtime: gate.runtime || "local",
					artifacts: stableSort(gate.artifacts || [])
				})) || []
			};
		});
	} else {
		// Fallback: try scope.yml and deps.yml
		const scopePath = path.join(smartergptDir, "scope.yml");
		const scopeSource = loadConfigFile(scopePath);
		sources.push(scopeSource);

		if (scopeSource.exists) {
			const scopeConfig = ScopeConfig.parse(scopeSource.content);
			config.target = scopeConfig.target;
			config.version = scopeConfig.version;
			provenance.target = scopeSource.file;
			provenance.version = scopeSource.file;
		}

		// deps.yml would be loaded here if it existed
		const depsPath = path.join(smartergptDir, "deps.yml");
		const depsSource = loadConfigFile(depsPath);
		sources.push(depsSource);
	}

	// Sort items by name for deterministic output
	config.items.sort((a, b) => (a.name || a.branch || "").localeCompare(b.name || b.branch || ""));
	config.sources = sources;

	return config;
}

/**
 * Load and parse a single configuration file
 */
function loadConfigFile(filePath: string): ConfigSource {
	const fileName = path.basename(filePath);

	try {
		const content = fs.readFileSync(filePath, "utf8");
		const parsed = YAML.parse(content);
		return {
			file: fileName,
			content: parsed,
			exists: true
		};
	} catch (error) {
		return {
			file: fileName,
			content: null,
			exists: false
		};
	}
}

/**
 * Sort record keys for deterministic output
 */
function sortRecord<T>(record: Record<string, T>): Record<string, T> {
	const sorted: Record<string, T> = {};
	for (const key of Object.keys(record).sort()) {
		sorted[key] = record[key];
	}
	return sorted;
}
