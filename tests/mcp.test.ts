import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMCPEnvironment,
  PlanCreateArgs,
  GatesRunArgs,
  MergeApplyArgs,
} from "../src/mcp/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("MCP Types and Environment", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use default environment values", () => {
    delete process.env.LEX_PR_PROFILE_DIR;
    delete process.env.ALLOW_MUTATIONS;

    const env = getMCPEnvironment();

    expect(env.LEX_PR_PROFILE_DIR).toBeUndefined();
    expect(env.ALLOW_MUTATIONS).toBe(false);
  });

  it("should use custom environment values", () => {
    process.env.LEX_PR_PROFILE_DIR = "/custom/path";
    process.env.ALLOW_MUTATIONS = "true";

    const env = getMCPEnvironment();

    expect(env.LEX_PR_PROFILE_DIR).toBe("/custom/path");
    expect(env.ALLOW_MUTATIONS).toBe(true);
  });

  it("should parse ALLOW_MUTATIONS correctly", () => {
    // Test various false values
    process.env.ALLOW_MUTATIONS = "false";
    expect(getMCPEnvironment().ALLOW_MUTATIONS).toBe(false);

    process.env.ALLOW_MUTATIONS = "";
    expect(getMCPEnvironment().ALLOW_MUTATIONS).toBe(false);

    process.env.ALLOW_MUTATIONS = "0";
    expect(getMCPEnvironment().ALLOW_MUTATIONS).toBe(false);

    // Test true value
    process.env.ALLOW_MUTATIONS = "true";
    expect(getMCPEnvironment().ALLOW_MUTATIONS).toBe(true);
  });
});

describe("MCP Parameter Validation", () => {
  it("should validate PlanCreateArgs", () => {
    // Valid args
    expect(() => PlanCreateArgs.parse({})).not.toThrow();
    expect(() => PlanCreateArgs.parse({ json: true })).not.toThrow();
    expect(() => PlanCreateArgs.parse({ outDir: "/tmp" })).not.toThrow();
    expect(() => PlanCreateArgs.parse({ json: false, outDir: "/tmp" })).not.toThrow();

    // Valid GitHub args
    expect(() => PlanCreateArgs.parse({ fromGithub: true })).not.toThrow();
    expect(() => PlanCreateArgs.parse({ fromGithub: true, query: "is:open" })).not.toThrow();
    expect(() =>
      PlanCreateArgs.parse({ fromGithub: true, labels: ["bug", "feature"] })
    ).not.toThrow();
    expect(() => PlanCreateArgs.parse({ fromGithub: true, includeDrafts: false })).not.toThrow();
    expect(() => PlanCreateArgs.parse({ fromGithub: true, excludePRs: [123, 456] })).not.toThrow();
    expect(() =>
      PlanCreateArgs.parse({ fromGithub: true, githubToken: "ghp_token" })
    ).not.toThrow();
    expect(() =>
      PlanCreateArgs.parse({ fromGithub: true, owner: "owner", repo: "repo" })
    ).not.toThrow();
    expect(() =>
      PlanCreateArgs.parse({ fromGithub: true, requiredGates: ["lint", "test"] })
    ).not.toThrow();
    expect(() => PlanCreateArgs.parse({ fromGithub: true, maxWorkers: 4 })).not.toThrow();
    expect(() => PlanCreateArgs.parse({ fromGithub: true, target: "develop" })).not.toThrow();

    // Invalid args
    expect(() => PlanCreateArgs.parse({ json: "true" })).toThrow();
    expect(() => PlanCreateArgs.parse({ outDir: 123 })).toThrow();
    expect(() => PlanCreateArgs.parse({ fromGithub: "true" })).toThrow();
    expect(() => PlanCreateArgs.parse({ labels: "bug,feature" })).toThrow(); // Should be array
    expect(() => PlanCreateArgs.parse({ excludePRs: "123,456" })).toThrow(); // Should be array of numbers
    expect(() => PlanCreateArgs.parse({ maxWorkers: "4" })).toThrow(); // Should be number
  });

  it("should validate GatesRunArgs", () => {
    // Valid args
    expect(() => GatesRunArgs.parse({})).not.toThrow();
    expect(() => GatesRunArgs.parse({ onlyItem: "item1" })).not.toThrow();
    expect(() => GatesRunArgs.parse({ onlyGate: "test" })).not.toThrow();
    expect(() => GatesRunArgs.parse({ outDir: "/tmp" })).not.toThrow();

    // Invalid args
    expect(() => GatesRunArgs.parse({ onlyItem: 123 })).toThrow();
    expect(() => GatesRunArgs.parse({ onlyGate: true })).toThrow();
  });

  it("should validate MergeApplyArgs", () => {
    // Valid args
    expect(() => MergeApplyArgs.parse({})).not.toThrow();
    expect(() => MergeApplyArgs.parse({ dryRun: true })).not.toThrow();
    expect(() => MergeApplyArgs.parse({ dryRun: false })).not.toThrow();

    // Invalid args
    expect(() => MergeApplyArgs.parse({ dryRun: "true" })).toThrow();
    expect(() => MergeApplyArgs.parse({ dryRun: 1 })).toThrow();
  });
});

describe("MCP Environment Gating", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    process.env.LEX_PROFILE_DIR = tempDir;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should block mutations when ALLOW_MUTATIONS=false", () => {
    process.env.ALLOW_MUTATIONS = "false";

    const env = getMCPEnvironment();
    expect(env.ALLOW_MUTATIONS).toBe(false);

    // This test validates the environment setup
    // The actual tool behavior is tested through integration
  });

  it("should allow mutations when ALLOW_MUTATIONS=true", () => {
    process.env.ALLOW_MUTATIONS = "true";

    const env = getMCPEnvironment();
    expect(env.ALLOW_MUTATIONS).toBe(true);
  });
});
