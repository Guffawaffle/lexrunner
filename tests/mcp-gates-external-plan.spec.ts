import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GatesRunArgs } from "../src/mcp/types.js";

describe("MCP gates.run with external plan files", () => {
  let testDir: string;

  beforeEach(() => {
    // Create test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-external-plan-test-"));
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("GatesRunArgs schema validation", () => {
    it("should accept planFile parameter", () => {
      const args = {
        planFile: "/path/to/plan.json",
      };
      expect(() => GatesRunArgs.parse(args)).not.toThrow();
    });

    it("should accept planFile with other parameters", () => {
      const args = {
        planFile: "/path/to/plan.json",
        outDir: "/tmp/output",
        onlyItem: "item1",
        onlyGate: "gate1",
      };
      expect(() => GatesRunArgs.parse(args)).not.toThrow();
    });

    it("should validate planFile must be a string", () => {
      const args = {
        planFile: 123,
      };
      expect(() => GatesRunArgs.parse(args)).toThrow();
    });

    it("should accept empty args (backward compatibility)", () => {
      expect(() => GatesRunArgs.parse({})).not.toThrow();
    });

    it("should make planFile optional", () => {
      const args = {
        outDir: "/tmp/output",
      };
      const result = GatesRunArgs.parse(args);
      expect(result.planFile).toBeUndefined();
    });
  });

  describe("External plan file functionality", () => {
    it("should validate that external plan files can be created and read", () => {
      const plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "test-item",
            deps: [],
            gates: [
              {
                name: "echo-test",
                run: 'echo "test passed"',
                env: {},
              },
            ],
          },
        ],
      };

      const planPath = path.join(testDir, "external-plan.json");
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

      // Verify file exists and is readable
      expect(fs.existsSync(planPath)).toBe(true);
      const content = fs.readFileSync(planPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.items.length).toBe(1);
    });

    it("should validate plan file path can be used in args", () => {
      const planPath = path.join(testDir, "test-plan.json");
      const args = GatesRunArgs.parse({
        planFile: planPath,
        outDir: path.join(testDir, "output"),
      });

      expect(args.planFile).toBe(planPath);
      expect(args.outDir).toBe(path.join(testDir, "output"));
    });
  });

  describe("Backward compatibility", () => {
    it("should allow gates.run to work without planFile parameter", () => {
      // Test that the old usage pattern still validates
      const oldStyleArgs = {
        onlyItem: "item1",
        outDir: "/tmp/output",
      };

      expect(() => GatesRunArgs.parse(oldStyleArgs)).not.toThrow();
      const result = GatesRunArgs.parse(oldStyleArgs);
      expect(result.planFile).toBeUndefined();
    });

    it("should maintain all existing optional parameters", () => {
      const fullArgs = {
        onlyItem: "test-item",
        onlyGate: "test-gate",
        outDir: "/tmp/test",
      };

      const result = GatesRunArgs.parse(fullArgs);
      expect(result.onlyItem).toBe("test-item");
      expect(result.onlyGate).toBe("test-gate");
      expect(result.outDir).toBe("/tmp/test");
      expect(result.planFile).toBeUndefined();
    });
  });

  describe("Error cases", () => {
    it("should validate planFile type", () => {
      // Should reject non-string planFile
      expect(() => GatesRunArgs.parse({ planFile: null })).toThrow();
      expect(() => GatesRunArgs.parse({ planFile: 123 })).toThrow();
      expect(() => GatesRunArgs.parse({ planFile: true })).toThrow();
      expect(() => GatesRunArgs.parse({ planFile: [] })).toThrow();
      expect(() => GatesRunArgs.parse({ planFile: {} })).toThrow();
    });

    it("should allow empty string planFile (edge case)", () => {
      // Empty string is technically a valid string type, though not useful
      expect(() => GatesRunArgs.parse({ planFile: "" })).not.toThrow();
    });
  });
});
