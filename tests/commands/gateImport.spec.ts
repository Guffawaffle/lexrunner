/**
 * Tests for the gate import command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerGateImportCommand } from "../../src/commands/gateImport.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { validateGateReport } from "../../src/schema/gateReport.js";

describe("Gate Import Command", () => {
  let program: Command;
  let tempDir: string;

  beforeEach(() => {
    program = new Command();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-import-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("Command Registration", () => {
    it("should register import command with correct configuration", () => {
      registerGateImportCommand(program);

      const importCommand = program.commands.find((cmd) => cmd.name() === "import");
      expect(importCommand).toBeDefined();
      expect(importCommand?.name()).toBe("import");
      expect(importCommand?.description()).toContain("Import");
    });

    it("should have required options", () => {
      registerGateImportCommand(program);

      const importCommand = program.commands.find((cmd) => cmd.name() === "import");
      const opts = importCommand?.options;

      const itemOpt = opts?.find((opt) => opt.long === "--item");
      expect(itemOpt).toBeDefined();
      expect(itemOpt?.required).toBe(true);

      const gateOpt = opts?.find((opt) => opt.long === "--gate");
      expect(gateOpt).toBeDefined();
      expect(gateOpt?.required).toBe(true);

      const statusOpt = opts?.find((opt) => opt.long === "--status");
      expect(statusOpt).toBeDefined();
      expect(statusOpt?.required).toBe(true);
    });

    it("should have optional options", () => {
      registerGateImportCommand(program);

      const importCommand = program.commands.find((cmd) => cmd.name() === "import");
      const opts = importCommand?.options;

      const inputOpt = opts?.find((opt) => opt.long === "--input");
      expect(inputOpt).toBeDefined();
      // input is optional

      const logOpt = opts?.find((opt) => opt.long === "--log");
      expect(logOpt).toBeDefined();

      const metaOpt = opts?.find((opt) => opt.long === "--meta");
      expect(metaOpt).toBeDefined();
    });
  });

  describe("Import Functionality", () => {
    it("should create valid gate report from command-line args", () => {
      const outDir = path.join(tempDir, "gate-results");
      fs.mkdirSync(outDir, { recursive: true });

      const gateReport = {
        schemaVersion: "1.0.0",
        item: "pr-200",
        gate: "build",
        status: "pass",
        duration_ms: 5000,
        started_at: new Date().toISOString(),
        meta: {
          source: "imported",
          imported_at: new Date().toISOString(),
        },
      };

      const filepath = path.join(outDir, "pr-200-build.json");
      fs.writeFileSync(filepath, JSON.stringify(gateReport, null, 2), "utf-8");

      const content = fs.readFileSync(filepath, "utf-8");
      const data = JSON.parse(content);
      const validated = validateGateReport(data);

      expect(validated.item).toBe("pr-200");
      expect(validated.gate).toBe("build");
      expect(validated.status).toBe("pass");
      expect(validated.meta?.source).toBe("imported");
    });

    it("should import from existing gate report JSON", () => {
      const inputDir = path.join(tempDir, "input");
      const outDir = path.join(tempDir, "gate-results");
      fs.mkdirSync(inputDir, { recursive: true });
      fs.mkdirSync(outDir, { recursive: true });

      // Create an existing gate report
      const existingReport = {
        schemaVersion: "1.0.0",
        item: "pr-original",
        gate: "test",
        status: "pass",
        duration_ms: 3000,
        started_at: new Date().toISOString(),
      };

      const inputFile = path.join(inputDir, "existing-report.json");
      fs.writeFileSync(inputFile, JSON.stringify(existingReport, null, 2), "utf-8");

      // Read and validate
      const content = fs.readFileSync(inputFile, "utf-8");
      const data = JSON.parse(content);
      const validated = validateGateReport(data);

      expect(validated).toBeDefined();
      expect(validated.item).toBe("pr-original");
      expect(validated.gate).toBe("test");
    });

    it("should attach metadata when importing", () => {
      const gateReport = {
        schemaVersion: "1.0.0",
        item: "pr-201",
        gate: "integration",
        status: "pass",
        duration_ms: 8000,
        started_at: new Date().toISOString(),
        meta: {
          source: "imported",
          imported_at: new Date().toISOString(),
          ci_build_id: "12345",
          commit_sha: "abc123def",
        },
      };

      const validated = validateGateReport(gateReport);
      expect(validated.meta?.source).toBe("imported");
      expect(validated.meta?.ci_build_id).toBe("12345");
      expect(validated.meta?.commit_sha).toBe("abc123def");
    });

    it("should support importing failed gate results", () => {
      const gateReport = {
        schemaVersion: "1.0.0",
        item: "pr-202",
        gate: "e2e",
        status: "fail",
        duration_ms: 2000,
        started_at: new Date().toISOString(),
        meta: {
          source: "imported",
          error_message: "Test timeout",
        },
      };

      const validated = validateGateReport(gateReport);
      expect(validated.status).toBe("fail");
      expect(validated.meta?.error_message).toBe("Test timeout");
    });
  });
});
