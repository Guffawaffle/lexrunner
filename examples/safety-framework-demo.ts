#!/usr/bin/env node
/**
 * Demo script showing the Enhanced Safety Framework in action
 * This demonstrates all the new features from Issue A8
 */

import {
  SafetyFramework,
  RiskLevel,
  ConfirmationMode,
  type OperationSummary,
} from "../src/autopilot/safety/SafetyFramework.js";

async function demonstrateSafetyFramework() {
  console.log("=".repeat(80));
  console.log("Enhanced Safety Framework Demo - Issue A8");
  console.log("=".repeat(80));
  console.log();

  // Demo 1: Risk Assessment
  console.log("📊 DEMO 1: Risk Assessment");
  console.log("-".repeat(80));
  const safety = new SafetyFramework();

  const operations = [
    { type: "add-comment" as const, description: "Add status comment" },
    { type: "create-branch" as const, description: "Create integration branch" },
    { type: "merge" as const, description: "Merge PR-123", prNumber: 123 },
  ];

  operations.forEach((op) => {
    const risk = safety.assessRiskLevel(op);
    const emoji = risk === RiskLevel.High ? "🚨" : risk === RiskLevel.Medium ? "⚠️" : "ℹ️";
    console.log(`${emoji} ${risk.toUpperCase()}: ${op.description}`);
  });
  console.log();

  // Demo 2: Dry-Run Mode
  console.log("🔍 DEMO 2: Dry-Run Mode");
  console.log("-".repeat(80));
  const dryRunSafety = new SafetyFramework(undefined, {
    confirmationMode: ConfirmationMode.DryRun,
  });

  const summary: OperationSummary = {
    autopilotLevel: 4,
    mergeOperations: [
      { type: "merge", description: "Merge PR-101: Core refactor", prNumber: 101 },
      { type: "merge", description: "Merge PR-102: Database migration", prNumber: 102 },
      { type: "push", description: "Push to main branch" },
    ],
    prOperations: [],
    affectedPRs: [101, 102],
    riskLevel: RiskLevel.High,
  };

  const dryRunResult = await dryRunSafety.confirmOperation(summary);
  console.log(`Result: confirmed=${dryRunResult.confirmed}, reason="${dryRunResult.reason}"`);
  console.log();

  // Demo 3: Safety Policies
  console.log("⚙️  DEMO 3: Configurable Safety Policies");
  console.log("-".repeat(80));
  const customSafety = new SafetyFramework(undefined, {
    confirmationThreshold: RiskLevel.High, // Only confirm high-risk ops
    confirmationMode: ConfirmationMode.Automatic,
    promptTimeout: 60,
    timeoutAction: "abort",
  });

  const policy = customSafety.getPolicy();
  console.log("Policy Configuration:");
  console.log(`  • Confirmation Threshold: ${policy.confirmationThreshold.toUpperCase()}`);
  console.log(`  • Confirmation Mode: ${policy.confirmationMode}`);
  console.log(`  • Prompt Timeout: ${policy.promptTimeout}s`);
  console.log(`  • Timeout Action: ${policy.timeoutAction}`);
  console.log();

  // Demo 4: Kill Switch
  console.log("🛑 DEMO 4: Kill Switch (Signal Handling)");
  console.log("-".repeat(80));
  const killSwitchSafety = new SafetyFramework();
  killSwitchSafety.installKillSwitch();
  console.log("Kill switch installed - handles SIGINT/SIGTERM");

  // Programmatic abort
  killSwitchSafety.requestAbort();
  console.log(`Abort requested: ${killSwitchSafety.isAbortRequested()}`);
  console.log();

  // Demo 5: Audit Trail
  console.log("📝 DEMO 5: Audit Trail Logging");
  console.log("-".repeat(80));
  safety.logSafetyDecision("containment-check", "passed", {
    prNumbers: [123, 456],
    targetBranch: "main",
  });
  safety.logSafetyDecision("confirmation", "user-approved", {
    autopilotLevel: 3,
    operationCount: 5,
  });
  console.log();

  // Demo 6: Risk-Based Operation Assessment
  console.log("🎯 DEMO 6: Overall Risk Assessment");
  console.log("-".repeat(80));
  const lowRiskSummary: OperationSummary = {
    autopilotLevel: 2,
    mergeOperations: [],
    prOperations: [{ type: "add-comment", description: "Post status comment" }],
    affectedPRs: [123],
  };

  const lowRisk = safety.assessOperationRisk(lowRiskSummary);
  console.log(`Low-risk operation set: ${lowRisk.toUpperCase()}`);

  const highRisk = safety.assessOperationRisk(summary);
  console.log(`High-risk operation set: ${highRisk.toUpperCase()}`);
  console.log();

  console.log("=".repeat(80));
  console.log("Demo Complete! All Issue A8 features demonstrated.");
  console.log("=".repeat(80));
}

// Run demo
demonstrateSafetyFramework().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
