import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mapCheckNameToGate,
  loadGateMappingConfig,
  createDefaultGateMappingConfig,
  DEFAULT_GATE_MAPPINGS,
  type GateMappingConfig,
} from "../src/schema/gateMapping.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "yaml";

describe("Gate Mapping", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-mapping-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("mapCheckNameToGate", () => {
    const testConfig: GateMappingConfig = {
      version: "1.0.0",
      mappings: [
        { pattern: "CI / build", gate: "build" },
        { pattern: "CI / test", gate: "test" },
        { pattern: "lint", gate: "lint" },
        { pattern: "type*", gate: "typecheck" }, // Wildcard pattern
      ],
    };

    it("maps exact check name to gate name", () => {
      expect(mapCheckNameToGate("CI / build", testConfig)).toBe("build");
      expect(mapCheckNameToGate("CI / test", testConfig)).toBe("test");
      expect(mapCheckNameToGate("lint", testConfig)).toBe("lint");
    });

    it("maps check name using wildcard pattern", () => {
      expect(mapCheckNameToGate("typecheck", testConfig)).toBe("typecheck");
      expect(mapCheckNameToGate("typescript", testConfig)).toBe("typecheck");
    });

    it("is case-insensitive", () => {
      expect(mapCheckNameToGate("LINT", testConfig)).toBe("lint");
      expect(mapCheckNameToGate("ci / BUILD", testConfig)).toBe("build");
    });

    it("returns null for unmapped check names", () => {
      expect(mapCheckNameToGate("unknown-check", testConfig)).toBe(null);
      expect(mapCheckNameToGate("e2e-tests", testConfig)).toBe(null);
    });

    it("prefers exact matches over pattern matches", () => {
      const config: GateMappingConfig = {
        version: "1.0.0",
        mappings: [
          { pattern: "test*", gate: "generic-test" },
          { pattern: "test", gate: "specific-test" },
        ],
      };
      expect(mapCheckNameToGate("test", config)).toBe("specific-test");
    });
  });

  describe("loadGateMappingConfig", () => {
    it("loads configuration from YAML file", () => {
      const configPath = path.join(tempDir, "gate-mapping.yaml");
      const config: GateMappingConfig = {
        version: "1.0.0",
        mappings: [
          { pattern: "CI / build", gate: "build" },
          { pattern: "CI / test", gate: "test" },
        ],
      };

      fs.writeFileSync(configPath, yaml.stringify(config), "utf-8");

      const loaded = loadGateMappingConfig(configPath);
      expect(loaded.version).toBe("1.0.0");
      expect(loaded.mappings).toHaveLength(2);
      expect(loaded.mappings[0].pattern).toBe("CI / build");
      expect(loaded.mappings[0].gate).toBe("build");
    });

    it("returns default configuration if file does not exist", () => {
      const configPath = path.join(tempDir, "nonexistent.yaml");
      const config = loadGateMappingConfig(configPath);

      expect(config.version).toBe("1.0.0");
      expect(config.mappings).toEqual(DEFAULT_GATE_MAPPINGS);
    });

    it("validates configuration schema", () => {
      const configPath = path.join(tempDir, "invalid.yaml");
      fs.writeFileSync(
        configPath,
        yaml.stringify({
          version: "1.0.0",
          mappings: [
            { pattern: "test" }, // Missing 'gate' field
          ],
        }),
        "utf-8"
      );

      expect(() => loadGateMappingConfig(configPath)).toThrow();
    });
  });

  describe("createDefaultGateMappingConfig", () => {
    it("creates default configuration file", () => {
      const configPath = path.join(tempDir, "gate-mapping.yaml");

      createDefaultGateMappingConfig(configPath);

      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = yaml.parse(content);

      expect(parsed.version).toBe("1.0.0");
      expect(Array.isArray(parsed.mappings)).toBe(true);
      expect(parsed.mappings.length).toBeGreaterThan(0);
    });

    it("creates parent directory if it does not exist", () => {
      const nestedDir = path.join(tempDir, "nested", "dir");
      const configPath = path.join(nestedDir, "gate-mapping.yaml");

      createDefaultGateMappingConfig(configPath);

      expect(fs.existsSync(configPath)).toBe(true);
      expect(fs.existsSync(nestedDir)).toBe(true);
    });
  });

  describe("DEFAULT_GATE_MAPPINGS", () => {
    it("includes common CI patterns", () => {
      const patterns = DEFAULT_GATE_MAPPINGS.map((m) => m.pattern);

      expect(patterns).toContain("CI / build");
      expect(patterns).toContain("CI / test");
      expect(patterns).toContain("lint");
      expect(patterns).toContain("build");
      expect(patterns).toContain("test");
    });

    it("maps to valid gate names", () => {
      for (const mapping of DEFAULT_GATE_MAPPINGS) {
        expect(mapping.gate).toBeTruthy();
        expect(typeof mapping.gate).toBe("string");
      }
    });
  });
});
