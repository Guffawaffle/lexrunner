/**
 * CLI Command Mapping - Current to Canonical Forms
 *
 * This file maps existing lexrunner commands to their canonical
 * category-action form per docs/CLI_VERBS.md.
 *
 * Use this as the authoritative source when:
 * - Creating aliases for backward compatibility
 * - Implementing new canonical commands
 * - Documenting command deprecations
 * - Generating help text
 */

export interface CommandMapping {
  /** Current command name as it exists today */
  current: string;
  /** Canonical form: category + action */
  canonical: {
    category: string;
    action: string;
  };
  /** Full canonical command string */
  canonicalCommand: string;
  /** Brief description of what the command does */
  description: string;
  /** Implementation phase: current, aliased, deprecated, or removed */
  status: "current" | "aliased" | "deprecated" | "removed";
}

/**
 * Complete mapping of all lexrunner commands
 */
export const COMMAND_MAPPINGS: CommandMapping[] = [
  // =========================================================================
  // Fanout Domain
  // =========================================================================
  {
    current: "orchestrate:analyze-issues",
    canonical: { category: "fanout", action: "analyze" },
    canonicalCommand: "lexrunner fanout analyze",
    description: "Analyze GitHub issues for fanout",
    status: "current",
  },
  {
    current: "orchestrate:assign-batch",
    canonical: { category: "fanout", action: "assign" },
    canonicalCommand: "lexrunner fanout assign",
    description: "Deterministically assign issues to workers",
    status: "current",
  },

  // =========================================================================
  // Weave Domain
  // =========================================================================
  {
    current: "orchestrate:plan-batch",
    canonical: { category: "weave", action: "plan" },
    canonicalCommand: "lexrunner weave plan",
    description: "Generate execution plan from PRs",
    status: "current",
  },
  {
    current: "orchestrate:predict-conflicts",
    canonical: { category: "weave", action: "analyze" },
    canonicalCommand: "lexrunner weave analyze",
    description: "Predict merge conflicts for weave",
    status: "current",
  },
  {
    current: "orchestrate:generate-deliverables",
    canonical: { category: "weave", action: "report" },
    canonicalCommand: "lexrunner weave report",
    description: "Generate deliverables from weave run",
    status: "current",
  },
  {
    current: "discover",
    canonical: { category: "weave", action: "discover" },
    canonicalCommand: "lexrunner weave discover",
    description: "Discover PRs for integration",
    status: "current",
  },
  {
    current: "plan",
    canonical: { category: "weave", action: "plan" },
    canonicalCommand: "lexrunner weave plan",
    description: "Generate execution plan",
    status: "current",
  },
  {
    current: "status",
    canonical: { category: "weave", action: "status" },
    canonicalCommand: "lexrunner weave status",
    description: "Show execution status",
    status: "current",
  },
  {
    current: "report",
    canonical: { category: "weave", action: "report" },
    canonicalCommand: "lexrunner weave report",
    description: "Generate execution report",
    status: "current",
  },

  // =========================================================================
  // Workspace Domain
  // =========================================================================
  {
    current: "init",
    canonical: { category: "workspace", action: "init" },
    canonicalCommand: "lexrunner workspace init",
    description: "Bootstrap workspace configuration",
    status: "current",
  },
  {
    current: "doctor",
    canonical: { category: "workspace", action: "doctor" },
    canonicalCommand: "lexrunner workspace doctor",
    description: "Check workspace health",
    status: "current",
  },
  {
    current: "migrate-profile",
    canonical: { category: "workspace", action: "migrate" },
    canonicalCommand: "lexrunner workspace migrate",
    description: "Migrate profile structure",
    status: "current",
  },
  {
    current: "orchestrate:pin-toolchain",
    canonical: { category: "workspace", action: "doctor" },
    canonicalCommand: "lexrunner workspace doctor",
    description: "Verify toolchain versions",
    status: "current",
  },

  // =========================================================================
  // Gate Domain
  // =========================================================================
  {
    current: "gate-report",
    canonical: { category: "gate", action: "report" },
    canonicalCommand: "lexrunner gate report",
    description: "Aggregate gate reports",
    status: "current",
  },

  // =========================================================================
  // Security Domain
  // =========================================================================
  {
    current: "security:scan-sarif",
    canonical: { category: "security", action: "run" },
    canonicalCommand: "lexrunner security run",
    description: "Run SARIF security scans",
    status: "current",
  },
  {
    current: "security:scan-secrets",
    canonical: { category: "security", action: "run" },
    canonicalCommand: "lexrunner security run",
    description: "Scan for secrets in code",
    status: "current",
  },
  {
    current: "security:validate-commands",
    canonical: { category: "security", action: "analyze" },
    canonicalCommand: "lexrunner security analyze",
    description: "Validate command usage",
    status: "current",
  },

  // =========================================================================
  // Audit Domain
  // =========================================================================
  {
    current: "audit:report",
    canonical: { category: "audit", action: "report" },
    canonicalCommand: "lexrunner audit report",
    description: "Generate audit report",
    status: "current",
  },
  {
    current: "audit:compliance",
    canonical: { category: "audit", action: "report" },
    canonicalCommand: "lexrunner audit report",
    description: "Generate compliance report",
    status: "current",
  },
];

/**
 * Get canonical form for a current command
 */
export function getCanonicalCommand(current: string): string | undefined {
  const mapping = COMMAND_MAPPINGS.find((m) => m.current === current);
  return mapping?.canonicalCommand;
}

/**
 * Get all commands in a category
 */
export function getCommandsByCategory(category: string): CommandMapping[] {
  return COMMAND_MAPPINGS.filter((m) => m.canonical.category === category);
}

/**
 * Get all categories
 */
export function getCategories(): string[] {
  const categories = new Set(COMMAND_MAPPINGS.map((m) => m.canonical.category));
  return Array.from(categories).sort();
}

/**
 * Get all actions used across commands
 */
export function getActions(): string[] {
  const actions = new Set(COMMAND_MAPPINGS.map((m) => m.canonical.action));
  return Array.from(actions).sort();
}
