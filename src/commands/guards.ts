/**
 * Safety guards to prevent PR creation in Issues-only commands
 *
 * Purpose: Ensures commands marked as "Issues-only" do not create PRs.
 * Used by: lex-pr idea, lex-pr create-project
 */

/**
 * Safety guard to prevent PR creation
 *
 * Ensures commands marked as "Issues-only" do not create PRs.
 * Logs warning if GitHub API calls resemble PR creation.
 *
 * @param operation - Name of the operation being guarded (for error messages)
 * @throws Error if call stack includes PR creation methods
 */
export function assertNoCreatePR(operation: string): void {
  const stack = new Error().stack || "";

  // Check if call stack includes PR creation methods
  const prCreationPatterns = ["createPullRequest", "pulls.create", "mergePullRequest"];

  const suspiciousCall = prCreationPatterns.find((pattern) => stack.includes(pattern));

  if (suspiciousCall) {
    throw new Error(
      `SAFETY VIOLATION: ${operation} attempted PR creation via ${suspiciousCall}\n` +
        `This command is Issues-only. Remove PR creation logic.`
    );
  }
}

/**
 * Validate that command options do not include PR-related flags
 *
 * @param options - Command options to validate
 * @throws Error if forbidden flags are present
 */
export function validateNoCreatePRFlags(options: Record<string, unknown>): void {
  const forbiddenFlags = ["create-pr", "pr", "pull-request", "merge"];

  const foundFlag = forbiddenFlags.find((flag) => flag in options);

  if (foundFlag) {
    throw new Error(
      `SAFETY VIOLATION: Flag --${foundFlag} not allowed in Issues-only commands\n` +
        `Use GitHub Projects or Issue tracking instead.`
    );
  }
}
