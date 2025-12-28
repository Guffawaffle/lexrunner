/**
 * Security Scanning Integration
 *
 * Integrates with security scanning tools to detect:
 * - Dependency vulnerabilities
 * - Known CVEs
 * - License compliance issues
 * - Security best practices violations
 */

import { securityScanFailedError } from "../errors/index.js";
import { AXErrorException } from "@smartergpt/lex/errors";

/**
 * Vulnerability severity levels
 */
export enum Severity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

/**
 * Vulnerability information
 */
export interface Vulnerability {
  /** Vulnerability identifier (CVE, etc.) */
  id: string;
  /** Affected package name */
  package: string;
  /** Affected version */
  version: string;
  /** Severity level */
  severity: Severity;
  /** Vulnerability title */
  title: string;
  /** Detailed description */
  description: string;
  /** Fix version (if available) */
  fixedIn?: string;
  /** CVE identifier */
  cve?: string;
  /** CVSS score */
  cvssScore?: number;
  /** Published date */
  publishedAt?: Date;
}

/**
 * Security scan result
 */
export interface SecurityScanResult {
  /** Scan timestamp */
  timestamp: Date;
  /** Scanner used */
  scanner: string;
  /** Total vulnerabilities found */
  totalVulnerabilities: number;
  /** Vulnerabilities by severity */
  vulnerabilities: Vulnerability[];
  /** Critical count */
  criticalCount: number;
  /** High count */
  highCount: number;
  /** Medium count */
  mediumCount: number;
  /** Low count */
  lowCount: number;
  /** Whether scan passed policy */
  passed: boolean;
}

/**
 * Security policy for vulnerability thresholds
 */
export interface SecurityPolicy {
  /** Block on critical vulnerabilities */
  blockCritical: boolean;
  /** Block on high vulnerabilities */
  blockHigh: boolean;
  /** Maximum allowed medium vulnerabilities */
  maxMedium: number;
  /** Maximum allowed low vulnerabilities */
  maxLow: number;
}

/**
 * Default security policy
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  blockCritical: true,
  blockHigh: true,
  maxMedium: 5,
  maxLow: 10,
};

/**
 * Security scanner interface
 */
export interface SecurityScanner {
  /** Perform security scan */
  scan(directory?: string): Promise<SecurityScanResult>;
  /** Get scanner name */
  getName(): string;
}

/**
 * NPM Audit Scanner
 */
export class NpmAuditScanner implements SecurityScanner {
  getName(): string {
    return "npm-audit";
  }

