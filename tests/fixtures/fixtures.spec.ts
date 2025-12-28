/**
 * Tests to validate fixture library correctness
 * Ensures all fixtures are valid and work as expected
 */

import { describe, it, expect } from "vitest";
import { fixtures } from "./index.js";
import { validatePlan } from "../../src/schema.js";

describe("Fixture Library Validation", () => {
  describe("Plan fixtures", () => {
    it("validates simple plan", () => {
      const plan = fixtures.plans.simple();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items).toHaveLength(3);
      expect(plan.schemaVersion).toBe("1.0.0");
    });

    it("validates simple plan with gates", () => {
      const plan = fixtures.plans.simpleWithGates();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.policy?.requiredGates).toContain("lint");
      expect(plan.policy?.requiredGates).toContain("test");
    });

    it("validates linear plan", () => {
      const plan = fixtures.plans.linear();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items).toHaveLength(4);
      expect(plan.items[1].deps).toContain("feat-a");
      expect(plan.items[2].deps).toContain("feat-b");
      expect(plan.items[3].deps).toContain("feat-c");
    });

    it("validates diamond plan", () => {
      const plan = fixtures.plans.diamond();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items).toHaveLength(3);
      expect(plan.items[2].deps).toHaveLength(2);
    });

    it("validates complex plan", () => {
      const plan = fixtures.plans.complex();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items.length).toBeGreaterThan(15);
      expect(plan.policy?.requiredGates).toContain("lint");
      expect(plan.policy?.requiredGates).toContain("test");
    });

    it("validates wide parallel plan", () => {
      const plan = fixtures.plans.wideParallel();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items).toHaveLength(10);
      expect(plan.items.every((item) => item.deps.length === 0)).toBe(true);
    });

    it("validates deep chain plan", () => {
      const plan = fixtures.plans.deepChain();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items).toHaveLength(15);
    });
  });

  describe("Invalid plan fixtures", () => {
    it("creates cycle plan", () => {
      const plan = fixtures.invalid.cycle();
      expect(() => validatePlan(plan)).not.toThrow(); // Schema is valid
      expect(plan.items).toHaveLength(3);
      // Cycle detection would happen during execution
    });

    it("creates unknown dependency plan", () => {
      const plan = fixtures.invalid.unknownDependency();
      expect(() => validatePlan(plan)).not.toThrow(); // Schema is valid
      expect(plan.items[1].deps).toContain("feat-nonexistent");
    });

    it("creates empty plan", () => {
      const plan = fixtures.invalid.empty();
      expect(() => validatePlan(plan)).not.toThrow();
      expect(plan.items).toHaveLength(0);
    });
  });

  describe("PR fixtures", () => {
    it("creates basic PR", () => {
      const pr = fixtures.prs.basic({
        number: 100,
        title: "Test PR",
      });

      expect(pr.number).toBe(100);
      expect(pr.title).toBe("Test PR");
      expect(pr.state).toBe("open");
      expect(pr.base?.ref).toBe("main");
    });

    it("creates batch of PRs", () => {
      const prs = fixtures.prs.batch(5);
      expect(prs).toHaveLength(5);
      expect(prs[0].number).toBe(100);
      expect(prs[4].number).toBe(104);
    });

    it("creates PR with dependencies", () => {
      const pr = fixtures.prs.withDeps({
        number: 101,
        title: "Feature PR",
        dependsOn: [100],
      });

      expect(pr.body).toContain("Depends on: #100");
    });

    it("creates PR chain", () => {
      const chain = fixtures.prs.chain(3, 100);
      expect(chain).toHaveLength(3);
      expect(chain[0].body).not.toContain("Depends on");
      expect(chain[1].body).toContain("#100");
      expect(chain[2].body).toContain("#101");
    });

    it("creates diamond PR pattern", () => {
      const prs = fixtures.prs.diamond(100);
      expect(prs).toHaveLength(3);
      expect(prs[2].body).toContain("#100");
      expect(prs[2].body).toContain("#101");
    });

    it("creates complex PR graph", () => {
      const prs = fixtures.prs.complex(15);
      expect(prs).toHaveLength(15);
    });
  });

  describe("Gate fixtures", () => {
    it("creates lint gate config", () => {
      const gate = fixtures.gates.configs.lint();
      expect(gate.name).toBe("lint");
      expect(gate.run).toBeTruthy();
      expect(gate.runtime).toBe("local");
    });

    it("creates test gate config", () => {
      const gate = fixtures.gates.configs.test();
      expect(gate.name).toBe("test");
    });

    it("creates passing gate result", () => {
      const result = fixtures.gates.results.pass("lint");
      expect(result.status).toBe("pass");
      expect(result.exitCode).toBe(0);
    });

    it("creates failing gate result", () => {
      const result = fixtures.gates.results.fail("test");
      expect(result.status).toBe("fail");
      expect(result.exitCode).toBe(1);
    });

    it("creates all pass results", () => {
      const results = fixtures.gates.results.allPass(["lint", "test", "e2e"]);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "pass")).toBe(true);
    });

    it("creates mixed results", () => {
      const results = fixtures.gates.results.someFail({
        pass: ["lint"],
        fail: ["test"],
      });
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("pass");
      expect(results[1].status).toBe("fail");
    });
  });

  describe("Scenario fixtures", () => {
    it("creates simple success scenario", () => {
      const scenario = fixtures.scenarios.simpleSuccess();
      expect(scenario.plan.items).toHaveLength(3);
      expect(scenario.prs).toHaveLength(3);
      expect(scenario.expected?.merged).toBe(3);
    });

    it("creates linear chain scenario", () => {
      const scenario = fixtures.scenarios.linearChain();
      expect(scenario.plan.items).toHaveLength(4);
      expect(scenario.prs).toHaveLength(4);
      expect(scenario.expected?.layers).toBe(4);
    });

    it("creates diamond merge scenario", () => {
      const scenario = fixtures.scenarios.diamondMerge();
      expect(scenario.plan.items).toHaveLength(3);
      expect(scenario.expected?.layers).toBe(2);
    });

    it("creates complex merge scenario", () => {
      const scenario = fixtures.scenarios.complexMerge({ prCount: 20 });
      expect(scenario.prs.length).toBeGreaterThan(0);
      expect(scenario.plan.items.length).toBeGreaterThan(0);
    });

    it("creates scenario with gate failures", () => {
      const scenario = fixtures.scenarios.withGateFailures();
      expect(scenario.expected?.merged).toBe(1);
      expect(scenario.expected?.failed).toBe(1);
      expect(scenario.expected?.blocked).toBe(1);
    });
  });

  describe("Mock GitHub utilities", () => {
    it("creates mock GitHub client", () => {
      const prs = fixtures.prs.batch(3);
      const mock = fixtures.utils.mockGitHub.createMockGitHub(prs);

      expect(mock.rest.pulls).toBeDefined();
      expect(mock.rest.issues).toBeDefined();
    });

    it("mock GitHub lists PRs", async () => {
      const prs = fixtures.prs.batch(3);
      const mock = fixtures.utils.mockGitHub.createMockGitHub(prs);

      const result = await mock.rest.pulls.list();
      expect(result.data).toHaveLength(3);
    });

    it("mock GitHub gets specific PR", async () => {
      const prs = fixtures.prs.batch(3);
      const mock = fixtures.utils.mockGitHub.createMockGitHub(prs);

      const result = await mock.rest.pulls.get({ pull_number: 100 });
      expect(result.data.number).toBe(100);
    });

    it("mock GitHub throws error for missing PR", async () => {
      const prs = fixtures.prs.batch(3);
      const mock = fixtures.utils.mockGitHub.createMockGitHub(prs);

      await expect(mock.rest.pulls.get({ pull_number: 999 })).rejects.toThrow("PR #999 not found");
    });

    it("creates error mock", async () => {
      const mock = fixtures.utils.mockGitHub.createErrorMock("Test error");

      await expect(mock.rest.pulls.list()).rejects.toThrow("Test error");
    });
  });

  describe("Cleanup utilities", () => {
    it("creates cleanup manager", () => {
      const manager = fixtures.utils.cleanup.createCleanupManager();
      expect(manager).toBeDefined();
    });

    it("registers and runs cleanup", async () => {
      const manager = fixtures.utils.cleanup.createCleanupManager();
      let cleaned = false;

      manager.register(async () => {
        cleaned = true;
      });

      await manager.cleanup();
      expect(cleaned).toBe(true);
    });

    it("runs withCleanup wrapper", async () => {
      let cleaned = false;

      const result = await fixtures.utils.cleanup.withCleanup(async (cleanup) => {
        cleanup.register(async () => {
          cleaned = true;
        });
        return "success";
      });

      expect(result).toBe("success");
      expect(cleaned).toBe(true);
    });
  });

  describe("Fixture determinism", () => {
    it("produces same simple plan on multiple calls", () => {
      const plan1 = fixtures.plans.simple();
      const plan2 = fixtures.plans.simple();

      expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
    });

    it("produces same PR batch on multiple calls", () => {
      const prs1 = fixtures.prs.batch(5);
      const prs2 = fixtures.prs.batch(5);

      expect(JSON.stringify(prs1)).toBe(JSON.stringify(prs2));
    });

    it("produces same gate configs on multiple calls", () => {
      const gate1 = fixtures.gates.configs.lint();
      const gate2 = fixtures.gates.configs.lint();

      expect(JSON.stringify(gate1)).toBe(JSON.stringify(gate2));
    });
  });
});
