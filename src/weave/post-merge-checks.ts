/**
 * Post-Merge Checks Module
 *
 * Executes validation checks after each successful merge to catch
 * integration issues early (type errors, lint failures, test failures).
 *
 * @module weave/post-merge-checks
 */

import type { ShellExecutor, ShellResult } from "./executor/types.js";

/**
 * Type of post-merge check
 */
export type PostMergeCheckType = "typecheck" | "lint" | "test";

/**
 * Post-merge check configuration
 */
export interface PostMergeCheck {
  /** Type of check */
  type: PostMergeCheckType;
  /** Command to execute */
  command: string;
  /** Whether this check is required (blocks weave if fails) */
  required: boolean;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Result of a post-merge check
 */
export interface PostMergeCheckResult {
  /** Type of check that was run */
  type: PostMergeCheckType;
  /** Whether the check passed */
  success: boolean;
  /** Exit code from command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if check failed */
  error?: string;
}

/**
 * Result of running all post-merge checks
 */
export interface PostMergeChecksResult {
  /** Whether all required checks passed */
  success: boolean;
  /** Individual check results */
  checks: PostMergeCheckResult[];
  /** First failed check (if any) */
  firstFailure?: PostMergeCheckResult;
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

/**
 * Default post-merge checks configuration
 */
export const DEFAULT_POST_MERGE_CHECKS: PostMergeCheck[] = [
  {
    type: "typecheck",
    command: "npm run build",
    required: true,
    timeout: 60_000,
  },
];

/**
 * Run a single post-merge check
 */
export async function runPostMergeCheck(
  check: PostMergeCheck,
  shell: ShellExecutor,
  workingDir: string
): Promise<PostMergeCheckResult> {
  const startTime = Date.now();

  try {
    const result: ShellResult = await shell.run(check.command, {
      cwd: workingDir,
      timeout: check.timeout,
    });

    const durationMs = Date.now() - startTime;

    return {
      type: check.type,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs,
      error: result.exitCode !== 0 ? `Check failed with exit code ${result.exitCode}` : undefined,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    return {
      type: check.type,
      success: false,
      exitCode: -1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all post-merge checks
 */
export async function runPostMergeChecks(
  checks: PostMergeCheck[],
  shell: ShellExecutor,
  workingDir: string,
  options?: {
    /** Skip post-merge checks */
    skip?: boolean;
    /** Only run required checks */
    requiredOnly?: boolean;
  }
): Promise<PostMergeChecksResult> {
  const startTime = Date.now();

  // Skip if requested
  if (options?.skip) {
    return {
      success: true,
      checks: [],
      totalDurationMs: 0,
    };
  }

  // Filter checks based on options
  const checksToRun = options?.requiredOnly ? checks.filter((c) => c.required) : checks;

  const results: PostMergeCheckResult[] = [];
  let firstFailure: PostMergeCheckResult | undefined;

  // Run checks sequentially
  for (const check of checksToRun) {
    const result = await runPostMergeCheck(check, shell, workingDir);
    results.push(result);

    // Track first failure of a required check
    if (!result.success && check.required && !firstFailure) {
      firstFailure = result;
      // Stop executing further checks after first required check failure
      break;
    }
  }

  const totalDurationMs = Date.now() - startTime;

  // Success means no required checks failed
  // Non-required checks can fail without affecting overall success
  const success = !firstFailure;

  return {
    success,
    checks: results,
    firstFailure,
    totalDurationMs,
  };
}

/**
 * Format post-merge check result for display
 */
export function formatPostMergeCheckResult(result: PostMergeCheckResult): string {
  const status = result.success ? "✅" : "❌";
  const duration = `${result.durationMs}ms`;

  let output = `${status} Post-merge ${result.type}: ${duration}`;

  if (!result.success && result.error) {
    output += `\n  Error: ${result.error}`;
  }

  if (!result.success && result.stderr) {
    // Include first few lines of stderr for context
    const stderrLines = result.stderr.split("\n").slice(0, 10);
    output += `\n  ${stderrLines.join("\n  ")}`;
  }

  return output;
}

/**
 * Format all post-merge checks results for display
 */
export function formatPostMergeChecksResult(result: PostMergeChecksResult): string {
  const lines: string[] = [];

  for (const check of result.checks) {
    lines.push(formatPostMergeCheckResult(check));
  }

  if (result.firstFailure) {
    lines.push("");
    lines.push("⚠️  Post-merge check failed. Weave paused.");
    lines.push("");
    lines.push("Options:");
    lines.push("  1. Fix locally and continue: lexrunner merge-weave --resume");
    lines.push("  2. Revert last merge: lexrunner merge-weave --revert-last");
    lines.push("  3. Abort weave: lexrunner merge-weave --abort");
  }

  return lines.join("\n");
}
