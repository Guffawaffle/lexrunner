/**
 * Tests for Unified Budget Model
 *
 * Tests the unified budget schema, manager, and CLI integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  // Schema
  BudgetFieldSchema,
  BudgetScope,
  UnifiedBudgetSchema,
  BudgetExhaustedReceiptSchema,
  TIER_BUDGET_ALLOCATIONS,
  createBudgetField,
  createUnifiedBudget,
  createCustomBudget,
  isFieldExhausted,
  isBudgetExhausted,
  getExhaustedField,
  type UnifiedBudget,
  type BudgetField,
  // Manager
  UnifiedBudgetManager,
  UnifiedBudgetExceededError,
  createBudgetManager,
  getTierAllocation,
  type SpendRequest,
} from "../src/budget/index.js";

describe("Unified Budget Schema", () => {
  describe("BudgetFieldSchema", () => {
    it("should validate a valid budget field", () => {
      const field = BudgetFieldSchema.parse({
        limit: 1000,
        used: 250,
        remaining: 750,
      });

      expect(field.limit).toBe(1000);
      expect(field.used).toBe(250);
      expect(field.remaining).toBe(750);
    });

    it("should reject negative values for limit and used", () => {
      expect(() =>
        BudgetFieldSchema.parse({
          limit: -100,
          used: 0,
          remaining: 100,
        })
      ).toThrow();

      expect(() =>
        BudgetFieldSchema.parse({
          limit: 100,
          used: -50,
          remaining: 150,
        })
      ).toThrow();
    });

    it("should allow negative remaining (over budget)", () => {
      const field = BudgetFieldSchema.parse({
        limit: 100,
        used: 150,
        remaining: -50,
      });
      expect(field.remaining).toBe(-50);
    });
  });

  describe("BudgetScope", () => {
    it("should accept valid scope values", () => {
      expect(BudgetScope.parse("session")).toBe("session");
      expect(BudgetScope.parse("task")).toBe("task");
      expect(BudgetScope.parse("gate")).toBe("gate");
    });

    it("should reject invalid scope values", () => {
      expect(() => BudgetScope.parse("invalid")).toThrow();
      expect(() => BudgetScope.parse("global")).toThrow();
    });
  });

  describe("UnifiedBudgetSchema", () => {
    it("should validate a complete unified budget", () => {
      const budget = UnifiedBudgetSchema.parse({
        id: "session-123",
        scope: "session",
        tier: "mid",
        tokens: { limit: 5000, used: 1000, remaining: 4000 },
        turns: { limit: 5, used: 1, remaining: 4 },
        time: { limit: 180000, used: 30000, remaining: 150000 },
        escalations: { limit: 2, used: 0, remaining: 2 },
        exhausted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      expect(budget.id).toBe("session-123");
      expect(budget.scope).toBe("session");
      expect(budget.tier).toBe("mid");
      expect(budget.tokens.limit).toBe(5000);
    });

    it("should validate a minimal unified budget", () => {
      const budget = UnifiedBudgetSchema.parse({
        id: "task-456",
        scope: "task",
        tokens: { limit: 1000, used: 0, remaining: 1000 },
        turns: { limit: 3, used: 0, remaining: 3 },
        time: { limit: 60000, used: 0, remaining: 60000 },
        escalations: { limit: 1, used: 0, remaining: 1 },
      });

      expect(budget.id).toBe("task-456");
      expect(budget.exhausted).toBe(false);
      expect(budget.tier).toBeUndefined();
    });

    it("should accept hierarchical budget with parent", () => {
      const budget = UnifiedBudgetSchema.parse({
        id: "gate-789",
        scope: "gate",
        tier: "junior",
        parentId: "task-456",
        tokens: { limit: 500, used: 0, remaining: 500 },
        turns: { limit: 2, used: 0, remaining: 2 },
        time: { limit: 30000, used: 0, remaining: 30000 },
        escalations: { limit: 1, used: 0, remaining: 1 },
      });

      expect(budget.parentId).toBe("task-456");
    });
  });

  describe("TIER_BUDGET_ALLOCATIONS", () => {
    it("should have allocations for all tiers", () => {
      expect(TIER_BUDGET_ALLOCATIONS.junior).toBeDefined();
      expect(TIER_BUDGET_ALLOCATIONS.mid).toBeDefined();
      expect(TIER_BUDGET_ALLOCATIONS.senior).toBeDefined();
    });

    it("should have increasing limits from junior to senior", () => {
      const junior = TIER_BUDGET_ALLOCATIONS.junior;
      const mid = TIER_BUDGET_ALLOCATIONS.mid;
      const senior = TIER_BUDGET_ALLOCATIONS.senior;

      expect(junior.tokens).toBeLessThan(mid.tokens);
      expect(mid.tokens).toBeLessThan(senior.tokens);

      expect(junior.turns).toBeLessThan(mid.turns);
      expect(mid.turns).toBeLessThan(senior.turns);

      expect(junior.time).toBeLessThan(mid.time);
      expect(mid.time).toBeLessThan(senior.time);
    });

    it("should have expected junior allocation values", () => {
      expect(TIER_BUDGET_ALLOCATIONS.junior).toEqual({
        tokens: 2000,
        turns: 3,
        time: 60000,
        escalations: 1,
      });
    });

    it("should have expected mid allocation values", () => {
      expect(TIER_BUDGET_ALLOCATIONS.mid).toEqual({
        tokens: 5000,
        turns: 5,
        time: 180000,
        escalations: 2,
      });
    });

    it("should have expected senior allocation values", () => {
      expect(TIER_BUDGET_ALLOCATIONS.senior).toEqual({
        tokens: 15000,
        turns: 10,
        time: 600000,
        escalations: 3,
      });
    });
  });

  describe("createBudgetField", () => {
    it("should create a fresh budget field", () => {
      const field = createBudgetField(1000);

      expect(field.limit).toBe(1000);
      expect(field.used).toBe(0);
      expect(field.remaining).toBe(1000);
    });
  });

  describe("createUnifiedBudget", () => {
    it("should create a budget with tier defaults", () => {
      const budget = createUnifiedBudget("test-session", "session", "mid");

      expect(budget.id).toBe("test-session");
      expect(budget.scope).toBe("session");
      expect(budget.tier).toBe("mid");
      expect(budget.tokens.limit).toBe(5000);
      expect(budget.turns.limit).toBe(5);
      expect(budget.time.limit).toBe(180000);
      expect(budget.escalations.limit).toBe(2);
      expect(budget.exhausted).toBe(false);
    });

    it("should create a budget with parent reference", () => {
      const budget = createUnifiedBudget("test-task", "task", "junior", "session-1");

      expect(budget.parentId).toBe("session-1");
    });

    it("should set timestamps", () => {
      const before = new Date();
      const budget = createUnifiedBudget("test", "session", "senior");
      const after = new Date();

      expect(budget.createdAt).toBeDefined();
      expect(new Date(budget.createdAt!).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(new Date(budget.createdAt!).getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("createCustomBudget", () => {
    it("should create budget with custom limits", () => {
      const budget = createCustomBudget("custom", "session", {
        tokens: 10000,
        turns: 8,
      });

      expect(budget.tokens.limit).toBe(10000);
      expect(budget.turns.limit).toBe(8);
      // Defaults from mid tier
      expect(budget.time.limit).toBe(180000);
      expect(budget.escalations.limit).toBe(2);
    });

    it("should use tier defaults for unspecified fields", () => {
      const budget = createCustomBudget("custom", "task", { tokens: 3000 }, "senior");

      expect(budget.tokens.limit).toBe(3000);
      expect(budget.turns.limit).toBe(10); // senior default
      expect(budget.time.limit).toBe(600000); // senior default
    });
  });

  describe("isFieldExhausted", () => {
    it("should return true when remaining is 0", () => {
      expect(isFieldExhausted({ limit: 100, used: 100, remaining: 0 })).toBe(true);
    });

    it("should return true when remaining is negative", () => {
      expect(isFieldExhausted({ limit: 100, used: 150, remaining: -50 })).toBe(true);
    });

    it("should return false when remaining is positive", () => {
      expect(isFieldExhausted({ limit: 100, used: 50, remaining: 50 })).toBe(false);
    });
  });

  describe("isBudgetExhausted", () => {
    it("should return true if any field is exhausted", () => {
      const budget = createUnifiedBudget("test", "session", "mid");
      budget.tokens.used = budget.tokens.limit;
      budget.tokens.remaining = 0;

      expect(isBudgetExhausted(budget)).toBe(true);
    });

    it("should return false if all fields have remaining budget", () => {
      const budget = createUnifiedBudget("test", "session", "mid");

      expect(isBudgetExhausted(budget)).toBe(false);
    });
  });

  describe("getExhaustedField", () => {
    it("should return the first exhausted field", () => {
      const budget = createUnifiedBudget("test", "session", "mid");
      budget.turns.used = budget.turns.limit;
      budget.turns.remaining = 0;

      expect(getExhaustedField(budget)).toBe("turns");
    });

    it("should return null if no fields are exhausted", () => {
      const budget = createUnifiedBudget("test", "session", "mid");

      expect(getExhaustedField(budget)).toBeNull();
    });

    it("should prioritize tokens, then turns, then time, then escalations", () => {
      const budget = createUnifiedBudget("test", "session", "mid");

      // Exhaust tokens and escalations
      budget.tokens.remaining = 0;
      budget.escalations.remaining = 0;

      expect(getExhaustedField(budget)).toBe("tokens");
    });
  });
});

describe("Unified Budget Manager", () => {
  let manager: UnifiedBudgetManager;
  let receiptLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    receiptLogger = vi.fn();
    manager = createBudgetManager({ receiptLogger });
  });

  describe("Budget Creation", () => {
    it("should create a session budget", () => {
      const budget = manager.createSessionBudget("session-1", "mid");

      expect(budget.id).toBe("session-1");
      expect(budget.scope).toBe("session");
      expect(budget.tier).toBe("mid");
      expect(manager.getBudget("session-1")).toBe(budget);
    });

    it("should create a task budget under a session", () => {
      manager.createSessionBudget("session-1", "mid");
      const task = manager.createTaskBudget("task-1", "session-1", "junior");

      expect(task.scope).toBe("task");
      expect(task.parentId).toBe("session-1");
    });

    it("should create a gate budget under a task", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.createTaskBudget("task-1", "session-1", "junior");
      const gate = manager.createGateBudget("gate-1", "task-1", "junior");

      expect(gate.scope).toBe("gate");
      expect(gate.parentId).toBe("task-1");
    });

    it("should create budget with custom limits", () => {
      const budget = manager.createBudgetWithLimits(
        "custom-1",
        "session",
        { tokens: 10000, turns: 20 },
        "senior"
      );

      expect(budget.tokens.limit).toBe(10000);
      expect(budget.turns.limit).toBe(20);
      expect(budget.time.limit).toBe(600000); // senior default
    });
  });

  describe("Budget Retrieval", () => {
    it("should get budget by ID", () => {
      manager.createSessionBudget("session-1", "mid");

      const budget = manager.getBudget("session-1");
      expect(budget).toBeDefined();
      expect(budget?.id).toBe("session-1");
    });

    it("should return undefined for non-existent budget", () => {
      expect(manager.getBudget("non-existent")).toBeUndefined();
    });

    it("should get all budgets", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.createTaskBudget("task-1", "session-1", "junior");

      const all = manager.getAllBudgets();
      expect(all).toHaveLength(2);
    });

    it("should get child budgets", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.createTaskBudget("task-1", "session-1", "junior");
      manager.createTaskBudget("task-2", "session-1", "mid");

      const children = manager.getChildBudgets("session-1");
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain("task-1");
      expect(children.map((c) => c.id)).toContain("task-2");
    });
  });

  describe("Budget Enforcement - checkBudget", () => {
    it("should pass when budget is available", () => {
      manager.createSessionBudget("session-1", "mid");

      expect(() => manager.checkBudget("session-1", { tokens: 100, turns: 1 })).not.toThrow();
    });

    it("should throw when tokens would exceed limit", () => {
      manager.createSessionBudget("session-1", "mid");

      expect(
        () => manager.checkBudget("session-1", { tokens: 10000 }) // exceeds 5000 limit
      ).toThrow(UnifiedBudgetExceededError);
    });

    it("should throw when turns would exceed limit", () => {
      manager.createSessionBudget("session-1", "mid");

      expect(
        () => manager.checkBudget("session-1", { turns: 10 }) // exceeds 5 limit
      ).toThrow(UnifiedBudgetExceededError);
    });

    it("should throw with correct error details", () => {
      manager.createSessionBudget("session-1", "junior");

      try {
        manager.checkBudget("session-1", { tokens: 5000 });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UnifiedBudgetExceededError);
        if (error instanceof UnifiedBudgetExceededError) {
          expect(error.field).toBe("tokens");
          expect(error.limit).toBe(2000);
          expect(error.budgetId).toBe("session-1");
          expect(error.scope).toBe("session");
        }
      }
    });

    it("should throw for non-existent budget", () => {
      expect(() => manager.checkBudget("non-existent", { tokens: 100 })).toThrow(
        "Budget not found"
      );
    });
  });

  describe("Budget Enforcement - spend", () => {
    it("should update used and remaining values", () => {
      manager.createSessionBudget("session-1", "mid");

      manager.spend("session-1", { tokens: 1000, turns: 1 });

      const budget = manager.getBudget("session-1")!;
      expect(budget.tokens.used).toBe(1000);
      expect(budget.tokens.remaining).toBe(4000);
      expect(budget.turns.used).toBe(1);
      expect(budget.turns.remaining).toBe(4);
    });

    it("should return false when budget is not exhausted", () => {
      manager.createSessionBudget("session-1", "mid");

      const exhausted = manager.spend("session-1", { tokens: 100 });
      expect(exhausted).toBe(false);
    });

    it("should return true and emit receipt when budget is exhausted", () => {
      manager.createSessionBudget("session-1", "junior");

      // Spend all tokens
      const exhausted = manager.spend("session-1", { tokens: 2000 });

      expect(exhausted).toBe(true);
      expect(receiptLogger).toHaveBeenCalledTimes(1);

      const receipt = receiptLogger.mock.calls[0][0];
      expect(receipt.kind).toBe("BudgetExhaustedReceipt");
      expect(receipt.exhaustedField).toBe("tokens");
      expect(receipt.budgetId).toBe("session-1");
    });

    it("should throw when spend exceeds remaining budget", () => {
      manager.createSessionBudget("session-1", "junior");

      expect(() => manager.spend("session-1", { tokens: 5000 })).toThrow(
        UnifiedBudgetExceededError
      );
    });

    it("should propagate spend to parent budgets", () => {
      manager.createSessionBudget("session-1", "senior");
      manager.createTaskBudget("task-1", "session-1", "mid");
      manager.createGateBudget("gate-1", "task-1", "junior");

      manager.spend("gate-1", { tokens: 500, turns: 1 });

      // Check gate budget
      const gate = manager.getBudget("gate-1")!;
      expect(gate.tokens.used).toBe(500);

      // Check task budget (parent)
      const task = manager.getBudget("task-1")!;
      expect(task.tokens.used).toBe(500);

      // Check session budget (grandparent)
      const session = manager.getBudget("session-1")!;
      expect(session.tokens.used).toBe(500);
    });

    it("should update timestamp on spend", () => {
      manager.createSessionBudget("session-1", "mid");
      const before = new Date();

      manager.spend("session-1", { tokens: 100 });

      const budget = manager.getBudget("session-1")!;
      expect(new Date(budget.updatedAt!).getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe("Budget Reset", () => {
    it("should reset usage to zero", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.spend("session-1", { tokens: 2000, turns: 3 });

      manager.resetBudget("session-1");

      const budget = manager.getBudget("session-1")!;
      expect(budget.tokens.used).toBe(0);
      expect(budget.tokens.remaining).toBe(5000);
      expect(budget.turns.used).toBe(0);
      expect(budget.turns.remaining).toBe(5);
    });

    it("should clear exhausted status", () => {
      manager.createSessionBudget("session-1", "junior");
      manager.spend("session-1", { tokens: 2000 }); // exhaust tokens

      const beforeReset = manager.getBudget("session-1")!;
      expect(beforeReset.exhausted).toBe(true);

      manager.resetBudget("session-1");

      const afterReset = manager.getBudget("session-1")!;
      expect(afterReset.exhausted).toBe(false);
    });

    it("should throw for non-existent budget", () => {
      expect(() => manager.resetBudget("non-existent")).toThrow("Budget not found");
    });
  });

  describe("Update Limits", () => {
    it("should update specific limits", () => {
      manager.createSessionBudget("session-1", "mid");

      manager.updateLimits("session-1", { tokens: 10000 });

      const budget = manager.getBudget("session-1")!;
      expect(budget.tokens.limit).toBe(10000);
      expect(budget.tokens.remaining).toBe(10000);
      expect(budget.turns.limit).toBe(5); // unchanged
    });

    it("should recalculate remaining after limit update", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.spend("session-1", { tokens: 2000 });

      manager.updateLimits("session-1", { tokens: 3000 });

      const budget = manager.getBudget("session-1")!;
      expect(budget.tokens.limit).toBe(3000);
      expect(budget.tokens.used).toBe(2000);
      expect(budget.tokens.remaining).toBe(1000);
    });

    it("should update exhausted status after limit increase", () => {
      manager.createSessionBudget("session-1", "junior");
      manager.spend("session-1", { tokens: 2000 }); // exhaust

      expect(manager.getBudget("session-1")!.exhausted).toBe(true);

      manager.updateLimits("session-1", { tokens: 5000 });

      expect(manager.getBudget("session-1")!.exhausted).toBe(false);
    });
  });

  describe("Budget Formatting", () => {
    it("should format budget for human display", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.spend("session-1", { tokens: 1000 });

      const formatted = manager.formatBudgetHuman("session-1");

      expect(formatted).toContain("session-1");
      expect(formatted).toContain("mid");
      expect(formatted).toContain("1000/5000");
      expect(formatted).toContain("20.0% used");
    });

    it("should show LOW warning when near limit", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.spend("session-1", { tokens: 4500 }); // 90% used

      const formatted = manager.formatBudgetHuman("session-1");

      expect(formatted).toContain("LOW");
    });

    it("should show EXHAUSTED when limit reached", () => {
      manager.createSessionBudget("session-1", "junior");
      manager.spend("session-1", { tokens: 2000 });

      const formatted = manager.formatBudgetHuman("session-1");

      expect(formatted).toContain("EXHAUSTED");
    });

    it("should return JSON format", () => {
      manager.createSessionBudget("session-1", "mid");

      const json = manager.formatBudgetJSON("session-1");

      expect(json).toBeDefined();
      expect(json?.id).toBe("session-1");
    });

    it("should return null for non-existent budget", () => {
      expect(manager.formatBudgetJSON("non-existent")).toBeNull();
    });
  });

  describe("Budget Removal", () => {
    it("should remove a budget", () => {
      manager.createSessionBudget("session-1", "mid");

      const removed = manager.removeBudget("session-1");

      expect(removed).toBe(true);
      expect(manager.getBudget("session-1")).toBeUndefined();
    });

    it("should return false for non-existent budget", () => {
      expect(manager.removeBudget("non-existent")).toBe(false);
    });

    it("should clear all budgets", () => {
      manager.createSessionBudget("session-1", "mid");
      manager.createSessionBudget("session-2", "senior");

      manager.clear();

      expect(manager.getAllBudgets()).toHaveLength(0);
    });
  });

  describe("getTierAllocation", () => {
    it("should return allocation for each tier", () => {
      expect(getTierAllocation("junior")).toEqual(TIER_BUDGET_ALLOCATIONS.junior);
      expect(getTierAllocation("mid")).toEqual(TIER_BUDGET_ALLOCATIONS.mid);
      expect(getTierAllocation("senior")).toEqual(TIER_BUDGET_ALLOCATIONS.senior);
    });
  });
});

describe("BudgetExhaustedReceiptSchema", () => {
  it("should validate a complete receipt", () => {
    const receipt = BudgetExhaustedReceiptSchema.parse({
      schemaVersion: "1.0.0",
      kind: "BudgetExhaustedReceipt",
      budgetId: "session-123",
      exhaustedField: "tokens",
      current: 5000,
      limit: 5000,
      scope: "session",
      tier: "mid",
      nextActions: ["Escalate to senior tier", "Optimize token usage"],
      timestamp: new Date().toISOString(),
    });

    expect(receipt.kind).toBe("BudgetExhaustedReceipt");
    expect(receipt.exhaustedField).toBe("tokens");
  });

  it("should validate a minimal receipt", () => {
    const receipt = BudgetExhaustedReceiptSchema.parse({
      schemaVersion: "1.0.0",
      kind: "BudgetExhaustedReceipt",
      budgetId: "gate-1",
      exhaustedField: "turns",
      current: 3,
      limit: 3,
      scope: "gate",
      timestamp: new Date().toISOString(),
    });

    expect(receipt.tier).toBeUndefined();
    expect(receipt.nextActions).toBeUndefined();
  });
});

describe("UnifiedBudgetExceededError", () => {
  it("should contain correct properties", () => {
    const error = new UnifiedBudgetExceededError("tokens", 5500, 5000, "session-1", "session");

    expect(error.name).toBe("UnifiedBudgetExceededError");
    expect(error.field).toBe("tokens");
    expect(error.current).toBe(5500);
    expect(error.limit).toBe(5000);
    expect(error.budgetId).toBe("session-1");
    expect(error.scope).toBe("session");
    expect(error.message).toContain("tokens");
    expect(error.message).toContain("5500/5000");
  });

  it("should be instance of Error", () => {
    const error = new UnifiedBudgetExceededError("turns", 10, 5, "task-1", "task");
    expect(error).toBeInstanceOf(Error);
  });
});
