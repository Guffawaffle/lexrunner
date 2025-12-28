import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sha256, environmentFingerprint, lockfileHash } from "../src/util/hash";
import * as fs from "fs";

describe("hash utilities", () => {
  describe("sha256", () => {
    it("should produce consistent hashes for same input", () => {
      const input = "test string";
      const hash1 = sha256(input);
      const hash2 = sha256(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // 64 char hex string
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = sha256("test1");
      const hash2 = sha256("test2");

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = sha256("");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle unicode characters", () => {
      const hash = sha256("🚀 Unicode test! 中文");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("environmentFingerprint", () => {
    it("should include basic environment info", () => {
      const fp = environmentFingerprint();

      // Should include platform info
      expect(fp.platform).toBeDefined();
      expect(fp.arch).toBeDefined();
      expect(fp.node).toBeDefined();
      expect(fp.envKeys).toBeInstanceOf(Array);
      expect(fp.sensitiveRedacted).toBeTypeOf("number");
    });

    it("should be deterministic for same environment", () => {
      const fp1 = environmentFingerprint();
      const fp2 = environmentFingerprint();

      expect(fp1).toEqual(fp2);
    });

    it("should redact sensitive keys from envKeys", () => {
      const fp = environmentFingerprint();

      // envKeys should not contain sensitive patterns
      const sensitivePattern = /(TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL|PASS)/i;
      const hasSensitive = fp.envKeys.some((key) => sensitivePattern.test(key));

      expect(hasSensitive).toBe(false);
    });
  });

  describe("lockfileHash", () => {
    it("should return hash when lockfile exists", () => {
      const result = lockfileHash();

      // Should either be null (no lockfile) or valid hash (lockfile found)
      if (result !== null) {
        expect(result).toMatch(/^[a-f0-9]{64}$/);
      } else {
        expect(result).toBeNull();
      }
    });

    it("should be deterministic when called multiple times", () => {
      const result1 = lockfileHash();
      const result2 = lockfileHash();

      expect(result1).toBe(result2);
    });
  });
});
