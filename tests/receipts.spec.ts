/**
 * Tests for ActionReceipt schema and emission helpers
 *
 * Verifies the Disciplined Failure pattern implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	// Schema exports
	ActionReceiptSchema,
	UncertaintyMarkerSchema,
	ConfidenceLevel,
	ReversibilityLevel,
	Outcome,
	hasGovernanceContext,
	// Emission helpers
	emitActionReceipt,
	emitFailureReceipt,
	emitDeferredReceipt,
	emitUncertaintyMarker,
	buildGovernanceContext,
	type ActionReceipt,
	type UncertaintyMarker,
} from "../src/receipts/index.js";

describe("ActionReceipt Schema", () => {
	describe("ConfidenceLevel", () => {
		it("should accept valid confidence levels", () => {
			expect(ConfidenceLevel.parse("high")).toBe("high");
			expect(ConfidenceLevel.parse("medium")).toBe("medium");
			expect(ConfidenceLevel.parse("low")).toBe("low");
			expect(ConfidenceLevel.parse("uncertain")).toBe("uncertain");
		});

		it("should reject invalid confidence levels", () => {
			expect(() => ConfidenceLevel.parse("invalid")).toThrow();
			expect(() => ConfidenceLevel.parse("")).toThrow();
		});
	});

	describe("ReversibilityLevel", () => {
		it("should accept valid reversibility levels", () => {
			expect(ReversibilityLevel.parse("reversible")).toBe("reversible");
			expect(ReversibilityLevel.parse("partially-reversible")).toBe(
				"partially-reversible"
			);
			expect(ReversibilityLevel.parse("irreversible")).toBe(
				"irreversible"
			);
		});

		it("should reject invalid reversibility levels", () => {
			expect(() => ReversibilityLevel.parse("maybe")).toThrow();
		});
	});

	describe("Outcome", () => {
		it("should accept valid outcomes", () => {
			expect(Outcome.parse("success")).toBe("success");
			expect(Outcome.parse("failure")).toBe("failure");
			expect(Outcome.parse("partial")).toBe("partial");
			expect(Outcome.parse("deferred")).toBe("deferred");
		});

		it("should reject invalid outcomes", () => {
			expect(() => Outcome.parse("unknown")).toThrow();
		});
	});

	describe("ActionReceiptSchema", () => {
		it("should validate a complete ActionReceipt", () => {
			const receipt = {
				schemaVersion: "1.0.0" as const,
				kind: "ActionReceipt" as const,
				action: "merge PR-123 to integration",
				outcome: "success" as const,
				rationale: "Dependencies satisfied, gates green",
				confidence: "high" as const,
				reversibility: "reversible" as const,
				rollbackPath: "git reset --hard HEAD~1",
				escalationRequired: false,
				timestamp: new Date().toISOString(),
				phase: "apply",
				runId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
			};

			const result = ActionReceiptSchema.parse(receipt);
			expect(result.action).toBe("merge PR-123 to integration");
			expect(result.confidence).toBe("high");
			expect(result.reversibility).toBe("reversible");
		});

		it("should validate a minimal ActionReceipt", () => {
			const receipt = {
				schemaVersion: "1.0.0" as const,
				kind: "ActionReceipt" as const,
				action: "execute gate: lint",
				outcome: "success" as const,
				rationale: "Required by plan policy",
				confidence: "high" as const,
				reversibility: "reversible" as const,
				escalationRequired: false,
				timestamp: new Date().toISOString(),
			};

			const result = ActionReceiptSchema.parse(receipt);
			expect(result.kind).toBe("ActionReceipt");
		});

		it("should require schemaVersion to be 1.0.0", () => {
			const receipt = {
				schemaVersion: "2.0.0",
				kind: "ActionReceipt",
				action: "test",
				outcome: "success",
				rationale: "test",
				confidence: "high",
				reversibility: "reversible",
				escalationRequired: false,
				timestamp: new Date().toISOString(),
			};

			expect(() => ActionReceiptSchema.parse(receipt)).toThrow();
		});

		it("should validate optional fields", () => {
			const receipt = {
				schemaVersion: "1.0.0" as const,
				kind: "ActionReceipt" as const,
				action: "merge",
				outcome: "failure" as const,
				rationale: "Conflict detected",
				confidence: "low" as const,
				reversibility: "reversible" as const,
				uncertaintyNotes: ["Unknown base changes", "Parallel commits"],
				rollbackPath: "git merge --abort",
				rollbackCommand: "git merge --abort",
				nextActions: ["Resolve conflicts", "Re-run merge"],
				escalationRequired: true,
				escalationReason: "Complex conflict requires human review",
				timestamp: new Date().toISOString(),
				phase: "apply",
				planHash: "abc123",
			};

			const result = ActionReceiptSchema.parse(receipt);
			expect(result.uncertaintyNotes).toHaveLength(2);
			expect(result.escalationRequired).toBe(true);
			expect(result.escalationReason).toBe(
				"Complex conflict requires human review"
			);
		});
	});

	describe("UncertaintyMarkerSchema", () => {
		it("should validate a complete UncertaintyMarker", () => {
			const marker = {
				operation: "merge PR-456 with active dependencies",
				uncertainties: [
					"Dependency PR-123 may have untested changes",
					"Target branch received commits since last check",
				],
				mitigations: [
					"Will run full test suite after merge",
					"Rollback path: git reset --hard HEAD~1",
				],
				proceedingAnyway: true,
				reason: "Time-sensitive release; risk accepted by policy",
				timestamp: new Date().toISOString(),
			};

			const result = UncertaintyMarkerSchema.parse(marker);
			expect(result.operation).toBe(
				"merge PR-456 with active dependencies"
			);
			expect(result.uncertainties).toHaveLength(2);
			expect(result.proceedingAnyway).toBe(true);
		});

		it("should validate a minimal UncertaintyMarker", () => {
			const marker = {
				operation: "risky operation",
				uncertainties: ["something unknown"],
				mitigations: ["we can roll back"],
				proceedingAnyway: false,
			};

			const result = UncertaintyMarkerSchema.parse(marker);
			expect(result.proceedingAnyway).toBe(false);
		});
	});

	describe("hasGovernanceContext", () => {
		it("should return true for context with reversibility", () => {
			const ctx = { reversibility: "reversible", otherField: "value" };
			expect(hasGovernanceContext(ctx)).toBe(true);
		});

		it("should return true for context with rollbackPath", () => {
			const ctx = { rollbackPath: "git reset", otherField: "value" };
			expect(hasGovernanceContext(ctx)).toBe(true);
		});

		it("should return true for context with confidence", () => {
			const ctx = { confidence: "high", otherField: "value" };
			expect(hasGovernanceContext(ctx)).toBe(true);
		});

		it("should return false for context without governance fields", () => {
			const ctx = { otherField: "value", anotherField: 123 };
			expect(hasGovernanceContext(ctx)).toBe(false);
		});

		it("should return false for undefined context", () => {
			expect(hasGovernanceContext(undefined)).toBe(false);
		});
	});
});

describe("ActionReceipt Emission Helpers", () => {
	let logSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		logSpy = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("emitActionReceipt", () => {
		it("should create a valid ActionReceipt with defaults", () => {
			const receipt = emitActionReceipt(
				{
					action: "merge PR-123",
					rationale: "Gates passed",
					confidence: "high",
					reversibility: "reversible",
				},
				{ log: false }
			);

			expect(receipt.schemaVersion).toBe("1.0.0");
			expect(receipt.kind).toBe("ActionReceipt");
			expect(receipt.outcome).toBe("success");
			expect(receipt.escalationRequired).toBe(false);
			expect(receipt.timestamp).toBeDefined();
		});

		it("should log JSON by default when log is enabled", () => {
			emitActionReceipt(
				{
					action: "test action",
					rationale: "test rationale",
					confidence: "high",
					reversibility: "reversible",
				},
				{ log: true, logger: logSpy }
			);

			expect(logSpy).toHaveBeenCalledTimes(1);
			const logged = JSON.parse(logSpy.mock.calls[0][0]);
			expect(logged.event).toBe("action_receipt");
			expect(logged.action).toBe("test action");
		});

		it("should log human-readable format when json is false", () => {
			emitActionReceipt(
				{
					action: "test action",
					rationale: "test rationale",
					confidence: "high",
					reversibility: "reversible",
				},
				{ log: true, json: false, logger: logSpy }
			);

			expect(logSpy).toHaveBeenCalledTimes(1);
			expect(logSpy.mock.calls[0][0]).toContain("[ActionReceipt]");
			expect(logSpy.mock.calls[0][0]).toContain("test action");
		});

		it("should include all optional fields when provided", () => {
			const receipt = emitActionReceipt(
				{
					action: "complex action",
					rationale: "complex rationale",
					confidence: "medium",
					reversibility: "partially-reversible",
					rollbackPath: "manual steps",
					rollbackCommand: "git revert HEAD",
					nextActions: ["step 1", "step 2"],
					phase: "verify",
					runId: "run123",
					planHash: "hash456",
					uncertaintyNotes: ["note 1"],
					escalationRequired: true,
					escalationReason: "needs review",
					outcome: "partial",
				},
				{ log: false }
			);

			expect(receipt.confidence).toBe("medium");
			expect(receipt.reversibility).toBe("partially-reversible");
			expect(receipt.rollbackPath).toBe("manual steps");
			expect(receipt.rollbackCommand).toBe("git revert HEAD");
			expect(receipt.nextActions).toEqual(["step 1", "step 2"]);
			expect(receipt.phase).toBe("verify");
			expect(receipt.runId).toBe("run123");
			expect(receipt.planHash).toBe("hash456");
			expect(receipt.uncertaintyNotes).toEqual(["note 1"]);
			expect(receipt.escalationRequired).toBe(true);
			expect(receipt.escalationReason).toBe("needs review");
			expect(receipt.outcome).toBe("partial");
		});
	});

	describe("emitFailureReceipt", () => {
		it("should create a receipt with failure outcome", () => {
			const receipt = emitFailureReceipt(
				{
					action: "gate: test",
					rationale: "3 tests failed",
					confidence: "high",
					reversibility: "reversible",
				},
				{ log: false }
			);

			expect(receipt.outcome).toBe("failure");
		});
	});

	describe("emitDeferredReceipt", () => {
		it("should create a receipt with deferred outcome", () => {
			const receipt = emitDeferredReceipt(
				{
					action: "merge PR-789",
					rationale: "Waiting for dependency",
					confidence: "medium",
					reversibility: "reversible",
				},
				{ log: false }
			);

			expect(receipt.outcome).toBe("deferred");
		});
	});

	describe("emitUncertaintyMarker", () => {
		it("should create a valid UncertaintyMarker", () => {
			const marker = emitUncertaintyMarker(
				{
					operation: "risky merge",
					uncertainties: ["unknown changes"],
					mitigations: ["can rollback"],
					proceedingAnyway: true,
					reason: "deadline",
				},
				{ log: false }
			);

			expect(marker.operation).toBe("risky merge");
			expect(marker.proceedingAnyway).toBe(true);
			expect(marker.timestamp).toBeDefined();
		});

		it("should log JSON by default", () => {
			emitUncertaintyMarker(
				{
					operation: "test op",
					uncertainties: ["u1"],
					mitigations: ["m1"],
					proceedingAnyway: false,
				},
				{ log: true, logger: logSpy }
			);

			expect(logSpy).toHaveBeenCalledTimes(1);
			const logged = JSON.parse(logSpy.mock.calls[0][0]);
			expect(logged.event).toBe("uncertainty_marker");
		});

		it("should log human-readable format when json is false", () => {
			emitUncertaintyMarker(
				{
					operation: "test op",
					uncertainties: ["u1", "u2"],
					mitigations: ["m1"],
					proceedingAnyway: true,
				},
				{ log: true, json: false, logger: logSpy }
			);

			expect(logSpy.mock.calls[0][0]).toContain("[UncertaintyMarker]");
			expect(logSpy.mock.calls[0][0]).toContain("PROCEEDING");
		});
	});

	describe("buildGovernanceContext", () => {
		it("should build context with all governance fields", () => {
			const ctx = buildGovernanceContext({
				reversibility: "reversible",
				rollbackPath: "git reset",
				rollbackCommand: "git reset --hard HEAD~1",
				confidence: "high",
				uncertaintyNotes: ["note 1", "note 2"],
			});

			expect(ctx.reversibility).toBe("reversible");
			expect(ctx.rollbackPath).toBe("git reset");
			expect(ctx.rollbackCommand).toBe("git reset --hard HEAD~1");
			expect(ctx.confidence).toBe("high");
			expect(ctx.uncertaintyNotes).toEqual(["note 1", "note 2"]);
		});

		it("should only include provided fields", () => {
			const ctx = buildGovernanceContext({
				reversibility: "irreversible",
			});

			expect(ctx.reversibility).toBe("irreversible");
			expect(ctx.rollbackPath).toBeUndefined();
			expect(ctx.confidence).toBeUndefined();
		});

		it("should return empty object when no fields provided", () => {
			const ctx = buildGovernanceContext({});
			expect(Object.keys(ctx)).toHaveLength(0);
		});

		it("should merge correctly with other context", () => {
			const govCtx = buildGovernanceContext({
				reversibility: "reversible",
				confidence: "high",
			});

			const merged = {
				customField: "value",
				...govCtx,
			};

			expect(merged.customField).toBe("value");
			expect(merged.reversibility).toBe("reversible");
			expect(merged.confidence).toBe("high");
		});
	});
});

describe("Integration with AXError pattern", () => {
	it("should work with governance context in error handling", () => {
		// Simulate how buildGovernanceContext would be used with createAXError
		const govCtx = buildGovernanceContext({
			reversibility: "reversible",
			rollbackPath: "git reset --hard HEAD~1",
			confidence: "high",
		});

		const errorContext = {
			item: "PR-123",
			files: ["src/cli.ts"],
			...govCtx,
		};

		expect(errorContext.item).toBe("PR-123");
		expect(errorContext.reversibility).toBe("reversible");
		expect(errorContext.rollbackPath).toBe("git reset --hard HEAD~1");
		expect(hasGovernanceContext(errorContext)).toBe(true);
	});
});
