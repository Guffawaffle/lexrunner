/**
 * Deliverables generator for merge-weave orchestration
 * Auto-generates structured deliverables with plan hashing and toolchain manifests
 */

import * as fs from "fs";
import * as path from "path";
import { Plan } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { sha256 } from "../util/hash.js";
import { generateToolchainManifest, formatToolchainAsMarkdown } from "./toolchainManifest.js";

export interface DeliverablesOptions {
  batchId: string;
  outputDir: string;
  planPath: string;
  templateDir?: string;
}

/**
 * Compute SHA256 hash of canonical plan.json
 */
export function computePlanHash(plan: Plan): string {
  const canonical = canonicalJSONStringify(plan);
  return sha256(canonical);
}

/**
 * Generate plan hash file content
 */
function generatePlanHashFile(planHash: string, plan: Plan): string {
  const lines: string[] = [];
  lines.push(`SHA256: ${planHash}`);
  lines.push(`Algorithm: SHA256`);
  lines.push(`Canonical JSON: true`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Plan Version: ${plan.schemaVersion}`);
  return lines.join("\n") + "\n";
}

/**
 * Generate GATE0 preflight deliverable
 */
function generateGate0Preflight(plan: Plan, batchId: string): string {
  const lines: string[] = [];
  lines.push(`# GATE0: Preflight - ${batchId}`);
  lines.push("");
  lines.push("## Batch Overview");
  lines.push("");
  lines.push(`- **Batch ID:** ${batchId}`);
  lines.push(`- **Total Items:** ${plan.items.length}`);
  lines.push(`- **Schema Version:** ${plan.schemaVersion}`);
  lines.push("");

  lines.push("## Issue List");
  lines.push("");
  for (const [index, item] of plan.items.entries()) {
    lines.push(`${index + 1}. **${item.name}**`);
    // Optional fields with type-safe access
    const itemAny = item as any;
    if (itemAny.issue) {
      lines.push(`   - Issue: ${itemAny.issue}`);
    }
    if (itemAny.branch) {
      lines.push(`   - Branch: \`${itemAny.branch}\``);
    }
  }
  lines.push("");

  lines.push("## Dependencies");
  lines.push("");
  const hasDeps = plan.items.some((item) => item.deps.length > 0);
  if (hasDeps) {
    for (const item of plan.items) {
      if (item.deps.length > 0) {
        lines.push(`- **${item.name}** depends on: ${item.deps.join(", ")}`);
      }
    }
  } else {
    lines.push("*No dependencies defined*");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate GATE1 assignment deliverable
 */
function generateGate1Assignment(plan: Plan, batchId: string): string {
  const lines: string[] = [];
  lines.push(`# GATE1: Assignment - ${batchId}`);
  lines.push("");
  lines.push("## Agent Assignments");
  lines.push("");

  for (const [index, item] of plan.items.entries()) {
    lines.push(`${index + 1}. **${item.name}**`);
    lines.push(`   - Status: Pending`);
    // Optional field with type-safe access
    const itemAny = item as any;
    if (itemAny.assignee) {
      lines.push(`   - Assignee: @${itemAny.assignee}`);
    }
    lines.push("");
  }

  lines.push("## Timing");
  lines.push("");
  lines.push(`- **Start Time:** ${new Date().toISOString()}`);
  lines.push(`- **Estimated Duration:** TBD`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate GATE2 conflicts deliverable
 */
function generateGate2Conflicts(plan: Plan, batchId: string): string {
  const lines: string[] = [];
  lines.push(`# GATE2: Conflict Analysis - ${batchId}`);
  lines.push("");
  lines.push("## Conflict Prediction");
  lines.push("");
  lines.push("*Conflict analysis to be performed during execution*");
  lines.push("");

  lines.push("## File Overlap Analysis");
  lines.push("");
  lines.push("| Item | Files Changed | Potential Conflicts |");
  lines.push("|------|---------------|---------------------|");
  for (const item of plan.items) {
    lines.push(`| ${item.name} | TBD | TBD |`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate GATE3 merge deliverable
 */
function generateGate3Merge(plan: Plan, batchId: string): string {
  const lines: string[] = [];
  lines.push(`# GATE3: Merge Execution - ${batchId}`);
  lines.push("");
  lines.push("## Merge Order");
  lines.push("");

  for (const [index, item] of plan.items.entries()) {
    lines.push(`${index + 1}. ${item.name}`);
  }
  lines.push("");

  lines.push("## Merge Log");
  lines.push("");
  lines.push("*Merge execution log to be recorded during execution*");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate GATE4 gates deliverable
 */
function generateGate4Gates(plan: Plan, batchId: string): string {
  const lines: string[] = [];
  lines.push(`# GATE4: Gate Results - ${batchId}`);
  lines.push("");
  lines.push("## Gate Execution Summary");
  lines.push("");

  const allGates = new Set<string>();
  for (const item of plan.items) {
    for (const gate of item.gates) {
      allGates.add(gate.name);
    }
  }

  if (allGates.size > 0) {
    lines.push("| Gate | Status | Duration |");
    lines.push("|------|--------|----------|");
    for (const gate of Array.from(allGates).sort()) {
      lines.push(`| ${gate} | Pending | - |`);
    }
  } else {
    lines.push("*No gates defined*");
  }
  lines.push("");

  lines.push("## Results by Item");
  lines.push("");
  for (const item of plan.items) {
    lines.push(`### ${item.name}`);
    if (item.gates.length > 0) {
      lines.push("");
      for (const gate of item.gates) {
        lines.push(`- **${gate.name}:** Pending`);
      }
    } else {
      lines.push("*No gates*");
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate GATE5 cleanup deliverable
 */
function generateGate5Cleanup(plan: Plan, batchId: string): string {
  const lines: string[] = [];
  lines.push(`# GATE5: Cleanup - ${batchId}`);
  lines.push("");
  lines.push("## Branch Cleanup");
  lines.push("");

  for (const item of plan.items) {
    // Optional field with type-safe access
    const itemAny = item as any;
    if (itemAny.branch) {
      lines.push(`- [ ] Delete branch: \`${itemAny.branch}\``);
    }
  }
  lines.push("");

  lines.push("## PR Closure");
  lines.push("");
  for (const item of plan.items) {
    // Optional field with type-safe access
    const itemAny = item as any;
    if (itemAny.issue) {
      lines.push(`- [ ] Close PR: ${itemAny.issue}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate SUMMARY deliverable
 */
function generateSummary(
  plan: Plan,
  batchId: string,
  planHash: string,
  toolchainMarkdown: string
): string {
  const lines: string[] = [];
  lines.push(`# Merge-Weave Summary - ${batchId}`);
  lines.push("");

  lines.push("## Plan Hash");
  lines.push("");
  lines.push(`**SHA256:** \`${planHash}\``);
  lines.push("");
  lines.push("This hash uniquely identifies the plan.json used for this merge-weave.");
  lines.push("To verify reproducibility, compare this hash with a re-execution.");
  lines.push("");

  lines.push(toolchainMarkdown);
  lines.push("");

  lines.push("## Execution Summary");
  lines.push("");
  lines.push(`- **Total Items:** ${plan.items.length}`);
  lines.push(`- **Batch ID:** ${batchId}`);
  lines.push(`- **Schema Version:** ${plan.schemaVersion}`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Items");
  lines.push("");
  for (const [index, item] of plan.items.entries()) {
    lines.push(`${index + 1}. **${item.name}**`);
    // Optional fields with type-safe access
    const itemAny = item as any;
    if (itemAny.issue) {
      lines.push(`   - Issue: ${itemAny.issue}`);
    }
    if (itemAny.branch) {
      lines.push(`   - Branch: \`${itemAny.branch}\``);
    }
    if (item.gates.length > 0) {
      lines.push(`   - Gates: ${item.gates.map((g) => g.name).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate full deliverables for a merge-weave batch
 */
export async function generateDeliverables(options: DeliverablesOptions): Promise<void> {
  const { batchId, outputDir, planPath } = options;

  // Load plan
  const planContent = fs.readFileSync(planPath, "utf-8");
  const plan: Plan = JSON.parse(planContent);

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Compute plan hash
  const planHash = computePlanHash(plan);

  // Generate toolchain manifest
  const toolchainManifest = generateToolchainManifest();
  const toolchainMarkdown = formatToolchainAsMarkdown(toolchainManifest);

  // Write plan.json (copy)
  const planDestPath = path.join(outputDir, "plan.json");
  fs.writeFileSync(planDestPath, canonicalJSONStringify(plan), "utf-8");

  // Write plan-hash.txt
  const planHashPath = path.join(outputDir, "plan-hash.txt");
  fs.writeFileSync(planHashPath, generatePlanHashFile(planHash, plan), "utf-8");

  // Write toolchain-manifest.json
  const manifestPath = path.join(outputDir, "toolchain-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(toolchainManifest, null, 2) + "\n", "utf-8");

  // Generate and write gate deliverables
  const deliverables = [
    { name: "GATE0_preflight.md", content: generateGate0Preflight(plan, batchId) },
    { name: "GATE1_assignment.md", content: generateGate1Assignment(plan, batchId) },
    { name: "GATE2_conflicts.md", content: generateGate2Conflicts(plan, batchId) },
    { name: "GATE3_merge.md", content: generateGate3Merge(plan, batchId) },
    { name: "GATE4_gates.md", content: generateGate4Gates(plan, batchId) },
    { name: "GATE5_cleanup.md", content: generateGate5Cleanup(plan, batchId) },
    { name: "SUMMARY.md", content: generateSummary(plan, batchId, planHash, toolchainMarkdown) },
  ];

  for (const deliverable of deliverables) {
    const filePath = path.join(outputDir, deliverable.name);
    fs.writeFileSync(filePath, deliverable.content, "utf-8");
  }
}
