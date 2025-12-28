/**
 * Fanout Trigger Matcher
 *
 * Scans PR diffs for patterns defined in fanout templates.
 * Extracts captures and generates trigger matches.
 *
 * @module
 */

import { minimatch } from "minimatch";
import type { FanoutTemplate, FanoutTemplates, TriggerMatch } from "./schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Represents a file change in a PR diff
 */
export interface PRDiffFile {
  /** File path relative to repo root */
  filename: string;
  /** File status: added, modified, deleted, renamed */
  status: "added" | "modified" | "deleted" | "renamed";
  /** Number of additions */
  additions: number;
  /** Number of deletions */
  deletions: number;
  /** The actual patch/diff content (unified diff format) */
  patch?: string;
}

/**
 * Parsed diff line with metadata
 */
interface DiffLine {
  content: string;
  lineNumber: number;
  type: "add" | "remove" | "context";
}

// =============================================================================
// DIFF PARSING
// =============================================================================

/**
 * Parse unified diff format into structured lines
 * Only extracts added lines for pattern matching
 */
export function parseDiffLines(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const result: DiffLine[] = [];

  let currentLine = 0;

  for (const line of lines) {
    // Parse hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Skip diff metadata lines
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      // Added line
      result.push({
        content: line.slice(1),
        lineNumber: currentLine,
        type: "add",
      });
      currentLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Removed line - don't increment line number
      result.push({
        content: line.slice(1),
        lineNumber: currentLine,
        type: "remove",
      });
    } else {
      // Context line
      result.push({
        content: line.startsWith(" ") ? line.slice(1) : line,
        lineNumber: currentLine,
        type: "context",
      });
      currentLine++;
    }
  }

  return result;
}

// =============================================================================
// PATTERN MATCHING
// =============================================================================

/**
 * Check if a filename matches any of the file glob patterns
 */
export function matchesFilePatterns(filename: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern, { matchBase: true }));
}

/**
 * Extract named captures from a regex match
 */
function extractCaptures(
  match: RegExpExecArray,
  captureNames?: Record<string, string>
): Record<string, string> {
  const captures: Record<string, string> = {};

  // Always include numeric groups
  for (let i = 1; i < match.length; i++) {
    if (match[i] !== undefined) {
      captures[`group${i}`] = match[i];
    }
  }

  // Include named groups from regex
  if (match.groups) {
    Object.assign(captures, match.groups);
  }

  // Apply custom capture mappings if defined
  if (captureNames) {
    for (const [name, group] of Object.entries(captureNames)) {
      const groupNum = parseInt(group.replace("$", ""), 10);
      if (!isNaN(groupNum) && match[groupNum]) {
        captures[name] = match[groupNum];
      }
    }
  }

  return captures;
}

/**
 * Match a single template against a single file's diff
 */
export function matchTemplateAgainstFile(
  template: FanoutTemplate,
  file: PRDiffFile
): TriggerMatch[] {
  // Skip disabled templates
  if (!template.enabled) {
    return [];
  }

  // Check file pattern match
  if (!matchesFilePatterns(file.filename, template.trigger.files)) {
    return [];
  }

  // No patch means no content to search
  if (!file.patch) {
    return [];
  }

  const matches: TriggerMatch[] = [];
  const regex = new RegExp(template.trigger.pattern, "g");
  const lines = parseDiffLines(file.patch);

  // Only match against added lines
  for (const line of lines) {
    if (line.type !== "add") continue;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(line.content)) !== null) {
      matches.push({
        templateId: template.id,
        matchedFile: file.filename,
        lineNumber: line.lineNumber,
        matchedText: match[0],
        captures: extractCaptures(match, template.trigger.captures),
        requiresJudgment: template.trigger.requires_judgment,
      });

      // Prevent infinite loops on zero-width matches
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
  }

  return matches;
}

// =============================================================================
// MAIN MATCHER
// =============================================================================

/**
 * Match all templates against all files in a PR diff
 */
export function matchTemplatesAgainstDiff(
  templates: FanoutTemplates,
  files: PRDiffFile[]
): TriggerMatch[] {
  const allMatches: TriggerMatch[] = [];

  // Sort templates by priority (higher first)
  const sortedTemplates = [...templates.templates].sort((a, b) => b.priority - a.priority);

  for (const template of sortedTemplates) {
    for (const file of files) {
      const matches = matchTemplateAgainstFile(template, file);
      allMatches.push(...matches);
    }
  }

  return allMatches;
}

/**
 * Deduplicate matches by template ID
 * Multiple matches of the same template in the same PR only create one issue
 */
export function deduplicateMatches(matches: TriggerMatch[]): TriggerMatch[] {
  const seen = new Map<string, TriggerMatch>();

  for (const match of matches) {
    if (!seen.has(match.templateId)) {
      seen.set(match.templateId, match);
    }
  }

  return Array.from(seen.values());
}
