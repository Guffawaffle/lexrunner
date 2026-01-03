/**
 * Integration tests for checkpoint CLI commands
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("Checkpoint CLI Integration", () => {
  const testCheckpointDir = path.join(
    process.cwd(),
    ".lexrunner",
    "checkpoints-test",
    Date.now().toString()
  );
  const cliPath = path.join(process.cwd(), "dist", "cli.js");

  beforeEach(() => {
    // Ensure clean test checkpoint directory
    if (fs.existsSync(testCheckpointDir)) {
      fs.rmSync(testCheckpointDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testCheckpointDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test checkpoint directory
    if (fs.existsSync(testCheckpointDir)) {
      fs.rmSync(testCheckpointDir, { recursive: true, force: true });
    }
  });

  const runCLI = (args: string): { stdout: string; stderr: string; exitCode: number } => {
    try {
      const stdout = execSync(`node ${cliPath} ${args}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exitCode: error.status || 1,
      };
    }
  };

  describe("weave checkpoints list", () => {
    it("should show message when no checkpoints exist", () => {
      const result = runCLI("weave checkpoints list");
      expect(result.stdout).toContain("No checkpoints found");
    });

    it("should show help text", () => {
      const result = runCLI("weave checkpoints list --help");
      expect(result.stdout).toContain("List all available checkpoints");
    });
  });

  describe("weave checkpoints show", () => {
    it("should fail for nonexistent checkpoint", () => {
      const result = runCLI("weave checkpoints show nonexistent");
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Failed to load checkpoint");
    });

    it("should show help text", () => {
      const result = runCLI("weave checkpoints show --help");
      expect(result.stdout).toContain("Show detailed information");
    });
  });

  describe("weave checkpoints clean", () => {
    it("should run without error when no checkpoints exist", () => {
      const result = runCLI("weave checkpoints clean");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cleanup completed");
    });

    it("should show help text", () => {
      const result = runCLI("weave checkpoints clean --help");
      expect(result.stdout).toContain("Clean up old checkpoints");
    });
  });

  describe("weave resume", () => {
    it("should fail when no checkpoints exist", () => {
      const result = runCLI("weave resume --latest");
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("No checkpoints found");
    });

    it("should fail when neither --run-id nor --latest provided", () => {
      const result = runCLI("weave resume");
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Must specify either --run-id or --latest");
    });

    it("should show help text", () => {
      const result = runCLI("weave resume --help");
      expect(result.stdout).toContain("Resume merge-weave execution");
    });
  });

  describe("weave help", () => {
    it("should show resume and checkpoints in help text", () => {
      const result = runCLI("weave --help");
      expect(result.stdout).toContain("resume");
      expect(result.stdout).toContain("checkpoints");
      expect(result.stdout).toContain("Resume from checkpoint");
    });
  });
});
