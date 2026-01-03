/**
 * Copilot PR Completion Detection
 *
 * Utilities to determine if a Copilot coding agent PR is complete and ready for undraft.
 *
 * Detection heuristics:
 * 1. All checklist items are checked ([x])
 * 2. Review has been requested
 * 3. Last commit is older than threshold (not actively working)
 *
 * @module
 */

/**
 * Check if a PR body has all checklist items checked
 * Returns true if:
 * - There are checklist items (- [ ] or - [x])
 * - All checklist items are checked ([x])
 * - OR there are no checklist items (vacuously true)
 */
export function hasAllChecklistItemsChecked(prBody: string | null | undefined): boolean {
  if (!prBody) {
    return true; // No body means no checklist, vacuously complete
  }

  // Match checklist items: - [ ] or - [x] (with optional leading whitespace)
  const checklistPattern = /^\s*-\s*\[([ x])\]/gim;
  const matches = prBody.match(checklistPattern);

  if (!matches || matches.length === 0) {
    return true; // No checklist items found, vacuously complete
  }

  // Check if all items are checked
  return matches.every((match) => match.includes("[x]"));
}

/**
 * Check if last commit is older than threshold (agent not actively working)
 * @param lastCommitDate ISO 8601 timestamp of last commit
 * @param thresholdMinutes Minimum age in minutes (default: 5)
 */
export function isCommitAgeAboveThreshold(
  lastCommitDate: string | null | undefined,
  thresholdMinutes: number = 5
): boolean {
  if (!lastCommitDate) {
    return false; // No commit date, assume not ready
  }

  const commitTime = new Date(lastCommitDate).getTime();
  const now = Date.now();
  const ageMinutes = (now - commitTime) / (1000 * 60);

  return ageMinutes >= thresholdMinutes;
}

/**
 * Check if a Copilot PR is complete and ready for undraft
 * @param prData PR metadata including body, review status, and timestamps
 */
export function isCopilotPRComplete(prData: {
  body: string | null | undefined;
  reviewRequested: boolean;
  lastCommitDate: string | null | undefined;
  commitAgeThresholdMinutes?: number;
}): boolean {
  const { body, reviewRequested, lastCommitDate, commitAgeThresholdMinutes = 5 } = prData;

  // All three conditions must be met
  const checklistComplete = hasAllChecklistItemsChecked(body);
  const commitOldEnough = isCommitAgeAboveThreshold(lastCommitDate, commitAgeThresholdMinutes);

  return checklistComplete && reviewRequested && commitOldEnough;
}
