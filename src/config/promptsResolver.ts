/**
 * Prompts directory resolution with 5-level precedence chain
 * Implements: LEX_PROMPTS_DIR (env) → .smartergpt.local/prompts → .smartergpt/prompts → @smartergpt/lex/prompts → @smartergpt/lex/canon/prompts
 *
 * @see Guffawaffle/LexRunner#371 (R-LOADER)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  getCurrentBranch as getGitBranch,
  getCurrentCommit as getGitCommit,
} from "../shared/git/runGit.js";

const require = createRequire(import.meta.url);

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
 * Result of Lex package prompts resolution
 */
interface LexPackagePromptsResult {
  /** Path to the prompts directory */
  path: string;
  /** Source identifier for diagnostics */
  source: "@smartergpt/lex/prompts" | "@smartergpt/lex/canon/prompts";
}

/**
 * Resolve path to the @smartergpt/lex package prompts directory
 *
 * Checks two locations in the Lex package in order:
 * 1. @smartergpt/lex/prompts - Package defaults (higher precedence, level 4)
 * 2. @smartergpt/lex/canon/prompts - Canonical fallback (lower precedence, level 5)
 *
 * @returns Resolved prompts directory info, or null if not found
 */
function resolveLexPackagePromptsDir(): LexPackagePromptsResult | null {
  try {
    const lexPkgPath = require.resolve("@smartergpt/lex/package.json");
    const lexPkgDir = path.dirname(lexPkgPath);

    // Precedence 4: @smartergpt/lex/prompts (package defaults - checked first)
    const promptsDir = path.join(lexPkgDir, "prompts");
    if (fs.existsSync(promptsDir)) {
      return {
        path: promptsDir,
        source: "@smartergpt/lex/prompts",
      };
    }

    // Precedence 5: @smartergpt/lex/canon/prompts (canonical fallback - checked second)
    const canonPromptsDir = path.join(lexPkgDir, "canon", "prompts");
    if (fs.existsSync(canonPromptsDir)) {
      return {
        path: canonPromptsDir,
        source: "@smartergpt/lex/canon/prompts",
      };
    }

    return null;
  } catch {
    // Error is intentionally ignored - this is expected when @smartergpt/lex
    // is not installed or the package.json cannot be resolved. Return null
    // to let the resolver continue with error handling.
    return null;
  }
}

/**
 * Resolve prompts directory with 5-level precedence chain
 *
 * Precedence order (highest to lowest):
 * 1. LEX_PROMPTS_DIR environment variable (explicit override)
 * 2. .smartergpt.local/prompts (local overlay, not tracked)
 * 3. .smartergpt/prompts (workspace, tracked)
 * 4. @smartergpt/lex/prompts (package defaults)
 * 5. @smartergpt/lex/canon/prompts (canonical fallback)
 *
 * @param baseDir - Base directory to resolve relative paths (default: current working directory)
 * @returns Resolved prompts directory information
 * @throws PromptsResolverError if no prompts directory is found
 */
export function resolvePromptsDir(baseDir: string = process.cwd()): ResolvedPromptsDir {
  // Precedence 1: LEX_PROMPTS_DIR (explicit environment override)
  if (process.env.LEX_PROMPTS_DIR) {
    const dir = path.resolve(process.env.LEX_PROMPTS_DIR);
    if (!fs.existsSync(dir)) {
      throw new PromptsResolverError(`LEX_PROMPTS_DIR not found: ${dir}`);
    }
    return {
      path: dir,
      source: "LEX_PROMPTS_DIR",
    };
  }

  // Precedence 2: .smartergpt.local/prompts (local overlay)
  const localOverlay = path.resolve(baseDir, ".smartergpt.local/prompts");
  if (fs.existsSync(localOverlay)) {
    return {
      path: localOverlay,
      source: ".smartergpt.local/prompts",
    };
  }

  // Precedence 3: .smartergpt/prompts (workspace)
  const workspaceDir = path.resolve(baseDir, ".smartergpt/prompts");
  if (fs.existsSync(workspaceDir)) {
    return {
      path: workspaceDir,
      source: ".smartergpt/prompts",
    };
  }

  // Precedence 4 & 5: @smartergpt/lex package (prompts or canon/prompts)
  const lexPackagePrompts = resolveLexPackagePromptsDir();
  if (lexPackagePrompts) {
    return {
      path: lexPackagePrompts.path,
      source: lexPackagePrompts.source,
    };
  }

  // No prompts directory found - provide helpful error with full precedence chain
  throw new PromptsResolverError(
    "Prompts directory not found. Expected one of:\n" +
      `  - LEX_PROMPTS_DIR (env var)\n` +
      `  - ${portableDiagnosticPath(localOverlay)}\n` +
      `  - ${portableDiagnosticPath(workspaceDir)}\n` +
      `  - @smartergpt/lex/prompts (package defaults)\n` +
      `  - @smartergpt/lex/canon/prompts (canonical fallback)`
  );
}

function portableDiagnosticPath(value: string): string {
  return value.replace(/\\/g, "/");
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
export function loadPrompt(name: string, baseDir: string = process.cwd()): LoadedPrompt {
  const promptsDir = resolvePromptsDir(baseDir);
  const promptPath = path.join(promptsDir.path, `${name}.md`);

  if (!fs.existsSync(promptPath)) {
    throw new PromptsResolverError(
      `Prompt not found: ${name} in ${promptsDir.path}\n` + `Source: ${promptsDir.source}`
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
    path: promptPath,
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
function parsePromptMetadata(content: string, defaultName: string): PromptMetadata {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    // No frontmatter - return defaults
    return {
      name: defaultName,
    };
  }

  try {
    // Simple YAML-like parsing (supports basic key: value pairs)
    const frontmatter = frontmatterMatch[1];
    const metadata: PromptMetadata = {
      name: defaultName,
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
      name: defaultName,
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
export function expandPromptTokens(content: string, baseDir: string = process.cwd()): string {
  // Date/time tokens
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const now = new Date().toISOString().replace(/[:\.]/g, "-").replace("Z", ""); // ISO without colons and dots

  // Path tokens
  const workspaceRoot = path.resolve(baseDir);
  const repoRoot = findRepoRoot(baseDir);

  // Git context tokens
  const branch = getGitBranch(baseDir);
  const commit = getGitCommit(baseDir);

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
