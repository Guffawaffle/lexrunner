/**
 * Prompts directory resolution with precedence chain
 * Implements: LEX_PROMPTS_DIR (env) → .smartergpt.local/prompts → .smartergpt/prompts → @smartergpt/lex package
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Resolved prompts directory information
 */
export interface ResolvedPromptsDir {
	/** Absolute path to the prompts directory */
	path: string;
	/** Source of resolution (LEX_PROMPTS_DIR, .smartergpt.local/prompts, .smartergpt/prompts, @smartergpt/lex package) */
	source: string;
}

/**
 * Resolve path to the @smartergpt/lex package prompts directory
 * 
 * @returns Absolute path to the Lex package prompts directory, or null if not found
 */
function resolveLexPackagePromptsDir(): string | null {
	try {
		// Try to resolve the @smartergpt/lex package
		// This uses Node's module resolution to find the package
		const lexPkgPath = require.resolve("@smartergpt/lex/package.json");
		const lexPkgDir = path.dirname(lexPkgPath);
		const promptsDir = path.join(lexPkgDir, "prompts");
		
		// Check if prompts directory exists
		if (fs.existsSync(promptsDir)) {
			return promptsDir;
		}
		
		return null;
	} catch (error) {
		// Package not installed or prompts not available
		return null;
	}
}

/**
 * Resolve prompts directory with precedence chain
 *
 * Precedence order (highest to lowest):
 * 1. LEX_PROMPTS_DIR environment variable (explicit override)
 * 2. .smartergpt.local/prompts (local overlay)
 * 3. .smartergpt/prompts (tracked canon)
 * 4. @smartergpt/lex package prompts (fallback defaults)
 *
 * @param baseDir - Base directory to resolve relative paths (default: current working directory)
 * @returns Resolved prompts directory information
 * @throws PromptsResolverError if no prompts directory is found
 */
export function resolvePromptsDir(
	baseDir: string = process.cwd()
): ResolvedPromptsDir {
	// Precedence 1: LEX_PROMPTS_DIR (explicit environment override)
	if (process.env.LEX_PROMPTS_DIR) {
		const dir = path.resolve(process.env.LEX_PROMPTS_DIR);
		if (!fs.existsSync(dir)) {
			throw new PromptsResolverError(
				`LEX_PROMPTS_DIR not found: ${dir}`
			);
		}
		return {
			path: dir,
			source: "LEX_PROMPTS_DIR"
		};
	}

	// Precedence 2: .smartergpt.local/prompts (local overlay)
	const localOverlay = path.resolve(baseDir, ".smartergpt.local/prompts");
	if (fs.existsSync(localOverlay)) {
		return {
			path: localOverlay,
			source: ".smartergpt.local/prompts"
		};
	}

	// Precedence 3: .smartergpt/prompts (tracked canon)
	const trackedCanon = path.resolve(baseDir, ".smartergpt/prompts");
	if (fs.existsSync(trackedCanon)) {
		return {
			path: trackedCanon,
			source: ".smartergpt/prompts"
		};
	}

	// Precedence 4: @smartergpt/lex package prompts (fallback defaults)
	const lexPackagePrompts = resolveLexPackagePromptsDir();
	if (lexPackagePrompts) {
		return {
			path: lexPackagePrompts,
			source: "@smartergpt/lex package"
		};
	}

	// No prompts directory found - provide helpful error
	throw new PromptsResolverError(
		"Prompts directory not found. Expected one of:\n" +
		`  - LEX_PROMPTS_DIR (env var)\n` +
		`  - ${localOverlay}\n` +
		`  - ${trackedCanon}\n` +
		`  - @smartergpt/lex package (not installed or prompts not available)`
	);
}

/**
 * Prompts resolver error
 */
export class PromptsResolverError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PromptsResolverError";
	}
}

/**
 * Prompt metadata extracted from frontmatter
 */
export interface PromptMetadata {
	name: string;
	version?: string;
	schemaVersion?: string;
	description?: string;
}

/**
 * Loaded prompt with content and metadata
 */
export interface LoadedPrompt {
	content: string;
	metadata: PromptMetadata;
	path: string;
}

/**
 * Load a prompt file by name
 *
 * @param name - Prompt name (without .md extension)
 * @param baseDir - Base directory for prompt resolution (default: current working directory)
 * @returns Loaded prompt with content and metadata
 * @throws PromptsResolverError if prompt file not found
 */
