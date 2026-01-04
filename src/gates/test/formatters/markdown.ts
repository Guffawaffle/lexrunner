/**
 * Markdown output formatter for AXTestResult
 *
 * Generates PR-ready comments with collapsible failure details,
 * GitHub-compatible file links, and actionable next steps.
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import type { AXTestResult, AXTestFailure, NextActionItem, AXNextAction } from "../schema.js";

/**
 * Markdown formatting options
 */
export interface MarkdownOptions {
  /** Show passing test count in summary (default: true) */
  includePassingSummary?: boolean;
  /** Use <details> tags for failures (default: true) */
  collapsible?: boolean;
  /** Limit displayed failures (default: 10) */
  maxFailures?: number;
  /** Show coverage table (default: true) */
  includeCoverage?: boolean;
  /** File link style (default: 'github') */
  linkFormat?: "github" | "gitlab" | "plain";
  /** Repository info for GitHub/GitLab links (owner/repo) */
  repository?: string;
  /** Git ref (branch/commit) for GitHub/GitLab links */
  ref?: string;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<MarkdownOptions> = {
  includePassingSummary: true,
  collapsible: true,
  maxFailures: 10,
  includeCoverage: true,
  linkFormat: "github",
  repository: "",
  ref: "main",
};

/**
 * Format AXTestResult as Markdown for PR comments
 */
export function formatAsMarkdown(result: AXTestResult, options?: MarkdownOptions): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sections: string[] = [];

  // Header
  sections.push(formatHeader(result, opts));

  // Failed tests section
  if (result.failures.length > 0) {
    sections.push(formatFailures(result.failures, opts));
  }

  // Coverage section
  if (opts.includeCoverage && result.coverage) {
    sections.push(formatCoverage(result.coverage));
  }

  return sections.join("\n\n");
}

/**
 * Format header with summary statistics
 */
function formatHeader(result: AXTestResult, opts: Required<MarkdownOptions>): string {
  const { summary } = result;
  const lines: string[] = [];

  lines.push("## 🧪 Test Results");
  lines.push("");

  // Summary line
  const parts: string[] = [];
  parts.push(`**${summary.total} tests**`);

  if (opts.includePassingSummary) {
    parts.push(`✅ ${summary.passed} passed`);
  }

  if (summary.failed > 0) {
    parts.push(`❌ ${summary.failed} failed`);
  }

  if (summary.skipped > 0) {
    parts.push(`⏭️ ${summary.skipped} skipped`);
  }

  parts.push(`⏱️ ${formatDuration(summary.durationMs)}`);

  lines.push(parts.join(" | "));

  return lines.join("\n");
}

/**
 * Format failures section
 */
function formatFailures(failures: AXTestFailure[], opts: Required<MarkdownOptions>): string {
  const lines: string[] = [];

  lines.push("### ❌ Failed Tests");
  lines.push("");

  const displayCount = Math.min(failures.length, opts.maxFailures);
  const truncated = failures.length > opts.maxFailures;

  for (let i = 0; i < displayCount; i++) {
    lines.push(formatFailure(failures[i], opts));
    if (i < displayCount - 1) {
      lines.push("");
    }
  }

  if (truncated) {
    const remaining = failures.length - opts.maxFailures;
    lines.push("");
    lines.push(`<!-- ${remaining} more ${remaining === 1 ? "failure" : "failures"} omitted -->`);
  }

  return lines.join("\n");
}

/**
 * Format single failure
 */
function formatFailure(failure: AXTestFailure, opts: Required<MarkdownOptions>): string {
  const lines: string[] = [];

  // File link
  const fileLink = formatFileLink(failure, opts);

  if (opts.collapsible) {
    // Collapsible details
    const summary = `<code>${fileLink}</code> — ${escapeMarkdown(failure.name)}`;
    lines.push(`<details>`);
    lines.push(`<summary>${summary}</summary>`);
    lines.push("");
    lines.push(formatFailureDetails(failure));
    lines.push("");
    lines.push("</details>");
  } else {
    // Non-collapsible format
    lines.push(`#### \`${fileLink}\` — ${escapeMarkdown(failure.name)}`);
    lines.push("");
    lines.push(formatFailureDetails(failure));
  }

  return lines.join("\n");
}

