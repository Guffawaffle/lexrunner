import { describe, it, expect } from "vitest";
import {
  BudgetTracker,
  BudgetExceededError,
  DEFAULT_BUDGET_CONFIG,
  type BudgetConfig,
} from "../src/budget/index.js";

describe("Budget Tracker", () => {
  describe("BudgetTracker", () => {
    it("should initialize with default config", () => {
      const tracker = new BudgetTracker(DEFAULT_BUDGET_CONFIG);
      const spend = tracker.getSpend();

      expect(spend.prompts).toBe(0);
      expect(spend.tokens_estimated).toBe(0);
    });

    it("should initialize with custom config", () => {
      const config: BudgetConfig = {
        tokenBudget: 1000,
        maxPrompts: 5,
      };
      const tracker = new BudgetTracker(config);
      const summary = tracker.getSummary();

      expect(summary.tokenBudget).toBe(1000);
      expect(summary.maxPrompts).toBe(5);
    });

    it("should estimate tokens correctly (~4 chars per token)", () => {
      const tracker = new BudgetTracker({ tokenBudget: 10000, maxPrompts: 10 });

      // Test with 400 characters = ~100 tokens
      const text = "a".repeat(400);
      tracker.recordPrompt(text);

      const spend = tracker.getSpend();
      expect(spend.tokens_estimated).toBe(100);
      expect(spend.prompts).toBe(1);
    });

    it("should track multiple prompts", () => {
      const tracker = new BudgetTracker({ tokenBudget: 10000, maxPrompts: 5 });

      tracker.recordPrompt("test prompt 1");
      tracker.recordPrompt("test prompt 2");
      tracker.recordPrompt("test prompt 3");

      const spend = tracker.getSpend();
      expect(spend.prompts).toBe(3);
      expect(spend.tokens_estimated).toBeGreaterThan(0);
    });

    it("should throw BudgetExceededError when prompt limit exceeded", () => {
      const tracker = new BudgetTracker({ tokenBudget: 10000, maxPrompts: 2 });

      tracker.recordPrompt("prompt 1");
      tracker.recordPrompt("prompt 2");

      expect(() => {
        tracker.recordPrompt("prompt 3");
      }).toThrow(BudgetExceededError);
    });

    it("should throw BudgetExceededError with correct error details for prompts", () => {
      const tracker = new BudgetTracker({ tokenBudget: 10000, maxPrompts: 2 });

      tracker.recordPrompt("prompt 1");
      tracker.recordPrompt("prompt 2");

      try {
        tracker.recordPrompt("prompt 3");
        expect.fail("Should have thrown BudgetExceededError");
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExceededError);
        if (error instanceof BudgetExceededError) {
          expect(error.type).toBe("prompt");
          expect(error.current).toBe(3);
          expect(error.limit).toBe(2);
          expect(error.message).toContain("prompt limit");
        }
      }
    });

    it("should throw BudgetExceededError when token limit exceeded", () => {
      const tracker = new BudgetTracker({ tokenBudget: 50, maxPrompts: 10 });

      // Each prompt is ~50 chars = ~13 tokens
      tracker.recordPrompt("a".repeat(50));
      tracker.recordPrompt("a".repeat(50));

      // Third prompt would exceed 50 token budget (13 + 13 + 13 = 39, but check happens)
      // Let's use a larger prompt to definitely exceed
      expect(() => {
        tracker.recordPrompt("a".repeat(200)); // 50 tokens
      }).toThrow(BudgetExceededError);
    });

    it("should throw BudgetExceededError with correct error details for tokens", () => {
      const tracker = new BudgetTracker({ tokenBudget: 50, maxPrompts: 10 });

      tracker.recordPrompt("a".repeat(100)); // 25 tokens

      try {
        tracker.recordPrompt("a".repeat(200)); // 50 tokens, total would be 75
        expect.fail("Should have thrown BudgetExceededError");
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExceededError);
        if (error instanceof BudgetExceededError) {
          expect(error.type).toBe("token");
          expect(error.current).toBeGreaterThan(50);
          expect(error.limit).toBe(50);
          expect(error.message).toContain("token limit");
        }
      }
    });

    it("should provide accurate summary", () => {
      const tracker = new BudgetTracker({ tokenBudget: 100, maxPrompts: 3 });

      tracker.recordPrompt("test");

      const summary = tracker.getSummary();
      expect(summary.prompts).toBe(1);
      expect(summary.maxPrompts).toBe(3);
      expect(summary.tokenBudget).toBe(100);
      expect(summary.promptBudgetExceeded).toBe(false);
      expect(summary.tokenBudgetExceeded).toBe(false);
    });

    it("should report exceeded status in summary after limit breach", () => {
      const tracker = new BudgetTracker({ tokenBudget: 100, maxPrompts: 2 });

      tracker.recordPrompt("test 1");
      tracker.recordPrompt("test 2");

      try {
        tracker.recordPrompt("test 3");
      } catch (error) {
        // Expected
      }

      const summary = tracker.getSummary();
      expect(summary.promptBudgetExceeded).toBe(true);
    });

    it("should format human-readable output", () => {
      const tracker = new BudgetTracker({ tokenBudget: 5000, maxPrompts: 3 });

      tracker.recordPrompt("test prompt");

      const output = tracker.formatHuman();
      expect(output).toContain("Budget Summary");
      expect(output).toContain("Prompts: 1/3");
      expect(output).toContain("Tokens (estimated)");
      expect(output).not.toContain("EXCEEDED");
    });

    it("should format human-readable output with exceeded status", () => {
      const tracker = new BudgetTracker({ tokenBudget: 10, maxPrompts: 1 });

      tracker.recordPrompt("test");

      try {
        tracker.recordPrompt("test 2");
      } catch (error) {
        // Expected
      }

      const output = tracker.formatHuman();
      expect(output).toContain("EXCEEDED");
    });

    it("should format JSON output", () => {
      const tracker = new BudgetTracker({ tokenBudget: 5000, maxPrompts: 3 });

      tracker.recordPrompt("test prompt");

      const output = tracker.formatJSON();
      expect(output).toHaveProperty("prompts");
      expect(output).toHaveProperty("tokens_estimated");
      expect(output.prompts).toBe(1);
    });

    it("should check budget without recording", () => {
      const tracker = new BudgetTracker({ tokenBudget: 50, maxPrompts: 2 });

      tracker.recordPrompt("test 1");
      tracker.recordPrompt("test 2");

      // Should throw when checking if we can add another
      expect(() => {
        tracker.checkBudget();
      }).toThrow(BudgetExceededError);
    });

    it("should check budget with estimated text", () => {
      const tracker = new BudgetTracker({ tokenBudget: 50, maxPrompts: 10 });

      tracker.recordPrompt("a".repeat(100)); // 25 tokens

      // Check if we can add 200 more chars (50 tokens) - should fail
      expect(() => {
        tracker.checkBudget("a".repeat(200));
      }).toThrow(BudgetExceededError);
    });

    it("should allow operations within budget", () => {
      const tracker = new BudgetTracker({ tokenBudget: 1000, maxPrompts: 5 });

      tracker.recordPrompt("small prompt");
      tracker.checkBudget("another small prompt");

      // Should not throw
      expect(() => {
        tracker.recordPrompt("another small prompt");
      }).not.toThrow();
    });

    it("should handle edge case: exactly at prompt limit", () => {
      const tracker = new BudgetTracker({ tokenBudget: 10000, maxPrompts: 3 });

      tracker.recordPrompt("prompt 1");
      tracker.recordPrompt("prompt 2");
      tracker.recordPrompt("prompt 3");

      const summary = tracker.getSummary();
      expect(summary.prompts).toBe(3);
      expect(summary.promptBudgetExceeded).toBe(false);

      // Next one should fail
      expect(() => {
        tracker.recordPrompt("prompt 4");
      }).toThrow(BudgetExceededError);
    });

    it("should handle edge case: exactly at token limit", () => {
      const tracker = new BudgetTracker({ tokenBudget: 100, maxPrompts: 10 });

      // 100 tokens exactly (400 chars)
      tracker.recordPrompt("a".repeat(400));

      const summary = tracker.getSummary();
      expect(summary.tokens_estimated).toBe(100);
      expect(summary.tokenBudgetExceeded).toBe(false);

      // Next token should fail
      expect(() => {
        tracker.recordPrompt("x");
      }).toThrow(BudgetExceededError);
    });
  });

  describe("DEFAULT_BUDGET_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_BUDGET_CONFIG.tokenBudget).toBe(5000);
      expect(DEFAULT_BUDGET_CONFIG.maxPrompts).toBe(3);
    });
  });

  describe("BudgetExceededError", () => {
    it("should contain correct properties", () => {
      const error = new BudgetExceededError("token", 100, 50);

      expect(error.name).toBe("BudgetExceededError");
      expect(error.type).toBe("token");
      expect(error.current).toBe(100);
      expect(error.limit).toBe(50);
      expect(error.message).toContain("token limit");
      expect(error.message).toContain("100/50");
    });

    it("should be instance of Error", () => {
      const error = new BudgetExceededError("prompt", 5, 3);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
