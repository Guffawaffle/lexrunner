import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseGlobalFlags, GlobalFlags } from "../../src/cli/flags.js";

describe("CLI --emit-frames Flag", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.LEX_PR_EMIT_FRAMES;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("Default behavior", () => {
    it("should default to true when no flag is provided", () => {
      const opts = {};
      const flags = parseGlobalFlags(opts);
      expect(flags.emitFrames).toBe(true);
    });
  });

  describe("CLI flag --emit-frames", () => {
    it("should enable frame emission when --emit-frames is provided", () => {
      const opts = { emitFrames: true };
      const flags = parseGlobalFlags(opts);
      expect(flags.emitFrames).toBe(true);
    });

    it("should disable frame emission when --no-emit-frames is provided", () => {
      const opts = { emitFrames: false };
      const flags = parseGlobalFlags(opts);
      expect(flags.emitFrames).toBe(false);
    });
  });

  describe("Environment variable LEX_PR_EMIT_FRAMES", () => {
    it("should enable frame emission when LEX_PR_EMIT_FRAMES=1", () => {
      process.env.LEX_PR_EMIT_FRAMES = "1";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(true);
    });

    it("should enable frame emission when LEX_PR_EMIT_FRAMES=true", () => {
      process.env.LEX_PR_EMIT_FRAMES = "true";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(true);
    });

    it("should disable frame emission when LEX_PR_EMIT_FRAMES=0", () => {
      process.env.LEX_PR_EMIT_FRAMES = "0";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(false);
    });

    it("should disable frame emission when LEX_PR_EMIT_FRAMES=false", () => {
      process.env.LEX_PR_EMIT_FRAMES = "false";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(false);
    });

    it("should use default value when LEX_PR_EMIT_FRAMES is set to invalid value", () => {
      process.env.LEX_PR_EMIT_FRAMES = "invalid";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(true); // Default is true
    });
  });

  describe("CLI args override env vars", () => {
    it("should prefer CLI --emit-frames over LEX_PR_EMIT_FRAMES env var", () => {
      process.env.LEX_PR_EMIT_FRAMES = "0";
      const flags = parseGlobalFlags({ emitFrames: true });
      expect(flags.emitFrames).toBe(true);
    });

    it("should prefer CLI --no-emit-frames over LEX_PR_EMIT_FRAMES env var", () => {
      process.env.LEX_PR_EMIT_FRAMES = "1";
      const flags = parseGlobalFlags({ emitFrames: false });
      expect(flags.emitFrames).toBe(false);
    });

    it("should use env var when CLI arg is undefined", () => {
      process.env.LEX_PR_EMIT_FRAMES = "0";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(false);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle typical enabled scenario (default)", () => {
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(true);
    });

    it("should handle explicit disable via CLI", () => {
      const flags = parseGlobalFlags({ emitFrames: false });
      expect(flags.emitFrames).toBe(false);
    });

    it("should handle disable via env var", () => {
      process.env.LEX_PR_EMIT_FRAMES = "false";
      const flags = parseGlobalFlags({});
      expect(flags.emitFrames).toBe(false);
    });

    it("should handle mixed flags correctly", () => {
      process.env.LEX_PR_EMIT_FRAMES = "1";
      const flags = parseGlobalFlags({ json: true, verbose: false });
      expect(flags.emitFrames).toBe(true);
      expect(flags.json).toBe(true);
      expect(flags.verbose).toBe(false);
    });
  });
});
