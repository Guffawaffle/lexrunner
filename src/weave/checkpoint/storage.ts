/**
 * Checkpoint storage layer - file-based persistence for merge-weave state
 */

import fs from "fs";
import path from "path";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import type {
  WeaveCheckpoint,
  CheckpointListEntry,
  SaveCheckpointOptions,
  LoadCheckpointOptions,
  ListCheckpointsOptions,
  CleanupResult,
} from "./types.js";

/**
 * Default checkpoint directory relative to workspace root
 */
export const DEFAULT_CHECKPOINT_DIR = ".lexrunner/checkpoints";

/**
 * Checkpoint retention period in days
 */
export const CHECKPOINT_RETENTION_DAYS = 7;

/**
 * Get the default checkpoint directory path
 */
export function getDefaultCheckpointDir(): string {
  return path.join(process.cwd(), DEFAULT_CHECKPOINT_DIR);
}

/**
 * Ensure checkpoint directory exists
 */
export function ensureCheckpointDir(checkpointDir?: string): string {
  const dir = checkpointDir || getDefaultCheckpointDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get checkpoint file path for a run ID
 */
export function getCheckpointPath(runId: string, checkpointDir?: string): string {
  const dir = ensureCheckpointDir(checkpointDir);
  return path.join(dir, `${runId}.json`);
}

/**
 * Save a checkpoint to disk
 */
export async function saveCheckpoint(
  checkpoint: WeaveCheckpoint,
  options: SaveCheckpointOptions = {}
): Promise<void> {
  const checkpointPath = getCheckpointPath(checkpoint.runId, options.checkpointDir);
  const json = canonicalJSONStringify(checkpoint);

  fs.writeFileSync(checkpointPath, json + "\n", "utf-8");

  // Run cleanup unless explicitly skipped
  if (!options.skipCleanup) {
    await cleanupOldCheckpoints(options.checkpointDir);
  }
}

/**
 * Load a checkpoint from disk
 */
export async function loadCheckpoint(
  runId: string,
  options: LoadCheckpointOptions = {}
): Promise<WeaveCheckpoint> {
  const checkpointPath = getCheckpointPath(runId, options.checkpointDir);

  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`Checkpoint not found for run ID: ${runId}`);
  }

  const json = fs.readFileSync(checkpointPath, "utf-8");
  const checkpoint: WeaveCheckpoint = JSON.parse(json);

  // Validate plan hash if requested (default: true)
  const shouldValidate = options.validatePlanHash !== false;
  if (shouldValidate && options.expectedPlanHash) {
    if (checkpoint.planHash !== options.expectedPlanHash) {
      throw new Error(
        `Plan hash mismatch: checkpoint has ${checkpoint.planHash}, expected ${options.expectedPlanHash}`
      );
    }
  }

  return checkpoint;
}

/**
 * List all checkpoints
 */
export async function listCheckpoints(
  options: ListCheckpointsOptions = {}
): Promise<CheckpointListEntry[]> {
  const dir = ensureCheckpointDir(options.checkpointDir);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const entries: CheckpointListEntry[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const json = fs.readFileSync(filePath, "utf-8");
      const checkpoint: WeaveCheckpoint = JSON.parse(json);

      // Apply filters
      if (options.phase && checkpoint.phase !== options.phase) {
        continue;
      }
      if (options.state && checkpoint.state !== options.state) {
        continue;
      }

      entries.push({
        runId: checkpoint.runId,
        timestamp: checkpoint.timestamp,
        phase: checkpoint.phase,
        state: checkpoint.state,
        completedItems: checkpoint.completedItems.length,
        pendingItems: checkpoint.pendingItems.length,
        failedItems: checkpoint.failedItems.length,
        startedAt: checkpoint.startedAt,
      });
    } catch (error) {
      // Skip malformed checkpoint files
      console.warn(`Warning: Failed to parse checkpoint file ${file}:`, error);
    }
  }

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply limit if specified
  if (options.limit && options.limit > 0) {
    return entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Get the most recent checkpoint
 */
export async function getLatestCheckpoint(checkpointDir?: string): Promise<WeaveCheckpoint | null> {
  const entries = await listCheckpoints({ checkpointDir, limit: 1 });

  if (entries.length === 0) {
    return null;
  }

  return loadCheckpoint(entries[0].runId, { checkpointDir });
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(runId: string, checkpointDir?: string): Promise<boolean> {
  const checkpointPath = getCheckpointPath(runId, checkpointDir);

  if (!fs.existsSync(checkpointPath)) {
    return false;
  }

  fs.unlinkSync(checkpointPath);
  return true;
}

/**
 * Clean up old checkpoints based on retention policy
 */
export async function cleanupOldCheckpoints(checkpointDir?: string): Promise<CleanupResult> {
  const dir = ensureCheckpointDir(checkpointDir);
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const entries = await listCheckpoints({ checkpointDir });
  const removedRunIds: string[] = [];
  let removed = 0;
  let retained = 0;

  for (const entry of entries) {
    const checkpointDate = new Date(entry.timestamp);

    if (checkpointDate < cutoffDate) {
      const deleted = await deleteCheckpoint(entry.runId, checkpointDir);
      if (deleted) {
        removedRunIds.push(entry.runId);
        removed++;
      }
    } else {
      retained++;
    }
  }

  return {
    removed,
    retained,
    removedRunIds,
  };
}

/**
 * Check if a checkpoint exists
 */
export function checkpointExists(runId: string, checkpointDir?: string): boolean {
  const checkpointPath = getCheckpointPath(runId, checkpointDir);
  return fs.existsSync(checkpointPath);
}
