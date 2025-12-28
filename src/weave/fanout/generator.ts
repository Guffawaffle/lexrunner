/**
 * Fanout Issue Generator
 *
 * Generates issues from trigger matches by substituting template placeholders.
 *
 * @module
 */

import type { FanoutTemplate, FanoutTemplates, GeneratedIssue, TriggerMatch } from "./schema.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Context values for template substitution
 */
export interface SubstitutionContext {
  /** PR number that triggered this */
  pr_number: string;
  /** PR title */
  pr_title: string;
  /** PR URL */
  pr_url: string;
  /** PR author */
  pr_author: string;
  /** Repository owner */
  repo_owner: string;
  /** Repository name */
  repo_name: string;
  /** Branch name */
  branch_name: string;
  /** Current date ISO */
  date: string;
  /** Additional custom values */
  [key: string]: string;
}

// =============================================================================
// TEMPLATE SUBSTITUTION
// =============================================================================

/**
 * Substitute placeholders in a template string
 * Placeholders use {name} syntax
 */
export function substituteTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (key in values) {
      return values[key];
    }
    // Leave unmatched placeholders as-is
    return match;
  });
}

/**
 * Build a complete substitution context from match and PR info
 */
export function buildSubstitutionContext(
  match: TriggerMatch,
  prInfo: Partial<SubstitutionContext>
): SubstitutionContext {
  const context: SubstitutionContext = {
    pr_number: prInfo.pr_number ?? "0",
    pr_title: prInfo.pr_title ?? "Unknown PR",
    pr_url: prInfo.pr_url ?? "",
    pr_author: prInfo.pr_author ?? "unknown",
    repo_owner: prInfo.repo_owner ?? "",
    repo_name: prInfo.repo_name ?? "",
    branch_name: prInfo.branch_name ?? "main",
    date: new Date().toISOString().split("T")[0],
    // Include matched file info
    matched_file: match.matchedFile,
    matched_line: String(match.lineNumber),
    matched_text: match.matchedText,
    // Merge in captures from the match
    ...match.captures,
  };

  return context;
}

// =============================================================================
// ISSUE GENERATION
// =============================================================================

/**
 * Generate a single issue from a template and match
 */
export function generateIssue(
  template: FanoutTemplate,
  match: TriggerMatch,
  context: SubstitutionContext
): GeneratedIssue {
  const { issue } = template;

  // Resolve target repo
  let targetRepo: string;
  if (issue.repo === "same") {
    targetRepo = `${context.repo_owner}/${context.repo_name}`;
  } else {
    targetRepo = issue.repo;
  }

  return {
    templateId: template.id,
    match,
    title: substituteTemplate(issue.title, context),
    body: substituteTemplate(issue.body, context),
    labels: issue.labels.map((l) => substituteTemplate(l, context)),
    assignees: issue.assignees?.map((a) => substituteTemplate(a, context)) ?? [],
    repo: targetRepo,
    requiresConfirmation: match.requiresJudgment,
  };
}

/**
 * Generate all issues from matches
 */
export function generateIssues(
  templates: FanoutTemplates,
  matches: TriggerMatch[],
  prInfo: Partial<SubstitutionContext>
): GeneratedIssue[] {
  const issues: GeneratedIssue[] = [];
  const templateMap = new Map(templates.templates.map((t) => [t.id, t]));

  for (const match of matches) {
    const template = templateMap.get(match.templateId);
    if (!template) {
      console.warn(`Template not found for match: ${match.templateId}`);
      continue;
    }

    const context = buildSubstitutionContext(match, prInfo);
    issues.push(generateIssue(template, match, context));
  }

  return issues;
}

// =============================================================================
// PREVIEW FORMATTING
// =============================================================================

/**
 * Format a generated issue for preview/dry-run output
 */
export function formatIssuePreview(issue: GeneratedIssue): string {
  const lines: string[] = [
    `## Issue: ${issue.title}`,
    "",
    `**Repo:** ${issue.repo}`,
    `**Labels:** ${issue.labels.join(", ") || "(none)"}`,
    `**Assignees:** ${issue.assignees.join(", ") || "(none)"}`,
    `**Template:** ${issue.templateId}`,
    `**Requires Confirmation:** ${issue.requiresConfirmation ? "Yes" : "No"}`,
    "",
    "### Match Details",
    `- File: \`${issue.match.matchedFile}\``,
    `- Line: ${issue.match.lineNumber}`,
    `- Matched: \`${issue.match.matchedText}\``,
    "",
    "### Body",
    "",
    issue.body,
  ];

  return lines.join("\n");
}

/**
 * Format multiple issues for preview
 */
export function formatIssuesPreview(issues: GeneratedIssue[]): string {
  if (issues.length === 0) {
    return "No fanout issues to create.";
  }

  const sections = issues.map(
    (issue, index) => `# Issue ${index + 1} of ${issues.length}\n\n${formatIssuePreview(issue)}`
  );

  return sections.join("\n\n---\n\n");
}
