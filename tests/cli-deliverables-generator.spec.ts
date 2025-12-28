import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("CLI orchestrate:generate-deliverables Integration", () => {
  const testDir = "/tmp/deliverables-cli-test";
  const planPath = path.join(testDir, "integration-plan.json");
  const outputDir = path.join(testDir, "output");
  const cliPath = path.join(process.cwd(), "dist", "cli.js");

  const testPlan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      {
        name: "feature-a",
        issue: "#201",
        branch: "feature/a",
        deps: [],
        gates: [
          { name: "lint", run: "npm run lint" },
          { name: "test", run: "npm test" },
        ],
      },
      {
        name: "feature-b",
        issue: "#202",
        branch: "feature/b",
        deps: ["feature-a"],
        gates: [{ name: "typecheck", run: "npm run typecheck" }],
      },
    ],
  };

  beforeEach(() => {
    // Clean up and create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Write test plan
    fs.writeFileSync(planPath, JSON.stringify(testPlan, null, 2));
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it("should generate deliverables via CLI", () => {
    const output = execSync(
      `node ${cliPath} orchestrate:generate-deliverables --batch cli-test --plan ${planPath} --output-dir ${outputDir}`,
      { encoding: "utf-8" }
    );

    // Check output messages
    expect(output).toContain("✅ Created:");
    expect(output).toContain("plan.json");
    expect(output).toContain("plan-hash.txt");
    expect(output).toContain("toolchain-manifest.json");
    expect(output).toContain("GATE0_preflight.md");
    expect(output).toContain("SUMMARY.md");
    expect(output).toContain("Plan hash:");

    // Verify files exist
    expect(fs.existsSync(path.join(outputDir, "plan.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "plan-hash.txt"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "SUMMARY.md"))).toBe(true);
  });

  it("should fail without --batch flag", () => {
    expect(() => {
      execSync(`node ${cliPath} orchestrate:generate-deliverables --plan ${planPath}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/--batch is required/);
  });

  it("should use default output directory when not specified", () => {
    const batchId = "test-default-dir";
    const expectedDir = path.join(".smartergpt.local", "deliverables", batchId);

    // Clean up if exists
    if (fs.existsSync(expectedDir)) {
      fs.rmSync(expectedDir, { recursive: true });
    }

    try {
      execSync(
        `node ${cliPath} orchestrate:generate-deliverables --batch ${batchId} --plan ${planPath}`,
        { encoding: "utf-8" }
      );

      expect(fs.existsSync(path.join(expectedDir, "plan.json"))).toBe(true);
      expect(fs.existsSync(path.join(expectedDir, "SUMMARY.md"))).toBe(true);
    } finally {
      // Clean up
      if (fs.existsSync(expectedDir)) {
        fs.rmSync(expectedDir, { recursive: true });
      }
    }
  });

  it("should produce deterministic plan hash", () => {
    const outputDir1 = path.join(testDir, "output1");
    const outputDir2 = path.join(testDir, "output2");

    // Generate deliverables twice
    execSync(
      `node ${cliPath} orchestrate:generate-deliverables --batch test --plan ${planPath} --output-dir ${outputDir1}`,
      { encoding: "utf-8" }
    );

    execSync(
      `node ${cliPath} orchestrate:generate-deliverables --batch test --plan ${planPath} --output-dir ${outputDir2}`,
      { encoding: "utf-8" }
    );

    // Read plan hashes
    const hash1 = fs.readFileSync(path.join(outputDir1, "plan-hash.txt"), "utf-8");
    const hash2 = fs.readFileSync(path.join(outputDir2, "plan-hash.txt"), "utf-8");

    // Extract SHA256 from both (ignore timestamp differences)
    const sha1 = hash1.match(/SHA256: ([a-f0-9]{64})/)?.[1];
    const sha2 = hash2.match(/SHA256: ([a-f0-9]{64})/)?.[1];

    expect(sha1).toBeDefined();
    expect(sha2).toBeDefined();
    expect(sha1).toBe(sha2);
  });

  it("should handle custom batch IDs correctly", () => {
    const customBatch = "batch-2025-Q1-sprint3";

    execSync(
      `node ${cliPath} orchestrate:generate-deliverables --batch ${customBatch} --plan ${planPath} --output-dir ${outputDir}`,
      { encoding: "utf-8" }
    );

    const summary = fs.readFileSync(path.join(outputDir, "SUMMARY.md"), "utf-8");
    const gate0 = fs.readFileSync(path.join(outputDir, "GATE0_preflight.md"), "utf-8");

    expect(summary).toContain(customBatch);
    expect(gate0).toContain(customBatch);
  });

  it("should display plan hash in output", () => {
    const output = execSync(
      `node ${cliPath} orchestrate:generate-deliverables --batch test --plan ${planPath} --output-dir ${outputDir}`,
      { encoding: "utf-8" }
    );

    expect(output).toMatch(/Plan hash: [a-f0-9]{64}/);
  });

  it("should create all required gate files", () => {
    execSync(
      `node ${cliPath} orchestrate:generate-deliverables --batch test --plan ${planPath} --output-dir ${outputDir}`,
      { encoding: "utf-8" }
    );

    const expectedFiles = [
      "plan.json",
      "plan-hash.txt",
      "toolchain-manifest.json",
      "GATE0_preflight.md",
      "GATE1_assignment.md",
      "GATE2_conflicts.md",
      "GATE3_merge.md",
      "GATE4_gates.md",
      "GATE5_cleanup.md",
      "SUMMARY.md",
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(outputDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });
});
