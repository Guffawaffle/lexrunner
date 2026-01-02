/**
 * Tests for conflict resolution guidance
 */

import { describe, it, expect } from "vitest";
import {
  generateResolutionGuidance,
  determineConflictSeverity,
} from "../src/weave/resolutionGuidance.js";

describe("Resolution Guidance", () => {
  describe("generateResolutionGuidance", () => {
    it("should provide guidance for tsconfig.json", () => {
      const guidance = generateResolutionGuidance("src/memory/store/tsconfig.json");

      expect(guidance).toBeDefined();
      expect(guidance?.type).toBe("auto-merge-safe");
      expect(guidance?.strategy).toBe("merge-both");
      expect(guidance?.confidence).toBeGreaterThan(0.7);
      expect(guidance?.message).toContain("TypeScript config");
      expect(guidance?.context?.fileType).toBe("tsconfig");
    });

    it("should provide guidance for package.json", () => {
      const guidance = generateResolutionGuidance("package.json");

      expect(guidance).toBeDefined();
      expect(guidance?.type).toBe("auto-merge-safe");
      expect(guidance?.strategy).toBe("merge-both");
      expect(guidance?.message).toContain("Package.json");
      expect(guidance?.context?.fileType).toBe("package.json");
    });

    it("should provide guidance for package-lock.json", () => {
      const guidance = generateResolutionGuidance("package-lock.json");

      expect(guidance).toBeDefined();
      expect(guidance?.type).toBe("auto-merge-safe");
      expect(guidance?.strategy).toBe("manual");
      expect(guidance?.message).toContain("regenerated");
      expect(guidance?.context?.regenerationCommand).toBe("npm install");
    });

    it("should provide guidance for yarn.lock", () => {
      const guidance = generateResolutionGuidance("yarn.lock");

      expect(guidance).toBeDefined();
      expect(guidance?.context?.regenerationCommand).toBe("yarn install");
    });

    it("should provide guidance for pnpm-lock.yaml", () => {
      const guidance = generateResolutionGuidance("pnpm-lock.yaml");

      expect(guidance).toBeDefined();
      expect(guidance?.context?.regenerationCommand).toBe("pnpm install");
    });

    it("should provide guidance for Gemfile.lock", () => {
      const guidance = generateResolutionGuidance("Gemfile.lock");

      expect(guidance).toBeDefined();
      expect(guidance?.context?.regenerationCommand).toBe("bundle install");
    });

    it("should provide guidance for Cargo.lock", () => {
      const guidance = generateResolutionGuidance("Cargo.lock");

      expect(guidance).toBeDefined();
      expect(guidance?.context?.regenerationCommand).toBe("cargo update");
    });

    it("should provide guidance for composer.lock", () => {
      const guidance = generateResolutionGuidance("composer.lock");

      expect(guidance).toBeDefined();
      expect(guidance?.context?.regenerationCommand).toBe("composer update");
    });

    it("should provide manual review guidance for eslint config", () => {
      const guidance = generateResolutionGuidance(".eslintrc.json");

      expect(guidance).toBeDefined();
      expect(guidance?.type).toBe("manual-review");
      expect(guidance?.strategy).toBe("manual");
    });

    it("should provide manual review guidance for prettier config", () => {
      const guidance = generateResolutionGuidance(".prettierrc.json");

      expect(guidance).toBeDefined();
      expect(guidance?.type).toBe("manual-review");
      expect(guidance?.strategy).toBe("manual");
    });

    it("should return undefined for unrecognized files", () => {
      const guidance = generateResolutionGuidance("src/index.ts");

      expect(guidance).toBeUndefined();
    });

    it("should handle nested paths correctly", () => {
      const guidance = generateResolutionGuidance("packages/core/tsconfig.json");

      expect(guidance).toBeDefined();
      expect(guidance?.context?.fileType).toBe("tsconfig");
    });
  });

  describe("determineConflictSeverity", () => {
    it("should mark lock files as likely conflicts", () => {
      const severity = determineConflictSeverity(
        "package-lock.json",
        ["package-lock.json", "src/index.ts"],
        ["package-lock.json", "src/utils.ts"]
      );

      expect(severity).toBe("likely");
    });

    it("should mark config files as possible conflicts", () => {
      const severity = determineConflictSeverity(
        "tsconfig.json",
        ["tsconfig.json", "src/index.ts"],
        ["tsconfig.json", "src/utils.ts"]
      );

      expect(severity).toBe("possible");
    });

    it("should mark regular files as likely conflicts when both change them", () => {
      const severity = determineConflictSeverity(
        "src/index.ts",
        ["src/index.ts", "src/utils.ts"],
        ["src/index.ts", "src/other.ts"]
      );

      expect(severity).toBe("likely");
    });

    it("should return unlikely when file is not in both change sets", () => {
      const severity = determineConflictSeverity(
        "src/index.ts",
        ["src/utils.ts"],
        ["src/other.ts"]
      );

      expect(severity).toBe("unlikely");
    });

    it("should handle package.json as possible conflict", () => {
      const severity = determineConflictSeverity(
        "package.json",
        ["package.json"],
        ["package.json"]
      );

      expect(severity).toBe("possible");
    });
  });
});
