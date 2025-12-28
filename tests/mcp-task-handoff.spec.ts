/**
 * Integration tests for ADR-007 Task Handoff MCP tools
 * Tests schema validation and tool integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CreateTaskSnapshotArgs,
  SubmitTaskReceiptArgs,
  GetTaskStatusArgs,
  ListPendingTasksArgs,
} from "../src/mcp/types.js";
import { parseTaskSnapshot, parseTaskReceipt } from "../src/schemas/task-contract.js";
import { SnapshotBuilder } from "../src/snapshot/index.js";
import { EngineVerifier } from "../src/verification/index.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("MCP Task Handoff Tools (ADR-007)", () => {
  let testDir: string;

  beforeEach(() => {
    // Create test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-handoff-test-"));

    // Create a test file
    const testFile = path.join(testDir, "test.ts");
    fs.writeFileSync(testFile, "const x = 6;\nexport { x };\n");
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("CreateTaskSnapshotArgs schema validation", () => {
    it("should validate valid arguments", () => {
      expect(() =>
        CreateTaskSnapshotArgs.parse({
          procedure: "post-merge-fix",
          determinism: "D1",
          failureMessage: "Expected 6, received 7",
          failureFileRel: "tests/unit/example.spec.ts",
          failureLine: 42,
          runnerOutputSnip: "FAIL tests/unit/example.spec.ts",
          failureExcerpt: "expect(count).toBe(6);",
          targetFiles: ["tests/unit/example.spec.ts"],
          verificationCmd: "npm test -- tests/unit/example.spec.ts",
          expectedExitCode: 0,
          repoRoot: "/repo",
          repoId: "Guffawaffle/lexrunner",
          commitSha: "abc123",
        })
      ).not.toThrow();
    });

    it("should validate minimal required fields", () => {
      expect(() =>
        CreateTaskSnapshotArgs.parse({
          procedure: "test",
          failureMessage: "Error",
          failureFileRel: "test.ts",
          runnerOutputSnip: "FAIL",
          targetFiles: ["test.ts"],
          verificationCmd: "echo test",
        })
      ).not.toThrow();
    });

    it("should reject invalid determinism level", () => {
      expect(() =>
        CreateTaskSnapshotArgs.parse({
          procedure: "test",
          determinism: "D4", // Invalid
          failureMessage: "Error",
          failureFileRel: "test.ts",
          runnerOutputSnip: "FAIL",
          targetFiles: ["test.ts"],
          verificationCmd: "echo test",
        })
      ).toThrow();
    });

    it("should reject missing required fields", () => {
      expect(() =>
        CreateTaskSnapshotArgs.parse({
          procedure: "test",
          // Missing other required fields
        })
      ).toThrow();
    });
  });

  describe("SubmitTaskReceiptArgs schema validation", () => {
    it("should validate valid receipt", () => {
      const receipt = {
        schema_version: "1.0.0",
        task_id: "test-task",
        snapshot_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        claims: {
          success: true,
          files_touched: ["test.ts"],
          rationale: "Fixed the issue",
          confidence: "high",
          assumptions_made: [],
        },
        search_activity: [],
        cost: {},
        blockers: [],
      };

      expect(() => SubmitTaskReceiptArgs.parse({ receipt })).not.toThrow();
    });

    it("should accept receipt parameter", () => {
      // Since we use z.any() for receipt to allow flexible validation later,
      // we just check that the args schema accepts it
      expect(() => SubmitTaskReceiptArgs.parse({ receipt: {} })).not.toThrow();
    });
  });

  describe("GetTaskStatusArgs schema validation", () => {
    it("should validate valid taskId", () => {
      expect(() => GetTaskStatusArgs.parse({ taskId: "test-task-123" })).not.toThrow();
    });

    it("should reject missing taskId", () => {
      expect(() => GetTaskStatusArgs.parse({})).toThrow();
    });
  });

  describe("ListPendingTasksArgs schema validation", () => {
    it("should validate empty filter", () => {
      expect(() => ListPendingTasksArgs.parse({})).not.toThrow();
    });

    it("should validate with filters", () => {
      expect(() =>
        ListPendingTasksArgs.parse({
          procedure: "post-merge-fix",
          determinism: "D1",
          limit: 10,
        })
      ).not.toThrow();
    });

    it("should reject invalid determinism", () => {
      expect(() =>
        ListPendingTasksArgs.parse({
          determinism: "invalid",
        })
      ).toThrow();
    });
  });

  describe("SnapshotBuilder integration", () => {
    it("should create valid TaskSnapshot_v1", async () => {
      const builder = new SnapshotBuilder({
        repoRoot: testDir,
        repoId: "test/repo",
      });

      const snapshot = await builder.buildSnapshot({
        taskId: "test-task-1",
        procedure: "post-merge-fix",
        determinism: "D1",
        targetFiles: ["test.ts"],
        failure: {
          message: "Test failure",
          fileRel: "test.ts",
          line: 1,
          runnerOutputSnip: "FAIL test.ts",
          excerpt: "const x = 6;",
        },
        commitSha: "abc1234567", // Must be at least 7 chars
        verificationCmd: "echo test",
        expectedExitCode: 0,
      });

      // Validate schema
      const validated = parseTaskSnapshot(snapshot);
      expect(validated.schema_version).toBe("1.0.0");
      expect(validated.task_id).toBe("test-task-1");
      expect(validated.procedure).toBe("post-merge-fix");
      expect(validated.determinism).toBe("D1");
      expect(validated.targets).toHaveLength(1);
      expect(validated.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("should extract hunks from target files", async () => {
      const builder = new SnapshotBuilder({
        repoRoot: testDir,
        repoId: "test/repo",
      });

      const snapshot = await builder.buildSnapshot({
        taskId: "test-task-2",
        procedure: "test",
        targetFiles: ["test.ts"],
        failure: {
          message: "Error",
          fileRel: "test.ts",
          runnerOutputSnip: "FAIL",
        },
        commitSha: "def4567890", // Must be at least 7 chars
        verificationCmd: "echo test",
      });

      expect(snapshot.targets[0].hunk).toBeTruthy();
      expect(snapshot.targets[0].hunk_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  describe("Engine Verifier integration", () => {
    it("should verify successful receipt", async () => {
      // Create a snapshot
      const builder = new SnapshotBuilder({
        repoRoot: testDir,
        repoId: "test/repo",
      });

      const snapshot = await builder.buildSnapshot({
        taskId: "verify-test-1",
        procedure: "test",
        targetFiles: ["test.ts"],
        failure: {
          message: "Test",
          fileRel: "test.ts",
          runnerOutputSnip: "FAIL",
        },
        commitSha: "abc1234567", // Must be at least 7 chars
        verificationCmd: "exit 0", // Always succeeds
        expectedExitCode: 0,
      });

      // Create a receipt
      const receipt = parseTaskReceipt({
        schema_version: "1.0.0",
        task_id: snapshot.task_id,
        snapshot_hash: snapshot.snapshot_hash,
        claims: {
          success: true,
          files_touched: ["test.ts"],
          rationale: "Fixed",
          confidence: "high",
          assumptions_made: [],
        },
        search_activity: [],
        cost: {},
        blockers: [],
      });

      // Verify
      const verifier = new EngineVerifier();
      const result = await verifier.verify({
        snapshot,
        receipt,
        workingDir: testDir,
        applyPatch: false, // Don't apply patch in test
      });

      expect(result.verification.verified).toBe(true);
      expect(result.verification.task_id).toBe(snapshot.task_id);
      expect(result.verification.exit_code).toBe(0);
      expect(result.trustGap).toBe(false); // Agent claimed success, engine verified
    });

    it("should detect trust gap when agent claim differs from verification", async () => {
      const builder = new SnapshotBuilder({
        repoRoot: testDir,
        repoId: "test/repo",
      });

      const snapshot = await builder.buildSnapshot({
        taskId: "trust-gap-test",
        procedure: "test",
        targetFiles: ["test.ts"],
        failure: {
          message: "Test",
          fileRel: "test.ts",
          runnerOutputSnip: "FAIL",
        },
        commitSha: "def4567890", // Must be at least 7 chars
        verificationCmd: "exit 1", // Always fails
        expectedExitCode: 0,
      });

      // Receipt claims success
      const receipt = parseTaskReceipt({
        schema_version: "1.0.0",
        task_id: snapshot.task_id,
        snapshot_hash: snapshot.snapshot_hash,
        claims: {
          success: true, // Agent claims success
          files_touched: [],
          rationale: "Fixed",
          confidence: "high",
          assumptions_made: [],
        },
        search_activity: [],
        cost: {},
        blockers: [],
      });

      const verifier = new EngineVerifier();
      const result = await verifier.verify({
        snapshot,
        receipt,
        workingDir: testDir,
        applyPatch: false,
      });

      expect(result.verification.verified).toBe(false); // Verification failed
      expect(result.trustGap).toBe(true); // Agent claimed success but verification failed
    });
  });
});
