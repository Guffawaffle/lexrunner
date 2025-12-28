/**
 * Interactive plan review module
 * Provides human-in-the-loop validation and modification of plans
 */

import * as readline from "readline";
import { Plan, PlanItem } from "../schema.js";
import { computeMergeOrder } from "../mergeOrder.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

export interface ReviewOptions {
  plan: Plan;
  interactive?: boolean;
  autoApprove?: boolean;
}

export interface ReviewResult {
  approved: boolean;
  modified: boolean;
  plan: Plan;
  reason?: string;
  changes?: string[];
}

/**
 * Interactive plan review workflow
 */
export async function reviewPlan(options: ReviewOptions): Promise<ReviewResult> {
  const { plan, interactive = true, autoApprove = false } = options;

  if (autoApprove) {
    return {
      approved: true,
      modified: false,
      plan,
    };
  }

  if (!interactive) {
    // Non-interactive mode: just validate and return
    return {
      approved: true,
      modified: false,
      plan,
    };
  }

  console.log("\n📋 Plan Review\n");

  // Display plan summary
  displayPlanSummary(plan);

  // Display dependency visualization
  console.log("\n🔗 Dependency Graph:\n");
  displayDependencyGraph(plan);

  // Display merge order
  console.log("\n📊 Merge Order:\n");
  displayMergeOrder(plan);

  // Interactive review loop
  let currentPlan = plan;
  let modified = false;
  const changes: string[] = [];

  while (true) {
    console.log("\n📝 Options:");
    console.log("  [a] Approve plan");
    console.log("  [r] Reject plan");
    console.log("  [e] Edit plan");
    console.log("  [v] View plan details");
    console.log("  [d] Show diff (if modified)");
    console.log("  [q] Quit without saving");

    const action = await prompt("\nChoose action: ");

    switch (action.toLowerCase()) {
      case "a":
      case "approve":
        return {
          approved: true,
          modified,
          plan: currentPlan,
          changes: modified ? changes : undefined,
        };

      case "r":
      case "reject":
        const reason = await prompt("Rejection reason: ");
        return {
          approved: false,
          modified,
          plan: currentPlan,
          reason,
        };

      case "e":
      case "edit":
        const editResult = await editPlan(currentPlan);
        if (editResult.modified) {
          currentPlan = editResult.plan;
          modified = true;
          changes.push(...editResult.changes);
          console.log("\n✓ Plan updated");
          displayPlanSummary(currentPlan);
        }
        break;

      case "v":
      case "view":
        displayPlanDetails(currentPlan);
        break;

      case "d":
      case "diff":
        if (modified) {
          displayPlanDiff(plan, currentPlan);
        } else {
          console.log("\n⚠️  No modifications yet");
        }
        break;

      case "q":
      case "quit":
        return {
          approved: false,
          modified: false,
          plan,
        };

      default:
        console.log("\n⚠️  Invalid option");
    }
  }
}

/**
 * Display plan summary
 */
export function displayPlanSummary(plan: Plan): void {
  console.log(`Target Branch: ${plan.target}`);
  console.log(`Total Items: ${plan.items.length}`);
  console.log(`Schema Version: ${plan.schemaVersion}`);

  if (plan.items.length > 0) {
    console.log("\nItems:");
    plan.items.forEach((item, index) => {
      const deps = item.deps.length > 0 ? ` (depends on: ${item.deps.join(", ")})` : "";
      const gates = item.gates.length > 0 ? ` [${item.gates.length} gates]` : "";
      console.log(`  ${index + 1}. ${item.name}${deps}${gates}`);
    });
  }
}

/**
 * Display dependency graph as ASCII visualization
 */
export function displayDependencyGraph(plan: Plan): void {
  if (plan.items.length === 0) {
    console.log("  (no items)");
    return;
  }

  // Build adjacency list
  const dependencies = new Map<string, string[]>();
  plan.items.forEach((item) => {
    dependencies.set(item.name, item.deps);
  });

  // Display each item with its dependencies
  plan.items.forEach((item) => {
    if (item.deps.length === 0) {
      console.log(`  ${item.name} (no dependencies)`);
    } else {
      console.log(`  ${item.name} ← ${item.deps.join(", ")}`);
    }
  });
}

/**
 * Display merge order timeline
 */
