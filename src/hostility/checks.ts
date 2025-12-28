/**
 * Environmental Hostility Checks
 *
 * Individual check functions for each hostility component.
 * Each check examines a specific aspect of environment quality.
 */

import * as fs from "fs";
import * as path from "path";
import { createComponent, HostilityComponent } from "./score.js";

// =============================================================================
// Scoring Constants
// =============================================================================
// These constants define the baseline scores and adjustments for each component.
// Lower scores are better (less hostile). The goal is to reach 0 (fully de-hostilized).

/** Baseline score when partial requirements are met */
const SCORE_PARTIAL_BASELINE = 0.5;

/** Score reduction for having scope/intent files */
const SCORE_SCOPE_FILES_REDUCTION = 0.2;

/** Score reduction for having a valid plan */
const SCORE_VALID_PLAN_REDUCTION = 0.2;

/** Score reduction for frame emission being enabled */
const SCORE_FRAME_EMISSION_REDUCTION = 0.3;

/** Score reduction for having receipt directories */
const SCORE_RECEIPT_DIR_REDUCTION = 0.1;

/** Score reduction for having gates configuration */
const SCORE_GATES_CONFIG_REDUCTION = 0.2;

/** Score reduction for git availability (rollback capability) */
const SCORE_GIT_AVAILABLE_REDUCTION = 0.15;

/** Score reduction for having retry configuration */
const SCORE_RETRY_CONFIG_REDUCTION = 0.1;

/** Baseline score for state coherence */
const SCORE_STATE_BASELINE = 0.3;

/** Score reduction for expected state directories */
const SCORE_EXPECTED_STATE_REDUCTION = 0.2;

/** Score increase for unexpected/fragmented state */
const SCORE_FRAGMENTED_STATE_PENALTY = 0.3;

/** Score reduction for having continuity documentation */
const SCORE_CONTINUITY_DOC_REDUCTION = 0.25;

/** Score reduction for having session state */
const SCORE_SESSION_STATE_REDUCTION = 0.1;

/** Score reduction for having intent.md */
const SCORE_INTENT_REDUCTION = 0.1;

/**
 * Options for running hostility checks
 */
export interface CheckOptions {
  /** Current working directory for checks */
  cwd?: string;
  /** Path to plan.json file */
  planPath?: string;
  /** Profile directory path */
  profileDir?: string;
}

/**
 * Check Constraint Clarity
 *
 * Measures: Are constraints explicit and machine-readable?
 * Checks for presence of AGENTS.md, copilot instructions, and policy files.
 */
export function checkConstraintClarity(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();

  const constraintFiles = [
    "AGENTS.md",
    ".github/copilot-instructions.md",
    "lexmap.policy.json",
    "CLAUDE.md",
  ];

  const found: string[] = [];
  for (const file of constraintFiles) {
    const filePath = path.join(cwd, file);
    if (fs.existsSync(filePath)) {
      found.push(file);
    }
  }

  // Score: 0 = all found (best), 1 = none found (worst)
  const score = 1 - found.length / constraintFiles.length;

  const details =
    found.length > 0
      ? `Found ${found.length}/${constraintFiles.length} constraint files: ${found.join(", ")}`
      : "No constraint files found";

  const recommendation =
    score > 0.3 ? "Add AGENTS.md or copilot instructions for clearer constraints" : undefined;

  return createComponent(score, details, recommendation);
}

/**
 * Check Requirement Explicitness
 *
 * Measures: Are requirements stated explicitly with pre-flight validation?
 * Checks for presence of scope configuration and plan validation.
 */
export function checkRequirementExplicitness(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();
  const profileDir = options.profileDir || path.join(cwd, ".smartergpt");

  const requirementFiles = [
    path.join(profileDir, "scope.yml"),
    path.join(profileDir, "intent.md"),
    path.join(profileDir, "runner", "scope.yml"),
    path.join(profileDir, "runner", "intent.md"),
  ];

  // Check if any requirement files exist
  const found = requirementFiles.filter((f) => fs.existsSync(f));

  // Check if plan exists and is valid
  const planPath = options.planPath || path.join(cwd, "plan.json");
  let planValid = false;
  let planItemCount = 0;

  if (fs.existsSync(planPath)) {
    try {
      const planContent = JSON.parse(fs.readFileSync(planPath, "utf-8"));
      if (planContent.schemaVersion && Array.isArray(planContent.items)) {
        planValid = true;
        planItemCount = planContent.items.length;
      }
    } catch {
      // Invalid JSON or structure
    }
  }

  // Scoring: baseline, reduced by found files and valid plan
  let score = SCORE_PARTIAL_BASELINE;
  if (found.length > 0) score -= SCORE_SCOPE_FILES_REDUCTION;
  if (planValid) score -= SCORE_VALID_PLAN_REDUCTION;

  const details = planValid
    ? `Plan validated with ${planItemCount} items, ${found.length} scope files found`
    : found.length > 0
      ? `Scope files found but no valid plan.json`
      : "No scope or plan files found";

  const recommendation =
    score > 0.3
      ? planValid
        ? undefined
        : "Create plan.json with 'lex-pr plan' for explicit requirements"
      : undefined;

  return createComponent(score, details, recommendation);
}

