import { describe, it, expect } from "vitest";
import { parseSarif } from "../src/security/sarif.js";
import { Severity } from "../src/security/scanning.js";
import fs from "fs";
import path from "path";

describe("Security - SARIF Parser", () => {
  describe("parseSarif", () => {
    it("should parse valid SARIF with vulnerabilities", () => {
      const sarifContent = fs.readFileSync(
        path.join(__dirname, "fixtures", "scan-results.sarif"),
        "utf-8"
      );

      const result = parseSarif(sarifContent);

      expect(result.scanner).toBe("test-scanner");
      expect(result.totalVulnerabilities).toBe(3);
      expect(result.criticalCount).toBe(1);
      expect(result.highCount).toBe(1);
      expect(result.mediumCount).toBe(1);
      expect(result.lowCount).toBe(0);
      expect(result.passed).toBe(false);
    });

    it("should parse SARIF with no vulnerabilities", () => {
      const sarifContent = fs.readFileSync(
        path.join(__dirname, "fixtures", "scan-results-clean.sarif"),
        "utf-8"
      );

      const result = parseSarif(sarifContent);

      expect(result.scanner).toBe("test-scanner");
      expect(result.totalVulnerabilities).toBe(0);
      expect(result.criticalCount).toBe(0);
      expect(result.highCount).toBe(0);
      expect(result.mediumCount).toBe(0);
      expect(result.lowCount).toBe(0);
      expect(result.passed).toBe(true);
    });

    it("should extract vulnerability details correctly", () => {
      const sarifContent = fs.readFileSync(
        path.join(__dirname, "fixtures", "scan-results.sarif"),
        "utf-8"
      );

      const result = parseSarif(sarifContent);

      // Check critical vulnerability
      const critical = result.vulnerabilities.find((v) => v.severity === Severity.CRITICAL);
      expect(critical).toBeDefined();
      expect(critical?.id).toBe("CVE-2024-1234");
      expect(critical?.package).toBe("package-a");
      expect(critical?.version).toBe("1.0.0");
      expect(critical?.cve).toBe("CVE-2024-1234");
      expect(critical?.cvssScore).toBe(9.8);
      expect(critical?.title).toBe("Critical SQL injection vulnerability");

      // Check high vulnerability
      const high = result.vulnerabilities.find((v) => v.severity === Severity.HIGH);
      expect(high).toBeDefined();
      expect(high?.id).toBe("CVE-2024-5678");
      expect(high?.package).toBe("package-b");
    });

    it("should handle invalid JSON gracefully", () => {
      expect(() => parseSarif("not valid json")).toThrow("Invalid SARIF JSON");
    });

    it("should handle SARIF with no runs", () => {
      const sarif = JSON.stringify({ version: "2.1.0", runs: [] });
      const result = parseSarif(sarif);

      expect(result.totalVulnerabilities).toBe(0);
      expect(result.passed).toBe(true);
    });

    it("should sort results deterministically by rule ID", () => {
      const sarifContent = fs.readFileSync(
        path.join(__dirname, "fixtures", "scan-results.sarif"),
        "utf-8"
      );

      const result1 = parseSarif(sarifContent);
      const result2 = parseSarif(sarifContent);

      // Check that vulnerabilities are in same order
      expect(result1.vulnerabilities.map((v) => v.id)).toEqual(
        result2.vulnerabilities.map((v) => v.id)
      );

      // Verify ordering is alphabetical by rule ID
      const ids = result1.vulnerabilities.map((v) => v.id);
      const sortedIds = [...ids].sort();
      expect(ids).toEqual(sortedIds);
    });

    it("should map SARIF levels correctly", () => {
      const sarif = {
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "test" } },
            results: [
              { ruleId: "A", level: "error", message: { text: "test" } },
              { ruleId: "B", level: "warning", message: { text: "test" } },
              { ruleId: "C", level: "note", message: { text: "test" } },
              { ruleId: "D", message: { text: "test" } }, // no level, defaults to note
            ],
          },
        ],
      };

      const result = parseSarif(JSON.stringify(sarif));

      expect(result.vulnerabilities[0].severity).toBe(Severity.HIGH); // error -> HIGH
      expect(result.vulnerabilities[1].severity).toBe(Severity.MEDIUM); // warning -> MEDIUM
      expect(result.vulnerabilities[2].severity).toBe(Severity.LOW); // note -> LOW
      expect(result.vulnerabilities[3].severity).toBe(Severity.LOW); // default -> LOW
    });

    it("should prefer security-severity property over level", () => {
      const sarif = {
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "test" } },
            results: [
              {
                ruleId: "TEST-1",
                level: "warning",
                message: { text: "test" },
                properties: { "security-severity": "critical" },
              },
            ],
          },
        ],
      };

      const result = parseSarif(JSON.stringify(sarif));

      // Should use critical from security-severity, not warning from level
      expect(result.vulnerabilities[0].severity).toBe(Severity.CRITICAL);
    });
  });
});
