import { describe, it, expect } from "vitest";
import {
  AutopilotLevel,
  AutopilotConfig,
  AutopilotConfigError,
  DEFAULT_AUTOPILOT_CONFIG,
  parseAutopilotConfig,
  validateAutopilotConfig,
  getAutopilotLevelDescription,
  hasCapability,
} from "../src/autopilot/index.js";

describe("Autopilot Types", () => {
  describe("AutopilotLevel enum", () => {
    it("should have correct numeric values", () => {
      expect(AutopilotLevel.ReportOnly).toBe(0);
      expect(AutopilotLevel.ArtifactGeneration).toBe(1);
      expect(AutopilotLevel.PRAnnotations).toBe(2);
      expect(AutopilotLevel.IntegrationBranches).toBe(3);
      expect(AutopilotLevel.FullAutomation).toBe(4);
    });
  });

  describe("DEFAULT_AUTOPILOT_CONFIG", () => {
    it("should have safest default values", () => {
      expect(DEFAULT_AUTOPILOT_CONFIG.maxLevel).toBe(AutopilotLevel.ReportOnly);
      expect(DEFAULT_AUTOPILOT_CONFIG.dryRun).toBe(true);
      expect(DEFAULT_AUTOPILOT_CONFIG.openPR).toBe(false);
      expect(DEFAULT_AUTOPILOT_CONFIG.closeSuperseded).toBe(false);
      expect(DEFAULT_AUTOPILOT_CONFIG.branchPrefix).toBe("integration/");
    });
  });

  describe("getAutopilotLevelDescription", () => {
    it("should return correct descriptions for each level", () => {
      expect(getAutopilotLevelDescription(AutopilotLevel.ReportOnly)).toContain("Report Only");
      expect(getAutopilotLevelDescription(AutopilotLevel.ArtifactGeneration)).toContain(
        "Artifact Generation"
      );
      expect(getAutopilotLevelDescription(AutopilotLevel.PRAnnotations)).toContain(
        "PR Annotations"
      );
      expect(getAutopilotLevelDescription(AutopilotLevel.IntegrationBranches)).toContain(
        "Integration Branches"
      );
      expect(getAutopilotLevelDescription(AutopilotLevel.FullAutomation)).toContain(
        "Full Automation"
      );
    });
  });

  describe("hasCapability", () => {
    it("should correctly identify capabilities at level 0", () => {
      const config: AutopilotConfig = { ...DEFAULT_AUTOPILOT_CONFIG, maxLevel: 0 };
      expect(hasCapability(config, "artifacts")).toBe(false);
      expect(hasCapability(config, "annotations")).toBe(false);
      expect(hasCapability(config, "branches")).toBe(false);
      expect(hasCapability(config, "finalization")).toBe(false);
    });

    it("should correctly identify capabilities at level 1", () => {
      const config: AutopilotConfig = { ...DEFAULT_AUTOPILOT_CONFIG, maxLevel: 1 };
      expect(hasCapability(config, "artifacts")).toBe(true);
      expect(hasCapability(config, "annotations")).toBe(false);
      expect(hasCapability(config, "branches")).toBe(false);
      expect(hasCapability(config, "finalization")).toBe(false);
    });

    it("should correctly identify capabilities at level 2", () => {
      const config: AutopilotConfig = { ...DEFAULT_AUTOPILOT_CONFIG, maxLevel: 2 };
      expect(hasCapability(config, "artifacts")).toBe(true);
      expect(hasCapability(config, "annotations")).toBe(true);
      expect(hasCapability(config, "branches")).toBe(false);
      expect(hasCapability(config, "finalization")).toBe(false);
    });

    it("should correctly identify capabilities at level 3", () => {
      const config: AutopilotConfig = { ...DEFAULT_AUTOPILOT_CONFIG, maxLevel: 3 };
      expect(hasCapability(config, "artifacts")).toBe(true);
      expect(hasCapability(config, "annotations")).toBe(true);
      expect(hasCapability(config, "branches")).toBe(true);
      expect(hasCapability(config, "finalization")).toBe(false);
    });

    it("should correctly identify capabilities at level 4", () => {
      const config: AutopilotConfig = { ...DEFAULT_AUTOPILOT_CONFIG, maxLevel: 4 };
      expect(hasCapability(config, "artifacts")).toBe(true);
      expect(hasCapability(config, "annotations")).toBe(true);
      expect(hasCapability(config, "branches")).toBe(true);
      expect(hasCapability(config, "finalization")).toBe(true);
    });
  });
});