  async scan(directory?: string): Promise<SecurityScanResult> {
    const { execa } = await import("execa");
    const workingDir = directory || process.cwd();

    try {
      const { stdout } = await execa("npm", ["audit", "--json"], {
        cwd: workingDir,
        reject: false, // Don't throw on non-zero exit
      });

      const auditData = JSON.parse(stdout);
      return this.parseNpmAudit(auditData);
    } catch (error) {
      const axError = securityScanFailedError(
        `NPM audit failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          scanner: "npm-audit",
          directory: workingDir,
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
      throw new AXErrorException(
        axError.code,
        axError.message,
        axError.nextActions,
        axError.context
      );
    }
  }

  private parseNpmAudit(auditData: any): SecurityScanResult {
    const vulnerabilities: Vulnerability[] = [];

    // Parse npm audit v7+ format
    if (auditData.vulnerabilities) {
      for (const [packageName, vulnData] of Object.entries(
        auditData.vulnerabilities as Record<string, any>
      )) {
        const via = Array.isArray(vulnData.via) ? vulnData.via : [vulnData.via];

        for (const item of via) {
          if (typeof item === "object") {
            vulnerabilities.push({
              id: item.source?.toString() || `npm-${packageName}`,
              package: packageName,
              version: vulnData.range || "unknown",
              severity: this.mapSeverity(item.severity),
              title: item.title || `Vulnerability in ${packageName}`,
              description: item.url || "",
              fixedIn: vulnData.fixAvailable ? "available" : undefined,
              cve: item.cve,
              cvssScore: item.cvss?.score,
            });
          }
        }
      }
    }

    // Count by severity
    const criticalCount = vulnerabilities.filter((v) => v.severity === Severity.CRITICAL).length;
    const highCount = vulnerabilities.filter((v) => v.severity === Severity.HIGH).length;
    const mediumCount = vulnerabilities.filter((v) => v.severity === Severity.MEDIUM).length;
    const lowCount = vulnerabilities.filter((v) => v.severity === Severity.LOW).length;

    return {
      timestamp: new Date(),
      scanner: "npm-audit",
      totalVulnerabilities: vulnerabilities.length,
      vulnerabilities,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      passed: criticalCount === 0 && highCount === 0,
    };
  }

  private mapSeverity(npmSeverity: string): Severity {
    switch (npmSeverity?.toLowerCase()) {
      case "critical":
        return Severity.CRITICAL;
      case "high":
        return Severity.HIGH;
      case "moderate":
      case "medium":
        return Severity.MEDIUM;
      case "low":
        return Severity.LOW;
      default:
        return Severity.INFO;
    }
  }
}

/**
 * Security Scanning Service
 */
export class SecurityScanningService {
  private scanners: SecurityScanner[] = [];
  private policy: SecurityPolicy;

  constructor(policy?: Partial<SecurityPolicy>) {
    this.policy = { ...DEFAULT_SECURITY_POLICY, ...policy };
    // Register default scanners
    this.registerScanner(new NpmAuditScanner());
  }

  /**
   * Register a security scanner
   */
  registerScanner(scanner: SecurityScanner): void {
    this.scanners.push(scanner);
  }

  /**
   * Run all registered scanners
   */
  async scanAll(directory?: string): Promise<SecurityScanResult[]> {
    const results: SecurityScanResult[] = [];

    for (const scanner of this.scanners) {
      try {
        const result = await scanner.scan(directory);
        results.push(result);
      } catch (error) {
        console.warn(`Scanner ${scanner.getName()} failed:`, error);
      }
    }

    return results;
  }

  /**
   * Evaluate results against policy
   */
  evaluatePolicy(result: SecurityScanResult): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    if (this.policy.blockCritical && result.criticalCount > 0) {
      violations.push(
        `${result.criticalCount} critical vulnerabilities found (policy blocks critical)`
      );
    }

    if (this.policy.blockHigh && result.highCount > 0) {
      violations.push(`${result.highCount} high vulnerabilities found (policy blocks high)`);
    }

    if (result.mediumCount > this.policy.maxMedium) {
      violations.push(
        `${result.mediumCount} medium vulnerabilities found (max allowed: ${this.policy.maxMedium})`
      );
    }

    if (result.lowCount > this.policy.maxLow) {
      violations.push(
        `${result.lowCount} low vulnerabilities found (max allowed: ${this.policy.maxLow})`
      );
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  /**
   * Generate security report
   */
  generateReport(results: SecurityScanResult[]): string {
    const lines: string[] = [];

    lines.push("# Security Scan Report");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");

    for (const result of results) {
      lines.push(`## Scanner: ${result.scanner}`);
      lines.push("");
      lines.push(`- Total Vulnerabilities: ${result.totalVulnerabilities}`);
      lines.push(`- Critical: ${result.criticalCount}`);
      lines.push(`- High: ${result.highCount}`);
      lines.push(`- Medium: ${result.mediumCount}`);
      lines.push(`- Low: ${result.lowCount}`);
      lines.push("");

      if (result.vulnerabilities.length > 0) {
        lines.push("### Vulnerabilities");
        lines.push("");

        // Group by severity
        const bySeverity = new Map<Severity, Vulnerability[]>();
        for (const vuln of result.vulnerabilities) {
          const group = bySeverity.get(vuln.severity) || [];
          group.push(vuln);
          bySeverity.set(vuln.severity, group);
        }

        // Output in severity order
        for (const severity of [
          Severity.CRITICAL,
          Severity.HIGH,
          Severity.MEDIUM,
          Severity.LOW,
          Severity.INFO,
        ]) {
          const vulns = bySeverity.get(severity);
          if (vulns && vulns.length > 0) {
            lines.push(`#### ${severity.toUpperCase()}`);
            lines.push("");

            for (const vuln of vulns) {
              lines.push(`- **${vuln.package}@${vuln.version}**: ${vuln.title}`);
              if (vuln.cve) {
                lines.push(`  - CVE: ${vuln.cve}`);
              }
              if (vuln.cvssScore) {
                lines.push(`  - CVSS Score: ${vuln.cvssScore}`);
              }
              if (vuln.fixedIn) {
                lines.push(`  - Fixed in: ${vuln.fixedIn}`);
              }
              lines.push("");
            }
          }
        }
      }

      // Policy evaluation
      const evaluation = this.evaluatePolicy(result);
      lines.push(`### Policy Evaluation: ${evaluation.passed ? "✅ PASSED" : "❌ FAILED"}`);
      lines.push("");

      if (!evaluation.passed) {
        lines.push("**Violations:**");
        for (const violation of evaluation.violations) {
          lines.push(`- ${violation}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }
}
