/**
 * Plan history and versioning module
 * Handles save/load/restore of plan versions
 */

import * as fs from "fs";
import * as path from "path";
import { Plan } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

export interface PlanVersion {
  version: number;
  timestamp: string;
  plan: Plan;
  author?: string;
  message?: string;
  approved?: boolean;
  changes?: string[];
}

export interface PlanHistory {
  versions: PlanVersion[];
  current: number;
}

/**
 * Save a plan version to history
 */
export function savePlanVersion(
  historyPath: string,
  plan: Plan,
  metadata?: {
    author?: string;
    message?: string;
    approved?: boolean;
    changes?: string[];
  }
): PlanVersion {
  const history = loadPlanHistory(historyPath);

  const version: PlanVersion = {
    version: history.versions.length + 1,
    timestamp: new Date().toISOString(),
    plan,
    ...metadata,
  };

  history.versions.push(version);
  history.current = version.version;

  // Save history file
  fs.writeFileSync(historyPath, canonicalJSONStringify(history), "utf-8");

  return version;
}

/**
 * Load plan history from file
 */
export function loadPlanHistory(historyPath: string): PlanHistory {
  if (!fs.existsSync(historyPath)) {
    return {
      versions: [],
      current: 0,
    };
  }

  try {
    const content = fs.readFileSync(historyPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    return {
      versions: [],
      current: 0,
    };
  }
}

/**
 * Get a specific plan version
 */
export function getPlanVersion(historyPath: string, version: number): PlanVersion | null {
  const history = loadPlanHistory(historyPath);
  return history.versions.find((v) => v.version === version) || null;
}

/**
 * Get the current plan version
 */
export function getCurrentPlan(historyPath: string): Plan | null {
  const history = loadPlanHistory(historyPath);
  if (history.current === 0 || history.versions.length === 0) {
    return null;
  }

  const current = history.versions.find((v) => v.version === history.current);
  return current ? current.plan : null;
}

/**
 * List all plan versions
 */
export function listPlanVersions(historyPath: string): PlanVersion[] {
  const history = loadPlanHistory(historyPath);
  return history.versions;
}

/**
 * Restore a specific plan version
 */
export function restorePlanVersion(historyPath: string, version: number): Plan | null {
  const history = loadPlanHistory(historyPath);
  const planVersion = history.versions.find((v) => v.version === version);

  if (!planVersion) {
    return null;
  }

  history.current = version;
  fs.writeFileSync(historyPath, canonicalJSONStringify(history), "utf-8");

  return planVersion.plan;
}

/**
 * Save plan to file with metadata
 */
export function savePlanToFile(
  planPath: string,
  plan: Plan,
  options?: {
    createBackup?: boolean;
    metadata?: {
      author?: string;
      approved?: boolean;
      changes?: string[];
    };
  }
): void {
  const { createBackup = false, metadata } = options || {};

  // Create backup if requested
  if (createBackup && fs.existsSync(planPath)) {
    const backupPath = `${planPath}.backup-${Date.now()}`;
    fs.copyFileSync(planPath, backupPath);
  }

  // Save plan
  const planContent = canonicalJSONStringify(plan);
  fs.writeFileSync(planPath, planContent, "utf-8");

  // Save metadata if provided
  if (metadata) {
    const metadataPath = `${planPath}.meta`;
    const metadataContent = canonicalJSONStringify({
      timestamp: new Date().toISOString(),
      ...metadata,
    });
    fs.writeFileSync(metadataPath, metadataContent, "utf-8");
  }
}

/**
 * Load plan from file with metadata
 */
export function loadPlanFromFile(planPath: string): {
  plan: Plan;
  metadata?: any;
} {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  const planContent = fs.readFileSync(planPath, "utf-8");
  const plan = JSON.parse(planContent) as Plan;

  // Load metadata if exists
  const metadataPath = `${planPath}.meta`;
  let metadata;
  if (fs.existsSync(metadataPath)) {
    const metadataContent = fs.readFileSync(metadataPath, "utf-8");
    metadata = JSON.parse(metadataContent);
  }

  return { plan, metadata };
}

/**
 * Get plan history directory
 */
export function getPlanHistoryDir(profileDir: string): string {
  const historyDir = path.join(profileDir, "runner", "plan-history");
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  return historyDir;
}

/**
 * Get plan history file path
 */
export function getPlanHistoryPath(profileDir: string, planName: string = "default"): string {
  const historyDir = getPlanHistoryDir(profileDir);
  return path.join(historyDir, `${planName}.history.json`);
}
