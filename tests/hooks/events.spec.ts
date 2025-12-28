import { describe, it, expect } from "vitest";
import {
  validateFanoutEvent,
  safeValidateFanoutEvent,
  validateMergeWeaveEvent,
  safeValidateMergeWeaveEvent,
  validateHookEvent,
  safeValidateHookEvent,
  type FanoutEvent,
  type MergeWeaveEvent,
} from "../../src/hooks/events.js";

describe("Hook Event Schemas", () => {
  describe("FanoutEvent", () => {
    const validFanoutEvent: FanoutEvent = {
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

    it("should validate a valid FanoutEvent", () => {
      const result = validateFanoutEvent(validFanoutEvent);
      expect(result).toEqual(validFanoutEvent);
    });

    it("should safely validate a valid FanoutEvent", () => {
      const result = safeValidateFanoutEvent(validFanoutEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFanoutEvent);
      }
    });

    it("should validate with optional metadata", () => {
      const eventWithMetadata: FanoutEvent = {
        ...validFanoutEvent,
        metadata: {
          executionMode: "parallel",
          targetBranch: "main",
          repository: "Guffawaffle/LexRunner",
          batchIndex: 0,
          estimatedDuration: 300000,
        },
      };

      const result = validateFanoutEvent(eventWithMetadata);
      expect(result).toEqual(eventWithMetadata);
    });

    it("should reject invalid eventType", () => {
      const invalid = {
        ...validFanoutEvent,
        eventType: "invalid",
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should reject invalid UUID", () => {
      const invalid = {
        ...validFanoutEvent,
        runId: "not-a-uuid",
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should reject invalid planHash format", () => {
      const invalid = {
        ...validFanoutEvent,
        planHash: "too-short",
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should reject empty prList", () => {
      const invalid = {
        ...validFanoutEvent,
        prList: [],
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should reject empty modulesTouched", () => {
      const invalid = {
        ...validFanoutEvent,
        modulesTouched: [],
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should reject negative batchSize", () => {
      const invalid = {
        ...validFanoutEvent,
        batchSize: -1,
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should reject zero batchSize", () => {
      const invalid = {
        ...validFanoutEvent,
        batchSize: 0,
      };

      expect(() => validateFanoutEvent(invalid)).toThrow();
    });

    it("should safely return error for invalid event", () => {
      const invalid = {
        ...validFanoutEvent,
        eventType: "invalid",
      };

      const result = safeValidateFanoutEvent(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("MergeWeaveEvent", () => {
    const validMergeWeaveEvent: MergeWeaveEvent = {
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
        resolutionNotes: "Auto-merged imports and dependency versions",
      },
      gateResults: {
        totalGates: 4,
        gatesPassed: ["lint", "typecheck", "test", "build"],
        gatesFailed: [],
        gateDetails: [
          {
            name: "lint",
            status: "pass",
            duration: 2500,
            exitCode: 0,
          },
          {
            name: "typecheck",
            status: "pass",
            duration: 5200,
            exitCode: 0,
          },
          {
            name: "test",
            status: "pass",
            duration: 12300,
            exitCode: 0,
            artifacts: [".smartergpt/runner/cache/test-results.xml"],
          },
          {
            name: "build",
            status: "pass",
            duration: 8900,
            exitCode: 0,
          },
        ],
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

    it("should validate a valid MergeWeaveEvent", () => {
      const result = validateMergeWeaveEvent(validMergeWeaveEvent);
      expect(result).toEqual(validMergeWeaveEvent);
    });

    it("should safely validate a valid MergeWeaveEvent", () => {
      const result = safeValidateMergeWeaveEvent(validMergeWeaveEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validMergeWeaveEvent);
      }
    });

    it("should validate with optional metadata", () => {
      const eventWithMetadata: MergeWeaveEvent = {
        ...validMergeWeaveEvent,
        metadata: {
          targetBranch: "main",
          integrationBranch: "integration/wave-1",
          mergedPRs: ["#123", "#124", "#125"],
          failedPRs: [],
          repository: "Guffawaffle/LexRunner",
        },
      };

      const result = validateMergeWeaveEvent(eventWithMetadata);
      expect(result).toEqual(eventWithMetadata);
    });

    it("should validate partial outcome", () => {
      const partialEvent: MergeWeaveEvent = {
        ...validMergeWeaveEvent,
        outcome: "partial",
        resolution: {
          strategy: "manual",
          resolvedFiles: ["src/cli.ts"],
          unresolvedFiles: ["src/schema.ts"],
          resolutionNotes: "Manual intervention required",
        },
        gateResults: {
          totalGates: 2,
          gatesPassed: ["lint"],
          gatesFailed: ["typecheck"],
        },
        metadata: {
          error: "Type conflicts require manual resolution",
        },
      };

      const result = validateMergeWeaveEvent(partialEvent);
      expect(result.outcome).toBe("partial");
      expect(result.resolution.unresolvedFiles).toHaveLength(1);
      expect(result.gateResults.gatesFailed).toHaveLength(1);
    });

    it("should validate failure outcome", () => {
      const failureEvent: MergeWeaveEvent = {
        ...validMergeWeaveEvent,
        outcome: "failure",
        conflictInfo: {
          totalConflicts: 10,
          conflictsResolved: 0,
          conflictFiles: ["src/cli.ts"],
        },
        resolution: {
          strategy: "none",
          resolvedFiles: [],
          unresolvedFiles: ["src/cli.ts"],
        },
        gateResults: {
          totalGates: 0,
          gatesPassed: [],
          gatesFailed: [],
        },
        metadata: {
          error: "Failed to resolve conflicts",
        },
      };

      const result = validateMergeWeaveEvent(failureEvent);
      expect(result.outcome).toBe("failure");
      expect(result.metadata?.error).toBeDefined();
    });

    it("should reject invalid outcome", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        outcome: "invalid",
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should reject negative conflicts", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        conflictInfo: {
          ...validMergeWeaveEvent.conflictInfo,
          totalConflicts: -1,
        },
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should reject invalid gate status", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        gateResults: {
          ...validMergeWeaveEvent.gateResults,
          gateDetails: [
            {
              name: "lint",
              status: "invalid",
              duration: 100,
              exitCode: 0,
            },
          ],
        },
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should reject negative duration", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        spend: {
          ...validMergeWeaveEvent.spend,
          duration: -100,
        },
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should reject zero duration", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        spend: {
          ...validMergeWeaveEvent.spend,
          duration: 0,
        },
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should reject invalid conflict type", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        conflictInfo: {
          ...validMergeWeaveEvent.conflictInfo,
          conflictTypes: ["invalid-type"],
        },
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should reject tierMatchRate out of range", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        spend: {
          ...validMergeWeaveEvent.spend,
          tierMetrics: {
            totalTasks: 3,
            byTier: { senior: 1, mid: 2, junior: 0 },
            escalations: 0,
            mismatches: 0,
            tierMatchRate: 1.5, // Invalid: > 1
            escalationRate: 0.0,
          },
        },
      };

      expect(() => validateMergeWeaveEvent(invalid)).toThrow();
    });

    it("should safely return error for invalid event", () => {
      const invalid = {
        ...validMergeWeaveEvent,
        outcome: "invalid",
      };

      const result = safeValidateMergeWeaveEvent(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    it("should validate minimal spend metrics", () => {
      const minimalEvent: MergeWeaveEvent = {
        ...validMergeWeaveEvent,
        spend: {
          duration: 1000,
        },
      };

      const result = validateMergeWeaveEvent(minimalEvent);
      expect(result.spend.duration).toBe(1000);
      expect(result.spend.turnCost).toBeUndefined();
      expect(result.spend.tokenUsage).toBeUndefined();
    });
  });

  describe("HookEvent discriminated union", () => {
    const validFanoutEvent: FanoutEvent = {
      eventType: "fanout",
      runId: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: "2025-12-14T22:43:58.569Z",
      planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      prList: ["#123"],
      modulesTouched: ["lexrunner/src/cli"],
      batchSize: 1,
      totalPRs: 1,
      planContext: {
        planPath: ".smartergpt/plan.json",
        planVersion: "1.0.0",
        planSize: 1,
      },
    };

    const validMergeWeaveEvent: MergeWeaveEvent = {
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
        duration: 1000,
      },
      planContext: {
        planPath: ".smartergpt/plan.json",
        planVersion: "1.0.0",
        planSize: 1,
      },
    };

    it("should validate FanoutEvent via union", () => {
      const result = validateHookEvent(validFanoutEvent);
      expect(result.eventType).toBe("fanout");
    });

    it("should validate MergeWeaveEvent via union", () => {
      const result = validateHookEvent(validMergeWeaveEvent);
      expect(result.eventType).toBe("merge-weave");
    });

    it("should safely validate FanoutEvent via union", () => {
      const result = safeValidateHookEvent(validFanoutEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.eventType).toBe("fanout");
      }
    });

    it("should safely validate MergeWeaveEvent via union", () => {
      const result = safeValidateHookEvent(validMergeWeaveEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.eventType).toBe("merge-weave");
      }
    });

    it("should reject event with invalid discriminator", () => {
      const invalid = {
        eventType: "invalid-type",
        runId: "550e8400-e29b-41d4-a716-446655440000",
      };

      expect(() => validateHookEvent(invalid)).toThrow();
    });
  });
});