export function displayMergeOrder(plan: Plan): void {
  try {
    const levels = computeMergeOrder(plan);

    if (levels.length === 0) {
      console.log("  (no items to merge)");
      return;
    }

    levels.forEach((level, index) => {
      console.log(`  Level ${index + 1}: ${level.join(", ")}`);
    });

    console.log(`\n  Total levels: ${levels.length}`);
  } catch (error) {
    console.log(
      `  ⚠️  Error computing merge order: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Display detailed plan information
 */
export function displayPlanDetails(plan: Plan): void {
  console.log("\n📄 Plan Details:\n");
  console.log(JSON.stringify(plan, null, 2));
}

/**
 * Edit plan interactively
 */
async function editPlan(plan: Plan): Promise<{ modified: boolean; plan: Plan; changes: string[] }> {
  const changes: string[] = [];
  let currentPlan = { ...plan, items: [...plan.items] };

  while (true) {
    console.log("\n✏️  Edit Options:");
    console.log("  [1] Add item");
    console.log("  [2] Remove item");
    console.log("  [3] Modify item dependencies");
    console.log("  [4] Modify item gates");
    console.log("  [5] Change target branch");
    console.log("  [6] Done editing");

    const choice = await prompt("\nChoose edit action: ");

    switch (choice) {
      case "1":
        const addResult = await addPlanItem(currentPlan);
        if (addResult.modified) {
          currentPlan = addResult.plan;
          changes.push(addResult.change);
        }
        break;

      case "2":
        const removeResult = await removePlanItem(currentPlan);
        if (removeResult.modified) {
          currentPlan = removeResult.plan;
          changes.push(removeResult.change);
        }
        break;

      case "3":
        const depsResult = await modifyItemDeps(currentPlan);
        if (depsResult.modified) {
          currentPlan = depsResult.plan;
          changes.push(depsResult.change);
        }
        break;

      case "4":
        console.log("\n⚠️  Gate editing not yet implemented");
        break;

      case "5":
        const newTarget = await prompt("New target branch: ");
        if (newTarget && newTarget !== currentPlan.target) {
          currentPlan = { ...currentPlan, target: newTarget };
          changes.push(`Changed target branch from ${plan.target} to ${newTarget}`);
        }
        break;

      case "6":
        return {
          modified: changes.length > 0,
          plan: currentPlan,
          changes,
        };

      default:
        console.log("\n⚠️  Invalid choice");
    }
  }
}

/**
 * Add a new plan item
 */
async function addPlanItem(plan: Plan): Promise<{ modified: boolean; plan: Plan; change: string }> {
  const name = await prompt("Item name: ");
  if (!name) {
    return { modified: false, plan, change: "" };
  }

  // Check for duplicates
  if (plan.items.some((item) => item.name === name)) {
    console.log("\n⚠️  Item with this name already exists");
    return { modified: false, plan, change: "" };
  }

  const depsInput = await prompt("Dependencies (comma-separated, or empty): ");
  const deps = depsInput
    ? depsInput
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d)
    : [];

  // Validate dependencies exist
  for (const dep of deps) {
    if (!plan.items.some((item) => item.name === dep)) {
      console.log(`\n⚠️  Dependency '${dep}' does not exist`);
      return { modified: false, plan, change: "" };
    }
  }

  const newItem: PlanItem = {
    name,
    deps,
    gates: [],
  };

  const newPlan = {
    ...plan,
    items: [...plan.items, newItem],
  };

  return {
    modified: true,
    plan: newPlan,
    change: `Added item '${name}'${deps.length > 0 ? ` with dependencies: ${deps.join(", ")}` : ""}`,
  };
}

/**
 * Remove a plan item
 */
async function removePlanItem(
  plan: Plan
): Promise<{ modified: boolean; plan: Plan; change: string }> {
  if (plan.items.length === 0) {
    console.log("\n⚠️  No items to remove");
    return { modified: false, plan, change: "" };
  }

  console.log("\nCurrent items:");
  plan.items.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.name}`);
  });

  const indexStr = await prompt("Item number to remove: ");
  const index = parseInt(indexStr) - 1;

  if (isNaN(index) || index < 0 || index >= plan.items.length) {
    console.log("\n⚠️  Invalid item number");
    return { modified: false, plan, change: "" };
  }

  const itemName = plan.items[index].name;

  // Check if other items depend on this one
  const dependents = plan.items.filter((item) => item.deps.includes(itemName));
  if (dependents.length > 0) {
    console.log(
      `\n⚠️  Cannot remove: ${dependents.length} item(s) depend on this: ${dependents.map((d) => d.name).join(", ")}`
    );
    return { modified: false, plan, change: "" };
  }

  const newPlan = {
    ...plan,
    items: plan.items.filter((_, i) => i !== index),
  };

  return {
    modified: true,
    plan: newPlan,
    change: `Removed item '${itemName}'`,
  };
}

