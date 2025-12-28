import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { validateManifest, findManifests } from "../scripts/validate-manifests.js";

describe("Executor Manifest Validation", () => {
  const tmpDir = path.join(process.cwd(), "tmp", "test-manifests");

  beforeEach(() => {
    // Create tmp directory for test manifests
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test manifests
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("validateManifest", () => {
    it("should validate a correct manifest", () => {
      const manifestPath = path.join(tmpDir, "valid-manifest.yaml");
      const validManifest = `schemaVersion: "executor-1.0.0"
role: "test-executor"
description: "Test executor"

toolBudget:
  allowed:
    - grep_search
    - read_file
  denied:
    - git push
  limits:
    maxToolCalls: 20
    maxTokensOut: 2000

jordanModeProtocol:
  prepPhase:
    - load-context
  stochasticPhase:
    promptTemplate: "prompts/test.prompt.md"
    maxCalls: 1
  receiptPhase:
    frameType: "test-frame"
    fields:
      - result
`;

      fs.writeFileSync(manifestPath, validManifest);

      const result = validateManifest(manifestPath);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should fail for invalid schema version", () => {
      const manifestPath = path.join(tmpDir, "invalid-version.yaml");
      const invalidManifest = `schemaVersion: "invalid-version"
role: "test-executor"

toolBudget:
  allowed: []

jordanModeProtocol:
  stochasticPhase:
    promptTemplate: "prompts/test.prompt.md"
  receiptPhase:
    frameType: "test-frame"
    fields:
      - result
`;

      fs.writeFileSync(manifestPath, invalidManifest);

      const result = validateManifest(manifestPath);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should fail for missing required fields", () => {
      const manifestPath = path.join(tmpDir, "missing-fields.yaml");
      const invalidManifest = `schemaVersion: "executor-1.0.0"
description: "Missing role field"

toolBudget:
  allowed: []
`;

      fs.writeFileSync(manifestPath, invalidManifest);

      const result = validateManifest(manifestPath);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should detect overlapping allowed/denied tools", () => {
      const manifestPath = path.join(tmpDir, "overlapping-tools.yaml");
      const invalidManifest = `schemaVersion: "executor-1.0.0"
role: "test-executor"

toolBudget:
  allowed:
    - grep_search
    - read_file
  denied:
    - grep_search

jordanModeProtocol:
  stochasticPhase:
    promptTemplate: "prompts/test.prompt.md"
  receiptPhase:
    frameType: "test-frame"
    fields:
      - result
`;

      fs.writeFileSync(manifestPath, invalidManifest);

      const result = validateManifest(manifestPath);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((err) => err.includes("both allowed and denied"))).toBe(true);
    });

    it("should detect required tools not in allowed list", () => {
      const manifestPath = path.join(tmpDir, "missing-required-tool.yaml");
      const invalidManifest = `schemaVersion: "executor-1.0.0"
role: "test-executor"

toolBudget:
  allowed:
    - grep_search

guardrails:
  tool:
    required:
      - read_file

jordanModeProtocol:
  stochasticPhase:
    promptTemplate: "prompts/test.prompt.md"
  receiptPhase:
    frameType: "test-frame"
    fields:
      - result
`;

      fs.writeFileSync(manifestPath, invalidManifest);

      const result = validateManifest(manifestPath);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((err) => err.includes("Required tools not in allowed list"))).toBe(
        true
      );
    });

    it("should handle YAML parse errors gracefully", () => {
      const manifestPath = path.join(tmpDir, "invalid-yaml.yaml");
      const invalidYaml = `schemaVersion: "executor-1.0.0"
role: "test-executor"
invalid: [unclosed array
`;

      fs.writeFileSync(manifestPath, invalidYaml);

      const result = validateManifest(manifestPath);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((err) => err.includes("Parse error"))).toBe(true);
    });
  });

  describe("findManifests", () => {
    it("should find executor manifests in executors directory", () => {
      const manifests = findManifests();

      // Should find at least the senior-dev manifest
      expect(manifests.length).toBeGreaterThan(0);
      expect(manifests.some((m) => m.includes("senior-dev"))).toBe(true);
    });

    it("should find manifests with correct filename", () => {
      const manifests = findManifests();

      // All found files should be named executor-manifest.yaml
      manifests.forEach((manifest) => {
        expect(path.basename(manifest)).toBe("executor-manifest.yaml");
      });
    });
  });

  describe("Real manifest validation", () => {
    it("should validate the senior-dev manifest", () => {
      const seniorDevManifest = path.join(
        process.cwd(),
        "executors",
        "senior-dev",
        "executor-manifest.yaml"
      );

      if (fs.existsSync(seniorDevManifest)) {
        const result = validateManifest(seniorDevManifest);
        expect(result.success).toBe(true);
      }
    });

    it("should validate the example manifest", () => {
      const exampleManifest = path.join(
        process.cwd(),
        "examples",
        "executor-manifest.example.yaml"
      );

      if (fs.existsSync(exampleManifest)) {
        const result = validateManifest(exampleManifest);
        expect(result.success).toBe(true);
      }
    });
  });
});
