/**
 * Configuration path resolution with runner/ subdirectory support
 * Provides new→legacy fallback pattern for config files
 */

import * as fs from "fs";
import * as path from "path";

export interface ResolvedConfigPath {
	/** Absolute path to the config file */
	path: string;
	/** Whether the file exists at the resolved path */
	exists: boolean;
	/** Source pattern used: "runner/" or "flat (legacy)" */
	source: "runner/" | "flat (legacy)";
	/** Whether a legacy migration notice should be shown */
	shouldNotifyMigration: boolean;
}

// Track if we've already shown the migration notice in this process
let migrationNoticeShown = false;

/**
 * Resolve configuration file path with runner/ subdirectory support
 * 
 * Tries paths in this order:
 * 1. profileDir/runner/{fileName} (new structure)
 * 2. profileDir/{fileName} (legacy flat structure)
 * 
 * @param profileDir - Base profile directory
 * @param fileName - Configuration file name
 * @returns Resolved path information
 */
export function resolveConfigPath(
	profileDir: string,
	fileName: string
): ResolvedConfigPath {
	// Try new structure first (runner/)
	const runnerPath = path.join(profileDir, "runner", fileName);
	if (fs.existsSync(runnerPath)) {
		return {
			path: runnerPath,
			exists: true,
			source: "runner/",
			shouldNotifyMigration: false
		};
	}

	// Fallback to legacy flat structure
	const flatPath = path.join(profileDir, fileName);
	const exists = fs.existsSync(flatPath);
	
	// Only show migration notice once per process and only if legacy file exists
	const shouldNotify = exists && !migrationNoticeShown;
	if (shouldNotify) {
		migrationNoticeShown = true;
	}

	return {
		path: flatPath,
		exists,
		source: "flat (legacy)",
		shouldNotifyMigration: shouldNotify
	};
}

/**
 * Show one-time migration notice to stderr
 */
export function showMigrationNotice(): void {
	console.error("⚠️  Legacy flat structure detected. Consider migrating with: lex-pr migrate-profile --from-flat");
}

/**
 * Reset migration notice state (useful for testing)
 */
export function resetMigrationNotice(): void {
	migrationNoticeShown = false;
}

/**
 * Log path resolution for telemetry
 * 
 * @param operation - Operation name (e.g., "loadScope")
 * @param resolved - Resolved path information
 */
export function logPathResolution(
	operation: string,
	resolved: ResolvedConfigPath
): void {
	const logEntry = {
		timestamp: new Date().toISOString(),
		level: resolved.source === "flat (legacy)" ? "warn" : "info",
		module: "config/pathResolver",
		operation,
		path_source: resolved.source,
		path: resolved.path,
		...(resolved.source === "flat (legacy)" && {
			message: "Using legacy flat structure. Run 'lex-pr migrate-profile --from-flat' to migrate."
		})
	};

	// Only log to stderr in non-JSON mode to avoid polluting stdout
	if (!process.env.LEX_JSON_MODE) {
		console.error(JSON.stringify(logEntry));
	}
}
