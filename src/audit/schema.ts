/**
 * Audit event schema versioning and validation
 */

/**
 * Current schema version emitted by this runner.
 * Follows semantic versioning: MAJOR.MINOR.PATCH
 */
export const CURRENT_SCHEMA_VERSION = "1.0.0";

/**
 * Supported major version for compatibility checks
 */
export const SUPPORTED_MAJOR_VERSION = 1;

/**
 * Check if consumer can parse this schema version.
 *
 * @param schemaVersion - Version from audit event (format: "MAJOR.MINOR.PATCH")
 * @param supportedMajor - Major version consumer supports (defaults to current)
 * @returns true if compatible, false if breaking
 *
 * @example
 * ```typescript
 * if (!isSchemaCompatible(event.schema_version, 1)) {
 *   console.warn(`Unsupported schema version: ${event.schema_version}`);
 * }
 * ```
 */
export function isSchemaCompatible(
  schemaVersion: string,
  supportedMajor: number = SUPPORTED_MAJOR_VERSION
): boolean {
  // Parse version string
  const parsed = parseSchemaVersion(schemaVersion);
  if (!parsed) {
    return false;
  }

  // Compatible if major version matches
  return parsed.major === supportedMajor;
}

/**
 * Validate audit event structure (basic validation without JSON Schema).
 * For full JSON Schema validation, use validateAuditEventWithSchema.
 *
 * @param event - Event object to validate
 * @returns Validation result with errors if invalid
 */
export function validateAuditEvent(event: any): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  // Required fields
  const requiredFields = [
    "schema_version",
    "event",
    "ts",
    "session_id",
    "run_id",
    "tool",
    "actor",
    "repo",
    "payload",
  ];

  for (const field of requiredFields) {
    if (!(field in event)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate schema_version format
  if (event.schema_version && typeof event.schema_version === "string") {
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(event.schema_version)) {
      errors.push(
        `Invalid schema_version format: ${event.schema_version} (expected: MAJOR.MINOR.PATCH)`
      );
    }
  }

  // Validate tool structure
  if (event.tool && typeof event.tool === "object") {
    if (!event.tool.name) {
      errors.push("Missing required field: tool.name");
    }
    if (!event.tool.version) {
      errors.push("Missing required field: tool.version");
    }
  }

  // Validate actor structure
  if (event.actor && typeof event.actor === "object") {
    if (!event.actor.type) {
      errors.push("Missing required field: actor.type");
    } else if (!["cli", "mcp", "ci"].includes(event.actor.type)) {
      errors.push(`Invalid actor.type: ${event.actor.type} (expected: cli, mcp, or ci)`);
    }
  }

  // Validate level if present
  if (event.level && !["info", "warn", "error"].includes(event.level)) {
    errors.push(`Invalid level: ${event.level} (expected: info, warn, or error)`);
  }

  return {
    valid: errors.length === 0,
    ...(errors.length > 0 && { errors }),
  };
}

/**
 * Migrate event from old schema version to current.
 * Currently a stub - will be implemented when breaking changes occur.
 *
 * @param event - Event to migrate
 * @param targetVersion - Target schema version (defaults to current)
 * @returns Migrated event
 */
export function migrateEvent(event: any, targetVersion: string = CURRENT_SCHEMA_VERSION): any {
  // Currently no migrations needed - all events are v1.0.0
  // Future migrations will be added here when breaking changes occur

  // Example for future v1 -> v2 migration:
  // if (event.schema_version.startsWith('1.') && targetVersion.startsWith('2.')) {
  //   const migrated = { ...event };
  //   // Apply breaking changes migration
  //   migrated.schema_version = targetVersion;
  //   return migrated;
  // }

  return event;
}

/**
 * Parse schema version into components
 *
 * @param version - Version string (MAJOR.MINOR.PATCH)
 * @returns Parsed version components or null if invalid
 */
export function parseSchemaVersion(
  version: string
): { major: number; minor: number; patch: number } | null {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null;
  }

  return { major, minor, patch };
}
