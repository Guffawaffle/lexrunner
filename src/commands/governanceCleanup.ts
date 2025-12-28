/**
 * governance:cleanup command - Manual log retention cleanup
 * QOL-002: Provides CLI interface for cleaning up old governance logs
 */

import { Command } from "commander";
import type { Command as CommanderProgram } from "commander";
import { cleanupOldLogs, enforceRetentionPolicy, getGovernanceLogsDir } from "../lexsona/logger.js";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Get current logs directory stats
 */
function getLogsStats(): {
  count: number;
  totalSizeMB: number;
  oldestDate: Date | null;
  newestDate: Date | null;
} {
  const logsDir = getGovernanceLogsDir();
  if (!existsSync(logsDir)) {
    return { count: 0, totalSizeMB: 0, oldestDate: null, newestDate: null };
  }

  const files = readdirSync(logsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const filePath = join(logsDir, f);
      const stats = statSync(filePath);
      return {
        name: f,
        size: stats.size,
        mtime: stats.mtime,
      };
    });

  if (files.length === 0) {
    return { count: 0, totalSizeMB: 0, oldestDate: null, newestDate: null };
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const oldest = files.reduce((min, f) => (f.mtime < min ? f.mtime : min), files[0].mtime);
  const newest = files.reduce((max, f) => (f.mtime > max ? f.mtime : max), files[0].mtime);

  return {
    count: files.length,
    totalSizeMB: totalSize / (1024 * 1024),
    oldestDate: oldest,
    newestDate: newest,
  };
}

export function createGovernanceCleanupCommand(): Command {
  const cmd = new Command("governance:cleanup");

  cmd
    .description("Clean up old governance logs based on retention policy")
    .option("--max-age <days>", "Delete logs older than this many days", "30")
    .option("--max-size <mb>", "Delete oldest logs if total size exceeds this (MB)", "100")
    .option("--dry-run", "Show what would be deleted without actually deleting")
    .option("--stats", "Show current logs statistics")
    .action(
      async (opts: { maxAge: string; maxSize: string; dryRun?: boolean; stats?: boolean }) => {
        const logsDir = getGovernanceLogsDir();

        // Show stats if requested
        if (opts.stats) {
          const stats = getLogsStats();
          console.log("\n📊 Governance Logs Statistics:");
          console.log(`  Directory: ${logsDir}`);
          console.log(`  Total logs: ${stats.count}`);
          console.log(`  Total size: ${stats.totalSizeMB.toFixed(2)} MB`);
          if (stats.oldestDate) {
            console.log(`  Oldest log: ${stats.oldestDate.toISOString()}`);
          }
          if (stats.newestDate) {
            console.log(`  Newest log: ${stats.newestDate.toISOString()}`);
          }
          console.log("");
          return;
        }

        const maxAgeDays = parseInt(opts.maxAge, 10);
        const maxSizeMB = parseInt(opts.maxSize, 10);

        console.log("\n🧹 Governance Log Cleanup");
        console.log(`  Max age: ${maxAgeDays} days`);
        console.log(`  Max size: ${maxSizeMB} MB`);
        if (opts.dryRun) {
          console.log("  Mode: DRY RUN (no files will be deleted)");
        }
        console.log("");

        // Show stats before cleanup
        const beforeStats = getLogsStats();
        console.log("Before cleanup:");
        console.log(`  Logs: ${beforeStats.count}`);
        console.log(`  Size: ${beforeStats.totalSizeMB.toFixed(2)} MB`);
        console.log("");

        if (opts.dryRun) {
          // Simulate cleanup
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

          const files = existsSync(logsDir)
            ? readdirSync(logsDir)
                .filter((f) => f.endsWith(".json"))
                .map((f) => {
                  const filePath = join(logsDir, f);
                  const stats = statSync(filePath);
                  return {
                    name: f,
                    path: filePath,
                    size: stats.size,
                    mtime: stats.mtime,
                  };
                })
            : [];

          const oldFiles = files.filter((f) => f.mtime < cutoffDate);
          console.log(`Would delete ${oldFiles.length} old logs`);

          // Size-based
          const maxSizeBytes = maxSizeMB * 1024 * 1024;
          const sortedFiles = [...files].sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
          let totalSize = files.reduce((sum, f) => sum + f.size, 0);
          let wouldDeleteSize = 0;

          for (const file of sortedFiles) {
            if (totalSize <= maxSizeBytes) break;
            wouldDeleteSize++;
            totalSize -= file.size;
          }

          if (wouldDeleteSize > 0) {
            console.log(`Would delete ${wouldDeleteSize} logs to meet size limit`);
          }

          return;
        }

        // Actual cleanup
        const deletedAge = await cleanupOldLogs(maxAgeDays);
        const deletedSize = await enforceRetentionPolicy(maxSizeMB);

        console.log("Cleanup complete:");
        console.log(`  Deleted by age: ${deletedAge} logs`);
        console.log(`  Deleted by size: ${deletedSize} logs`);
        console.log("");

        // Show stats after cleanup
        const afterStats = getLogsStats();
        console.log("After cleanup:");
        console.log(`  Logs: ${afterStats.count}`);
        console.log(`  Size: ${afterStats.totalSizeMB.toFixed(2)} MB`);
        console.log("");
      }
    );

  return cmd;
}

/**
 * Register command with CLI program
 */
export function registerGovernanceCleanupCommand(program: CommanderProgram): void {
  const cmd = createGovernanceCleanupCommand();
  program.addCommand(cmd);
}
