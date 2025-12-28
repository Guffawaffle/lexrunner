/**
 * PR Description Parser & Dependency Extraction
 * Parses PR descriptions to extract dependencies, metadata, and gate overrides
 */

import * as yaml from "yaml";

/**
 * Parsed dependency information from PR description
 */
export interface ParsedDependency {
  prId: string;
  dependencies: string[];
  gates?: {
    skip?: string[];
    required?: string[];
  };
  metadata?: {
    priority?: string;
    labels?: string[];
    [key: string]: any;
  };
}

/**
 * Parsing options
 */
export interface ParserOptions {
  /**
   * Repository owner/repo for resolving relative PR references
   */
  repository?: string;

  /**
   * Validate that dependencies don't create cycles
   */
  detectCycles?: boolean;

  /**
   * Partial extraction mode - return what can be parsed without failing
   */
  partialExtraction?: boolean;
}

/**
 * Parse PR description to extract dependencies and metadata
 *
 * Extracts structured information from PR descriptions including:
 * - Explicit dependencies (Depends-on:, Depends:, Requires:)
 * - Gate overrides (Skip:, Required:)
 * - Metadata (Priority:, Labels:, YAML front-matter)
 *
 * @param prNumber - PR number (e.g., 123)
 * @param description - PR body text (can be null)
 * @param options - Parsing options
 * @returns Parsed dependency information with deterministic sorted arrays
 *
 * @example
 * ```typescript
 * import { parsePRDescription } from "./planner/dependencyParser.js";
 *
 * const description = `
 * Add authentication API.
 *
 * Depends-on: #100, #101
 * Required: security-scan
 * `;
 *
 * const result = parsePRDescription(123, description, {
 *   repository: "owner/repo"
 * });
 *
 * console.log(result);
 * // {
 * //   prId: "PR-123",
 * //   dependencies: ["#100", "#101"],
 * //   gates: { required: ["security-scan"] }
 * // }
 * ```
 *
 * @see {@link docs/diffgraph-planner.md#dependency-syntax-reference} for supported syntax
 * @see {@link docs/dependency-parser.md} for detailed parser documentation
 */
