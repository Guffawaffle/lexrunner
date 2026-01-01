/**
 * Frame Emission CI Gate Integration Tests
 *
 * These tests validate Frame emission in CI-realistic scenarios:
 * 1. Merge-weave with Frame emission enabled
 * 2. Module ID resolution via aliases
 * 3. Schema v2 compliance
 * 4. Atlas Frame generation patterns
 *
 * Implements: LPR-009 / Issue #318
 *
 * @see docs/EVENT_SCHEMA.md for full v2 schema documentation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  emitMergeWeaveFrame,
  emitExecutorFrame,
  emitGateFrame,
  emitProcedureFrame,
} from "../../src/frames/emitter.js";
import {
  validateFanoutEvent,
  validateMergeWeaveEvent,
  FanoutEventSchema,
  MergeWeaveEventSchema,
} from "../../src/hooks/events.js";
import type { MergeWeaveFrameInput, GateFrameInput } from "../../src/frames/types.js";

// Mock the alias resolver for CI environment (no Lex policy access)
vi.mock("../../src/aliases/index.js", () => ({
  resolveModulePaths: vi.fn(async (paths: string[]) =>
    paths.map((path) => ({
      canonical: path.startsWith("src/") ? `core/${path.replace("src/", "")}` : path,
      original: path,
      resolved: path.startsWith("src/"),
      confidence: path.startsWith("src/") ? 0.95 : 1.0,
    }))
  ),
  extractCanonicalIds: vi.fn((resolutions: { canonical: string }[]) =>
    resolutions.map((r) => r.canonical)
  ),
}));

describe("Frame Emission CI Gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Merge-Weave Frame Emission", () => {
    it("should emit Frame with all v2 required fields for CI validation", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "ci-gate-test-001",
        planHash: "sha256:abc123def456",
        mergedPRs: ["#101", "#102", "#103"],
        conflictsResolved: 1,
        gatesPassed: ["lint", "typecheck", "test"],
        gatesFailed: [],
        durationMs: 30000,
        outcome: "success",
        targetBranch: "main",
      };

      const result = await emitMergeWeaveFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame).toBeDefined();

      const frame = result.frame!;

      // V2 schema compliance checks
      expect(frame.metadata?.run_id).toBe("ci-gate-test-001");
      expect(frame.metadata?.plan_hash).toBe("sha256:abc123def456");

      // Core frame structure
      expect(frame.type).toBe("merge-weave");
      expect(frame.outcome).toBe("success");
      expect(frame.reference_point).toMatch(/^merge-weave-\d{4}-\d{2}-\d{2}-[a-z0-9]+$/);
      expect(frame.module_scope).toEqual(["#101", "#102", "#103"]);
      expect(frame.keywords).toContain("merge-weave");
      expect(frame.keywords).toContain("main");
      expect(frame.next_actions).toContain("Run e2e tests");
    });

    it("should handle failure outcomes with proper error metadata", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "ci-gate-test-002",
        planHash: "sha256:failure-case",
        mergedPRs: ["#201"],
        conflictsResolved: 0,
        gatesPassed: [],
        gatesFailed: ["typecheck"],
        durationMs: 5000,
        outcome: "failure",
        targetBranch: "main",
        error: "TypeScript compilation failed: TS2345",
      };

      const result = await emitMergeWeaveFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame?.outcome).toBe("failure");
      expect(result.frame?.metadata?.error).toContain("TS2345");
      expect(result.frame?.metadata?.gates_failed).toEqual(["typecheck"]);
      expect(result.frame?.next_actions).toContain("Review merge failure logs");
    });

    it("should handle partial success with both passed and failed gates", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "ci-gate-test-003",
        planHash: "sha256:partial-case",
        mergedPRs: ["#301", "#302"],
        conflictsResolved: 1,
        gatesPassed: ["lint"],
        gatesFailed: ["test"],
        durationMs: 15000,
        outcome: "partial",
        targetBranch: "integration",
      };

      const result = await emitMergeWeaveFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame?.outcome).toBe("partial");
      expect(result.frame?.metadata?.gates_passed).toEqual(["lint"]);
      expect(result.frame?.metadata?.gates_failed).toEqual(["test"]);
      expect(result.frame?.summary_caption).toContain("Partially merged");
    });
  });

  describe("Module ID Resolution via Aliases", () => {
    it("should resolve src/ paths to canonical module IDs", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "ci-alias-test-001",
        planHash: "sha256:alias-test",
        mergedPRs: ["src/frames/emitter.ts", "src/hooks/events.ts"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success",
        targetBranch: "main",
      };

      const result = await emitMergeWeaveFrame(input);

      expect(result.success).toBe(true);
      // Mock resolver prefixes src/ paths with core/
      expect(result.frame?.module_scope).toEqual([
        "core/frames/emitter.ts",
        "core/hooks/events.ts",
      ]);
    });

    it("should pass through PR numbers without resolution", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "ci-alias-test-002",
        planHash: "sha256:pr-passthrough",
        mergedPRs: ["#123", "#456"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success",
        targetBranch: "main",
      };

      const result = await emitMergeWeaveFrame(input);

      expect(result.success).toBe(true);
      // PR numbers should pass through unchanged
      expect(result.frame?.module_scope).toEqual(["#123", "#456"]);
    });
  });

  describe("Gate Frame Emission", () => {
    it("should emit Gate frame with correct structure", async () => {
      const input: GateFrameInput = {
        runId: "ci-gate-frame-001",
        gateName: "lint",
        itemName: "PR-123",
        durationMs: 5000,
        outcome: "success",
        exitCode: 0,
      };

      const result = await emitGateFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame).toBeDefined();

      const frame = result.frame!;
      expect(frame.type).toBe("gate");
      expect(frame.outcome).toBe("success");
      expect(frame.reference_point).toMatch(/^gate-lint-PR-123-\d{4}-\d{2}-\d{2}-[a-z0-9]+$/);
      expect(frame.metadata?.run_id).toBe("ci-gate-frame-001");
      expect(frame.metadata?.exit_code).toBe(0);
    });

    it("should emit Gate frame for failed gate with error details", async () => {
      const input: GateFrameInput = {
        runId: "ci-gate-frame-002",
        gateName: "typecheck",
        itemName: "PR-456",
        durationMs: 8000,
        outcome: "failure",
        exitCode: 1,
        error: "error TS2345: Argument of type 'string' is not assignable",
      };

      const result = await emitGateFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame?.outcome).toBe("failure");
      expect(result.frame?.metadata?.exit_code).toBe(1);
      expect(result.frame?.metadata?.error).toContain("TS2345");
    });
  });

  describe("Event Schema Validation", () => {
    it("should validate FanoutEvent schema", () => {
      const event = {
        eventType: "fanout" as const,
        runId: "550e8400-e29b-41d4-a716-446655440000", // UUID v4
        timestamp: new Date().toISOString(),
        planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // 64 hex chars
        prList: ["#101", "#102"],
        modulesTouched: ["core/frames", "core/hooks"],
        batchSize: 2,
        totalPRs: 2,
        planContext: {
          planPath: ".smartergpt/plan.json",
          planVersion: "1.0.0",
          planSize: 2,
        },
      };

      const result = FanoutEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should validate MergeWeaveEvent schema", () => {
      const event = {
        eventType: "merge-weave" as const,
        runId: "550e8400-e29b-41d4-a716-446655440000", // UUID v4
        timestamp: new Date().toISOString(),
        planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // 64 hex chars
        outcome: "success" as const,
        conflictInfo: {
          totalConflicts: 1,
          conflictsResolved: 1,
          conflictFiles: ["src/cli.ts"],
        },
        resolution: {
          strategy: "manual",
          resolvedFiles: ["src/cli.ts"],
          unresolvedFiles: [],
        },
        gateResults: {
          totalGates: 2,
          gatesPassed: ["lint", "test"],
          gatesFailed: [],
        },
        spend: {
          duration: 30000,
        },
        planContext: {
          planPath: ".smartergpt/plan.json",
          planVersion: "1.0.0",
          planSize: 3,
        },
      };

      const result = MergeWeaveEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should reject invalid MergeWeaveEvent", () => {
      const invalidEvent = {
        eventType: "merge-weave",
        // Missing required fields
        runId: "not-a-uuid",
      };

      const result = MergeWeaveEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });
  });

  describe("Atlas Frame Generation Patterns", () => {
    it("should generate consistent Frame IDs for deterministic tracking (idempotency)", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "atlas-pattern-001",
        planHash: "sha256:atlas-test",
        mergedPRs: ["#1"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success",
        targetBranch: "main",
      };

      const result1 = await emitMergeWeaveFrame(input);
      const result2 = await emitMergeWeaveFrame(input);

      // With idempotency, same content produces same Frame ID (better for Atlas tracking)
      expect(result1.frameId).toBe(result2.frameId);

      // Structure should be consistent
      expect(result1.frame?.type).toBe(result2.frame?.type);
      expect(result1.frame?.module_scope).toEqual(result2.frame?.module_scope);
    });

    it("should include keywords for Atlas neighbor discovery", async () => {
      const input: MergeWeaveFrameInput = {
        runId: "atlas-keywords-001",
        planHash: "sha256:keywords-test",
        mergedPRs: ["#1"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success",
        targetBranch: "feature/new-api",
      };

      const result = await emitMergeWeaveFrame(input);

      expect(result.frame?.keywords).toContain("merge-weave");
      expect(result.frame?.keywords).toContain("integration");
      expect(result.frame?.keywords).toContain("feature/new-api");
    });
  });
});
