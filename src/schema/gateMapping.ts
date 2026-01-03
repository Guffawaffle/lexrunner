/**
 * Gate mapping configuration schema
 * Maps CI check names to lexrunner gate names
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

/**
 * Pattern mapping from CI check name to gate name
 */
export const GateMappingPattern = z.object({
  pattern: z.string().describe("Pattern to match check name (supports wildcards)"),
  gate: z.string().describe("Gate name to map to"),
  source: z.string().optional().describe("Source CI system (e.g., 'github-actions')"),
});
export type GateMappingPattern = z.infer<typeof GateMappingPattern>;

/**
 * Gate mapping configuration
 */
export const GateMappingConfig = z.object({
  version: z.string().default("1.0.0"),
  mappings: z.array(GateMappingPattern).default([]),
});
export type GateMappingConfig = z.infer<typeof GateMappingConfig>;

/**
 * Default gate mappings for common CI patterns
 */
export const DEFAULT_GATE_MAPPINGS: GateMappingPattern[] = [
  { pattern: "CI / build", gate: "build" },
  { pattern: "CI / test", gate: "test" },
  { pattern: "CI / lint", gate: "lint" },
  { pattern: "lint", gate: "lint" },
  { pattern: "test", gate: "test" },
  { pattern: "build", gate: "build" },
  { pattern: "typecheck", gate: "typecheck" },
  { pattern: "security-scan", gate: "vuln" },
  { pattern: "vulnerability-scan", gate: "vuln" },
];

/**
 * Load gate mapping configuration from file
 */
export function loadGateMappingConfig(configPath: string): GateMappingConfig {
  if (!fs.existsSync(configPath)) {
    // Return default config if file doesn't exist
    return {
      version: "1.0.0",
      mappings: DEFAULT_GATE_MAPPINGS,
    };
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.parse(content);
  return GateMappingConfig.parse(parsed);
}

/**
 * Map a CI check name to a gate name using the mapping configuration
 */
export function mapCheckNameToGate(checkName: string, config: GateMappingConfig): string | null {
  // Normalize check name for case-insensitive comparison
  const normalizedCheckName = checkName.toLowerCase();

  // Try exact match first (case-insensitive)
  for (const mapping of config.mappings) {
    if (mapping.pattern.toLowerCase() === normalizedCheckName) {
      return mapping.gate;
    }
  }

  // Try pattern matching with wildcards
  for (const mapping of config.mappings) {
    const pattern = mapping.pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
      .replace(/\\\*/g, ".*"); // Convert * to .*

    const regex = new RegExp(`^${pattern}$`, "i"); // Case-insensitive
    if (regex.test(checkName)) {
      return mapping.gate;
    }
  }

  // No mapping found
  return null;
}

/**
 * Create default gate mapping configuration file
 */
export function createDefaultGateMappingConfig(configPath: string): void {
  const config: GateMappingConfig = {
    version: "1.0.0",
    mappings: DEFAULT_GATE_MAPPINGS,
  };

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, yaml.stringify(config), "utf-8");
}
