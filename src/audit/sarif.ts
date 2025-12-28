/**
 * SARIF adapter - converts vulnerability gate findings to SARIF 2.1.0 format
 * Enables integration with GitHub Code Scanning, GitLab SAST, Snyk, Veracode, etc.
 */

import * as fs from "fs";
import * as path from "path";
import { EventEnvelope } from "./events.js";
import { VulnerabilitySeverity } from "./sdk/types.js";

/**
 * SARIF 2.1.0 schema types
 */
export interface SARIFReport {
  $schema: string;
  version: string;
  runs: SARIFRun[];
}

export interface SARIFRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SARIFRule[];
    };
  };
  results: SARIFResult[];
}

export interface SARIFRule {
  id: string;
  name: string;
  shortDescription: {
    text: string;
  };
  fullDescription: {
    text: string;
  };
  defaultConfiguration: {
    level: "error" | "warning" | "note";
  };
  properties: {
    tags: string[];
    precision: string;
  };
}

export interface SARIFResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: {
    text: string;
  };
  locations: SARIFLocation[];
  properties: {
    severity: VulnerabilitySeverity;
    package?: string;
    version?: string;
    fixedIn?: string;
  };
}

export interface SARIFLocation {
  physicalLocation: {
    artifactLocation: {
      uri: string;
    };
  };
}

/**
 * Map vulnerability severity to SARIF level
 */
function severityToSARIFLevel(severity: VulnerabilitySeverity): "error" | "warning" | "note" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
    default:
      return "warning";
  }
}

/**
 * Convert vuln_found event to SARIF rule
 */
function vulnEventToSARIFRule(event: EventEnvelope): SARIFRule {
  const { cve, severity, package: pkg, version, fixedIn } = event.payload;

  const pkgInfo = pkg ? ` in ${pkg}@${version || "unknown"}` : "";
  const fixInfo = fixedIn ? `. Fixed in ${fixedIn}` : "";

  return {
    id: cve,
    name: cve,
    shortDescription: {
      text: `${severity.charAt(0).toUpperCase() + severity.slice(1)} severity vulnerability${pkgInfo}`,
    },
    fullDescription: {
      text: `Vulnerability ${cve} detected${pkgInfo}${fixInfo}.`,
    },
    defaultConfiguration: {
      level: severityToSARIFLevel(severity),
    },
    properties: {
      tags: ["security", "cve"],
      precision: "high",
    },
  };
}

/**
 * Convert vuln_found event to SARIF result
 */
function vulnEventToSARIFResult(event: EventEnvelope): SARIFResult {
  const { cve, severity, package: pkg, version, fixedIn } = event.payload;

  const pkgInfo = pkg ? ` in ${pkg}@${version || "unknown"}` : "";
  const fixInfo = fixedIn ? `. Fixed in ${fixedIn}` : "";

  // Default location to package.json if not specified
  const location: SARIFLocation = {
    physicalLocation: {
      artifactLocation: {
        uri: event.payload.file || "package.json",
      },
    },
  };

  return {
    ruleId: cve,
    level: severityToSARIFLevel(severity),
    message: {
      text: `Vulnerability ${cve}: ${severity.charAt(0).toUpperCase() + severity.slice(1)} severity${pkgInfo}${fixInfo}.`,
    },
    locations: [location],
    properties: {
      severity,
      ...(pkg && { package: pkg }),
      ...(version && { version }),
      ...(fixedIn && { fixedIn }),
    },
  };
}

/**
 * Generate SARIF report from audit events
 */
export async function generateSARIF(
  events: EventEnvelope[],
  toolVersion: string
): Promise<SARIFReport> {
  // Filter to vuln_found events only
  const vulnEvents = events.filter((e) => e.event === "vuln_found");

  // Build unique rules map (one rule per CVE)
  const rulesMap = new Map<string, SARIFRule>();
  const results: SARIFResult[] = [];

  for (const event of vulnEvents) {
    const cve = event.payload.cve;

    // Add rule if not already present
    if (!rulesMap.has(cve)) {
      rulesMap.set(cve, vulnEventToSARIFRule(event));
    }

    // Add result
    results.push(vulnEventToSARIFResult(event));
  }

  // Convert rules map to array and sort for determinism
  const rules = Array.from(rulesMap.values()).sort((a, b) => a.id.localeCompare(b.id));

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "lexrunner",
            version: toolVersion,
            informationUri: "https://smartergpt.dev/lexrunner",
            rules,
          },
        },
        results,
      },
    ],
  };
}

/**
 * Write SARIF report to file
 */
export async function writeSARIF(report: SARIFReport, outputPath: string): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write SARIF with pretty formatting
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
}