describe("Autopilot Config Validation", () => {
  describe("validateAutopilotConfig", () => {
    it("should accept valid default config", () => {
      expect(() => validateAutopilotConfig(DEFAULT_AUTOPILOT_CONFIG)).not.toThrow();
    });

    it("should accept level 0 with no extra flags", () => {
      const config: AutopilotConfig = {
        maxLevel: 0,
        dryRun: true,
        openPR: false,
        closeSuperseded: false,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).not.toThrow();
    });

    it("should accept level 3 with open-pr", () => {
      const config: AutopilotConfig = {
        maxLevel: 3,
        dryRun: true,
        openPR: true,
        closeSuperseded: false,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).not.toThrow();
    });

    it("should accept level 4 with all flags", () => {
      const config: AutopilotConfig = {
        maxLevel: 4,
        dryRun: false,
        openPR: true,
        closeSuperseded: true,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).not.toThrow();
    });

    it("should reject negative level", () => {
      const config: AutopilotConfig = {
        maxLevel: -1 as AutopilotLevel,
        dryRun: true,
        openPR: false,
        closeSuperseded: false,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).toThrow(AutopilotConfigError);
      expect(() => validateAutopilotConfig(config)).toThrow(/must be at least 0/);
    });

    it("should reject level > 4", () => {
      const config: AutopilotConfig = {
        maxLevel: 5 as AutopilotLevel,
        dryRun: true,
        openPR: false,
        closeSuperseded: false,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).toThrow(AutopilotConfigError);
      expect(() => validateAutopilotConfig(config)).toThrow(/must be at most 4/);
    });

    it("should reject open-pr with level < 3", () => {
      const config: AutopilotConfig = {
        maxLevel: 2,
        dryRun: true,
        openPR: true,
        closeSuperseded: false,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).toThrow(AutopilotConfigError);
      expect(() => validateAutopilotConfig(config)).toThrow(/requires --max-level 3/);
    });

    it("should reject close-superseded with level < 4", () => {
      const config: AutopilotConfig = {
        maxLevel: 3,
        dryRun: true,
        openPR: false,
        closeSuperseded: true,
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).toThrow(AutopilotConfigError);
      expect(() => validateAutopilotConfig(config)).toThrow(/requires --max-level 4/);
    });

    it("should reject comment-template with level < 2", () => {
      const config: AutopilotConfig = {
        maxLevel: 1,
        dryRun: true,
        openPR: false,
        closeSuperseded: false,
        commentTemplate: "/tmp/template.md",
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).toThrow(AutopilotConfigError);
      expect(() => validateAutopilotConfig(config)).toThrow(/requires --max-level 2/);
    });

    it("should allow comment-template with level >= 2", () => {
      const config: AutopilotConfig = {
        maxLevel: 2,
        dryRun: true,
        openPR: false,
        closeSuperseded: false,
        commentTemplate: "/tmp/template.md",
        branchPrefix: "integration/",
      };
      expect(() => validateAutopilotConfig(config)).not.toThrow();
    });
  });

  describe("parseAutopilotConfig", () => {
    it("should parse defaults when no options provided", () => {
      const config = parseAutopilotConfig({});
      expect(config.maxLevel).toBe(0);
      expect(config.dryRun).toBe(true);
      expect(config.openPR).toBe(false);
      expect(config.closeSuperseded).toBe(false);
      expect(config.branchPrefix).toBe("integration/");
      expect(config.commentTemplate).toBeUndefined();
    });

    it("should parse max-level option", () => {
      const config = parseAutopilotConfig({ maxLevel: 3 });
      expect(config.maxLevel).toBe(3);
    });

    it("should parse dry-run option", () => {
      const config = parseAutopilotConfig({ dryRun: false });
      expect(config.dryRun).toBe(false);
    });

    it("should parse open-pr option with correct level", () => {
      const config = parseAutopilotConfig({ maxLevel: 3, openPr: true });
      expect(config.openPR).toBe(true);
    });

    it("should parse close-superseded option with correct level", () => {
      const config = parseAutopilotConfig({ maxLevel: 4, closeSuperseded: true });
      expect(config.closeSuperseded).toBe(true);
    });

    it("should parse comment-template option", () => {
      const config = parseAutopilotConfig({
        maxLevel: 2,
        commentTemplate: "/path/to/template.md",
      });
      expect(config.commentTemplate).toBe("/path/to/template.md");
    });

    it("should parse branch-prefix option", () => {
      const config = parseAutopilotConfig({ branchPrefix: "weave/" });
      expect(config.branchPrefix).toBe("weave/");
    });

    it("should throw on invalid level", () => {
      expect(() => parseAutopilotConfig({ maxLevel: 10 })).toThrow(AutopilotConfigError);
    });

    it("should throw on invalid combination: open-pr without level 3", () => {
      expect(() => parseAutopilotConfig({ maxLevel: 2, openPr: true })).toThrow(
        AutopilotConfigError
      );
      expect(() => parseAutopilotConfig({ maxLevel: 2, openPr: true })).toThrow(
        /requires --max-level 3/
      );
    });

    it("should throw on invalid combination: close-superseded without level 4", () => {
      expect(() => parseAutopilotConfig({ maxLevel: 3, closeSuperseded: true })).toThrow(
        AutopilotConfigError
      );
      expect(() => parseAutopilotConfig({ maxLevel: 3, closeSuperseded: true })).toThrow(
        /requires --max-level 4/
      );
    });

    it("should parse all options together correctly", () => {
      const config = parseAutopilotConfig({
        maxLevel: 4,
        dryRun: false,
        openPr: true,
        closeSuperseded: true,
        commentTemplate: "/tmp/template.md",
        branchPrefix: "weave/",
      });
      expect(config.maxLevel).toBe(4);
      expect(config.dryRun).toBe(false);
      expect(config.openPR).toBe(true);
      expect(config.closeSuperseded).toBe(true);
      expect(config.commentTemplate).toBe("/tmp/template.md");
      expect(config.branchPrefix).toBe("weave/");
    });
  });
});

