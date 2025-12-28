#!/usr/bin/env tsx
/**
 * Validate all executor manifests against the schema
 *
 * This script:
 * 1. Finds all executor-manifest.yaml files in the executors/ directory
 * 2. Validates each against the ExecutorManifestSchema
 * 3. Reports errors with manifest path + validation details
 * 4. Exits with code 1 if any validation fails
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYAML } from "yaml";
import { safeParseExecutorManifest } from "../src/schemas/executorManifest.js";

interface ValidationResult {
  path: string;
  success: boolean;
  errors?: string[];
}

/**
 * Recursively find all executor-manifest.yaml files
 */
function findManifestsRecursive(dir: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findManifestsRecursive(fullPath, results);
    } else if (entry.isFile() && entry.name === "executor-manifest.yaml") {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Find all executor manifest files
 */
function findManifests(): string[] {
  const executorsDir = path.join(process.cwd(), "executors");

  if (!fs.existsSync(executorsDir)) {
    return [];
  }

  return findManifestsRecursive(executorsDir);
}

/**
 * Validate a single manifest file
 */
function validateManifest(manifestPath: string): ValidationResult {
  try {
    // Read and parse YAML
    const content = fs.readFileSync(manifestPath, "utf-8");
    const data = parseYAML(content);

    // Validate against schema
    const result = safeParseExecutorManifest(data);

    if (!result.success) {
      // Extract error messages from Zod error
      const errors = result.error.errors.map((err) => {
        const path = err.path.join(".");
        return `  ${path}: ${err.message}`;
      });

      return {
        path: manifestPath,
        success: false,
        errors,
      };
    }

    // Additional validation: check tool budget consistency
    const manifest = result.data;
    const budgetErrors: string[] = [];

    // Check for overlapping allowed/denied tools
    if (manifest.toolBudget.allowed && manifest.toolBudget.denied) {
      const allowed = new Set(manifest.toolBudget.allowed);
      const denied = new Set(manifest.toolBudget.denied);

      const overlap = [...allowed].filter((tool) => denied.has(tool));
      if (overlap.length > 0) {
        budgetErrors.push(
          `  toolBudget: Tools cannot be both allowed and denied: ${overlap.join(", ")}`
        );
      }
    }

    // Check guardrail profile completeness
    if (manifest.guardrails) {
      // Validate that required tools in guardrails.tool are in allowed list
      if (manifest.guardrails.tool?.required) {
        const allowed = new Set(manifest.toolBudget.allowed || []);
        const missingTools = manifest.guardrails.tool.required.filter((tool) => !allowed.has(tool));

        if (missingTools.length > 0) {
          budgetErrors.push(
            `  guardrails.tool.required: Required tools not in allowed list: ${missingTools.join(", ")}`
          );
        }
      }
    }

    if (budgetErrors.length > 0) {
      return {
        path: manifestPath,
        success: false,
        errors: budgetErrors,
      };
    }

    return {
      path: manifestPath,
      success: true,
    };
  } catch (error) {
    return {
      path: manifestPath,
      success: false,
      errors: [`  Parse error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Main validation function
 */
function main(): void {
  console.log("🔍 Validating executor manifests...\n");

  const manifests = findManifests();

  if (manifests.length === 0) {
    console.log("⚠️  No executor manifests found in executors/ directory");
    process.exit(1);
  }

  console.log(`Found ${manifests.length} manifest(s) to validate:\n`);

  const results: ValidationResult[] = [];

  for (const manifestPath of manifests) {
    const relativePath = path.relative(process.cwd(), manifestPath);
    const result = validateManifest(manifestPath);
    results.push(result);

    if (result.success) {
      console.log(`✅ ${relativePath}`);
    } else {
      console.log(`❌ ${relativePath}`);
      if (result.errors) {
        result.errors.forEach((err) => console.log(err));
      }
      console.log();
    }
  }

  const failedCount = results.filter((r) => !r.success).length;

  console.log();
  if (failedCount === 0) {
    console.log(`✅ All ${manifests.length} manifest(s) are valid`);
    process.exit(0);
  } else {
    console.log(`❌ ${failedCount} of ${manifests.length} manifest(s) failed validation`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url.startsWith("file:")) {
  const modulePath = new URL(import.meta.url).pathname;
  const scriptPath = process.argv[1];
  if (modulePath === scriptPath || modulePath === scriptPath + ".ts") {
    main();
  }
}

export { findManifests, validateManifest, main };
