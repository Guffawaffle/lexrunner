/**
 * Profile migration command - migrate from flat to runner/ structure
 */

import * as fs from "fs";
import * as path from "path";
import { resolveProfile } from "../config/profileResolver.js";

export interface MigrateProfileOptions {
  fromFlat?: boolean;
  dryRun?: boolean;
  profileDir?: string;
}

export interface MigrateProfileResult {
  success: boolean;
  message: string;
  migratedFiles: string[];
  backupPath?: string;
  skippedFiles: string[];
}

/**
 * Migrate profile from flat structure to runner/ subdirectory
 */
export async function runMigrateProfile(
  options: MigrateProfileOptions = {}
): Promise<MigrateProfileResult> {
  if (!options.fromFlat) {
    return {
      success: false,
      message: "No migration type specified. Use --from-flat to migrate from flat structure.",
      migratedFiles: [],
      skippedFiles: [],
    };
  }

  const baseDir = process.cwd();

  // Resolve profile directory with error handling
  let profileDir: string;
  try {
    const resolved = resolveProfile(options.profileDir, baseDir);
    profileDir = resolved.path;
  } catch (error) {
    return {
      success: false,
      message: `Profile directory error: ${error instanceof Error ? error.message : String(error)}`,
      migratedFiles: [],
      skippedFiles: [],
    };
  }

  // Check if profile directory exists
  if (!fs.existsSync(profileDir)) {
    return {
      success: false,
      message: `Profile directory does not exist: ${profileDir}`,
      migratedFiles: [],
      skippedFiles: [],
    };
  }

  // Files to migrate
  const configFiles = [
    "intent.md",
    "scope.yml",
    "deps.yml",
    "gates.yml",
    "stack.yml",
    "pull-request-template.md",
  ];

  const migratedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const runnerDir = path.join(profileDir, "runner");

  // Check if any files need migration
  const filesToMigrate = configFiles.filter((file) => {
    const flatPath = path.join(profileDir, file);
    const runnerPath = path.join(runnerDir, file);

    // Only migrate if file exists in flat structure and doesn't exist in runner/
    return fs.existsSync(flatPath) && !fs.existsSync(runnerPath);
  });

  if (filesToMigrate.length === 0) {
    // Check if files are already in runner/
    const filesInRunner = configFiles.filter((file) => {
      const runnerPath = path.join(runnerDir, file);
      return fs.existsSync(runnerPath);
    });

    if (filesInRunner.length > 0) {
      return {
        success: true,
        message: "Migration already complete. All config files are in runner/ subdirectory.",
        migratedFiles: [],
        skippedFiles: configFiles,
      };
    }

    return {
      success: true,
      message: "No config files found to migrate.",
      migratedFiles: [],
      skippedFiles: [],
    };
  }

  // Dry run mode - just report what would be done
  if (options.dryRun) {
    return {
      success: true,
      message: `Dry run: Would migrate ${filesToMigrate.length} file(s) to runner/ subdirectory`,
      migratedFiles: filesToMigrate.map((f) => `${f} (would migrate)`),
      skippedFiles,
    };
  }

  // Create backup before migration
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(profileDir, `.backup-${timestamp}`);

  try {
    fs.mkdirSync(backupPath, { recursive: true });

    // Copy files to backup
    for (const file of filesToMigrate) {
      const sourcePath = path.join(profileDir, file);
      const backupFilePath = path.join(backupPath, file);
      fs.copyFileSync(sourcePath, backupFilePath);
    }

    // Create runner/ directory
    fs.mkdirSync(runnerDir, { recursive: true });

    // Move files to runner/
    for (const file of filesToMigrate) {
      const flatPath = path.join(profileDir, file);
      const runnerPath = path.join(runnerDir, file);

      // Move file
      fs.renameSync(flatPath, runnerPath);
      migratedFiles.push(file);
    }

    // Record skipped files (files that already exist in runner/)
    for (const file of configFiles) {
      if (!filesToMigrate.includes(file)) {
        const runnerPath = path.join(runnerDir, file);
        if (fs.existsSync(runnerPath)) {
          skippedFiles.push(`${file} (already in runner/)`);
        }
      }
    }

    return {
      success: true,
      message: `Successfully migrated ${migratedFiles.length} file(s) to runner/ subdirectory`,
      migratedFiles,
      backupPath,
      skippedFiles,
    };
  } catch (error) {
    // Rollback on error
    try {
      for (const file of migratedFiles) {
        const runnerPath = path.join(runnerDir, file);
        const flatPath = path.join(profileDir, file);
        if (fs.existsSync(runnerPath)) {
          fs.renameSync(runnerPath, flatPath);
        }
      }
    } catch (rollbackError) {
      // Rollback failed - backup should still be available
    }

    return {
      success: false,
      message: `Migration failed: ${error instanceof Error ? error.message : String(error)}. Files restored from backup.`,
      migratedFiles: [],
      backupPath,
      skippedFiles,
    };
  }
}
