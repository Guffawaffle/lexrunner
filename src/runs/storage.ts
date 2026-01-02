/**
 * Run Storage Utilities
 *
 * File I/O helpers for atomic writes and run persistence.
 * Handles storage in .lexrunner/runs/ directory.
 */

import * as fs from "fs";
import * as path from "path";
import type { RunState, RunIndex, RunIndexEntry } from "./types.js";

/** Default runs directory relative to cwd */
const DEFAULT_RUNS_DIR = ".lexrunner/runs";

/** Schema version for index file */
const INDEX_SCHEMA_VERSION = "1.0.0";

/**
 * Get the runs directory path
 */
export function getRunsDir(baseDir: string = process.cwd()): string {
  return path.join(baseDir, DEFAULT_RUNS_DIR);
}

/**
 * Ensure the runs directory exists
 */
export function ensureRunsDir(baseDir: string = process.cwd()): string {
  const runsDir = getRunsDir(baseDir);
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  return runsDir;
}

/**
 * Get the path for a run state file
 */
export function getRunStatePath(runId: string, baseDir: string = process.cwd()): string {
  const runsDir = getRunsDir(baseDir);
  return path.join(runsDir, `${runId}.json`);
}

/**
 * Get the path for a run's directory (for artifacts, logs, etc.)
 */
export function getRunDir(runId: string, baseDir: string = process.cwd()): string {
  const runsDir = getRunsDir(baseDir);
  return path.join(runsDir, runId);
}

/**
 * Get the path for the run index file
 */
export function getIndexPath(baseDir: string = process.cwd()): string {
  const runsDir = getRunsDir(baseDir);
  return path.join(runsDir, "index.json");
}

/**
 * Write run state atomically
 *
 * Uses write-to-temp + rename pattern to prevent partial writes
 */
export function writeRunState(runState: RunState, baseDir: string = process.cwd()): void {
  const runsDir = ensureRunsDir(baseDir);
  const statePath = getRunStatePath(runState.runId, baseDir);
  const tempPath = path.join(runsDir, `.${runState.runId}.tmp`);

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(runState, null, 2), "utf-8");
    // Atomic rename
    fs.renameSync(tempPath, statePath);
  } catch (error) {
    // Clean up temp file on failure
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Read run state from disk
 *
 * @returns RunState if found, null if not found
 * @throws on parse error
 */
export function readRunState(runId: string, baseDir: string = process.cwd()): RunState | null {
  const statePath = getRunStatePath(runId, baseDir);

  if (!fs.existsSync(statePath)) {
    return null;
  }

  const content = fs.readFileSync(statePath, "utf-8");
  return JSON.parse(content) as RunState;
}

/**
 * Delete run state and associated directory
 */
export function deleteRunState(runId: string, baseDir: string = process.cwd()): boolean {
  const statePath = getRunStatePath(runId, baseDir);
  const runDir = getRunDir(runId, baseDir);

  let deleted = false;

  // Delete state file
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
    deleted = true;
  }

  // Delete run directory if it exists
  if (fs.existsSync(runDir)) {
    fs.rmSync(runDir, { recursive: true, force: true });
    deleted = true;
  }

  return deleted;
}

/**
 * Read the run index
 *
 * @returns RunIndex if found, empty index if not
 */
export function readIndex(baseDir: string = process.cwd()): RunIndex {
  const indexPath = getIndexPath(baseDir);

  if (!fs.existsSync(indexPath)) {
    return {
      schemaVersion: INDEX_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      runs: [],
    };
  }

  const content = fs.readFileSync(indexPath, "utf-8");
  return JSON.parse(content) as RunIndex;
}

/**
 * Write the run index atomically
 */
export function writeIndex(index: RunIndex, baseDir: string = process.cwd()): void {
  const runsDir = ensureRunsDir(baseDir);
  const indexPath = getIndexPath(baseDir);
  const tempPath = path.join(runsDir, ".index.tmp");

  // Update timestamp
  index.updatedAt = new Date().toISOString();
  index.schemaVersion = INDEX_SCHEMA_VERSION;

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(index, null, 2), "utf-8");
    // Atomic rename
    fs.renameSync(tempPath, indexPath);
  } catch (error) {
    // Clean up temp file on failure
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Add or update a run in the index
 */
export function upsertIndexEntry(entry: RunIndexEntry, baseDir: string = process.cwd()): void {
  const index = readIndex(baseDir);

  // Find existing entry
  const existingIdx = index.runs.findIndex((r) => r.runId === entry.runId);

  if (existingIdx >= 0) {
    // Update existing
    index.runs[existingIdx] = entry;
  } else {
    // Add new
    index.runs.push(entry);
  }

  // Sort by createdAt descending (most recent first)
  index.runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  writeIndex(index, baseDir);
}

/**
 * Remove a run from the index
 */
export function removeIndexEntry(runId: string, baseDir: string = process.cwd()): boolean {
  const index = readIndex(baseDir);

  const initialLength = index.runs.length;
  index.runs = index.runs.filter((r) => r.runId !== runId);

  if (index.runs.length < initialLength) {
    writeIndex(index, baseDir);
    return true;
  }

  return false;
}

/**
 * Create run directory structure (for artifacts, logs, etc.)
 */
export function ensureRunDir(runId: string, baseDir: string = process.cwd()): string {
  const runDir = getRunDir(runId, baseDir);

  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  // Create subdirectories
  const artifactsDir = path.join(runDir, "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  return runDir;
}

/**
 * Append to a run's NDJSON log file
 */
export function appendToRunLog(
  runId: string,
  logName: string,
  entry: Record<string, unknown>,
  baseDir: string = process.cwd()
): void {
  const runDir = ensureRunDir(runId, baseDir);
  const logPath = path.join(runDir, `${logName}.ndjson`);

  // Add timestamp if not present
  if (!entry.ts) {
    entry.ts = new Date().toISOString();
  }

  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(logPath, line, "utf-8");
}

/**
 * Read entries from a run's NDJSON log file
 */
export function readRunLog(
  runId: string,
  logName: string,
  baseDir: string = process.cwd()
): Array<Record<string, unknown>> {
  const runDir = getRunDir(runId, baseDir);
  const logPath = path.join(runDir, `${logName}.ndjson`);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Write attributions to a run's attribution log (LR-TSF-001)
 */
export function writeAttributions(
  runId: string,
  attributions: Array<{
    timestamp: string;
    constraintId: string;
    action: string;
    target?: string;
    source: string;
    statement: string;
  }>,
  baseDir: string = process.cwd()
): void {
  for (const attribution of attributions) {
    appendToRunLog(runId, "attributions", attribution, baseDir);
  }
}