describe("Autopilot Integration Scenarios", () => {
  it("should support level 0: report only workflow", () => {
    const config = parseAutopilotConfig({ maxLevel: 0 });
    expect(config.maxLevel).toBe(AutopilotLevel.ReportOnly);
    expect(hasCapability(config, "artifacts")).toBe(false);
    expect(hasCapability(config, "annotations")).toBe(false);
    expect(hasCapability(config, "branches")).toBe(false);
    expect(hasCapability(config, "finalization")).toBe(false);
  });

  it("should support level 1: artifact generation workflow", () => {
    const config = parseAutopilotConfig({ maxLevel: 1 });
    expect(config.maxLevel).toBe(AutopilotLevel.ArtifactGeneration);
    expect(hasCapability(config, "artifacts")).toBe(true);
    expect(hasCapability(config, "annotations")).toBe(false);
    expect(hasCapability(config, "branches")).toBe(false);
    expect(hasCapability(config, "finalization")).toBe(false);
  });

  it("should support level 2: PR annotations workflow", () => {
    const config = parseAutopilotConfig({
      maxLevel: 2,
      commentTemplate: "/tmp/template.md",
    });
    expect(config.maxLevel).toBe(AutopilotLevel.PRAnnotations);
    expect(hasCapability(config, "artifacts")).toBe(true);
    expect(hasCapability(config, "annotations")).toBe(true);
    expect(hasCapability(config, "branches")).toBe(false);
    expect(hasCapability(config, "finalization")).toBe(false);
  });

  it("should support level 3: integration branches workflow", () => {
    const config = parseAutopilotConfig({
      maxLevel: 3,
      openPr: true,
      branchPrefix: "integration/",
    });
    expect(config.maxLevel).toBe(AutopilotLevel.IntegrationBranches);
    expect(config.openPR).toBe(true);
    expect(hasCapability(config, "artifacts")).toBe(true);
    expect(hasCapability(config, "annotations")).toBe(true);
    expect(hasCapability(config, "branches")).toBe(true);
    expect(hasCapability(config, "finalization")).toBe(false);
  });

  it("should support level 4: full automation workflow", () => {
    const config = parseAutopilotConfig({
      maxLevel: 4,
      dryRun: false,
      openPr: true,
      closeSuperseded: true,
      branchPrefix: "weave/",
    });
    expect(config.maxLevel).toBe(AutopilotLevel.FullAutomation);
    expect(config.dryRun).toBe(false);
    expect(config.openPR).toBe(true);
    expect(config.closeSuperseded).toBe(true);
    expect(hasCapability(config, "artifacts")).toBe(true);
    expect(hasCapability(config, "annotations")).toBe(true);
    expect(hasCapability(config, "branches")).toBe(true);
    expect(hasCapability(config, "finalization")).toBe(true);
  });
});

describe("Autopilot Config Edge Cases", () => {
  it("should reject fractional levels", () => {
    expect(() => parseAutopilotConfig({ maxLevel: 3.7 })).toThrow(AutopilotConfigError);
    // Zod v4 uses different error message format
    expect(() => parseAutopilotConfig({ maxLevel: 3.7 })).toThrow(/int|integer|Invalid/i);
  });

  it("should handle NaN as validation error", () => {
    expect(() => parseAutopilotConfig({ maxLevel: NaN })).toThrow(AutopilotConfigError);
  });

  it("should handle string branch prefixes correctly", () => {
    const config = parseAutopilotConfig({
      branchPrefix: "custom-prefix/with/slashes/",
    });
    expect(config.branchPrefix).toBe("custom-prefix/with/slashes/");
  });

  it("should allow empty comment template", () => {
    const config = parseAutopilotConfig({ maxLevel: 2, commentTemplate: "" });
    expect(config.commentTemplate).toBe("");
  });
});