/**
 * Check Problem Boundedness
 *
 * Measures: Is the problem surface bounded to a manageable scope?
 * Checks plan item count and complexity.
 */
export function checkProblemBoundedness(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();
  const planPath = options.planPath || path.join(cwd, "plan.json");

  if (!fs.existsSync(planPath)) {
    return createComponent(0.5, "No plan.json found", "Create plan.json with bounded items");
  }

  try {
    const planContent = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    const itemCount = planContent.items?.length || 0;

    // Scoring: 0 for <= 10 items, linear to 1.0 at 20+ items
    // Recommend < 10 items per plan for optimal agent operation
    const score = Math.min(1, Math.max(0, (itemCount - 10) / 10));

    const details = `Plan has ${itemCount} items (recommend < 10 for optimal parallelism)`;

    const recommendation =
      itemCount > 10 ? "Split plan into smaller batches (< 10 items each)" : undefined;

    return createComponent(score, details, recommendation);
  } catch {
    return createComponent(0.5, "Could not parse plan.json", "Ensure plan.json is valid JSON");
  }
}

/**
 * Check Receipt Completeness
 *
 * Measures: Are all operations traced with receipts?
 * Checks for frame emission settings and receipt directories.
 */
export function checkReceiptCompleteness(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();
  const profileDir = options.profileDir || path.join(cwd, ".smartergpt");

  // Check environment for frame emission
  const hasEmitFrames = process.env.LEX_PR_EMIT_FRAMES !== "false";

  // Check for deliverables/receipts directories
  const receiptDirs = [
    path.join(profileDir, "runner", "deliverables"),
    path.join(profileDir, "deliverables"),
    path.join(cwd, ".lexrunner", "receipts"),
  ];

  const hasReceiptDir = receiptDirs.some((d) => fs.existsSync(d));

  // Scoring: low if frame emission enabled AND receipt dir exists
  let score = SCORE_PARTIAL_BASELINE;
  if (hasEmitFrames) score -= SCORE_FRAME_EMISSION_REDUCTION;
  if (hasReceiptDir) score -= SCORE_RECEIPT_DIR_REDUCTION;

  const details = hasEmitFrames
    ? hasReceiptDir
      ? "Frame emission enabled, receipt directories present"
      : "Frame emission enabled"
    : "Frame emission disabled";

  const recommendation = !hasEmitFrames
    ? "Enable --emit-frames for traceability"
    : !hasReceiptDir
      ? "Run autopilot to generate deliverables with receipts"
      : undefined;

  return createComponent(score, details, recommendation);
}

/**
 * Check Error Recoverability
 *
 * Measures: Are rollback paths and error recovery defined?
 * Checks for error handling configuration and retry mechanisms.
 */
export function checkErrorRecoverability(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();
  const profileDir = options.profileDir || path.join(cwd, ".smartergpt");

  // Check for gates configuration (gates provide structured error handling)
  const gatesFiles = [
    path.join(profileDir, "gates.yml"),
    path.join(profileDir, "runner", "gates.yml"),
  ];

  const hasGates = gatesFiles.some((f) => fs.existsSync(f));

  // Check for retry/recovery configuration in plan
  const planPath = options.planPath || path.join(cwd, "plan.json");
  let hasRetryConfig = false;

  if (fs.existsSync(planPath)) {
    try {
      const planContent = JSON.parse(fs.readFileSync(planPath, "utf-8"));
      // Check if policy has retry settings
      if (planContent.policy?.maxRetries || planContent.policy?.retryDelayMs) {
        hasRetryConfig = true;
      }
    } catch {
      // Invalid plan
    }
  }

  // Check if git is in a clean state (allows for easy rollback)
  let gitClean = false;
  try {
    const gitStatus = path.join(cwd, ".git");
    if (fs.existsSync(gitStatus)) {
      // Git repo exists - baseline recovery path
      gitClean = true;
    }
  } catch {
    // No git
  }

  // Scoring
  let score = SCORE_PARTIAL_BASELINE;
  if (hasGates) score -= SCORE_GATES_CONFIG_REDUCTION;
  if (gitClean) score -= SCORE_GIT_AVAILABLE_REDUCTION;
  if (hasRetryConfig) score -= SCORE_RETRY_CONFIG_REDUCTION;

  const details = hasGates
    ? "Gates configured for structured error handling"
    : "No gates.yml found for error handling";

  const recommendation =
    score > 0.3 ? (!hasGates ? "Add gates.yml with rollback configuration" : undefined) : undefined;

  return createComponent(score, details, recommendation);
}

