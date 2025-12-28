/**
 * Unit tests for Tool Budget Enforcement
 *
 * Tests the ToolBudgetEnforcer class with various budget configurations
 * and violation scenarios.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolBudgetEnforcer,
  createToolBudgetEnforcer,
  type ToolBudgetState,
} from "../../src/executors/toolBudget.js";
import type { ToolBudget } from "../../src/schemas/executorManifest.js";
import { ErrorCodes } from "../../src/errors/index.js";

describe("ToolBudgetEnforcer", () => {
  describe("allowed/denied lists", () => {
    it("should allow tools in the allowed list", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search", "read_file"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(true);
    });

    it("should deny tools not in the allowed list", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search", "read_file"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("run_in_terminal");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_BUDGET_EXCEEDED);
        expect(result.error.message).toContain("not in the allowed tool list");
        expect(result.error.context).toMatchObject({
          tool: "run_in_terminal",
          violation: "tool_not_allowed",
        });
      }
    });

    it("should deny tools in the denied list", () => {
      const budget: ToolBudget = {
        allowed: [],
        denied: ["run_in_terminal", "git push"],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("run_in_terminal");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_BUDGET_EXCEEDED);
        expect(result.error.message).toContain("denied by executor budget");
        expect(result.error.context).toMatchObject({
          tool: "run_in_terminal",
          violation: "tool_denied",
        });
      }
    });

    it("should prioritize denied over allowed (denied takes precedence)", () => {
      const budget: ToolBudget = {
        allowed: ["run_in_terminal"],
        denied: ["run_in_terminal"],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("run_in_terminal");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error.context).toMatchObject({
          violation: "tool_denied",
        });
      }
    });

    it("should allow any tool when allowed list is empty and tool not denied", () => {
      const budget: ToolBudget = {
        allowed: [],
        denied: ["dangerous_tool"],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("safe_tool");
      expect(result.allowed).toBe(true);
    });
  });

  describe("maxToolCalls limit", () => {
    it("should enforce maxToolCalls limit", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxToolCalls: 2 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // First call should succeed
      let result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(true);
      enforcer.recordToolCall("grep_search");

      // Second call should succeed
      result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(true);
      enforcer.recordToolCall("grep_search");

      // Third call should fail
      result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_BUDGET_EXCEEDED);
        expect(result.error.message).toContain("Maximum tool calls limit");
        expect(result.error.context).toMatchObject({
          tool: "grep_search",
          violation: "max_calls_exceeded",
          limit: 2,
          current: 3,
        });
      }
    });

    it("should track calls across different tools", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search", "read_file"],
        denied: [],
        limits: { maxToolCalls: 3 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      enforcer.checkToolCall("grep_search");
      enforcer.recordToolCall("grep_search");

      enforcer.checkToolCall("read_file");
      enforcer.recordToolCall("read_file");

      enforcer.checkToolCall("grep_search");
      enforcer.recordToolCall("grep_search");

      // Fourth call should fail
      const result = enforcer.checkToolCall("read_file");
      expect(result.allowed).toBe(false);
    });

    it("should allow unlimited calls when maxToolCalls is not set", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // Make many calls
      for (let i = 0; i < 100; i++) {
        const result = enforcer.checkToolCall("grep_search");
        expect(result.allowed).toBe(true);
        enforcer.recordToolCall("grep_search");
      }
    });
  });

  describe("maxTokensOut limit", () => {
    it("should enforce maxTokensOut limit", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxTokensOut: 1000 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // First call with 600 tokens
      let result = enforcer.checkToolCall("grep_search", 600);
      expect(result.allowed).toBe(true);
      enforcer.recordToolCall("grep_search", 600);

      // Second call with 300 tokens
      result = enforcer.checkToolCall("grep_search", 300);
      expect(result.allowed).toBe(true);
      enforcer.recordToolCall("grep_search", 300);

      // Third call with 200 tokens would exceed (900 + 200 = 1100 > 1000)
      result = enforcer.checkToolCall("grep_search", 200);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_BUDGET_EXCEEDED);
        expect(result.error.message).toContain("Maximum token output limit");
        expect(result.error.context).toMatchObject({
          tool: "grep_search",
          violation: "max_tokens_exceeded",
          limit: 1000,
          current: 1100,
        });
      }
    });

    it("should allow call when estimatedTokensOut is 0 or not provided", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxTokensOut: 100 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // Should allow call without token estimate
      let result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(true);

      // Should allow call with 0 tokens
      result = enforcer.checkToolCall("grep_search", 0);
      expect(result.allowed).toBe(true);
    });

    it("should allow unlimited tokens when maxTokensOut is not set", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("grep_search", 999999);
      expect(result.allowed).toBe(true);
    });
  });

  describe("combined limits", () => {
    it("should enforce both maxToolCalls and maxTokensOut", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: {
          maxToolCalls: 5,
          maxTokensOut: 500,
        },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // Token limit should hit first (3 calls * 200 tokens = 600 > 500)
      enforcer.checkToolCall("grep_search", 200);
      enforcer.recordToolCall("grep_search", 200);

      enforcer.checkToolCall("grep_search", 200);
      enforcer.recordToolCall("grep_search", 200);

      const result = enforcer.checkToolCall("grep_search", 200);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error.context).toMatchObject({
          violation: "max_tokens_exceeded",
        });
      }

      // State should show 2 calls, 400 tokens
      const state = enforcer.getState();
      expect(state.totalCalls).toBe(2);
      expect(state.totalTokensOut).toBe(400);
    });
  });

  describe("state management", () => {
    it("should track state correctly", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      enforcer.recordToolCall("grep_search", 100);
      enforcer.recordToolCall("grep_search", 200);

      const state = enforcer.getState();
      expect(state.totalCalls).toBe(2);
      expect(state.totalTokensOut).toBe(300);
    });

    it("should return readonly state", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      enforcer.recordToolCall("grep_search", 100);

      const state = enforcer.getState();
      // Mutating returned state should not affect internal state
      (state as ToolBudgetState).totalCalls = 999;

      const freshState = enforcer.getState();
      expect(freshState.totalCalls).toBe(1);
    });

    it("should reset state correctly", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxToolCalls: 2 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      enforcer.recordToolCall("grep_search");
      enforcer.recordToolCall("grep_search");

      // Should be at limit
      let result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(false);

      // Reset
      enforcer.reset();

      // Should allow calls again
      result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(true);

      const state = enforcer.getState();
      expect(state.totalCalls).toBe(0);
      expect(state.totalTokensOut).toBe(0);
    });

    it("should return readonly budget configuration", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: ["run_in_terminal"],
        limits: { maxToolCalls: 10 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const returnedBudget = enforcer.getBudget();
      // Mutating returned budget should not affect internal budget
      returnedBudget.allowed.push("new_tool");
      returnedBudget.denied.push("another_tool");

      const freshBudget = enforcer.getBudget();
      expect(freshBudget.allowed).toEqual(["grep_search"]);
      expect(freshBudget.denied).toEqual(["run_in_terminal"]);
    });
  });

  describe("helper functions", () => {
    it("should create enforcer via factory function", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
      };
      const enforcer = createToolBudgetEnforcer(budget);

      expect(enforcer).toBeInstanceOf(ToolBudgetEnforcer);

      const result = enforcer.checkToolCall("grep_search");
      expect(result.allowed).toBe(true);
    });
  });

  describe("error messages", () => {
    it("should include helpful next actions for denied tools", () => {
      const budget: ToolBudget = {
        allowed: [],
        denied: ["run_in_terminal", "git push"],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("run_in_terminal");
      if (!result.allowed) {
        expect(result.error.nextActions).toBeDefined();
        expect(result.error.nextActions.length).toBeGreaterThan(0);
        expect(result.error.nextActions.some((a) => a.includes("denied"))).toBe(true);
      }
    });

    it("should include helpful next actions for not-allowed tools", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("read_file");
      if (!result.allowed) {
        expect(result.error.nextActions).toBeDefined();
        expect(result.error.nextActions.length).toBeGreaterThan(0);
        expect(result.error.nextActions.some((a) => a.includes("allowed"))).toBe(true);
      }
    });

    it("should include helpful next actions for call limit exceeded", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxToolCalls: 1 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      enforcer.recordToolCall("grep_search");
      const result = enforcer.checkToolCall("grep_search");

      if (!result.allowed) {
        expect(result.error.nextActions).toBeDefined();
        expect(result.error.nextActions.length).toBeGreaterThan(0);
        expect(result.error.nextActions.some((a) => a.includes("maxToolCalls"))).toBe(true);
      }
    });

    it("should include helpful next actions for token limit exceeded", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxTokensOut: 100 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      const result = enforcer.checkToolCall("grep_search", 200);

      if (!result.allowed) {
        expect(result.error.nextActions).toBeDefined();
        expect(result.error.nextActions.length).toBeGreaterThan(0);
        expect(result.error.nextActions.some((a) => a.includes("maxTokensOut"))).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle empty budget configuration", () => {
      const budget: ToolBudget = {
        allowed: [],
        denied: [],
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // Any tool should be allowed with empty lists
      const result = enforcer.checkToolCall("any_tool");
      expect(result.allowed).toBe(true);
    });

    it("should handle zero limits", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: {
          maxToolCalls: 0,
          maxTokensOut: 0,
        },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // First call should fail due to zero limits
      const result = enforcer.checkToolCall("grep_search", 10);
      expect(result.allowed).toBe(false);
    });

    it("should handle exact limit boundary", () => {
      const budget: ToolBudget = {
        allowed: ["grep_search"],
        denied: [],
        limits: { maxTokensOut: 1000 },
      };
      const enforcer = new ToolBudgetEnforcer(budget);

      // Exactly at limit should succeed
      let result = enforcer.checkToolCall("grep_search", 1000);
      expect(result.allowed).toBe(true);
      enforcer.recordToolCall("grep_search", 1000);

      // One more token should fail
      result = enforcer.checkToolCall("grep_search", 1);
      expect(result.allowed).toBe(false);
    });
  });
});
