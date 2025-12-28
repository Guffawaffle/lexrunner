/**
 * Redaction utilities tests
 */

import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactObject,
  redactArgv,
  hashPath,
  sanitizeEnv,
  buildContext,
} from "../../src/audit/redaction.js";

describe("Audit Redaction", () => {
  describe("redactSecrets", () => {
    it("should redact secrets matching pattern", () => {
      const text = "My password is secret123 and token is abc456";
      const redacted = redactSecrets(text, "password|token");

      expect(redacted).toContain("***REDACTED***");
      expect(redacted).not.toContain("secret123");
      expect(redacted).not.toContain("abc456");
    });

    it("should handle case-insensitive patterns", () => {
      const text = "TOKEN=xyz PASSWORD=123 Secret=abc";
      const redacted = redactSecrets(text, "token|password|secret");

      expect(redacted).toBe("TOKEN ***REDACTED*** PASSWORD ***REDACTED*** Secret ***REDACTED***");
    });

    it("should handle invalid regex gracefully", () => {
      const text = "test content";
      const redacted = redactSecrets(text, "[invalid(regex");

      // Should return original text if regex is invalid
      expect(redacted).toBe(text);
    });

    it("should redact common secret patterns", () => {
      const patterns = [
        "api_key=12345",
        "bearer token12345",
        "Authorization: secret",
        "AUTH_TOKEN=abc",
      ];

      const pattern = "token|secret|key|auth";

      for (const text of patterns) {
        const redacted = redactSecrets(text, pattern);
        expect(redacted).toContain("***REDACTED***");
      }
    });
  });

  describe("redactObject", () => {
    it("should redact string values in object", () => {
      const obj = {
        username: "alice",
        password: "secret123",
        token: "ghp_abc123",
      };

      const redacted = redactObject(obj, "password|token");

      expect(redacted.username).toBe("alice");
      expect(redacted.password).toContain("***REDACTED***");
      expect(redacted.token).toContain("***REDACTED***");
    });

    it("should redact nested objects", () => {
      const obj = {
        user: {
          name: "alice",
          credentials: {
            password: "secret",
            apiKey: "key123",
          },
        },
      };

      const redacted = redactObject(obj, "password|key");

      expect(redacted.user.name).toBe("alice");
      expect(redacted.user.credentials.password).toContain("***REDACTED***");
      expect(redacted.user.credentials.apiKey).toContain("***REDACTED***");
    });

    it("should redact arrays", () => {
      const obj = {
        tokens: ["token1", "token2"],
        names: ["alice", "bob"],
      };

      const redacted = redactObject(obj, "token");

      // When key matches pattern, entire value is redacted
      expect(redacted.tokens).toBe("***REDACTED***");
      expect(redacted.names).toEqual(["alice", "bob"]);
    });

    it("should redact keys matching pattern", () => {
      const obj = {
        username: "alice",
        secret_key: "value123",
        api_token: "abc",
      };

      const redacted = redactObject(obj, "secret|token");

      expect(redacted.username).toBe("alice");
      expect(redacted.secret_key).toBe("***REDACTED***");
      expect(redacted.api_token).toBe("***REDACTED***");
    });

    it("should handle null and undefined", () => {
      expect(redactObject(null, "pattern")).toBeNull();
      expect(redactObject(undefined, "pattern")).toBeUndefined();
    });
  });

  describe("redactArgv", () => {
    it("should redact arguments with secrets", () => {
      const argv = ["lex-pr", "execute", "--token", "ghp_abc123", "--file", "plan.json"];
      const redacted = redactArgv(argv, "token");

      expect(redacted).toContain("lex-pr");
      expect(redacted).toContain("--file");
      expect(redacted).toContain("plan.json");
      expect(redacted.some((arg) => arg.includes("***REDACTED***"))).toBe(true);
    });

    it("should redact key=value format", () => {
      const argv = ["--token=ghp_abc123", "--file=plan.json"];
      const redacted = redactArgv(argv, "token");

      expect(redacted).toContain("--token=***REDACTED***");
      expect(redacted).toContain("--file=plan.json");
    });

    it("should redact values in key=value when value matches", () => {
      const argv = ["--key=secret123", "--name=alice"];
      const redacted = redactArgv(argv, "secret");

      expect(redacted).toContain("--key=***REDACTED***");
      expect(redacted).toContain("--name=alice");
    });
  });

  describe("hashPath", () => {
    it("should hash file paths deterministically", () => {
      const path1 = "/sensitive/path/to/file.txt";
      const hash1 = hashPath(path1);
      const hash2 = hashPath(path1);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should produce different hashes for different paths", () => {
      const path1 = "/path/to/file1.txt";
      const path2 = "/path/to/file2.txt";

      const hash1 = hashPath(path1);
      const hash2 = hashPath(path2);

      expect(hash1).not.toBe(hash2);
    });

    it("should hash relative and absolute paths differently", () => {
      const abs = "/path/to/file.txt";
      const rel = "path/to/file.txt";

      const hash1 = hashPath(abs);
      const hash2 = hashPath(rel);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("sanitizeEnv", () => {
    it("should only include allowlisted env vars", () => {
      const env = {
        CI: "true",
        GITHUB_ACTOR: "alice",
        GITHUB_TOKEN: "ghp_secret",
        HOME: "/home/user",
      };

      const sanitized = sanitizeEnv(env, ["CI", "GITHUB_ACTOR"]);

      expect(sanitized).toEqual({
        CI: "true",
        GITHUB_ACTOR: "alice",
      });
      expect(sanitized.GITHUB_TOKEN).toBeUndefined();
      expect(sanitized.HOME).toBeUndefined();
    });

    it("should handle empty allowlist", () => {
      const env = {
        CI: "true",
        GITHUB_TOKEN: "secret",
      };

      const sanitized = sanitizeEnv(env, []);

      expect(Object.keys(sanitized).length).toBe(0);
    });

    it("should handle missing env vars gracefully", () => {
      const env = {
        CI: "true",
      };

      const sanitized = sanitizeEnv(env, ["CI", "MISSING_VAR"]);

      expect(sanitized).toEqual({
        CI: "true",
      });
    });
  });

  describe("buildContext", () => {
    it("should build git context when requested", () => {
      const context = buildContext(["git"], {
        branch: "main",
        commit: "abc123",
        remote: "origin",
      });

      expect(context.git).toBeDefined();
      expect(context.git?.branch).toBe("main");
      expect(context.git?.commit).toBe("abc123");
      expect(context.git?.remote).toBe("origin");
    });

    it("should build os context when requested", () => {
      const context = buildContext(["os"], undefined, ["NODE_ENV"]);

      expect(context.os).toBeDefined();
      expect(context.os?.platform).toBeDefined();
      expect(context.os?.arch).toBeDefined();
      expect(context.os?.node_version).toBeDefined();
    });

    it("should build ci context when requested", () => {
      const oldEnv = { ...process.env };

      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_RUN_ID = "123456";
      process.env.GITHUB_ACTOR = "alice";

      const context = buildContext(["ci"]);

      expect(context.ci).toBeDefined();
      expect(context.ci?.job_id).toBe("123456");
      expect(context.ci?.actor).toBe("alice");

      // Restore env
      process.env = oldEnv;
    });

    it("should build multiple contexts", () => {
      const context = buildContext(["git", "os"], { branch: "main", commit: "abc" });

      expect(context.git).toBeDefined();
      expect(context.os).toBeDefined();
      expect(context.ci).toBeUndefined();
    });

    it("should sanitize env vars in os context", () => {
      const oldEnv = { ...process.env };

      process.env.SAFE_VAR = "safe";
      process.env.SECRET_VAR = "secret";

      const context = buildContext(["os"], undefined, ["SAFE_VAR"]);

      expect(context.os?.env).toBeDefined();
      expect(context.os?.env.SAFE_VAR).toBe("safe");
      expect(context.os?.env.SECRET_VAR).toBeUndefined();

      // Restore env
      process.env = oldEnv;
    });
  });
});