export function parsePRDescription(
  prNumber: number,
  description: string | null,
  options: ParserOptions = {}
): ParsedDependency {
  const prId = `PR-${prNumber}`;
  const dependencies: string[] = [];
  const gates: { skip?: string[]; required?: string[] } = {};
  const metadata: { [key: string]: any } = {};

  if (!description) {
    return { prId, dependencies, gates, metadata };
  }

  try {
    // Parse YAML/markdown front-matter if present
    const frontMatter = extractFrontMatter(description);
    if (frontMatter) {
      Object.assign(metadata, frontMatter);
    }

    // Extract dependencies from various formats
    dependencies.push(...extractDependencies(description, options));

    // Extract gate overrides
    const gateOverrides = extractGateOverrides(description);
    if (gateOverrides.skip?.length) {
      gates.skip = gateOverrides.skip;
    }
    if (gateOverrides.required?.length) {
      gates.required = gateOverrides.required;
    }

    // Extract metadata from PR body
    const extractedMetadata = extractMetadata(description);
    Object.assign(metadata, extractedMetadata);

    // Remove duplicates and sort for deterministic output
    const uniqueDeps = [...new Set(dependencies)].sort();

    return {
      prId,
      dependencies: uniqueDeps,
      ...(Object.keys(gates).length > 0 ? { gates } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  } catch (error) {
    if (options.partialExtraction) {
      // Return what we have so far
      return {
        prId,
        dependencies: [...new Set(dependencies)].sort(),
        ...(Object.keys(gates).length > 0 ? { gates } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    }
    throw error;
  }
}

/**
 * Extract YAML/markdown front-matter from PR description
 */
function extractFrontMatter(description: string): Record<string, any> | null {
  // Match YAML front-matter pattern: ---\n...\n---
  const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = description.match(frontMatterRegex);

  if (!match) {
    return null;
  }

  try {
    const yamlContent = match[1];
    const parsed = yaml.parse(yamlContent);
    return parsed || null;
  } catch (error) {
    // Invalid YAML in front-matter, ignore
    return null;
  }
}

/**
 * Extract dependencies from PR description
 * Supports multiple formats:
 * - Depends-on: #123, #456
 * - Depends: PR-123, PR-456
 * - Requires: #123
 * - GitHub linking: Closes #123, Fixes #456
 */
function extractDependencies(description: string, options: ParserOptions): string[] {
  const dependencies: string[] = [];

  // Pattern 1: "Depends-on:" footer style
  const dependsOnRegex = /(?:^|\n)Depends-on:\s*([^\r\n]+)/gi;
  for (const match of description.matchAll(dependsOnRegex)) {
    const deps = parseDependencyLine(match[1], options);
    dependencies.push(...deps);
  }

  // Pattern 2: "Depends:" inline/footer style
  const dependsRegex = /(?:^|\n)Depends:\s*([^\r\n]+)/gi;
  for (const match of description.matchAll(dependsRegex)) {
    const deps = parseDependencyLine(match[1], options);
    dependencies.push(...deps);
  }

  // Pattern 3: "Requires:" alternative syntax
  const requiresRegex = /(?:^|\n)Requires:\s*([^\r\n]+)/gi;
  for (const match of description.matchAll(requiresRegex)) {
    const deps = parseDependencyLine(match[1], options);
    dependencies.push(...deps);
  }

  // Pattern 4: GitHub linking keywords (Closes, Fixes, Resolves) - can have comma-separated list
  const githubLinkRegex = /(?:Closes|Fixes|Resolves):\s*([^\r\n]+)/gi;
  for (const match of description.matchAll(githubLinkRegex)) {
    const deps = parseDependencyLine(match[1], options);
    dependencies.push(...deps);
  }

  return dependencies;
}

/**
 * Parse a single dependency line that may contain multiple references
 */
function parseDependencyLine(line: string, options: ParserOptions): string[] {
  const deps: string[] = [];

  // Split by comma and process each dependency
  const parts = line.split(",").map((part) => part.trim());

  for (const part of parts) {
    // Handle different formats:
    // - #123 (simple PR reference)
    // - PR-123 (PR format)
    // - owner/repo#123 (cross-repo reference)

    if (part.match(/^#\d+$/)) {
      // Simple "#123" format
      deps.push(part);
    } else if (part.match(/^PR-\d+$/i)) {
      // "PR-123" format - normalize to #123
      const prNumber = part.match(/PR-(\d+)/i)?.[1];
      if (prNumber) {
        deps.push(`#${prNumber}`);
      }
    } else if (part.includes("#")) {
      // "owner/repo#123" or "repo#123" format
      deps.push(part);
    }
  }

  return deps;
}

/**
 * Extract gate overrides from PR description
 */
function extractGateOverrides(description: string): { skip?: string[]; required?: string[] } {
  const skip: string[] = [];
  const required: string[] = [];

  // Pattern: "Skip: gate1, gate2" or "Skip-gates: gate1, gate2"
  const skipRegex = /(?:^|\n)(?:Skip|Skip-gates):\s*([^\r\n]+)/gi;
  for (const match of description.matchAll(skipRegex)) {
    const gates = match[1]
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    skip.push(...gates);
  }

  // Pattern: "Required: gate1, gate2" or "Required-gates: gate1, gate2"
  const requiredRegex = /(?:^|\n)(?:Required|Required-gates):\s*([^\r\n]+)/gi;
  for (const match of description.matchAll(requiredRegex)) {
    const gates = match[1]
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    required.push(...gates);
  }

  return {
    ...(skip.length > 0 ? { skip: [...new Set(skip)].sort() } : {}),
    ...(required.length > 0 ? { required: [...new Set(required)].sort() } : {}),
  };
}

/**
 * Extract metadata from PR description
 */
function extractMetadata(description: string): Record<string, any> {
  const metadata: Record<string, any> = {};

  // Extract priority
  const priorityRegex = /(?:^|\n)Priority:\s*(\w+)/i;
  const priorityMatch = description.match(priorityRegex);
  if (priorityMatch) {
    metadata.priority = priorityMatch[1].toLowerCase();
  }

  // Extract labels (from a Labels: line)
  const labelsRegex = /(?:^|\n)Labels:\s*([^\r\n]+)/i;
  const labelsMatch = description.match(labelsRegex);
  if (labelsMatch) {
    const labels = labelsMatch[1]
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (labels.length > 0) {
      metadata.labels = labels.sort();
    }
  }

  return metadata;
}

/**
 * Validate dependencies for circular references
 */
export function validateDependencies(parsedPRs: ParsedDependency[]): void {
  const graph = new Map<string, Set<string>>();

  // Build dependency graph
  for (const pr of parsedPRs) {
    graph.set(
      pr.prId,
      new Set(
        pr.dependencies.map((dep) => {
          // Normalize dependency format to PR-XXX
          if (dep.startsWith("#")) {
            return `PR-${dep.substring(1)}`;
          }
          if (dep.match(/^PR-\d+$/i)) {
            return dep.toUpperCase();
          }
          // For cross-repo references, extract PR number
          if (dep.includes("#")) {
            const prNum = dep.split("#")[1];
            return `PR-${prNum}`;
          }
          return dep;
        })
      )
    );
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycle(node: string): boolean {
    if (!visited.has(node)) {
      visited.add(node);
      recStack.add(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && hasCycle(neighbor)) {
          return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }
    }
    recStack.delete(node);
    return false;
  }

  for (const prId of graph.keys()) {
    if (hasCycle(prId)) {
      throw new Error(`Circular dependency detected involving ${prId}`);
    }
    visited.clear();
    recStack.clear();
  }
}

/**
 * Check if a dependency reference is valid
 */
export function isValidDependencyRef(dep: string): boolean {
  // Valid formats:
  // - #123
  // - PR-123
  // - owner/repo#123
  // - repo#123

  if (dep.match(/^#\d+$/)) return true;
  if (dep.match(/^PR-\d+$/i)) return true;
  if (dep.match(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+#\d+$/)) return true;
  if (dep.match(/^[a-zA-Z0-9_-]+#\d+$/)) return true;

  return false;
}

/**
 * Normalize dependency reference to a standard format
 */
export function normalizeDependencyRef(dep: string, repository?: string): string {
  // Simple #123 format
  if (dep.match(/^#\d+$/)) {
    const prNumber = dep.substring(1);
    return repository ? `${repository}#${prNumber}` : dep;
  }

  // PR-123 format
  if (dep.match(/^PR-\d+$/i)) {
    const prNumber = dep.match(/PR-(\d+)/i)?.[1];
    return repository ? `${repository}#${prNumber}` : `#${prNumber}`;
  }

  // Already in full format
  if (dep.includes("#")) {
    return dep;
  }

  return dep;
}
