import { describe, it, expect, beforeEach } from "vitest";
import {
  EnterpriseAuditService,
  ComplianceFormat,
  MergeAuditData,
  RETENTION_FRAMEWORKS,
  normalizeFrameworkId,
} from "../src/security/compliance";
import { AuthContext } from "../src/security/authentication";

describe("Security - Compliance & Audit", () => {
  let auditService: EnterpriseAuditService;

  beforeEach(() => {
    auditService = new EnterpriseAuditService();
  });

  describe("Secure Audit Logging", () => {
    it("should create secure audit entry with hash", () => {
      const entry = auditService.logSecure("test_operation", "approved", { test: "data" });

      expect(entry).toHaveProperty("hash");
      expect(entry).toHaveProperty("timestamp");
      expect(entry.operation).toBe("test_operation");
      expect(entry.decision).toBe("approved");
    });

    it("should include auth context in entry", () => {
      const authContext: AuthContext = {
        user: "test-user",
        method: "token",
        roles: ["developer"],
      };

      const entry = auditService.logSecure("test_operation", "approved", {}, authContext);

      expect(entry.authContext).toBeDefined();
      expect(entry.authContext?.user).toBe("test-user");
      expect(entry.authContext?.roles).toContain("developer");
    });

    it("should sign entry when signing key provided", () => {
      const signedService = new EnterpriseAuditService("test-signing-key");
      const entry = signedService.logSecure("test_operation", "approved", {});

      expect(entry.signature).toBeDefined();
      expect(typeof entry.signature).toBe("string");
    });
  });

  describe("Merge Operation Audit", () => {
    it("should log merge operation with full details", () => {
      const mergeData: MergeAuditData = {
        prNumbers: [101, 102],
        targetBranch: "main",
        mergeStrategy: "squash",
        gateResults: { lint: "passed", test: "passed" },
        decision: "approved",
      };

      const entry = auditService.logMergeOperation(mergeData);

      expect(entry.operation).toBe("merge_operation");
      expect(entry.decision).toBe("approved");
      expect(entry.metadata.prNumbers).toEqual([101, 102]);
      expect(entry.metadata.targetBranch).toBe("main");
    });

    it("should include rejection reason in audit", () => {
      const mergeData: MergeAuditData = {
        prNumbers: [103],
        targetBranch: "main",
        mergeStrategy: "merge",
        gateResults: { test: "failed" },
        decision: "rejected",
        reason: "Test gate failed",
      };

      const entry = auditService.logMergeOperation(mergeData);

      expect(entry.decision).toBe("rejected");
      expect(entry.metadata.reason).toBe("Test gate failed");
    });
  });

  describe("Signature Verification", () => {
    it("should verify valid signature", () => {
      const signedService = new EnterpriseAuditService("test-key");
      const entry = signedService.logSecure("test", "approved", {});

      expect(signedService.verifyEntry(entry)).toBe(true);
    });

    it("should fail verification for tampered entry", () => {
      const signedService = new EnterpriseAuditService("test-key");
      const entry = signedService.logSecure("test", "approved", {});

      // Tamper with the entry
      entry.decision = "rejected";

      expect(signedService.verifyEntry(entry)).toBe(false);
    });

    it("should fail verification without signing key", () => {
      const entry = auditService.logSecure("test", "approved", {});

      expect(auditService.verifyEntry(entry)).toBe(false);
    });
  });

  describe("Compliance Reports", () => {
    beforeEach(() => {
      // Create some audit entries
      auditService.logSecure("gate_execution", "passed", { gate: "lint" });
      auditService.logSecure("merge_operation", "approved", { pr: 101 });
      auditService.logSecure("gate_execution", "failed", { gate: "test" });
    });

    it("should generate JSON format report", () => {
      const report = auditService.generateComplianceReport(ComplianceFormat.JSON);

      expect(report.format).toBe(ComplianceFormat.JSON);
      expect(report.totalEntries).toBeGreaterThan(0);
      expect(report.content).toBeDefined();
      expect(() => JSON.parse(report.content)).not.toThrow();
    });

    it("should generate JSONL format report", () => {
      const report = auditService.generateComplianceReport(ComplianceFormat.JSONL);

      expect(report.format).toBe(ComplianceFormat.JSONL);
      const lines = report.content.split("\n").filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it("should generate SOX format report", () => {
      const report = auditService.generateComplianceReport(ComplianceFormat.SOX);

      expect(report.format).toBe(ComplianceFormat.SOX);
      expect(report.content).toContain("SOX COMPLIANCE");
      expect(report.content).toContain("AUDIT TRAIL");
    });

    it("should generate SOC2 format report", () => {
      const report = auditService.generateComplianceReport(ComplianceFormat.SOC2);

      expect(report.format).toBe(ComplianceFormat.SOC2);
      expect(report.content).toContain("SOC2 COMPLIANCE");
      expect(report.content).toContain("ACCESS CONTROL");
      expect(report.content).toContain("CHANGE MANAGEMENT");
    });

    it("should generate CSV format report", () => {
      const report = auditService.generateComplianceReport(ComplianceFormat.CSV);

      expect(report.format).toBe(ComplianceFormat.CSV);
      expect(report.content).toContain("Timestamp,Operation,Decision");
      const lines = report.content.split("\n");
      expect(lines.length).toBeGreaterThan(1); // Header + data
    });

    it("should include time range in report", () => {
      const report = auditService.generateComplianceReport(ComplianceFormat.JSON);

      expect(report.timeRange).toBeDefined();
      expect(report.timeRange.start).toBeDefined();
      expect(report.timeRange.end).toBeDefined();
    });

    it("should sign report when signing key provided", () => {
      const signedService = new EnterpriseAuditService("test-key");
      signedService.logSecure("test", "approved", {});

      const report = signedService.generateComplianceReport(ComplianceFormat.JSON);

      expect(report.signature).toBeDefined();
      expect(typeof report.signature).toBe("string");
    });
  });

  describe("Audit Log Retention", () => {
    it("should provide retention recommendations", () => {
      const recommendations = auditService.getRetentionRecommendations();

      expect(recommendations).toBeInstanceOf(Array);
      expect(recommendations.length).toBeGreaterThan(0);

      // Check SOX recommendation
      const sox = recommendations.find((r) => r.framework === "SOX");
      expect(sox).toBeDefined();
      expect(sox?.minDays).toBe(2555); // 7 years
    });

    it("should include major compliance frameworks", () => {
      const recommendations = auditService.getRetentionRecommendations();
      const frameworks = recommendations.map((r) => r.framework);

      expect(frameworks).toContain("SOX");
      expect(frameworks).toContain("SOC2");
      expect(frameworks).toContain("GDPR");
      expect(frameworks).toContain("HIPAA");
      expect(frameworks).toContain("ISO 27001");
      expect(frameworks).toContain("PCI DSS");
    });

    it("should prune old entries", () => {
      // Create test entries
      auditService.logSecure("old_op", "decision", {});

      const prunedCount = auditService.pruneOldEntries(0); // Prune everything

      expect(prunedCount).toBeGreaterThanOrEqual(0);
    });

    it("should apply SOX retention policy", () => {
      const result = auditService.applyRetentionPolicy("SOX");

      expect(result.applied).toBe(true);
      expect(result.retentionDays).toBe(2555); // 7 years
      expect(result.prunedCount).toBeGreaterThanOrEqual(0);
    });

    it("should apply GDPR retention policy", () => {
      const result = auditService.applyRetentionPolicy("GDPR");

      expect(result.applied).toBe(true);
      expect(result.retentionDays).toBe(90); // 3 months
    });

    it("should handle invalid framework gracefully", () => {
      const result = auditService.applyRetentionPolicy("INVALID" as any);

      expect(result.applied).toBe(false);
      expect(result.retentionDays).toBe(0);
      expect(result.prunedCount).toBe(0);
    });

    it("should return trimRetention summary without inputs", () => {
      const summary = auditService.trimRetention();
      expect(summary.total).toBeGreaterThanOrEqual(0);
      expect(summary.trimmed).toBe(0);
      expect(summary.kept).toBe(summary.total);
      expect(Array.isArray(summary.supportedFrameworks)).toBe(true);
    });

    it("should compute trimmed count for explicit days", () => {
      // Add an old entry and mutate timestamp (audit trail stores reference we can modify for test)
      const old = auditService.logSecure("old_event", "ok", {});
      const past = new Date();
      past.setDate(past.getDate() - 400); // ~400 days ago
      (old as any).timestamp = past.toISOString();
      // Use retention 0 days so all entries qualify as trimmed (ensures deterministic >=1)
      const summary = auditService.trimRetention(0);
      expect(summary.retentionDaysApplied).toBe(0);
      expect(summary.trimmed).toBeGreaterThanOrEqual(1);
      expect(summary.kept + summary.trimmed).toBe(summary.total);
    });

    it("should normalize framework aliases (iso27001)", () => {
      const summary = auditService.trimRetention(undefined, "iso27001");
      expect(summary.framework).toBe("ISO 27001");
      expect(summary.retentionDaysApplied).toBeDefined();
    });

    it("should use framework default when days not provided", () => {
      const summary = auditService.trimRetention(undefined, "PCI");
      expect(summary.framework).toBe("PCI DSS");
      expect(summary.retentionDaysApplied).toBe(365);
    });
  });

  describe("Framework Normalization (M3)", () => {
    it("should export canonical framework constants", () => {
      expect(RETENTION_FRAMEWORKS.SOX).toBe("SOX");
      expect(RETENTION_FRAMEWORKS.SOC2).toBe("SOC2");
      expect(RETENTION_FRAMEWORKS.GDPR).toBe("GDPR");
      expect(RETENTION_FRAMEWORKS.HIPAA).toBe("HIPAA");
      expect(RETENTION_FRAMEWORKS.ISO_27001).toBe("ISO 27001");
      expect(RETENTION_FRAMEWORKS.PCI_DSS).toBe("PCI DSS");
    });

    it("should normalize SOX variants", () => {
      expect(normalizeFrameworkId("sox")).toBe("SOX");
      expect(normalizeFrameworkId("SOX")).toBe("SOX");
      expect(normalizeFrameworkId("sarbanes")).toBe("SOX");
      expect(normalizeFrameworkId("sarbanesoxley")).toBe("SOX");
      expect(normalizeFrameworkId("Sarbanes-Oxley")).toBe("SOX");
    });

    it("should normalize ISO 27001 variants", () => {
      expect(normalizeFrameworkId("iso27001")).toBe("ISO 27001");
      expect(normalizeFrameworkId("ISO 27001")).toBe("ISO 27001");
      expect(normalizeFrameworkId("ISO-27001")).toBe("ISO 27001");
      expect(normalizeFrameworkId("iso 27001")).toBe("ISO 27001");
    });

    it("should normalize PCI DSS variants", () => {
      expect(normalizeFrameworkId("pci")).toBe("PCI DSS");
      expect(normalizeFrameworkId("PCI")).toBe("PCI DSS");
      expect(normalizeFrameworkId("pcidss")).toBe("PCI DSS");
      expect(normalizeFrameworkId("PCI DSS")).toBe("PCI DSS");
      expect(normalizeFrameworkId("pci-dss")).toBe("PCI DSS");
    });

    it("should normalize SOC2 variants", () => {
      expect(normalizeFrameworkId("soc2")).toBe("SOC2");
      expect(normalizeFrameworkId("SOC2")).toBe("SOC2");
      expect(normalizeFrameworkId("SOC-2")).toBe("SOC2");
      expect(normalizeFrameworkId("soc 2")).toBe("SOC2");
    });

    it("should return null for unknown frameworks", () => {
      expect(normalizeFrameworkId("unknown")).toBeNull();
      expect(normalizeFrameworkId("FOOBAR")).toBeNull();
      expect(normalizeFrameworkId("")).toBeNull();
    });

    it("should be case-insensitive", () => {
      expect(normalizeFrameworkId("GDPR")).toBe("GDPR");
      expect(normalizeFrameworkId("gdpr")).toBe("GDPR");
      expect(normalizeFrameworkId("GdPr")).toBe("GDPR");
    });

    it("should handle hyphenated and spaced variants", () => {
      // All these should normalize the same way
      expect(normalizeFrameworkId("ISO-27001")).toBe("ISO 27001");
      expect(normalizeFrameworkId("ISO 27001")).toBe("ISO 27001");
      expect(normalizeFrameworkId("ISO27001")).toBe("ISO 27001");
    });
  });
});