export function loadPrompt(
	name: string,
	baseDir: string = process.cwd()
): LoadedPrompt {
	const promptsDir = resolvePromptsDir(baseDir);
	const promptPath = path.join(promptsDir.path, `${name}.md`);

	if (!fs.existsSync(promptPath)) {
		throw new PromptsResolverError(
			`Prompt not found: ${name} in ${promptsDir.path}\n` +
			`Source: ${promptsDir.source}`
		);
	}

	let content = fs.readFileSync(promptPath, "utf-8");

	// Extract metadata from frontmatter (if present)
	const metadata = parsePromptMetadata(content, name);

	// Expand tokens in content
	content = expandPromptTokens(content, baseDir);

	return {
		content,
		metadata,
		path: promptPath
	};
}

/**
 * Parse prompt metadata from frontmatter
 *
 * Supports YAML frontmatter format:
 * ---
 * name: prompt-name
 * version: 1.0.0
 * ---
 *
 * @param content - Prompt content with optional frontmatter
 * @param defaultName - Default name if not in frontmatter
 * @returns Parsed metadata
 */
function parsePromptMetadata(
	content: string,
	defaultName: string
): PromptMetadata {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

	if (!frontmatterMatch) {
		// No frontmatter - return defaults
		return {
			name: defaultName
		};
	}

	try {
		// Simple YAML-like parsing (supports basic key: value pairs)
		const frontmatter = frontmatterMatch[1];
		const metadata: PromptMetadata = {
			name: defaultName
		};

		// Extract fields using regex
		const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
		if (nameMatch) metadata.name = nameMatch[1].trim();

		const versionMatch = frontmatter.match(/^version:\s*(.+)$/m);
		if (versionMatch) metadata.version = versionMatch[1].trim();

		const schemaVersionMatch = frontmatter.match(/^schemaVersion:\s*(.+)$/m);
		if (schemaVersionMatch) metadata.schemaVersion = schemaVersionMatch[1].trim();

		const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
		if (descriptionMatch) metadata.description = descriptionMatch[1].trim();

		return metadata;
	} catch (error) {
		// If parsing fails, return defaults
		return {
			name: defaultName
		};
	}
}

/**
 * Expand tokens in prompt content
 *
 * Supported tokens:
 * - {{today}} → YYYY-MM-DD
 * - {{now}} → ISO timestamp without colons (safe for filenames)
 * - {{repo_root}} → Repository root directory
 * - {{workspace_root}} → Workspace root directory
 * - {{branch}} → Current git branch
 * - {{commit}} → Current commit SHA
 *
 * @param content - Prompt content with tokens
 * @param baseDir - Base directory for workspace resolution
 * @returns Content with expanded tokens
 */
export function expandPromptTokens(
	content: string,
	baseDir: string = process.cwd()
): string {
	// Date/time tokens
	const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
	const now = new Date().toISOString().replace(/[:\.]/g, "-").replace("Z", ""); // ISO without colons and dots

	// Path tokens
	const workspaceRoot = path.resolve(baseDir);
	const repoRoot = findRepoRoot(baseDir);

	// Git context tokens
	const branch = getCurrentBranch(baseDir);
	const commit = getCurrentCommit(baseDir);

	return content
		.replace(/\{\{today\}\}/g, today)
		.replace(/\{\{now\}\}/g, now)
		.replace(/\{\{repo_root\}\}/g, repoRoot)
		.replace(/\{\{workspace_root\}\}/g, workspaceRoot)
		.replace(/\{\{branch\}\}/g, branch)
		.replace(/\{\{commit\}\}/g, commit);
}

/**
 * Find repository root directory (contains .git)
 */
function findRepoRoot(startDir: string): string {
	let currentDir = path.resolve(startDir);
	const root = path.parse(currentDir).root;

	while (currentDir !== root) {
		if (fs.existsSync(path.join(currentDir, ".git"))) {
			return currentDir;
		}
		currentDir = path.dirname(currentDir);
	}

	// If no .git found, return start directory
	return path.resolve(startDir);
}

/**
 * Get current git branch name (synchronous)
 */
function getCurrentBranch(cwd: string): string {
	try {
		const { execSync } = require("child_process");
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"]
		});
		return branch.trim();
	} catch {
		return "";
	}
}

/**
 * Get current git commit SHA (synchronous)
 */
function getCurrentCommit(cwd: string): string {
	try {
		const { execSync } = require("child_process");
		const commit = execSync("git rev-parse HEAD", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"]
		});
		return commit.trim();
	} catch {
		return "";
	}
}