/**
 * Modify item dependencies
 */
async function modifyItemDeps(
  plan: Plan
): Promise<{ modified: boolean; plan: Plan; change: string }> {
  if (plan.items.length === 0) {
    console.log("\n⚠️  No items to modify");
    return { modified: false, plan, change: "" };
  }

  console.log("\nCurrent items:");
  plan.items.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.name} (deps: ${item.deps.join(", ") || "none"})`);
  });

  const indexStr = await prompt("Item number to modify: ");
  const index = parseInt(indexStr) - 1;

  if (isNaN(index) || index < 0 || index >= plan.items.length) {
    console.log("\n⚠️  Invalid item number");
    return { modified: false, plan, change: "" };
  }

  const item = plan.items[index];
  const depsInput = await prompt(
    `New dependencies for '${item.name}' (comma-separated, or empty): `
  );
  const newDeps = depsInput
    ? depsInput
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d)
    : [];

  // Validate dependencies exist and don't create self-reference
  for (const dep of newDeps) {
    if (dep === item.name) {
      console.log(`\n⚠️  Item cannot depend on itself`);
      return { modified: false, plan, change: "" };
    }
    if (!plan.items.some((i) => i.name === dep)) {
      console.log(`\n⚠️  Dependency '${dep}' does not exist`);
      return { modified: false, plan, change: "" };
    }
  }

  // Check for cycles
  const testPlan = {
    ...plan,
    items: plan.items.map((i, idx) => (idx === index ? { ...i, deps: newDeps } : i)),
  };

  try {
    computeMergeOrder(testPlan);
  } catch (error) {
    console.log(
      `\n⚠️  Invalid dependencies: ${error instanceof Error ? error.message : String(error)}`
    );
    return { modified: false, plan, change: "" };
  }

  return {
    modified: true,
    plan: testPlan,
    change: `Modified dependencies for '${item.name}' from [${item.deps.join(", ")}] to [${newDeps.join(", ")}]`,
  };
}

/**
 * Display diff between original and modified plan
 */
export function displayPlanDiff(original: Plan, modified: Plan): void {
  console.log("\n📊 Plan Diff:\n");

  // Target branch diff
  if (original.target !== modified.target) {
    console.log(`Target Branch: ${original.target} → ${modified.target}`);
  }

  // Items diff
  const originalNames = new Set(original.items.map((i) => i.name));
  const modifiedNames = new Set(modified.items.map((i) => i.name));

  // Added items
  const added = modified.items.filter((i) => !originalNames.has(i.name));
  if (added.length > 0) {
    console.log("\nAdded items:");
    added.forEach((item) => {
      console.log(
        `  + ${item.name}${item.deps.length > 0 ? ` (deps: ${item.deps.join(", ")})` : ""}`
      );
    });
  }

  // Removed items
  const removed = original.items.filter((i) => !modifiedNames.has(i.name));
  if (removed.length > 0) {
    console.log("\nRemoved items:");
    removed.forEach((item) => {
      console.log(`  - ${item.name}`);
    });
  }

  // Modified items
  const common = original.items.filter((i) => modifiedNames.has(i.name));
  const modifiedItems = common.filter((origItem) => {
    const modItem = modified.items.find((i) => i.name === origItem.name)!;
    return (
      JSON.stringify(origItem.deps) !== JSON.stringify(modItem.deps) ||
      JSON.stringify(origItem.gates) !== JSON.stringify(modItem.gates)
    );
  });

  if (modifiedItems.length > 0) {
    console.log("\nModified items:");
    modifiedItems.forEach((origItem) => {
      const modItem = modified.items.find((i) => i.name === origItem.name)!;
      console.log(`  ~ ${origItem.name}`);

      if (JSON.stringify(origItem.deps) !== JSON.stringify(modItem.deps)) {
        console.log(`    deps: [${origItem.deps.join(", ")}] → [${modItem.deps.join(", ")}]`);
      }

      if (JSON.stringify(origItem.gates) !== JSON.stringify(modItem.gates)) {
        console.log(`    gates: ${origItem.gates.length} → ${modItem.gates.length}`);
      }
    });
  }

  if (
    added.length === 0 &&
    removed.length === 0 &&
    modifiedItems.length === 0 &&
    original.target === modified.target
  ) {
    console.log("  (no changes)");
  }
}

/**
 * Prompt for user input
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
