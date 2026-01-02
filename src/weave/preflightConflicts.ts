/**
 * Preflight conflict detection for merge operations
 * Uses git merge-tree to simulate merges without modifying working tree
 */

import { execa } from "execa";
import { Plan } from "../schema.js";
import { PreflightItemConflict, PreflightResults, InterPRConflict } from "./types.js";
import { weavePreflightFailedError } from "../errors/index.js";
import { generateResolutionGuidance, determineConflictSeverity } from "./resolutionGuidance.js";

/**
 * Detect conflicts for all items in a plan by simulating merges sequentially
 */
export async function detectPreflightConflicts(
  plan: Plan,
  workingDir: string = process.cwd()
): Promise<PreflightResults> {
  const items: PreflightItemConflict[] = [];
  let totalConflicts = 0;

  // Simulate merging each item into the target branch
  for (const item of plan.items) {
    try {
      const result = await simulateItemMerge(plan.target, item.name, workingDir);

      items.push(result);
      if (result.hasConflicts) {
        totalConflicts += result.conflicts.length;
      }
    } catch (error) {
      // If simulation fails, record as error
      items.push({
        name: item.name,
        hasConflicts: false,
        conflicts: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Detect inter-PR conflicts (file overlap between PRs)
  const interPRConflicts = await detectInterPRConflicts(plan, items, workingDir);

  return {
    conflictsDetected: totalConflicts,
    items,
    interPRConflicts,
  };
}

/**
 * Simulate merging a single item into the target branch
 */
async function simulateItemMerge(
  targetBranch: string,
  itemBranch: string,
  workingDir: string
): Promise<PreflightItemConflict> {
  try {
    // Try to fetch from origin (will fail if no remote configured, which is fine for local testing)
    await execa("git", ["fetch", "origin", targetBranch, itemBranch], {
      cwd: workingDir,
      reject: false, // Don't throw on non-zero exit
    });

    // Try with origin/ prefix first, fallback to local branches
    let targetRef = `origin/${targetBranch}`;
    let itemRef = `origin/${itemBranch}`;

    // Check if origin refs exist
    const { exitCode: targetExists } = await execa("git", ["rev-parse", "--verify", targetRef], {
      cwd: workingDir,
      reject: false,
    });

    if (targetExists !== 0) {
      // Fallback to local branch
      targetRef = targetBranch;
    }

    const { exitCode: itemExists } = await execa("git", ["rev-parse", "--verify", itemRef], {
      cwd: workingDir,
      reject: false,
    });

    if (itemExists !== 0) {
      // Fallback to local branch
      itemRef = itemBranch;
    }

    // Get the merge base
    const { stdout: mergeBase } = await execa("git", ["merge-base", targetRef, itemRef], {
      cwd: workingDir,
    });

    // Run git merge-tree to simulate the merge
    const { stdout } = await execa("git", ["merge-tree", mergeBase.trim(), targetRef, itemRef], {
      cwd: workingDir,
      reject: false, // Don't throw on non-zero exit
    });

    // Parse the output for conflicts
    const conflicts = parseMergeTreeOutput(stdout);
    return {
      name: itemBranch,
      hasConflicts: conflicts.length > 0,
      conflicts,
      mergeBase: mergeBase.trim(),
    };
  } catch (error) {
    // If git commands fail, treat as potential conflict
    throw weavePreflightFailedError({
      itemBranch,
      targetBranch,
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Parse git merge-tree output to extract conflict information
 */
function parseMergeTreeOutput(output: string): Array<{
  path: string;
  type: "both-modified" | "rename" | "delete-modify" | "add-add" | "unknown";
  oursChanged: boolean;
  theirsChanged: boolean;
  lines?: string;
}> {
  const conflicts: Array<{
    path: string;
    type: "both-modified" | "rename" | "delete-modify" | "add-add" | "unknown";
    oursChanged: boolean;
    theirsChanged: boolean;
    lines?: string;
  }> = [];

  const lines = output.split("\n");
  const conflictFiles = new Set<string>();

  // Track current file being processed
  let currentFile: string | null = null;
  let inConflictMarker = false;
  let conflictStartLine = 0;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    // Look for conflict markers
    if (line.includes("<<<<<<<")) {
      inConflictMarker = true;
      conflictStartLine = lineNumber;

      // Extract filename from marker if present
      const match = line.match(/<<<<<<< (.+)/);
      if (match && match[1]) {
        currentFile = match[1].trim();
      }
    } else if (line.includes(">>>>>>>") && inConflictMarker) {
      inConflictMarker = false;

      if (currentFile && !conflictFiles.has(currentFile)) {
        conflictFiles.add(currentFile);
        conflicts.push({
          path: currentFile,
          type: "both-modified",
          oursChanged: true,
          theirsChanged: true,
          lines: `${conflictStartLine}-${lineNumber}`,
        });
      }

      currentFile = null;
    }

    // Also look for CONFLICT messages in stderr-style output
    if (line.startsWith("CONFLICT")) {
      const fileMatch = line.match(/CONFLICT \(([^)]+)\):\s+(.+)/);
      if (fileMatch) {
        const conflictType = fileMatch[1];
        const filePath = fileMatch[2].trim();

        if (!conflictFiles.has(filePath)) {
          conflictFiles.add(filePath);

          let type: "both-modified" | "rename" | "delete-modify" | "add-add" | "unknown" =
            "unknown";
          if (conflictType.includes("content")) {
            type = "both-modified";
          } else if (conflictType.includes("rename")) {
            type = "rename";
          } else if (conflictType.includes("delete")) {
            type = "delete-modify";
          } else if (conflictType.includes("add")) {
            type = "add-add";
          }

          conflicts.push({
            path: filePath,
            type,
            oursChanged: true,
            theirsChanged: true,
          });
        }
      }
    }

    // Look for "changed in both" messages
    if (line.includes("changed in both") || line.includes("both modified")) {
      const pathMatch = line.match(/[:\s](.+)$/);
      if (pathMatch) {
        const filePath = pathMatch[1].trim();
        if (!conflictFiles.has(filePath)) {
          conflictFiles.add(filePath);
          conflicts.push({
            path: filePath,
            type: "both-modified",
            oursChanged: true,
            theirsChanged: true,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detect inter-PR conflicts by analyzing file changes between items
 */
async function detectInterPRConflicts(
  plan: Plan,
  items: PreflightItemConflict[],
  workingDir: string
): Promise<InterPRConflict[]> {
  const conflicts: InterPRConflict[] = [];

  // Get changed files for each item
  const itemChanges = new Map<string, string[]>();

  for (const item of plan.items) {
    try {
      const changedFiles = await getChangedFiles(plan.target, item.name, workingDir);
      itemChanges.set(item.name, changedFiles);
    } catch (error) {
      // If we can't get changes, skip this item
      itemChanges.set(item.name, []);
    }
  }

  // Compare each pair of items for file overlap
  const itemNames = Array.from(itemChanges.keys());
  for (let i = 0; i < itemNames.length; i++) {
    for (let j = i + 1; j < itemNames.length; j++) {
      const item1 = itemNames[i];
      const item2 = itemNames[j];
      const files1 = itemChanges.get(item1) ?? [];
      const files2 = itemChanges.get(item2) ?? [];

      // Find overlapping files
      const overlappingFiles = files1.filter((f) => files2.includes(f));

      if (overlappingFiles.length > 0) {
        // Determine severity and guidance for each overlapping file
        const fileGuidance = overlappingFiles.map((file) => ({
          file,
          severity: determineConflictSeverity(file, files1, files2),
          guidance: generateResolutionGuidance(file),
        }));

        // Use the highest severity
        const highestSeverity = fileGuidance.some((fg) => fg.severity === "likely")
          ? "likely"
          : fileGuidance.some((fg) => fg.severity === "possible")
            ? "possible"
            : "unlikely";

        // Use the first available guidance or create a default
        const guidance =
          fileGuidance.find((fg) => fg.guidance)?.guidance ||
          createDefaultGuidance(overlappingFiles);

        conflicts.push({
          item1,
          item2,
          files: overlappingFiles,
          severity: highestSeverity,
          guidance,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Get list of files changed in an item compared to target branch
 */
async function getChangedFiles(
  targetBranch: string,
  itemBranch: string,
  workingDir: string
): Promise<string[]> {
  try {
    // Try with origin/ prefix first
    let targetRef = `origin/${targetBranch}`;
    let itemRef = `origin/${itemBranch}`;

    // Check if origin refs exist
    const { exitCode: targetExists } = await execa("git", ["rev-parse", "--verify", targetRef], {
      cwd: workingDir,
      reject: false,
    });

    if (targetExists !== 0) {
      targetRef = targetBranch;
    }

    const { exitCode: itemExists } = await execa("git", ["rev-parse", "--verify", itemRef], {
      cwd: workingDir,
      reject: false,
    });

    if (itemExists !== 0) {
      itemRef = itemBranch;
    }

    // Get the list of changed files
    const { stdout } = await execa("git", ["diff", "--name-only", targetRef, itemRef], {
      cwd: workingDir,
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    // If git commands fail, return empty list
    return [];
  }
}

/**
 * Create default guidance when no specific pattern matches
 */
function createDefaultGuidance(files: string[]): {
  type: "manual-review" | "dependency-order";
  message: string;
  confidence: number;
  strategy?: "manual" | "merge-both";
} {
  return {
    type: "manual-review",
    message: `Both PRs modify ${files.length === 1 ? "the same file" : `${files.length} common files`}. Manual review recommended after the first PR merges.`,
    confidence: 0.5,
    strategy: "manual",
  };
}

/**
 * Skip preflight detection with a reason
 */
export function skipPreflightDetection(reason: string): PreflightResults {
  return {
    conflictsDetected: 0,
    items: [],
    interPRConflicts: [],
    skipped: true,
    skipReason: reason,
  };
}