/**
 * Format failure details (error, diff, next actions)
 */
function formatFailureDetails(failure: AXTestFailure): string {
  const lines: string[] = [];

  // Error message
  lines.push(`**Error:** ${escapeMarkdown(failure.error.message)}`);
  lines.push("");

  // Diff if available
  if (failure.diff) {
    lines.push("```diff");
    lines.push(`- Expected: ${failure.diff.expected}`);
    lines.push(`+ Actual: ${failure.diff.actual}`);
    lines.push("```");
    lines.push("");
  }

  // Next actions
  if (failure.nextActions.length > 0) {
    lines.push("**Suggested Actions:**");
    for (const action of failure.nextActions) {
      lines.push(formatNextAction(action));
    }
  }

  return lines.join("\n");
}

/**
 * Format file link based on link style
 */
function formatFileLink(failure: AXTestFailure, opts: Required<MarkdownOptions>): string {
  const { file, line } = failure;

  switch (opts.linkFormat) {
    case "github":
      if (opts.repository) {
        // GitHub URL fragments only support line numbers, not columns
        const lineRef = `L${line}`;
        return `[${file}:${line}](https://github.com/${opts.repository}/blob/${opts.ref}/${file}#${lineRef})`;
      }
      // Fallback to plain if no repo
      return `${file}:${line}`;

    case "gitlab":
      if (opts.repository) {
        // GitLab URL fragments only support line numbers, not columns
        const lineRef = `L${line}`;
        return `[${file}:${line}](https://gitlab.com/${opts.repository}/-/blob/${opts.ref}/${file}#${lineRef})`;
      }
      // Fallback to plain if no repo
      return `${file}:${line}`;

    case "plain":
    default:
      // Plain format includes column for local tooling (e.g., editors, grep output)
      return failure.column ? `${file}:${line}:${failure.column}` : `${file}:${line}`;
  }
}

/**
 * Format next action (string or structured)
 */
function formatNextAction(action: NextActionItem): string {
  if (typeof action === "string") {
    return `- ${escapeMarkdown(action)}`;
  }

  // Structured action
  const icon = getActionIcon(action.kind);
  const cmd = action.cmd ? ` \`${escapeMarkdown(action.cmd)}\`` : "";
  return `- ${icon}${cmd} ${escapeMarkdown(action.note)}`;
}

/**
 * Get icon for action kind
 */
function getActionIcon(kind: AXNextAction["kind"]): string {
  switch (kind) {
    case "rerun":
      return "🔄";
    case "inspect":
      return "🔍";
    case "fix":
      return "🔧";
    case "doc":
      return "📖";
    default:
      return "•";
  }
}

/**
 * Format coverage section
 */
function formatCoverage(coverage: {
  linesPct: number;
  branchesPct: number;
  functionsPct: number;
  statementsPct?: number;
}): string {
  const lines: string[] = [];

  lines.push("### 📊 Coverage");
  lines.push("");
  lines.push("| Metric | Coverage |");
  lines.push("|--------|----------|");
  lines.push(`| Lines | ${coverage.linesPct.toFixed(1)}% |`);
  lines.push(`| Branches | ${coverage.branchesPct.toFixed(1)}% |`);
  lines.push(`| Functions | ${coverage.functionsPct.toFixed(1)}% |`);

  if (coverage.statementsPct !== undefined) {
    lines.push(`| Statements | ${coverage.statementsPct.toFixed(1)}% |`);
  }

  return lines.join("\n");
}

/**
 * Format duration (ms → human-readable)
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Escape markdown special characters
 * Note: Does not escape backticks (`) as they're often part of code snippets
 * Does not escape periods as they're common in error messages and paths
 */
function escapeMarkdown(text: string): string {
  // Escape markdown special chars except backticks and periods: *, _, [, ], (, ), #, !, |, -
  // All special chars are explicitly escaped
  return text.replace(/([*_\[\]()#!|\-])/g, "\\$1");
}
