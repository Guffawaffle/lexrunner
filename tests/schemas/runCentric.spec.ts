/**
 * Run-Centric Schemas Tests
 * Tests for StatusResponse, NextOption, and PersonaSnapshot schemas
 */

import { describe, it, expect } from "vitest";
import {
  StatusResponseSchema,
  NextOptionSchema,
  PersonaSnapshotSchema,
  parseStatusResponse,
  parseNextOption,
  parsePersonaSnapshot,
  safeParseStatusResponse,
  safeParseNextOption,
  safeParsePersonaSnapshot,
  type StatusResponse,
  type NextOption,
  type PersonaSnapshot,
} from "../../src/schemas/runCentric.js";

describe("Run-Centric Schemas", () => {
  describe("PersonaSnapshotSchema", () => {
    it("should validate a complete PersonaSnapshot", () => {
      const validSnapshot: PersonaSnapshot = {
        mode: "senior-dev",
        forbidden: ["force-push", "delete-branch"],
        completionGates: ["lint", "test", "build"],
        decisionStyle: {
          preferSmallDiffs: true,
          requireRationaleForSkips: true,
          escalateSecurityFindings: false,
        },
        outputFormat: {
          severityLevels: ["critical", "high", "medium", "low"],
          requireSeverityOnFindings: true,
        },
      };

      const result = PersonaSnapshotSchema.parse(validSnapshot);
      expect(result.mode).toBe("senior-dev");
      expect(result.forbidden).toEqual(["force-push", "delete-branch"]);
      expect(result.completionGates).toEqual(["lint", "test", "build"]);
      expect(result.decisionStyle?.preferSmallDiffs).toBe(true);
    });

    it("should validate a minimal PersonaSnapshot", () => {
      const minimalSnapshot = {
        mode: "default",
        forbidden: [],
        completionGates: [],
      };

      const result = PersonaSnapshotSchema.parse(minimalSnapshot);
      expect(result.mode).toBe("default");
      expect(result.forbidden).toEqual([]);
      expect(result.completionGates).toEqual([]);
      expect(result.decisionStyle).toBeUndefined();
      expect(result.outputFormat).toBeUndefined();
    });

    it("should reject missing required fields", () => {
      const invalidSnapshot = {
        mode: "test",
        // Missing forbidden and completionGates
      };

      expect(() => PersonaSnapshotSchema.parse(invalidSnapshot)).toThrow();
    });

    it("should use parsePersonaSnapshot function", () => {
      const snapshot = parsePersonaSnapshot({
        mode: "reviewer",
        forbidden: ["merge"],
        completionGates: ["approve"],
      });
      expect(snapshot.mode).toBe("reviewer");
    });

    it("should return errors via safeParsePersonaSnapshot", () => {
      const result = safeParsePersonaSnapshot({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("NextOptionSchema", () => {
    it("should validate a simple NextOption", () => {
      const validOption: NextOption = {
        action: "merge_next",
        description: "Merge the next PR in the dependency chain.",
      };

      const result = NextOptionSchema.parse(validOption);
      expect(result.action).toBe("merge_next");
      expect(result.description).toBe("Merge the next PR in the dependency chain.");
    });

    it("should validate a NextOption with all optional fields", () => {
      const fullOption: NextOption = {
        action: "resolve_conflict",
        description: "Resolve the merge conflict in src/cli.ts.",
        requiresLLMDecision: true,
        prompt: "Review the conflict markers and choose the correct resolution.",
        responseSchema: {
          type: "object",
          properties: {
            resolution: { type: "string" },
          },
        },
        objective: "Preserve functionality from both branches",
        constraints: ["Do not remove tests", "Maintain backwards compatibility"],
        style: "detailed",
        riskLevel: "medium",
      };

      const result = NextOptionSchema.parse(fullOption);
      expect(result.requiresLLMDecision).toBe(true);
      expect(result.style).toBe("detailed");
      expect(result.riskLevel).toBe("medium");
      expect(result.constraints).toHaveLength(2);
    });

    it("should validate all riskLevel values", () => {
      const riskLevels = ["low", "medium", "high"] as const;

      for (const riskLevel of riskLevels) {
        const option = {
          action: "test_action",
          description: "Test description.",
          riskLevel,
        };

        const result = NextOptionSchema.parse(option);
        expect(result.riskLevel).toBe(riskLevel);
      }
    });

    it("should validate all style values", () => {
      const styles = ["brief", "detailed"] as const;

      for (const style of styles) {
        const option = {
          action: "test_action",
          description: "Test description.",
          style,
        };

        const result = NextOptionSchema.parse(option);
        expect(result.style).toBe(style);
      }
    });

    it("should reject invalid riskLevel", () => {
      const invalidOption = {
        action: "test",
        description: "Test.",
        riskLevel: "invalid",
      };

      expect(() => NextOptionSchema.parse(invalidOption)).toThrow();
    });

    it("should reject invalid style", () => {
      const invalidOption = {
        action: "test",
        description: "Test.",
        style: "verbose",
      };

      expect(() => NextOptionSchema.parse(invalidOption)).toThrow();
    });

    it("should reject missing required fields", () => {
      expect(() => NextOptionSchema.parse({ action: "test" })).toThrow();
      expect(() => NextOptionSchema.parse({ description: "test" })).toThrow();
      expect(() => NextOptionSchema.parse({})).toThrow();
    });

    it("should use parseNextOption function", () => {
      const option = parseNextOption({
        action: "abort_run",
        description: "Abort the current run.",
      });
      expect(option.action).toBe("abort_run");
    });

    it("should return errors via safeParseNextOption", () => {
      const result = safeParseNextOption({ action: "test" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it("should handle responseSchema with any JSON schema", () => {
      const option = parseNextOption({
        action: "provide_input",
        description: "Provide structured input.",
        responseSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            count: { type: "number" },
          },
          required: ["name"],
        },
      });
      expect(option.responseSchema).toBeDefined();
      expect((option.responseSchema as any).type).toBe("object");
    });
  });

  describe("StatusResponseSchema", () => {
    it("should validate a minimal StatusResponse", () => {
      const minimalResponse: StatusResponse = {
        runId: "01HXYZ123ABC",
        state: "planning",
        mode: "senior-dev",
        procedure: "merge-weave-main",
        summary: "Initializing merge-weave procedure.",
        nextOptions: [],
      };

      const result = StatusResponseSchema.parse(minimalResponse);
      expect(result.runId).toBe("01HXYZ123ABC");
      expect(result.state).toBe("planning");
      expect(result.nextOptions).toEqual([]);
    });

    it("should validate a complete StatusResponse", () => {
      const fullResponse: StatusResponse = {
        runId: "01HXYZ123ABC",
        state: "gated",
        mode: "senior-dev",
        procedure: "merge-weave-main",
        summary: "Waiting for lint gate to pass on PR #42.",
        progress: {
          completed: ["fetch-prs", "analyze-deps"],
          current: "run-gates",
          remaining: ["merge-prs", "cleanup"],
        },
        nextOptions: [
          {
            action: "retry_gate",
            description: "Retry the failing lint gate.",
            riskLevel: "low",
          },
          {
            action: "skip_gate",
            description: "Skip the lint gate and continue.",
            requiresLLMDecision: true,
            prompt: "Provide rationale for skipping.",
            riskLevel: "medium",
          },
        ],
        context: {
          prNumber: 42,
          branchName: "feature/new-thing",
        },
        riskFlags: ["unstable-ci", "large-diff"],
        blockers: ["lint gate failing"],
        persona: {
          mode: "senior-dev",
          forbidden: ["force-push"],
          completionGates: ["lint", "test"],
          decisionStyle: {
            preferSmallDiffs: true,
          },
        },
      };

      const result = StatusResponseSchema.parse(fullResponse);
      expect(result.progress?.completed).toEqual(["fetch-prs", "analyze-deps"]);
      expect(result.progress?.current).toBe("run-gates");
      expect(result.nextOptions).toHaveLength(2);
      expect(result.riskFlags).toContain("unstable-ci");
      expect(result.blockers).toContain("lint gate failing");
      expect(result.persona?.mode).toBe("senior-dev");
    });

    it("should validate progress with null current step", () => {
      const response = {
        runId: "run-1",
        state: "completed",
        mode: "default",
        procedure: "simple",
        summary: "Run completed successfully.",
        progress: {
          completed: ["step-1", "step-2"],
          current: null,
          remaining: [],
        },
        nextOptions: [],
      };

      const result = StatusResponseSchema.parse(response);
      expect(result.progress?.current).toBeNull();
    });

    it("should reject missing required fields", () => {
      const missingRunId = {
        state: "planning",
        mode: "default",
        procedure: "test",
        summary: "Test.",
        nextOptions: [],
      };
      expect(() => StatusResponseSchema.parse(missingRunId)).toThrow();

      const missingSummary = {
        runId: "run-1",
        state: "planning",
        mode: "default",
        procedure: "test",
        nextOptions: [],
      };
      expect(() => StatusResponseSchema.parse(missingSummary)).toThrow();
    });

    it("should reject invalid nextOptions", () => {
      const invalidOptions = {
        runId: "run-1",
        state: "planning",
        mode: "default",
        procedure: "test",
        summary: "Test.",
        nextOptions: [
          { action: "test" }, // Missing description
        ],
      };

      expect(() => StatusResponseSchema.parse(invalidOptions)).toThrow();
    });

    it("should use parseStatusResponse function", () => {
      const status = parseStatusResponse({
        runId: "run-1",
        state: "executing",
        mode: "default",
        procedure: "test",
        summary: "Test run in progress.",
        nextOptions: [],
      });
      expect(status.state).toBe("executing");
    });

    it("should return errors via safeParseStatusResponse", () => {
      const result = safeParseStatusResponse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it("should handle context with any values", () => {
      const response = parseStatusResponse({
        runId: "run-1",
        state: "planning",
        mode: "default",
        procedure: "test",
        summary: "Test.",
        nextOptions: [],
        context: {
          stringValue: "hello",
          numberValue: 42,
          boolValue: true,
          arrayValue: [1, 2, 3],
          nestedObject: { key: "value" },
        },
      });

      expect(response.context?.stringValue).toBe("hello");
      expect(response.context?.numberValue).toBe(42);
    });

    it("should validate all common state values", () => {
      const states = ["planning", "gated", "executing", "completed", "failed"];

      for (const state of states) {
        const response = {
          runId: "run-1",
          state,
          mode: "default",
          procedure: "test",
          summary: `State is ${state}.`,
          nextOptions: [],
        };

        const result = StatusResponseSchema.parse(response);
        expect(result.state).toBe(state);
      }
    });
  });

  describe("Invariants", () => {
    it("nextOptions is the canonical source of allowed actions", () => {
      const status = parseStatusResponse({
        runId: "run-1",
        state: "gated",
        mode: "default",
        procedure: "test",
        summary: "Test.",
        nextOptions: [
          { action: "action_a", description: "Do A." },
          { action: "action_b", description: "Do B." },
        ],
      });

      // The only valid actions are those in nextOptions
      const allowedActions = status.nextOptions.map((o) => o.action);
      expect(allowedActions).toEqual(["action_a", "action_b"]);
    });

    it("summary should be suitable for a single sentence", () => {
      const status = parseStatusResponse({
        runId: "run-1",
        state: "planning",
        mode: "default",
        procedure: "test",
        summary: "Analyzing PR dependencies for merge-weave operation.",
        nextOptions: [],
      });

      // Summary should be a short, single-sentence string
      expect(status.summary).toBeTruthy();
      expect(typeof status.summary).toBe("string");
    });
  });

  describe("Type exports", () => {
    it("should export StatusResponse type", () => {
      const status: StatusResponse = {
        runId: "run-1",
        state: "completed",
        mode: "default",
        procedure: "test",
        summary: "Done.",
        nextOptions: [],
      };
      expect(status.runId).toBe("run-1");
    });

    it("should export NextOption type", () => {
      const option: NextOption = {
        action: "test",
        description: "Test action.",
      };
      expect(option.action).toBe("test");
    });

    it("should export PersonaSnapshot type", () => {
      const snapshot: PersonaSnapshot = {
        mode: "test",
        forbidden: [],
        completionGates: [],
      };
      expect(snapshot.mode).toBe("test");
    });
  });
});
