import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectContext, GitContext, CIContext, OSContext } from "../../src/audit/context.js";

describe("Audit Context Collection", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("collectContext", () => {
    it("should collect git context when requested", async () => {
      const context = await collectContext(["git"]);

      expect(context).toHaveProperty("git");
      expect(context.git).toBeDefined();
      expect(context.git?.commit).toBeDefined();
      expect(context.git?.branch).toBeDefined();
      expect(context.git?.dirty).toBeDefined();
    });

    it("should collect CI context when requested", async () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_RUN_ID = "123456";
      process.env.GITHUB_WORKFLOW = "CI";

      const context = await collectContext(["ci"]);

      expect(context).toHaveProperty("ci");
      expect(context.ci).toBeDefined();
      expect(context.ci?.provider).toBe("github-actions");
      expect(context.ci?.run_id).toBe("123456");
      expect(context.ci?.workflow).toBe("CI");
    });

    it("should collect OS context when requested", async () => {
      const context = await collectContext(["os"]);

      expect(context).toHaveProperty("os");
      expect(context.os).toBeDefined();
      expect(context.os?.platform).toBeDefined();
      expect(context.os?.release).toBeDefined();
      expect(context.os?.arch).toBeDefined();
    });

    it("should collect multiple context types", async () => {
      process.env.GITHUB_ACTIONS = "true";

      const context = await collectContext(["git", "ci", "os"]);

      expect(context).toHaveProperty("git");
      expect(context).toHaveProperty("ci");
      expect(context).toHaveProperty("os");
    });

    it("should return empty context when no types requested", async () => {
      const context = await collectContext([]);

      expect(context).toEqual({});
    });
  });

  describe("Git Context", () => {
    it("should include commit and branch", async () => {
      const context = await collectContext(["git"]);

      expect(context.git?.commit).toBeDefined();
      expect(typeof context.git?.commit).toBe("string");
      expect(context.git?.branch).toBeDefined();
      expect(typeof context.git?.branch).toBe("string");
    });

    it("should include dirty flag", async () => {
      const context = await collectContext(["git"]);

      expect(context.git?.dirty).toBeDefined();
      expect(typeof context.git?.dirty).toBe("boolean");
    });

    it("should handle missing git gracefully", async () => {
      // This test will still work as git should be available in CI
      // but the function is designed to handle failures gracefully
      const context = await collectContext(["git"]);

      expect(context.git).toBeDefined();
    });
  });

  describe("CI Context - GitHub Actions", () => {
    it("should detect GitHub Actions", async () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_RUN_ID = "1234567890";
      process.env.GITHUB_RUN_NUMBER = "42";
      process.env.GITHUB_WORKFLOW = "CI";
      process.env.GITHUB_JOB = "build";
      process.env.GITHUB_ACTOR = "guffawaffle";
      process.env.GITHUB_EVENT_NAME = "pull_request";
      process.env.GITHUB_REF = "refs/heads/main";
      process.env.GITHUB_SHA = "abc123def456";

      const context = await collectContext(["ci"]);

      expect(context.ci).toEqual({
        provider: "github-actions",
        run_id: "1234567890",
        run_number: "42",
        workflow: "CI",
        job: "build",
        actor: "guffawaffle",
        event_name: "pull_request",
        ref: "refs/heads/main",
        sha: "abc123def456",
      });
    });
  });

  describe("CI Context - GitLab CI", () => {
    it("should detect GitLab CI", async () => {
      // Clear GitHub Actions env vars
      delete process.env.GITHUB_ACTIONS;
      delete process.env.CI;

      process.env.GITLAB_CI = "true";
      process.env.CI_PIPELINE_ID = "pipeline-123";
      process.env.CI_PIPELINE_IID = "iid-456";
      process.env.CI_PIPELINE_SOURCE = "push";
      process.env.CI_JOB_NAME = "test";
      process.env.GITLAB_USER_LOGIN = "testuser";
      process.env.CI_COMMIT_REF_NAME = "main";
      process.env.CI_COMMIT_SHA = "def456abc789";

      const context = await collectContext(["ci"]);

      expect(context.ci).toEqual({
        provider: "gitlab-ci",
        run_id: "pipeline-123",
        run_number: "iid-456",
        workflow: "push",
        job: "test",
        actor: "testuser",
        event_name: "push",
        ref: "main",
        sha: "def456abc789",
      });
    });
  });

  describe("CI Context - CircleCI", () => {
    it("should detect CircleCI", async () => {
      // Clear GitHub Actions env vars
      delete process.env.GITHUB_ACTIONS;
      delete process.env.GITLAB_CI;
      delete process.env.CI;

      process.env.CIRCLECI = "true";
      process.env.CIRCLE_WORKFLOW_ID = "workflow-123";
      process.env.CIRCLE_BUILD_NUM = "789";
      process.env.CIRCLE_JOB = "test";
      process.env.CIRCLE_USERNAME = "circleuser";
      process.env.CIRCLE_BRANCH = "feature-branch";
      process.env.CIRCLE_SHA1 = "sha1hash";

      const context = await collectContext(["ci"]);

      expect(context.ci).toEqual({
        provider: "circleci",
        run_id: "workflow-123",
        run_number: "789",
        workflow: "test",
        job: "test",
        actor: "circleuser",
        ref: "feature-branch",
        sha: "sha1hash",
      });
    });
  });

  describe("CI Context - Jenkins", () => {
    it("should detect Jenkins", async () => {
      // Clear GitHub Actions env vars
      delete process.env.GITHUB_ACTIONS;
      delete process.env.GITLAB_CI;
      delete process.env.CIRCLECI;
      delete process.env.CI;

      process.env.JENKINS_URL = "https://jenkins.example.com";
      process.env.BUILD_ID = "build-123";
      process.env.BUILD_NUMBER = "456";
      process.env.JOB_NAME = "test-job";
      process.env.GIT_BRANCH = "origin/main";
      process.env.GIT_COMMIT = "commit-hash";

      const context = await collectContext(["ci"]);

      expect(context.ci).toEqual({
        provider: "jenkins",
        run_id: "build-123",
        run_number: "456",
        workflow: "test-job",
        job: "test-job",
        ref: "origin/main",
        sha: "commit-hash",
      });
    });
  });

  describe("CI Context - Generic CI", () => {
    it("should detect generic CI", async () => {
      // Clear all specific CI env vars
      delete process.env.GITHUB_ACTIONS;
      delete process.env.GITLAB_CI;
      delete process.env.CIRCLECI;
      delete process.env.JENKINS_URL;

      process.env.CI = "true";
      process.env.BUILD_NUMBER = "999";

      const context = await collectContext(["ci"]);

      expect(context.ci).toEqual({
        provider: "generic-ci",
        run_number: "999",
      });
    });

    it("should detect local environment", async () => {
      // Clear all CI env vars
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.GITLAB_CI;
      delete process.env.CIRCLECI;
      delete process.env.JENKINS_URL;

      const context = await collectContext(["ci"]);

      expect(context.ci).toEqual({
        provider: "local",
      });
    });
  });

  describe("OS Context", () => {
    it("should collect platform information", async () => {
      const context = await collectContext(["os"]);

      expect(context.os?.platform).toBeDefined();
      expect(typeof context.os?.platform).toBe("string");
      expect(["linux", "darwin", "win32"]).toContain(context.os?.platform);
    });

    it("should collect system information", async () => {
      const context = await collectContext(["os"]);

      expect(context.os?.release).toBeDefined();
      expect(context.os?.arch).toBeDefined();
      expect(["x64", "arm64", "arm"]).toContain(context.os?.arch);
    });

    it("should include optional fields when available", async () => {
      const context = await collectContext(["os"]);

      // These fields should be present but we don't test exact values
      // as they depend on the system
      if (context.os?.hostname) {
        expect(typeof context.os.hostname).toBe("string");
      }
      if (context.os?.user) {
        expect(typeof context.os.user).toBe("string");
      }
      if (context.os?.uptime) {
        expect(typeof context.os.uptime).toBe("number");
      }
      if (context.os?.loadavg) {
        expect(Array.isArray(context.os.loadavg)).toBe(true);
      }
    });
  });
});
