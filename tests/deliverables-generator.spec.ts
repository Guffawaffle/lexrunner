import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { computePlanHash, generateDeliverables } from "../src/orchestration/deliverablesGenerator";
import { Plan } from "../src/schema";

describe("Deliverables Generator", () => {
  const testOutputDir = "/tmp/deliverables-test";
  const testPlanPath = path.join(testOutputDir, "test-plan.json");

  const samplePlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      {
        name: "item-1",
        issue: "#101",
        branch: "feature/item-1",
        deps: [],
        gates: [
          { name: "lint", run: "npm run lint" },
          { name: "test", run: "npm test" },
        ],
      },
      {
        name: "item-2",
        issue: "#102",
        branch: "feature/item-2",
        deps: ["item-1"],
        gates: [{ name: "typecheck", run: "npm run typecheck" }],
      },
    ],
  };

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true });
    }
    fs.mkdirSync(testOutputDir, { recursive: true });

    // Write test plan
    fs.writeFileSync(testPlanPath, JSON.stringify(samplePlan, null, 2));
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true });
    }
  });

  describe("computePlanHash", () => {
    it("should compute deterministic SHA256 hash", () => {
      const hash1 = computePlanHash(samplePlan);
      const hash2 = computePlanHash(samplePlan);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce same hash for equivalent plans", () => {
      const plan1: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "test",
            deps: [],
            gates: [{ name: "lint", run: "npm run lint" }],
          },
        ],
      };

      const plan2: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "test",
            deps: [],
            gates: [{ name: "lint", run: "npm run lint" }],
          },
        ],
      };

      expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
    });

    it("should produce different hash for different plans", () => {
      const plan1: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "test-1",
            deps: [],
            gates: [],
          },
        ],
      };

      const plan2: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "test-2",
            deps: [],
            gates: [],
          },
        ],
      };

      expect(computePlanHash(plan1)).not.toBe(computePlanHash(plan2));
    });

    it("should use canonical JSON (key ordering)", () => {
      // Create plan with keys in different order
      const planA = JSON.parse(
        JSON.stringify({
          target: "main",
          schemaVersion: "1.0.0",
          items: [{ name: "test", deps: [], gates: [] }],
        })
      );

      const planB = JSON.parse(
        JSON.stringify({
          schemaVersion: "1.0.0",
          items: [{ deps: [], gates: [], name: "test" }],
          target: "main",
        })
      );

      // Hashes should be identical because canonical JSON sorts keys
      expect(computePlanHash(planA)).toBe(computePlanHash(planB));
    });
  });

  describe("generateDeliverables", () => {
    it("should generate all required deliverable files", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      // Check all files exist
      expect(fs.existsSync(path.join(outputDir, "plan.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "plan-hash.txt"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "toolchain-manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "GATE0_preflight.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "GATE1_assignment.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "GATE2_conflicts.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "GATE3_merge.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "GATE4_gates.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "GATE5_cleanup.md"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "SUMMARY.md"))).toBe(true);
    });

    it("should write plan hash in correct format", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const hashContent = fs.readFileSync(path.join(outputDir, "plan-hash.txt"), "utf-8");

      expect(hashContent).toMatch(/^SHA256: [a-f0-9]{64}/);
      expect(hashContent).toContain("Algorithm: SHA256");
      expect(hashContent).toContain("Canonical JSON: true");
      expect(hashContent).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
      expect(hashContent).toContain("Plan Version: 1.0.0");
    });

    it("should embed plan hash in SUMMARY.md", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const summaryContent = fs.readFileSync(path.join(outputDir, "SUMMARY.md"), "utf-8");
      const planHash = computePlanHash(samplePlan);

      expect(summaryContent).toContain("## Plan Hash");
      expect(summaryContent).toContain(`SHA256:** \`${planHash}\``);
      expect(summaryContent).toContain("This hash uniquely identifies the plan.json");
    });

    it("should include toolchain information in SUMMARY.md", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const summaryContent = fs.readFileSync(path.join(outputDir, "SUMMARY.md"), "utf-8");

      expect(summaryContent).toContain("## Toolchain");
      expect(summaryContent).toMatch(/\| Tool \| Version \|/);
      expect(summaryContent).toContain("Full manifest: `toolchain-manifest.json`");
    });

    it("should generate toolchain manifest with required tools", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const manifestContent = fs.readFileSync(
        path.join(outputDir, "toolchain-manifest.json"),
        "utf-8"
      );
      const manifest = JSON.parse(manifestContent);

      expect(manifest.schemaVersion).toBe("1.0.0");
      expect(manifest.tools).toBeInstanceOf(Array);
      expect(manifest.environment).toBeDefined();
      expect(manifest.environment.timezone).toBeDefined();
      expect(manifest.environment.locale).toBeDefined();

      // Check for Node.js (always present)
      const nodejs = manifest.tools.find((t: any) => t.name === "Node.js");
      expect(nodejs).toBeDefined();
      expect(nodejs.version).toMatch(/\d+\.\d+\.\d+/);
    });

    it("should copy plan.json to deliverables directory", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const copiedPlan = JSON.parse(fs.readFileSync(path.join(outputDir, "plan.json"), "utf-8"));

      expect(copiedPlan).toEqual(samplePlan);
    });

    it("should include batch ID in gate deliverables", async () => {
      const outputDir = path.join(testOutputDir, "output");
      const batchId = "batch-xyz-123";

      await generateDeliverables({
        batchId,
        planPath: testPlanPath,
        outputDir,
      });

      const gate0 = fs.readFileSync(path.join(outputDir, "GATE0_preflight.md"), "utf-8");
      const summary = fs.readFileSync(path.join(outputDir, "SUMMARY.md"), "utf-8");

      expect(gate0).toContain(batchId);
      expect(summary).toContain(batchId);
    });

    it("should list all items in GATE0 preflight", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const gate0 = fs.readFileSync(path.join(outputDir, "GATE0_preflight.md"), "utf-8");

      expect(gate0).toContain("item-1");
      expect(gate0).toContain("item-2");
      expect(gate0).toContain("#101");
      expect(gate0).toContain("#102");
    });

    it("should list dependencies in GATE0", async () => {
      const outputDir = path.join(testOutputDir, "output");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: testPlanPath,
        outputDir,
      });

      const gate0 = fs.readFileSync(path.join(outputDir, "GATE0_preflight.md"), "utf-8");

      expect(gate0).toContain("## Dependencies");
      expect(gate0).toContain("item-2");
      expect(gate0).toContain("depends on: item-1");
    });

    it("should handle plans with no dependencies", async () => {
      const noDepsPath = path.join(testOutputDir, "no-deps-plan.json");
      const noDepsPanel: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "solo", deps: [], gates: [] }],
      };

      fs.writeFileSync(noDepsPath, JSON.stringify(noDepsPanel, null, 2));

      const outputDir = path.join(testOutputDir, "output-nodeps");

      await generateDeliverables({
        batchId: "test-batch",
        planPath: noDepsPath,
        outputDir,
      });

      const gate0 = fs.readFileSync(path.join(outputDir, "GATE0_preflight.md"), "utf-8");

      expect(gate0).toContain("*No dependencies defined*");
    });
  });
});
