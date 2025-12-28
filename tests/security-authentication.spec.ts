import { describe, it, expect, beforeEach, vi } from "vitest";
import { GitHubTokenAuthProvider, AuthenticationManager } from "../src/security/authentication";

describe("Security - Authentication", () => {
  describe("GitHubTokenAuthProvider", () => {
    it("should throw error when token is not provided", () => {
      // Clear env var
      delete process.env.GITHUB_TOKEN;

      expect(() => new GitHubTokenAuthProvider()).toThrow("GitHub token required");
    });

    it("should use provided token", async () => {
      const provider = new GitHubTokenAuthProvider("test-token");
      expect(provider).toBeDefined();
    });

    it("should use environment token when not provided", () => {
      process.env.GITHUB_TOKEN = "env-token";
      const provider = new GitHubTokenAuthProvider();
      expect(provider).toBeDefined();
      delete process.env.GITHUB_TOKEN;
    });
  });

  describe("AuthenticationManager", () => {
    it("should create with default provider", () => {
      process.env.GITHUB_TOKEN = "test-token";
      const manager = new AuthenticationManager();
      expect(manager).toBeDefined();
      delete process.env.GITHUB_TOKEN;
    });

    it("should get context after initialization", () => {
      process.env.GITHUB_TOKEN = "test-token";
      const manager = new AuthenticationManager();
      const context = manager.getContext();
      expect(context).toBeUndefined(); // Not initialized yet
      delete process.env.GITHUB_TOKEN;
    });
  });
});
