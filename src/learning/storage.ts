/**
 * Storage Management for Counter-Examples - LR-TSF-003
 *
 * Handles persisting counter-examples to disk and maintaining an index.
 */

import * as fs from "fs";
import * as path from "path";
import type { CounterExample } from "./counter-example.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

/**
 * Counter-example index entry
 */
export interface CounterExampleIndexEntry {
  id: string;
  timestamp: string;
  failureType: string;
  target: string;
  classificationType: string;
  shouldLearn: boolean;
  filePath: string;
}

/**
 * Counter-example index
 */
export interface CounterExampleIndex {
  version: string;
  entries: CounterExampleIndexEntry[];
}

/**
 * Get the counter-examples directory path
 */
export function getCounterExamplesDir(baseDir: string = process.cwd()): string {
  return path.join(baseDir, ".lexrunner", "counter-examples");
}

/**
 * Ensure counter-examples directory exists
 */
function ensureCounterExamplesDir(baseDir: string = process.cwd()): string {
  const dir = getCounterExamplesDir(baseDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the index file path
 */
function getIndexPath(baseDir: string = process.cwd()): string {
  return path.join(getCounterExamplesDir(baseDir), "index.json");
}

/**
 * Load the counter-example index
 */
function loadIndex(baseDir: string = process.cwd()): CounterExampleIndex {
  const indexPath = getIndexPath(baseDir);
  if (!fs.existsSync(indexPath)) {
    return {
      version: "1.0.0",
      entries: [],
    };
  }

  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Failed to load counter-example index: ${error}`);
    return {
      version: "1.0.0",
      entries: [],
    };
  }
}

/**
 * Save the counter-example index
 */
function saveIndex(index: CounterExampleIndex, baseDir: string = process.cwd()): void {
  const indexPath = getIndexPath(baseDir);
  const content = canonicalJSONStringify(index);
  fs.writeFileSync(indexPath, content, "utf-8");
}

/**
 * Generate a filename for a counter-example
 */
function generateFileName(counterExample: CounterExample): string {
  const date = new Date(counterExample.timestamp).toISOString().split("T")[0];
  const target = counterExample.failure.target.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const type = counterExample.failure.type;
  return `${date}-${target}-${type}.json`;
}

/**
 * Store a counter-example to disk
 */
export function storeCounterExample(
  counterExample: CounterExample,
  baseDir: string = process.cwd()
): string {
  // Ensure directory exists
  const dir = ensureCounterExamplesDir(baseDir);

  // Generate filename
  const fileName = generateFileName(counterExample);
  const filePath = path.join(dir, fileName);

  // Write counter-example file
  const content = canonicalJSONStringify(counterExample);
  fs.writeFileSync(filePath, content, "utf-8");

  // Update index
  const index = loadIndex(baseDir);
  const indexEntry: CounterExampleIndexEntry = {
    id: counterExample.id,
    timestamp: counterExample.timestamp,
    failureType: counterExample.failure.type,
    target: counterExample.failure.target,
    classificationType: counterExample.classification.type,
    shouldLearn: counterExample.shouldLearn,
    filePath: fileName,
  };

  // Remove existing entry with same ID if present
  index.entries = index.entries.filter((e) => e.id !== counterExample.id);
  index.entries.push(indexEntry);

  // Sort entries by timestamp (newest first)
  index.entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  saveIndex(index, baseDir);

  console.log(`✓ Recorded counter-example: ${counterExample.classification.type}`);
  console.log(`  Stored in: ${filePath}`);

  return filePath;
}

/**
 * List all counter-examples
 */
export function listCounterExamples(baseDir: string = process.cwd()): CounterExampleIndexEntry[] {
  const index = loadIndex(baseDir);
  return index.entries;
}

/**
 * Load a specific counter-example by ID
 */
export function loadCounterExample(
  id: string,
  baseDir: string = process.cwd()
): CounterExample | null {
  const index = loadIndex(baseDir);
  const entry = index.entries.find((e) => e.id === id);

  if (!entry) {
    return null;
  }

  const filePath = path.join(getCounterExamplesDir(baseDir), entry.filePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Failed to load counter-example ${id}: ${error}`);
    return null;
  }
}

/**
 * Export counter-examples in various formats
 */
export function exportCounterExamples(
  format: "json" | "csv",
  baseDir: string = process.cwd()
): string {
  const index = loadIndex(baseDir);

  if (format === "json") {
    return canonicalJSONStringify(index);
  }

  // CSV format
  const lines: string[] = [
    "ID,Timestamp,Failure Type,Target,Classification,Should Learn,File Path",
  ];

  for (const entry of index.entries) {
    lines.push(
      [
        entry.id,
        entry.timestamp,
        entry.failureType,
        entry.target,
        entry.classificationType,
        entry.shouldLearn.toString(),
        entry.filePath,
      ].join(",")
    );
  }

  return lines.join("\n");
}
