import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeGate } from "../src/gates.js";
import { Policy, Gate } from "../src/schema.js";
import { validateFlakeReport } from "../src/schema/flakeReport.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Flake Report Generation", () => {
  const defaultPolicy: Policy = {
    requiredGates: [],
    optionalGates: [],
    maxWorkers: 1,
    retries: {},
    overrides: {},
    blockOn: [],
    mergeRule: { type: "strict-required" },
  };

  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flake-report-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should emit flake report when gate succeeds after transient failure", async () => {
    // Create a gate that fails on first attempt but succeeds on retry
    const failOnce = path.join(tempDir, "fail-once.txt");
    fs.writeFileSync(failOnce, "1"); // Start with attempt 1

    const gate: Gate = {
      name: "test-retry-success",
      run: `bash -c 'attempt=$(cat ${failOnce}); if [ "$attempt" -eq "1" ]; then echo "2" > ${failOnce}; echo "Transient network error" >&2; exit 1; else exit 0; fi'`,
      runtime: "local",
    };

    const policy: Policy = {
      ...defaultPolicy,
      retries: {
        "test-retry-success": {
          maxAttempts: 3,
          backoffSeconds: 0.1,
        },
      },
    };

    const result = await executeGate(gate, policy, tempDir, 5000, "test-item");

    // Gate should succeed
    expect(result.status).toBe("pass");
    expect(result.attempts).toBe(2);

    // Flake report should be created
    const flakeReportPath = path.join(
      tempDir,
      "flake-reports",
      "test-item-test-retry-success.json"
    );
    expect(fs.existsSync(flakeReportPath)).toBe(true);

    // Validate flake report structure
    const reportContent = fs.readFileSync(flakeReportPath, "utf-8");
    const report = JSON.parse(reportContent);
    const validated = validateFlakeReport(report);

    expect(validated.schemaVersion).toBe("1.0.0");
    expect(validated.item).toBe("test-item");
    expect(validated.gate).toBe("test-retry-success");
    expect(validated.total_attempts).toBe(2);
    expect(validated.final_status).toBe("pass");
    expect(validated.attempts).toHaveLength(2);

    // First attempt should be fail
    expect(validated.attempts[0].attempt).toBe(1);
    expect(validated.attempts[0].status).toBe("fail");
    expect(validated.attempts[0].error_type).toBe("transient");

    // Second attempt should be pass
    expect(validated.attempts[1].attempt).toBe(2);
    expect(validated.attempts[1].status).toBe("pass");
    expect(validated.attempts[1].error_type).toBeUndefined();
  });

  it("should emit flake report when gate fails after retries", async () => {
    const gate: Gate = {
      name: "test-retry-fail",
      run: 'bash -c "echo Network timeout error >&2; exit 1"',
      runtime: "local",
    };

    const policy: Policy = {
      ...defaultPolicy,
      retries: {
        "test-retry-fail": {
          maxAttempts: 3,
          backoffSeconds: 0.1,
        },
      },
    };

    const result = await executeGate(gate, policy, tempDir, 5000, "test-item");

    // Gate should fail
    expect(result.status).toBe("fail");
    expect(result.attempts).toBe(3);

    // Flake report should be created
    const flakeReportPath = path.join(tempDir, "flake-reports", "test-item-test-retry-fail.json");
    expect(fs.existsSync(flakeReportPath)).toBe(true);

    const reportContent = fs.readFileSync(flakeReportPath, "utf-8");
    const report = JSON.parse(reportContent);
    const validated = validateFlakeReport(report);

    expect(validated.total_attempts).toBe(3);
    expect(validated.final_status).toBe("fail");
    expect(validated.attempts).toHaveLength(3);

    // All attempts should be fail with transient error
    validated.attempts.forEach((attempt, idx) => {
      expect(attempt.attempt).toBe(idx + 1);
      expect(attempt.status).toBe("fail");
      expect(attempt.error_type).toBe("transient");
    });
  });

  it("should NOT emit flake report when gate passes on first attempt", async () => {
    const gate: Gate = {
      name: "test-no-retry",
      run: 'bash -c "exit 0"',
      runtime: "local",
    };

    const result = await executeGate(gate, defaultPolicy, tempDir, 5000, "test-item");

    expect(result.status).toBe("pass");
    expect(result.attempts).toBe(1);

    // Flake report should NOT be created
    const flakeReportPath = path.join(tempDir, "flake-reports", "test-item-test-no-retry.json");
    expect(fs.existsSync(flakeReportPath)).toBe(false);
  });

  it("should NOT retry on permanent errors", async () => {
    const gate: Gate = {
      name: "test-permanent-error",
      run: 'bash -c "echo Authentication failed >&2; exit 1"',
      runtime: "local",
    };

    const policy: Policy = {
      ...defaultPolicy,
      retries: {
        "test-permanent-error": {
          maxAttempts: 3,
          backoffSeconds: 0.1,
        },
      },
    };

    const result = await executeGate(gate, policy, tempDir, 5000, "test-item");

    // Gate should fail on first attempt
    expect(result.status).toBe("fail");
    expect(result.attempts).toBe(1); // Only one attempt due to permanent error

    // No flake report since there was only one attempt
    const flakeReportPath = path.join(
      tempDir,
      "flake-reports",
      "test-item-test-permanent-error.json"
    );
    expect(fs.existsSync(flakeReportPath)).toBe(false);
  });

  it("should have deterministic JSON output with stable ordering", async () => {
    const gate: Gate = {
      name: "test-determinism",
      run: 'bash -c "echo Network timeout >&2; exit 1"',
      runtime: "local",
    };

    const policy: Policy = {
      ...defaultPolicy,
      retries: {
        "test-determinism": {
          maxAttempts: 2,
          backoffSeconds: 0.1,
        },
      },
    };

    // Run twice and compare outputs
    const result1 = await executeGate(gate, policy, tempDir, 5000, "test-item1");
    const result2 = await executeGate(gate, policy, tempDir, 5000, "test-item2");

    const report1Path = path.join(tempDir, "flake-reports", "test-item1-test-determinism.json");
    const report2Path = path.join(tempDir, "flake-reports", "test-item2-test-determinism.json");

    expect(fs.existsSync(report1Path)).toBe(true);
    expect(fs.existsSync(report2Path)).toBe(true);

    const report1Content = fs.readFileSync(report1Path, "utf-8");
    const report2Content = fs.readFileSync(report2Path, "utf-8");

    const report1 = JSON.parse(report1Content);
    const report2 = JSON.parse(report2Content);

    // Structure should be identical (except timestamps and item names)
    expect(report1.schemaVersion).toBe(report2.schemaVersion);
    expect(report1.gate).toBe(report2.gate);
    expect(report1.total_attempts).toBe(report2.total_attempts);
    expect(report1.final_status).toBe(report2.final_status);
    expect(report1.attempts.length).toBe(report2.attempts.length);

    // Verify deterministic key ordering in JSON output
    const keys1 = Object.keys(report1);
    const keys2 = Object.keys(report2);
    expect(keys1).toEqual(keys2);

    // Verify attempts are in chronological order
    for (let i = 0; i < report1.attempts.length; i++) {
      expect(report1.attempts[i].attempt).toBe(i + 1);
      expect(report2.attempts[i].attempt).toBe(i + 1);
    }
  });

  it("should include error metadata in flake report", async () => {
    const gate: Gate = {
      name: "test-error-metadata",
      run: 'bash -c "echo Network timeout error >&2; exit 1"',
      runtime: "local",
    };

    const policy: Policy = {
      ...defaultPolicy,
      retries: {
        "test-error-metadata": {
          maxAttempts: 2,
          backoffSeconds: 0.1,
        },
      },
    };

    await executeGate(gate, policy, tempDir, 5000, "test-item");

    const flakeReportPath = path.join(
      tempDir,
      "flake-reports",
      "test-item-test-error-metadata.json"
    );
    const reportContent = fs.readFileSync(flakeReportPath, "utf-8");
    const report = JSON.parse(reportContent);

    // Check error metadata
    expect(report.attempts[0].error_message).toContain("Network timeout error");
    expect(report.attempts[0].error_type).toBe("transient");
    expect(report.attempts[0].duration_ms).toBeGreaterThan(0);
    expect(report.attempts[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
