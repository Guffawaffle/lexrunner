/**
 * Integration tests for interactive plan review CLI commands
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";
import { canonicalJSONStringify } from "../src/util/canonicalJson.js";
import { Plan } from "../src/schema.js";

describe("Interactive Plan Review CLI Integration", () => {
  const testDir = "/tmp/lex-pr-cli-review-test";
  const cliPath = path.join(process.cwd(), "dist/cli.js");

  const samplePlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      { name: "item-a", deps: [], gates: [] },
      { name: "item-b", deps: ["item-a"], gates: [] },
    ],
  };

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("plan-review command", () => {
    it("should auto-approve in non-interactive mode", async () => {
      const planPath = path.join(testDir, "plan.json");
      const outputPath = path.join(testDir, "approved.json");

      fs.writeFileSync(planPath, canonicalJSONStringify(samplePlan));

      const result = await execa("node", [
        cliPath,
        "plan-review",
        planPath,
        "--non-interactive",
        "--output",
        outputPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Plan approved");
      expect(fs.existsSync(outputPath)).toBe(true);

      const approved = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      expect(approved.items).toHaveLength(2);
    });

    it("should show help for plan-review", async () => {
      const result = await execa("node", [cliPath, "plan-review", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Interactive plan review");
      expect(result.stdout).toContain("--non-interactive");
      expect(result.stdout).toContain("--save-history");
      expect(result.stdout).toContain("--output");
    });

    it("should error on missing plan file", async () => {
      await expect(
        execa("node", [cliPath, "plan-review", "/nonexistent/plan.json", "--non-interactive"])
      ).rejects.toThrow();
    });

    it("should save to history when requested", async () => {
      const planPath = path.join(testDir, "plan.json");
      const profileDir = path.join(testDir, ".profile");

      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "profile.yml"), "role: local\nname: Test Profile\n");
      fs.writeFileSync(planPath, canonicalJSONStringify(samplePlan));

      const result = await execa("node", [
        cliPath,
        "plan-review",
        planPath,
        "--non-interactive",
        "--save-history",
        "--profile-dir",
        profileDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Saved to history");

      const historyPath = path.join(profileDir, "runner/plan-history/default.history.json");
      expect(fs.existsSync(historyPath)).toBe(true);

      const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      expect(history.versions).toHaveLength(1);
      expect(history.versions[0].approved).toBe(true);
    });
  });

  describe("plan-diff command", () => {
    it("should show diff between two plans", async () => {
      const plan1Path = path.join(testDir, "plan1.json");
      const plan2Path = path.join(testDir, "plan2.json");

      const plan2: Plan = {
        ...samplePlan,
        items: [...samplePlan.items, { name: "item-c", deps: ["item-b"], gates: [] }],
      };

      fs.writeFileSync(plan1Path, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(plan2Path, canonicalJSONStringify(plan2));

      try {
        await execa("node", [cliPath, "plan-diff", plan1Path, plan2Path]);
        expect.fail("Should have exited with code 1 for changes");
      } catch (error: any) {
        expect(error.exitCode).toBe(1); // Changes detected
        expect(error.stdout).toContain("Plan Comparison");
        expect(error.stdout).toContain("Added Items:");
        expect(error.stdout).toContain("+ item-c");
      }
    });

    it("should show no changes for identical plans", async () => {
      const plan1Path = path.join(testDir, "plan1.json");
      const plan2Path = path.join(testDir, "plan2.json");

      fs.writeFileSync(plan1Path, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(plan2Path, canonicalJSONStringify(samplePlan));

      const result = await execa("node", [cliPath, "plan-diff", plan1Path, plan2Path]);

      expect(result.exitCode).toBe(0); // No changes
      expect(result.stdout).toContain("No changes detected");
    });

    it("should output JSON format", async () => {
      const plan1Path = path.join(testDir, "plan1.json");
      const plan2Path = path.join(testDir, "plan2.json");

      const plan2: Plan = {
        ...samplePlan,
        target: "develop",
      };

      fs.writeFileSync(plan1Path, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(plan2Path, canonicalJSONStringify(plan2));

      try {
        await execa("node", [cliPath, "plan-diff", plan1Path, plan2Path, "--json"]);
        expect.fail("Should have exited with code 1 for changes");
      } catch (error: any) {
        expect(error.exitCode).toBe(1); // Changes detected
        const diff = JSON.parse(error.stdout);
        expect(diff.targetChanged).toBe(true);
        expect(diff.hasChanges).toBe(true);
        expect(diff.originalTarget).toBe("main");
        expect(diff.modifiedTarget).toBe("develop");
      }
    });

    it("should show help for plan-diff", async () => {
      const result = await execa("node", [cliPath, "plan-diff", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Compare two plans");
      expect(result.stdout).toContain("--json");
    });

    it("should detect added items", async () => {
      const plan1Path = path.join(testDir, "plan1.json");
      const plan2Path = path.join(testDir, "plan2.json");

      const plan2: Plan = {
        ...samplePlan,
        items: [
          ...samplePlan.items,
          { name: "item-c", deps: ["item-b"], gates: [] },
          { name: "item-d", deps: ["item-c"], gates: [] },
        ],
      };

      fs.writeFileSync(plan1Path, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(plan2Path, canonicalJSONStringify(plan2));

      try {
        await execa("node", [cliPath, "plan-diff", plan1Path, plan2Path, "--json"]);
        expect.fail("Should have exited with code 1 for changes");
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const diff = JSON.parse(error.stdout);
        expect(diff.addedItems).toHaveLength(2);
        expect(diff.addedItems.map((i: any) => i.name)).toEqual(["item-c", "item-d"]);
      }
    });

    it("should detect removed items", async () => {
      const plan1Path = path.join(testDir, "plan1.json");
      const plan2Path = path.join(testDir, "plan2.json");

      const plan2: Plan = {
        ...samplePlan,
        items: [samplePlan.items[0]],
      };

      fs.writeFileSync(plan1Path, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(plan2Path, canonicalJSONStringify(plan2));

      try {
        await execa("node", [cliPath, "plan-diff", plan1Path, plan2Path, "--json"]);
        expect.fail("Should have exited with code 1 for changes");
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const diff = JSON.parse(error.stdout);
        expect(diff.removedItems).toHaveLength(1);
        expect(diff.removedItems[0].name).toBe("item-b");
      }
    });

    it("should detect modified dependencies", async () => {
      const plan1Path = path.join(testDir, "plan1.json");
      const plan2Path = path.join(testDir, "plan2.json");

      const plan2: Plan = {
        ...samplePlan,
        items: [samplePlan.items[0], { ...samplePlan.items[1], deps: [] }],
      };

      fs.writeFileSync(plan1Path, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(plan2Path, canonicalJSONStringify(plan2));

      try {
        await execa("node", [cliPath, "plan-diff", plan1Path, plan2Path, "--json"]);
        expect.fail("Should have exited with code 1 for changes");
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const diff = JSON.parse(error.stdout);
        expect(diff.modifiedItems).toHaveLength(1);
        expect(diff.modifiedItems[0].name).toBe("item-b");
        expect(diff.modifiedItems[0].originalDeps).toEqual(["item-a"]);
        expect(diff.modifiedItems[0].modifiedDeps).toEqual([]);
      }
    });
  });

  describe("Integration with existing commands", () => {
    it("should work in pipeline: plan -> review -> execute", async () => {
      const planPath = path.join(testDir, "plan.json");
      const approvedPath = path.join(testDir, "approved.json");

      fs.writeFileSync(planPath, canonicalJSONStringify(samplePlan));

      // Step 1: Review plan
      const reviewResult = await execa("node", [
        cliPath,
        "plan-review",
        planPath,
        "--non-interactive",
        "--output",
        approvedPath,
      ]);
      expect(reviewResult.exitCode).toBe(0);

      // Step 2: Verify merge order works on approved plan
      const orderResult = await execa("node", [cliPath, "merge-order", approvedPath, "--json"]);
      expect(orderResult.exitCode).toBe(0);
      const order = JSON.parse(orderResult.stdout);
      expect(order.levels).toBeDefined();
    });

    it("should compare before and after review", async () => {
      const originalPath = path.join(testDir, "original.json");
      const modifiedPath = path.join(testDir, "modified.json");

      const modifiedPlan: Plan = {
        ...samplePlan,
        items: [...samplePlan.items, { name: "item-c", deps: ["item-b"], gates: [] }],
      };

      fs.writeFileSync(originalPath, canonicalJSONStringify(samplePlan));
      fs.writeFileSync(modifiedPath, canonicalJSONStringify(modifiedPlan));

      try {
        await execa("node", [cliPath, "plan-diff", originalPath, modifiedPath]);
        expect.fail("Should have exited with code 1 for changes");
      } catch (error: any) {
        expect(error.exitCode).toBe(1); // Changes detected
        expect(error.stdout).toContain("+ item-c");
      }
    });
  });
});
