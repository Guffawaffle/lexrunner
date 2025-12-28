/**
 * Plan comparison and diff utilities
 */

import { Plan, PlanItem } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

export interface PlanDiff {
  targetChanged: boolean;
  originalTarget?: string;
  modifiedTarget?: string;
  addedItems: PlanItem[];
  removedItems: PlanItem[];
  modifiedItems: Array<{
    name: string;
    originalDeps: string[];
    modifiedDeps: string[];
    originalGatesCount: number;
    modifiedGatesCount: number;
  }>;
  hasChanges: boolean;
}

/**
 * Compare two plans and generate a detailed diff
 */
export function comparePlans(original: Plan, modified: Plan): PlanDiff {
  const diff: PlanDiff = {
    targetChanged: original.target !== modified.target,
    originalTarget: original.target,
    modifiedTarget: modified.target,
    addedItems: [],
    removedItems: [],
    modifiedItems: [],
    hasChanges: false,
  };

  const originalNames = new Set(original.items.map((i) => i.name));
  const modifiedNames = new Set(modified.items.map((i) => i.name));

  // Find added items
  diff.addedItems = modified.items.filter((i) => !originalNames.has(i.name));

  // Find removed items
  diff.removedItems = original.items.filter((i) => !modifiedNames.has(i.name));

  // Find modified items
  const commonItems = original.items.filter((i) => modifiedNames.has(i.name));

  for (const origItem of commonItems) {
    const modItem = modified.items.find((i) => i.name === origItem.name)!;

    const depsChanged =
      JSON.stringify(origItem.deps.sort()) !== JSON.stringify(modItem.deps.sort());
    const gatesChanged = origItem.gates.length !== modItem.gates.length;

    if (depsChanged || gatesChanged) {
      diff.modifiedItems.push({
        name: origItem.name,
        originalDeps: origItem.deps,
        modifiedDeps: modItem.deps,
        originalGatesCount: origItem.gates.length,
        modifiedGatesCount: modItem.gates.length,
      });
    }
  }

  diff.hasChanges =
    diff.targetChanged ||
    diff.addedItems.length > 0 ||
    diff.removedItems.length > 0 ||
    diff.modifiedItems.length > 0;

  return diff;
}

/**
 * Format plan diff as human-readable text
 */
export function formatPlanDiff(diff: PlanDiff): string {
  const lines: string[] = [];

  if (!diff.hasChanges) {
    return "No changes detected";
  }

  if (diff.targetChanged) {
    lines.push(`Target Branch: ${diff.originalTarget} → ${diff.modifiedTarget}`);
    lines.push("");
  }

  if (diff.addedItems.length > 0) {
    lines.push("Added Items:");
    diff.addedItems.forEach((item) => {
      lines.push(`  + ${item.name}`);
      if (item.deps.length > 0) {
        lines.push(`    deps: ${item.deps.join(", ")}`);
      }
      if (item.gates.length > 0) {
        lines.push(`    gates: ${item.gates.length}`);
      }
    });
    lines.push("");
  }

  if (diff.removedItems.length > 0) {
    lines.push("Removed Items:");
    diff.removedItems.forEach((item) => {
      lines.push(`  - ${item.name}`);
    });
    lines.push("");
  }

  if (diff.modifiedItems.length > 0) {
    lines.push("Modified Items:");
    diff.modifiedItems.forEach((item) => {
      lines.push(`  ~ ${item.name}`);

      const depsChanged =
        JSON.stringify(item.originalDeps.sort()) !== JSON.stringify(item.modifiedDeps.sort());
      if (depsChanged) {
        lines.push(
          `    deps: [${item.originalDeps.join(", ")}] → [${item.modifiedDeps.join(", ")}]`
        );
      }

      if (item.originalGatesCount !== item.modifiedGatesCount) {
        lines.push(`    gates: ${item.originalGatesCount} → ${item.modifiedGatesCount}`);
      }
    });
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Validate plan consistency
 */
export function validatePlan(plan: Plan): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for duplicate item names
  const names = plan.items.map((i) => i.name);
  const uniqueNames = new Set(names);
  if (names.length !== uniqueNames.size) {
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    errors.push(`Duplicate item names: ${[...new Set(duplicates)].join(", ")}`);
  }

  // Check for invalid dependencies
  const nameSet = new Set(names);
  plan.items.forEach((item) => {
    item.deps.forEach((dep) => {
      if (!nameSet.has(dep)) {
        errors.push(`Item '${item.name}' has unknown dependency '${dep}'`);
      }
      if (dep === item.name) {
        errors.push(`Item '${item.name}' cannot depend on itself`);
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
