import { z } from "zod";

/**
 * Autopilot Level - defines the degree of automation in merge-weave execution
 *
 * Level 0: Report Only
 * - Generate plan and gate results
 * - Output deliverables (snapshot.md, plan.json)
 * - No GitHub interactions
 * - Safe for CI/automation without side effects
 *
 * Level 1: Artifact Generation
 * - All Level 0 capabilities
 * - Generate integration branch plans
 * - Create merge preview artifacts
 * - Write detailed execution logs
 * - Still no GitHub interactions
 *
 * Level 2: PR Annotations
 * - All Level 1 capabilities
 * - Post status comments on PRs
 * - Update PR status checks
 * - Add labels based on gate results
 * - Read-only git operations (no merges)
 *
 * Level 3: Integration Branches
 * - All Level 2 capabilities
 * - Create integration branches
 * - Perform merge operations
 * - Open integration PRs
 * - Run gates on integration branches
 *
 * Level 4: Full Automation
 * - All Level 3 capabilities
 * - Finalize successful integrations
 * - Close superseded PRs
 * - Merge integration PRs to target
 * - Complete end-to-end automation
 */
export enum AutopilotLevel {
  /** Level 0: Report only - generate plans and artifacts, no side effects */
  ReportOnly = 0,

  /** Level 1: Artifact generation - create integration plans and previews */
  ArtifactGeneration = 1,

  /** Level 2: PR annotations - post comments and update status */
  PRAnnotations = 2,

  /** Level 3: Integration branches - create branches and open PRs */
  IntegrationBranches = 3,

  /** Level 4: Full automation - complete end-to-end merge-weave */
  FullAutomation = 4,
}

/**
 * Zod schema for AutopilotLevel validation
 */
export const AutopilotLevelSchema = z
  .number()
  .int()
  .min(0, "Autopilot level must be at least 0")
  .max(4, "Autopilot level must be at most 4");

/**
 * Configuration for autopilot behavior
 */
export interface AutopilotConfig {
  /**
   * Maximum automation level to apply (0-4)
   * @default 0
   */
  maxLevel: AutopilotLevel;

  /**
   * Perform dry-run without executing operations
   * @default true
   */
  dryRun: boolean;

  /**
   * Open pull requests for integration branches (Level 3+)
   * @default false
   */
  openPR: boolean;

  /**
   * Close superseded PRs after successful integration (Level 4+)
   * @default false
   */
  closeSuperseded: boolean;

  /**
   * Template path for PR comment format (Level 2+)
   * @default undefined - uses built-in template
   */
  commentTemplate?: string;

  /**
   * Prefix for integration branch names (Level 3+)
   * @default "integration/"
   */
  branchPrefix: string;
}

/**
 * Zod schema for AutopilotConfig validation
 */
export const AutopilotConfigSchema = z.object({
  maxLevel: AutopilotLevelSchema,
  dryRun: z.boolean().default(true),
  openPR: z.boolean().default(false),
  closeSuperseded: z.boolean().default(false),
  commentTemplate: z.string().optional(),
  branchPrefix: z.string().default("integration/"),
});

/**
 * Default autopilot configuration (safest settings)
 */
export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  maxLevel: AutopilotLevel.ReportOnly,
  dryRun: true,
  openPR: false,
  closeSuperseded: false,
  branchPrefix: "integration/",
};

/**
 * Validation error for invalid autopilot configurations
 */
export class AutopilotConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutopilotConfigError";
  }
}

/**
 * Validates autopilot configuration for consistency and safety
 * @throws {AutopilotConfigError} if configuration is invalid
 */
export function validateAutopilotConfig(config: AutopilotConfig): void {
  // Validate using Zod schema first
  const result = AutopilotConfigSchema.safeParse(config);
  if (!result.success) {
    throw new AutopilotConfigError(`Invalid autopilot configuration: ${result.error.message}`);
  }

  // Additional logical validations

  // If openPR is true, maxLevel must be at least 3
  if (config.openPR && config.maxLevel < AutopilotLevel.IntegrationBranches) {
    throw new AutopilotConfigError(
      "--open-pr requires --max-level 3 or higher (integration branches)"
    );
  }

  // If closeSuperseded is true, maxLevel must be 4
  if (config.closeSuperseded && config.maxLevel < AutopilotLevel.FullAutomation) {
    throw new AutopilotConfigError("--close-superseded requires --max-level 4 (full automation)");
  }

  // If commentTemplate is provided, maxLevel must be at least 2
  if (config.commentTemplate && config.maxLevel < AutopilotLevel.PRAnnotations) {
    throw new AutopilotConfigError(
      "--comment-template requires --max-level 2 or higher (PR annotations)"
    );
  }

  // Warn if dryRun is false with high automation levels (but allow it)
  if (!config.dryRun && config.maxLevel >= AutopilotLevel.IntegrationBranches) {
    // This is intentional - user wants to execute, so we allow it
    // Just ensuring the combination is explicitly chosen
  }
}

/**
 * Parse CLI options into AutopilotConfig
 */
export function parseAutopilotConfig(opts: {
  maxLevel?: number;
  dryRun?: boolean;
  openPr?: boolean;
  closeSuperseded?: boolean;
  commentTemplate?: string;
  branchPrefix?: string;
}): AutopilotConfig {
  const config: AutopilotConfig = {
    maxLevel:
      opts.maxLevel !== undefined
        ? (opts.maxLevel as AutopilotLevel)
        : DEFAULT_AUTOPILOT_CONFIG.maxLevel,
    dryRun: opts.dryRun !== undefined ? opts.dryRun : DEFAULT_AUTOPILOT_CONFIG.dryRun,
    openPR: opts.openPr !== undefined ? opts.openPr : DEFAULT_AUTOPILOT_CONFIG.openPR,
    closeSuperseded:
      opts.closeSuperseded !== undefined
        ? opts.closeSuperseded
        : DEFAULT_AUTOPILOT_CONFIG.closeSuperseded,
    commentTemplate: opts.commentTemplate,
    branchPrefix: opts.branchPrefix || DEFAULT_AUTOPILOT_CONFIG.branchPrefix,
  };

  // Validate the parsed configuration
  validateAutopilotConfig(config);

  return config;
}

/**
 * Get human-readable description of an autopilot level
 */
export function getAutopilotLevelDescription(level: AutopilotLevel): string {
  switch (level) {
    case AutopilotLevel.ReportOnly:
      return "Report Only - Generate plans and artifacts without side effects";
    case AutopilotLevel.ArtifactGeneration:
      return "Artifact Generation - Create integration plans and previews";
    case AutopilotLevel.PRAnnotations:
      return "PR Annotations - Post comments and update status";
    case AutopilotLevel.IntegrationBranches:
      return "Integration Branches - Create branches and open PRs";
    case AutopilotLevel.FullAutomation:
      return "Full Automation - Complete end-to-end merge-weave";
    default:
      return `Unknown level: ${level}`;
  }
}

/**
 * Check if a specific capability is enabled at the given level
 */
export function hasCapability(
  config: AutopilotConfig,
  capability: "artifacts" | "annotations" | "branches" | "finalization"
): boolean {
  switch (capability) {
    case "artifacts":
      return config.maxLevel >= AutopilotLevel.ArtifactGeneration;
    case "annotations":
      return config.maxLevel >= AutopilotLevel.PRAnnotations;
    case "branches":
      return config.maxLevel >= AutopilotLevel.IntegrationBranches;
    case "finalization":
      return config.maxLevel >= AutopilotLevel.FullAutomation;
    default:
      return false;
  }
}
