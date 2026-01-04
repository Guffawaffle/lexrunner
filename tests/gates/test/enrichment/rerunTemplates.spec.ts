/**
 * Tests for rerun command templates
 */

import { describe, it, expect } from "vitest";
import {
  getRerunCommand,
  getAvailableRunners,
  getTemplate,
  detectRunner,
} from "../../../../src/gates/test/enrichment/rerunTemplates.js";

describe("getRerunCommand", () => {
  it("should generate vitest command", () => {
    const cmd = getRerunCommand("my test name", "vitest");
    expect(cmd).toBe('npx vitest run -t "my test name"');
  });

  it("should generate jest command", () => {
    const cmd = getRerunCommand("my test name", "jest");
    expect(cmd).toBe('npx jest -t "my test name"');
  });

  it("should generate node test runner command", () => {
    const cmd = getRerunCommand("my test name", "node");
    expect(cmd).toBe('node --test --test-name-pattern="my test name"');
  });

  it("should generate pytest command", () => {
    const cmd = getRerunCommand("my test name", "pytest");
    expect(cmd).toBe('pytest -k "my test name"');
  });

  it("should generate go test command", () => {
    const cmd = getRerunCommand("TestMyFunction", "go");
    expect(cmd).toBe('go test -run "TestMyFunction"');
  });

  it("should generate phpunit command", () => {
    const cmd = getRerunCommand("testMyMethod", "phpunit");
    expect(cmd).toBe('phpunit --filter "testMyMethod"');
  });

  it("should handle test names with spaces", () => {
    const cmd = getRerunCommand("should do something important", "vitest");
    expect(cmd).toContain("should do something important");
  });

  it("should handle test names with special characters", () => {
    const cmd = getRerunCommand("test (with) [brackets]", "jest");
    expect(cmd).toContain("test (with) [brackets]");
  });

  it("should throw error for unknown runner", () => {
    expect(() => getRerunCommand("test", "unknown" as any)).toThrow("Unknown test runner");
  });
});

describe("getAvailableRunners", () => {
  it("should return all supported runners", () => {
    const runners = getAvailableRunners();

    expect(runners).toContain("vitest");
    expect(runners).toContain("jest");
    expect(runners).toContain("node");
    expect(runners).toContain("pytest");
    expect(runners).toContain("go");
    expect(runners).toContain("phpunit");
  });

  it("should return at least 6 runners", () => {
    const runners = getAvailableRunners();
    expect(runners.length).toBeGreaterThanOrEqual(6);
  });
});

describe("getTemplate", () => {
  it("should return template for vitest", () => {
    const template = getTemplate("vitest");

    expect(template).toBeDefined();
    expect(template?.command).toContain("vitest");
    expect(template?.description).toBeTruthy();
  });

  it("should return template for jest", () => {
    const template = getTemplate("jest");

    expect(template).toBeDefined();
    expect(template?.command).toContain("jest");
  });

  it("should return template for node", () => {
    const template = getTemplate("node");

    expect(template).toBeDefined();
    expect(template?.command).toContain("node --test");
  });

  it("should return template for pytest", () => {
    const template = getTemplate("pytest");

    expect(template).toBeDefined();
    expect(template?.command).toContain("pytest");
  });

  it("should return template for go", () => {
    const template = getTemplate("go");

    expect(template).toBeDefined();
    expect(template?.command).toContain("go test");
  });

  it("should return template for phpunit", () => {
    const template = getTemplate("phpunit");

    expect(template).toBeDefined();
    expect(template?.command).toContain("phpunit");
  });

  it("should have testName placeholder in all templates", () => {
    const runners = getAvailableRunners();

    for (const runner of runners) {
      const template = getTemplate(runner);
      expect(template?.command).toContain("{testName}");
    }
  });
});

describe("detectRunner", () => {
  it("should detect vitest from framework", () => {
    const runner = detectRunner({ framework: "vitest" });
    expect(runner).toBe("vitest");
  });

  it("should detect vitest with version", () => {
    const runner = detectRunner({ framework: "vitest@4.0.0" });
    expect(runner).toBe("vitest");
  });

  it("should detect jest from framework", () => {
    const runner = detectRunner({ framework: "jest" });
    expect(runner).toBe("jest");
  });

  it("should detect pytest", () => {
    const runner = detectRunner({ framework: "pytest" });
    expect(runner).toBe("pytest");
  });

  it("should detect py.test", () => {
    const runner = detectRunner({ framework: "py.test" });
    expect(runner).toBe("pytest");
  });

  it("should detect go", () => {
    const runner = detectRunner({ framework: "go" });
    expect(runner).toBe("go");
  });

  it("should detect golang", () => {
    const runner = detectRunner({ framework: "golang" });
    expect(runner).toBe("go");
  });

  it("should detect phpunit", () => {
    const runner = detectRunner({ framework: "phpunit" });
    expect(runner).toBe("phpunit");
  });

  it("should default to node when no framework provided", () => {
    const runner = detectRunner();
    expect(runner).toBe("node");
  });

  it("should default to node for unknown framework", () => {
    const runner = detectRunner({ framework: "unknown-framework" });
    expect(runner).toBe("node");
  });

  it("should be case insensitive", () => {
    expect(detectRunner({ framework: "VITEST" })).toBe("vitest");
    expect(detectRunner({ framework: "Jest" })).toBe("jest");
    expect(detectRunner({ framework: "PyTest" })).toBe("pytest");
  });
});