/**
 * Check State Coherence
 *
 * Measures: Is state consolidated in expected locations?
 * Checks for state fragmentation across directories.
 */
export function checkStateCoherence(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();

  // Expected state directories
  const expectedDirs = [".smartergpt/", ".smartergpt.local/", ".lexrunner/"];

  // Potentially problematic state locations (fragmented state)
  const unexpectedDirs = ["temp/", ".cache/lex-pr/", "node_modules/.lexrunner/", ".lex-temp/"];

  const foundExpected = expectedDirs.filter((d) => fs.existsSync(path.join(cwd, d)));
  const foundUnexpected = unexpectedDirs.filter((d) => fs.existsSync(path.join(cwd, d)));

  // Scoring: penalize fragmented state, reward consolidated state
  let score = SCORE_STATE_BASELINE;
  if (foundExpected.length > 0) score -= SCORE_EXPECTED_STATE_REDUCTION;
  if (foundUnexpected.length > 0) score += SCORE_FRAGMENTED_STATE_PENALTY;

  const details =
    foundUnexpected.length > 0
      ? `State found in non-standard locations: ${foundUnexpected.join(", ")}`
      : foundExpected.length > 0
        ? "State in expected locations"
        : "No state directories found";

  const recommendation =
    foundUnexpected.length > 0
      ? "Consolidate state to .smartergpt/ or .lexrunner/ directory"
      : undefined;

  return createComponent(score, details, recommendation);
}

/**
 * Check Model Continuity
 *
 * Measures: Are handoff protocols in place for model switches?
 * Checks for continuity documentation and session artifacts.
 */
export function checkModelContinuity(options: CheckOptions = {}): HostilityComponent {
  const cwd = options.cwd || process.cwd();
  const profileDir = options.profileDir || path.join(cwd, ".smartergpt");

  // Check for continuity/handoff documentation
  const continuityFiles = [
    path.join(cwd, "CONTINUITY.md"),
    path.join(cwd, "HANDOFF.md"),
    path.join(cwd, ".github", "HANDOFF.md"),
    path.join(profileDir, "handoff.md"),
  ];

  // Check for session state files (help with continuity)
  const sessionFiles = [
    path.join(profileDir, "runner", "session.json"),
    path.join(profileDir, "session.json"),
    path.join(cwd, ".lexrunner", "session.json"),
  ];

  const hasContinuityDocs = continuityFiles.some((f) => fs.existsSync(f));
  const hasSessionState = sessionFiles.some((f) => fs.existsSync(f));

  // Check for intent.md which helps with continuity
  const hasIntent =
    fs.existsSync(path.join(profileDir, "intent.md")) ||
    fs.existsSync(path.join(profileDir, "runner", "intent.md"));

  // Scoring
  let score = SCORE_PARTIAL_BASELINE;
  if (hasContinuityDocs) score -= SCORE_CONTINUITY_DOC_REDUCTION;
  if (hasSessionState) score -= SCORE_SESSION_STATE_REDUCTION;
  if (hasIntent) score -= SCORE_INTENT_REDUCTION;

  const details = hasContinuityDocs
    ? "Continuity protocol documented"
    : hasIntent
      ? "Intent.md provides partial continuity context"
      : "No explicit handoff protocol";

  const recommendation = !hasContinuityDocs
    ? "Add HANDOFF.md or session state for model switch continuity"
    : undefined;

  return createComponent(score, details, recommendation);
}

/**
 * Run all hostility checks and return component results.
 */
export function runAllChecks(options: CheckOptions = {}): Record<string, HostilityComponent> {
  return {
    constraintClarity: checkConstraintClarity(options),
    requirementExplicitness: checkRequirementExplicitness(options),
    problemBoundedness: checkProblemBoundedness(options),
    receiptCompleteness: checkReceiptCompleteness(options),
    errorRecoverability: checkErrorRecoverability(options),
    stateCoherence: checkStateCoherence(options),
    modelContinuity: checkModelContinuity(options),
  };
}
