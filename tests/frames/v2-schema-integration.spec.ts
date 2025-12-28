/**
 * Integration test for Lex Frame Schema v2 alignment
 *
 * Tests that LexRunner Frame emission includes all v2 schema fields:
 * - runId: Unique identifier for correlating events
 * - planHash: SHA-256 hash of execution plan for idempotency
 * - spend: Cost tracking metrics (tokens, latency, turn cost)
 *
 * Related:
 * - LexRunner#344 (this issue): Frame schema v2 alignment validation
 * - Lex#88: Frame schema v2 extension
 * - docs/EVENT_SCHEMA.md: Full v2 schema documentation
 */

import { describe, it, expect } from "vitest";
import {
  emitMergeWeaveFrame,
  emitProcedureFrame,
  type MergeWeaveFrameInput,
} from "../../src/frames/emitter.js";
import {
  validateFanoutEvent,
  validateMergeWeaveEvent,
  type FanoutEvent,
  type MergeWeaveEvent,
} from "../../src/hooks/events.js";

describe("Frame Schema v2 Integration", () => {
  describe("v2 Field Validation", () => {
    it("should emit Frame with all v2 required fields (runId, planHash, spend)", () => {
      // Create a v2-compliant Frame with all required fields
      const input: MergeWeaveFrameInput = {
        runId: "550e8400-e29b-41d4-a716-446655440000",
        planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mergedPRs: ["#123", "#124", "#125"],
        conflictsResolved: 2,
        gatesPassed: ["lint", "typecheck", "test"],
        durationMs: 45000,
        outcome: "success",
        targetBranch: "main",
        turnCost: {
          components: {
            latencyMs: 1200,
            contextResetTokens: 0,
            renegotiationCount: 0,
            tokenBloat: 50,
            attentionSwitchCount: 2,
          },
          weightedScore: 145.5,
          eventCount: 12,
          priorRunScore: 180.3,
          improvement: "19.3%",
        },
        tierMetrics: {
          totalTasks: 3,
          byTier: {
            senior: 1,
            mid: 2,
            junior: 0,
          },
          escalations: 0,
          mismatches: 0,
          tierMatchRate: 1.0,
          escalationRate: 0.0,
        },
      };

      const result = emitMergeWeaveFrame(input);

      // Verify Frame was created successfully
      expect(result.success).toBe(true);
      expect(result.frame).toBeDefined();

      const frame = result.frame!;

      // Verify v2 field: runId
      expect(frame.metadata?.run_id).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(frame.metadata?.run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      // Verify v2 field: planHash
      expect(frame.metadata?.plan_hash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
      expect(frame.metadata?.plan_hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify v2 field: spend.duration
      expect(frame.metadata?.duration_ms).toBe(45000);

      // Verify v2 field: spend.turnCost
      expect(frame.metadata?.turn_cost).toBeDefined();
      expect(frame.metadata?.turn_cost?.components.latencyMs).toBe(1200);
      expect(frame.metadata?.turn_cost?.components.contextResetTokens).toBe(0);
      expect(frame.metadata?.turn_cost?.components.renegotiationCount).toBe(0);
      expect(frame.metadata?.turn_cost?.components.tokenBloat).toBe(50);
      expect(frame.metadata?.turn_cost?.components.attentionSwitchCount).toBe(2);
      expect(frame.metadata?.turn_cost?.weightedScore).toBe(145.5);
      expect(frame.metadata?.turn_cost?.eventCount).toBe(12);
      expect(frame.metadata?.turn_cost?.priorRunScore).toBe(180.3);
      expect(frame.metadata?.turn_cost?.improvement).toBe("19.3%");

      // Verify v2 field: spend.tierMetrics
      expect(frame.metadata?.tier_metrics).toBeDefined();
      expect(frame.metadata?.tier_metrics?.totalTasks).toBe(3);
      expect(frame.metadata?.tier_metrics?.byTier.senior).toBe(1);
      expect(frame.metadata?.tier_metrics?.byTier.mid).toBe(2);
      expect(frame.metadata?.tier_metrics?.byTier.junior).toBe(0);
      expect(frame.metadata?.tier_metrics?.escalations).toBe(0);
      expect(frame.metadata?.tier_metrics?.mismatches).toBe(0);
      expect(frame.metadata?.tier_metrics?.tierMatchRate).toBe(1.0);
      expect(frame.metadata?.tier_metrics?.escalationRate).toBe(0.0);
    });

    it("should emit Procedure Frame with v2 fields (runId, planHash)", () => {
      const input = {
        runId: "660f9511-f3ac-52e5-b827-557766551111",
        planHash: "a7b2c33298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999",
        procedure: "release-prepare",
        moduleScope: ["v1.0.0"],
        durationMs: 30000,
        outcome: "success" as const,
        nextActions: ["Tag release", "Push to registry"],
        artifacts: [".lexrunner/releases/v1.0.0.md"],
      };

      const result = emitProcedureFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame).toBeDefined();

      const frame = result.frame!;

      // Verify v2 fields
      expect(frame.metadata?.run_id).toBe("660f9511-f3ac-52e5-b827-557766551111");
      expect(frame.metadata?.plan_hash).toBe(
        "a7b2c33298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999"
      );
      expect(frame.metadata?.duration_ms).toBe(30000);
      expect(frame.metadata?.artifacts).toEqual([".lexrunner/releases/v1.0.0.md"]);
    });
  });

  describe("Hook Event v2 Schema Validation", () => {
    it("should validate FanoutEvent with v2 fields (runId, planHash)", () => {
      const event: FanoutEvent = {
        eventType: "fanout",
        runId: "550e8400-e29b-41d4-a716-446655440000",
        timestamp: "2025-12-14T22:43:58.569Z",
        planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        prList: ["#123", "#124", "#125"],
        modulesTouched: ["lexrunner/src/cli", "lexrunner/src/gates", "lexrunner/src/frames"],
        batchSize: 3,
        totalPRs: 10,
        planContext: {
          planPath: ".smartergpt/plan.json",
          planVersion: "1.0.0",
          planSize: 10,
        },
      };

      // Validate using Zod schema
      const validated = validateFanoutEvent(event);

      // Verify v2 fields are present and valid
      expect(validated.runId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(validated.planHash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });

    it("should validate MergeWeaveEvent with v2 spend fields", () => {
      const event: MergeWeaveEvent = {
        eventType: "merge-weave",
        runId: "550e8400-e29b-41d4-a716-446655440000",
        timestamp: "2025-12-14T23:15:42.123Z",
        planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        outcome: "success",
        conflictInfo: {
          totalConflicts: 3,
          conflictsResolved: 3,
          conflictFiles: ["src/cli.ts", "src/gates.ts", "package.json"],
          conflictTypes: ["content", "content", "add-add"],
        },
        resolution: {
          strategy: "semantic-merge",
          resolvedFiles: ["src/cli.ts", "src/gates.ts", "package.json"],
          unresolvedFiles: [],
        },
        gateResults: {
          totalGates: 4,
          gatesPassed: ["lint", "typecheck", "test", "build"],
          gatesFailed: [],
        },
        spend: {
          duration: 45200,
          turnCost: {
            components: {
              latencyMs: 1200,
              contextResetTokens: 0,
              renegotiationCount: 0,
              tokenBloat: 50,
              attentionSwitchCount: 2,
            },
            weightedScore: 145.5,
            eventCount: 12,
            priorRunScore: 180.3,
            improvement: "19.3%",
          },
          tokenUsage: {
            input: 15000,
            output: 3500,
            total: 18500,
          },
          tierMetrics: {
            totalTasks: 3,
            byTier: {
              senior: 1,
              mid: 2,
              junior: 0,
            },
            escalations: 0,
            mismatches: 0,
            tierMatchRate: 1.0,
            escalationRate: 0.0,
          },
        },
        planContext: {
          planPath: ".smartergpt/plan.json",
          planVersion: "1.0.0",
          planSize: 10,
        },
      };

      // Validate using Zod schema
      const validated = validateMergeWeaveEvent(event);

      // Verify v2 fields
      expect(validated.runId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(validated.planHash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );

      // Verify spend metrics (v2 schema extension)
      expect(validated.spend.duration).toBe(45200);
      expect(validated.spend.turnCost).toBeDefined();
      expect(validated.spend.turnCost?.weightedScore).toBe(145.5);
      expect(validated.spend.tokenUsage).toBeDefined();
      expect(validated.spend.tokenUsage?.total).toBe(18500);
      expect(validated.spend.tierMetrics).toBeDefined();
      expect(validated.spend.tierMetrics?.totalTasks).toBe(3);
    });
  });

  describe("v2 Schema Edge Cases", () => {
    it("should handle minimal spend metrics (duration only)", () => {
      const event: MergeWeaveEvent = {
        eventType: "merge-weave",
        runId: "550e8400-e29b-41d4-a716-446655440000",
        timestamp: "2025-12-14T23:15:42.123Z",
        planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        outcome: "success",
        conflictInfo: {
          totalConflicts: 0,
          conflictsResolved: 0,
          conflictFiles: [],
        },
        resolution: {
          strategy: "none",
          resolvedFiles: [],
          unresolvedFiles: [],
        },
        gateResults: {
          totalGates: 1,
          gatesPassed: ["lint"],
          gatesFailed: [],
        },
        spend: {
          duration: 1000, // Minimal: only duration required
        },
        planContext: {
          planPath: ".smartergpt/plan.json",
          planVersion: "1.0.0",
          planSize: 1,
        },
      };

      const validated = validateMergeWeaveEvent(event);

      // Verify minimal spend is valid
      expect(validated.spend.duration).toBe(1000);
      expect(validated.spend.turnCost).toBeUndefined();
      expect(validated.spend.tokenUsage).toBeUndefined();
      expect(validated.spend.tierMetrics).toBeUndefined();
    });

    it("should validate runId as UUID v4 format", () => {
      const validUUIDs = [
        "550e8400-e29b-41d4-a716-446655440000",
        "660f9511-f3ac-52e5-b827-557766551111",
        "01234567-89ab-4cde-8901-234567890abc",
      ];

      for (const uuid of validUUIDs) {
        const event: FanoutEvent = {
          eventType: "fanout",
          runId: uuid,
          timestamp: "2025-12-14T22:43:58.569Z",
          planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          prList: ["#123"],
          modulesTouched: ["test"],
          batchSize: 1,
          totalPRs: 1,
          planContext: {
            planPath: "plan.json",
            planVersion: "1.0.0",
            planSize: 1,
          },
        };

        // Should not throw
        const validated = validateFanoutEvent(event);
        expect(validated.runId).toBe(uuid);
      }
    });

    it("should validate planHash as SHA-256 (64 hex chars)", () => {
      const validHashes = [
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ];

      for (const hash of validHashes) {
        const event: FanoutEvent = {
          eventType: "fanout",
          runId: "550e8400-e29b-41d4-a716-446655440000",
          timestamp: "2025-12-14T22:43:58.569Z",
          planHash: hash,
          prList: ["#123"],
          modulesTouched: ["test"],
          batchSize: 1,
          totalPRs: 1,
          planContext: {
            planPath: "plan.json",
            planVersion: "1.0.0",
            planSize: 1,
          },
        };

        // Should not throw
        const validated = validateFanoutEvent(event);
        expect(validated.planHash).toBe(hash);
      }
    });

    it("should reject invalid planHash format", () => {
      const invalidHashes = [
        "too-short",
        "not-hex-GGGG0000000000000000000000000000000000000000000000000000000000",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85", // 63 chars
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8555", // 65 chars
      ];

      for (const hash of invalidHashes) {
        const event = {
          eventType: "fanout",
          runId: "550e8400-e29b-41d4-a716-446655440000",
          timestamp: "2025-12-14T22:43:58.569Z",
          planHash: hash,
          prList: ["#123"],
          modulesTouched: ["test"],
          batchSize: 1,
          totalPRs: 1,
          planContext: {
            planPath: "plan.json",
            planVersion: "1.0.0",
            planSize: 1,
          },
        };

        expect(() => validateFanoutEvent(event)).toThrow();
      }
    });
  });

  describe("Cross-Reference with WeaveLock", () => {
    it("should document runId source from weave-lock.json", () => {
      // This test documents the relationship between Frame emission and WeaveLock
      // Actual integration is validated in weave tests

      // Frame emitters receive runId and planHash from WeaveContext
      // WeaveContext.runId comes from WeaveLockFile.runId
      // WeaveContext.metadata.planHash comes from WeaveLockFile.planHash

      const mockRunIdFromWeaveLock = "550e8400-e29b-41d4-a716-446655440000";
      const mockPlanHashFromWeaveLock =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      const input: MergeWeaveFrameInput = {
        runId: mockRunIdFromWeaveLock, // From WeaveLockFile.runId
        planHash: mockPlanHashFromWeaveLock, // From WeaveLockFile.planHash
        mergedPRs: ["#123"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success",
        targetBranch: "main",
      };

      const result = emitMergeWeaveFrame(input);

      expect(result.success).toBe(true);
      expect(result.frame?.metadata?.run_id).toBe(mockRunIdFromWeaveLock);
      expect(result.frame?.metadata?.plan_hash).toBe(mockPlanHashFromWeaveLock);
    });
  });
});
