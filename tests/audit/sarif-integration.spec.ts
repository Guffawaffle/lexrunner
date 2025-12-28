/**
 * SARIF integration tests - Full workflow from audit events to SARIF output
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";
import { initAuditEmitter, emitEvent, finalizeAudit, EVENT_TYPES } from "../../src/audit/index.js";
import { initAuditSDK } from "../../src/audit/sdk/index.js";

describe("SARIF Integration", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sarif-integration-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("End-to-End SARIF Generation", () => {
    it("should generate SARIF file when --audit-sarif is enabled", async () => {
      const auditDir = join(testDir, "audit");
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: auditDir,
        sarif: true,
      });

      // Emit some vulnerability events
      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-1234",
          severity: "high",
          package: "lodash",
          version: "4.17.20",
          fixedIn: "4.17.21",
        },
        "warn"
      );

      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-5678",
          severity: "medium",
          package: "axios",
          version: "0.21.0",
          fixedIn: "0.21.1",
        },
        "warn"
      );

      await finalizeAudit(emitter);

      // Check that SARIF file was created
      const sarifPath = join(auditDir, "audit-sarif.json");
      expect(existsSync(sarifPath)).toBe(true);

      // Validate SARIF content
      const sarifContent = await readFile(sarifPath, "utf-8");
      const sarif = JSON.parse(sarifContent);

      expect(sarif.version).toBe("2.1.0");
      expect(sarif.$schema).toBe(
        "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json"
      );
      expect(sarif.runs).toHaveLength(1);
      expect(sarif.runs[0].results).toHaveLength(2);
      expect(sarif.runs[0].tool.driver.rules).toHaveLength(2);
    });

    it("should NOT generate SARIF file when --audit-sarif is disabled", async () => {
      const auditDir = join(testDir, "audit");
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: auditDir,
        sarif: false,
      });

      // Emit vulnerability event
      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-1234",
          severity: "high",
        },
        "warn"
      );

      await finalizeAudit(emitter);

      // Check that SARIF file was NOT created
      const sarifPath = join(auditDir, "audit-sarif.json");
      expect(existsSync(sarifPath)).toBe(false);
    });

    it("should NOT generate SARIF file when no vuln_found events", async () => {
      const auditDir = join(testDir, "audit");
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: auditDir,
        sarif: true,
      });

      // Emit non-vulnerability events
      await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, {
        argv: ["lex-pr", "execute"],
        cwd: "/test",
      });

      await emitEvent(emitter, EVENT_TYPES.GATE_STARTED, {
        item: "PR-123",
        gate: "lint",
      });

      await finalizeAudit(emitter);

      // Check that SARIF file was NOT created (no vulns)
      const sarifPath = join(auditDir, "audit-sarif.json");
      expect(existsSync(sarifPath)).toBe(false);
    });

    it("should include vuln events from sidecar files", async () => {
      const auditDir = join(testDir, "audit");
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: auditDir,
        sarif: true,
      });

      // Emit a direct vulnerability event
      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-1111",
          severity: "critical",
          package: "express",
          version: "4.17.0",
        },
        "error"
      );

      // Simulate gate using SDK to emit sidecar event
      const dropDir = emitter.getDropDir();
      const auditSDK = initAuditSDK("vuln-scan");

      // SDK should be active because drop dir is set
      await auditSDK.emitVuln("CVE-2024-2222", "high", {
        package: "react",
        version: "16.0.0",
        fixedIn: "16.14.0",
      });

      await auditSDK.close();

      // Wait briefly for sidecar ingestion
      await new Promise((resolve) => setTimeout(resolve, 100));

      await finalizeAudit(emitter);

      // Check SARIF includes both events
      const sarifPath = join(auditDir, "audit-sarif.json");
      expect(existsSync(sarifPath)).toBe(true);

      const sarifContent = await readFile(sarifPath, "utf-8");
      const sarif = JSON.parse(sarifContent);

      // Should have 2 results (one direct, one from sidecar)
      expect(sarif.runs[0].results.length).toBeGreaterThanOrEqual(2);

      const cves = sarif.runs[0].results.map((r: any) => r.ruleId).sort();
      expect(cves).toContain("CVE-2024-1111");
      expect(cves).toContain("CVE-2024-2222");
    });

    it("should generate valid SARIF that matches GitHub Code Scanning expectations", async () => {
      const auditDir = join(testDir, "audit");
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: auditDir,
        sarif: true,
      });

      // Emit realistic vulnerability event
      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-1234",
          severity: "high",
          package: "lodash",
          version: "4.17.20",
          fixedIn: "4.17.21",
        },
        "warn"
      );

      await finalizeAudit(emitter);

      const sarifPath = join(auditDir, "audit-sarif.json");
      const sarifContent = await readFile(sarifPath, "utf-8");
      const sarif = JSON.parse(sarifContent);

      // Validate required fields for GitHub Code Scanning
      expect(sarif.$schema).toBeDefined();
      expect(sarif.version).toBe("2.1.0");
      expect(sarif.runs).toBeInstanceOf(Array);
      expect(sarif.runs).toHaveLength(1);

      const run = sarif.runs[0];
      expect(run.tool).toBeDefined();
      expect(run.tool.driver).toBeDefined();
      expect(run.tool.driver.name).toBe("lexrunner");
      expect(run.tool.driver.version).toBeDefined();
      expect(run.tool.driver.rules).toBeInstanceOf(Array);
      expect(run.results).toBeInstanceOf(Array);

      const result = run.results[0];
      expect(result.ruleId).toBe("CVE-2024-1234");
      expect(result.level).toBe("error");
      expect(result.message).toBeDefined();
      expect(result.message.text).toBeTruthy();
      expect(result.locations).toBeInstanceOf(Array);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0].physicalLocation).toBeDefined();
      expect(result.locations[0].physicalLocation.artifactLocation).toBeDefined();
      expect(result.locations[0].physicalLocation.artifactLocation.uri).toBeTruthy();
    });

    it("should handle multiple severity levels in single run", async () => {
      const auditDir = join(testDir, "audit");
      const emitter = await initAuditEmitter({
        profile: "soc2",
        dir: auditDir,
        sarif: true,
      });

      // Emit vulnerabilities of different severities
      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-CRITICAL",
          severity: "critical",
        },
        "error"
      );

      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-HIGH",
          severity: "high",
        },
        "warn"
      );

      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-MEDIUM",
          severity: "medium",
        },
        "warn"
      );

      await emitEvent(
        emitter,
        "vuln_found",
        {
          cve: "CVE-2024-LOW",
          severity: "low",
        },
        "info"
      );

      await finalizeAudit(emitter);

      const sarifPath = join(auditDir, "audit-sarif.json");
      const sarifContent = await readFile(sarifPath, "utf-8");
      const sarif = JSON.parse(sarifContent);

      const results = sarif.runs[0].results;
      expect(results).toHaveLength(4);

      const levels = results.map((r: any) => r.level);
      expect(levels).toContain("error"); // critical and high
      expect(levels).toContain("warning"); // medium
      expect(levels).toContain("note"); // low
    });
  });
});
