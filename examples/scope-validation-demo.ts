/**
 * Example: Scope Validation in Action
 *
 * This example demonstrates how the scope validator prevents agents from making
 * unintended modifications to code, particularly in legacy AMD/UMD modules.
 */

import {
  validateEditScope,
  analyzeFileScope,
  ScopeValidationError,
} from "../src/planner/scopeValidator.js";
import * as fs from "fs";
import * as path from "path";

// Example 1: Analyze a file's scope
async function example1_analyzeScope() {
  console.log("=== Example 1: Analyze File Scope ===\n");

  const testFile = path.join(process.cwd(), ".test-scope-example", "payment.js");
  fs.mkdirSync(path.dirname(testFile), { recursive: true });

  fs.writeFileSync(
    testFile,
    `
define(['dep'], function(dep) {
  window.DEBUG_MODE = true;  // Global side effect

  function processPayment(amount) {
    return amount * 1.1;
  }

  function auditLog(msg) {
    console.log('AUDIT:', msg);
  }

  return { processPayment, auditLog };
});
  `
  );

  const scope = await analyzeFileScope(testFile);
  console.log("File analysis result:");
  console.log(JSON.stringify(scope, null, 2));
  console.log("\n✅ Analysis complete\n");

  fs.rmSync(path.dirname(testFile), { recursive: true, force: true });
}

// Example 2: Validation passes - agent declares all changes
async function example2_validationPasses() {
  console.log("=== Example 2: Validation Passes ===\n");

  const testFile = path.join(process.cwd(), ".test-scope-example", "valid.ts");
  fs.mkdirSync(path.dirname(testFile), { recursive: true });

  fs.writeFileSync(
    testFile,
    `
export function add(a: number, b: number): number {
  return a + b;
}
  `
  );

  const declaredPlan = {
    functions_modified: ["add"],
    side_effects: "none" as const,
    globals_written: [],
  };

  try {
    const result = await validateEditScope(testFile, declaredPlan);
    console.log("✅ Validation passed!");
    console.log("Scope validated:", result.scope_validated);
    console.log("Violations:", result.violations?.length || 0);
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }

  console.log();
  fs.rmSync(path.dirname(testFile), { recursive: true, force: true });
}

// Example 3: Validation fails - undeclared modifications detected
async function example3_validationFails() {
  console.log("=== Example 3: Validation Fails (Issue Scenario) ===\n");

  const testFile = path.join(process.cwd(), ".test-scope-example", "unsafe.js");
  fs.mkdirSync(path.dirname(testFile), { recursive: true });

  fs.writeFileSync(
    testFile,
    `
define(['dep'], function(dep) {
  window.DEBUG_MODE = true;  // ❌ UNDECLARED GLOBAL

  function processPayment(amount) {
    return amount * 1.1;
  }

  function auditLog(msg) {  // ❌ UNDECLARED FUNCTION
    console.log('AUDIT:', msg);
  }

  return { processPayment, auditLog };
});
  `
  );

  // Agent claims to only modify processPayment
  const declaredPlan = {
    functions_modified: ["processPayment"],
    side_effects: "none" as const,
    globals_written: [],
  };

  try {
    await validateEditScope(testFile, declaredPlan);
    console.log("⚠️  Validation unexpectedly passed");
  } catch (error) {
    if (error instanceof ScopeValidationError) {
      console.log("❌ Validation failed (as expected)!");
      console.log("\nViolations detected:");
      error.violations?.forEach((v, i) => {
        console.log(`  ${i + 1}. ${v.type}: ${v.message}`);
      });
      console.log("\nError message:");
      console.log(error.message);
    }
  }

  console.log();
  fs.rmSync(path.dirname(testFile), { recursive: true, force: true });
}

// Example 4: Global writes are explicitly declared
async function example4_declaredGlobals() {
  console.log("=== Example 4: Declared Global Writes (Pass) ===\n");

  const testFile = path.join(process.cwd(), ".test-scope-example", "config.js");
  fs.mkdirSync(path.dirname(testFile), { recursive: true });

  fs.writeFileSync(
    testFile,
    `
window.APP_CONFIG = { debug: true };

function initApp() {
  return window.APP_CONFIG;
}
  `
  );

  const declaredPlan = {
    functions_modified: ["initApp"],
    side_effects: "global" as const,
    globals_written: ["window.APP_CONFIG"],
  };

  try {
    const result = await validateEditScope(testFile, declaredPlan);
    console.log("✅ Validation passed with declared globals!");
    console.log("Module system:", result.module_system);
    console.log("Side effects:", result.side_effects);
    console.log("Globals written:", result.globals_written);
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }

  console.log();
  fs.rmSync(path.dirname(testFile), { recursive: true, force: true });
}

// Run all examples
async function runExamples() {
  console.log("🔍 Scope Validation Examples\n");
  console.log("=".repeat(60) + "\n");

  await example1_analyzeScope();
  await example2_validationPasses();
  await example3_validationFails();
  await example4_declaredGlobals();

  console.log("=".repeat(60));
  console.log("\n✨ All examples completed!\n");
}

// Run if executed directly
if (import.meta.url.endsWith(process.argv[1])) {
  runExamples().catch(console.error);
}

export {
  example1_analyzeScope,
  example2_validationPasses,
  example3_validationFails,
  example4_declaredGlobals,
};
