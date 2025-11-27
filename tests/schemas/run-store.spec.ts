/**
 * RunStore Schemas Tests
 *
 * Tests for RunRecord, StepOutcome, Receipt, RunState, and StepStatus schemas.
 */

import { describe, it, expect } from "vitest";
import {
	RunStateSchema,
	StepStatusSchema,
	RunRecordSchema,
	StepOutcomeSchema,
	ReceiptSchema,
	parseRunRecord,
	parseStepOutcome,
	parseReceipt,
	safeParseRunRecord,
	safeParseStepOutcome,
	safeParseReceipt,
	type RunState,
	type StepStatus,
	type RunRecord,
	type StepOutcome,
	type Receipt,
	type RunStore,
	type ListRunsOptions,
} from "../../src/store/run-store.js";

describe("RunStore Schemas", () => {
	describe("RunStateSchema", () => {
		it("should validate all run states", () => {
			const states: RunState[] = ["pending", "running", "completed", "failed", "aborted"];

			for (const state of states) {
				const result = RunStateSchema.parse(state);
				expect(result).toBe(state);
			}
		});

		it("should reject invalid run states", () => {
			expect(() => RunStateSchema.parse("invalid")).toThrow();
			expect(() => RunStateSchema.parse("")).toThrow();
			expect(() => RunStateSchema.parse(123)).toThrow();
		});
	});

	describe("StepStatusSchema", () => {
		it("should validate all step statuses", () => {
			const statuses: StepStatus[] = ["pass", "fail", "skipped", "blocked"];

			for (const status of statuses) {
				const result = StepStatusSchema.parse(status);
				expect(result).toBe(status);
			}
		});

		it("should reject invalid step statuses", () => {
			expect(() => StepStatusSchema.parse("success")).toThrow();
			expect(() => StepStatusSchema.parse("error")).toThrow();
			expect(() => StepStatusSchema.parse("")).toThrow();
		});
	});

	describe("RunRecordSchema", () => {
		const validTimestamp = "2024-01-15T10:30:00.000Z";

		it("should validate a minimal RunRecord", () => {
			const record: RunRecord = {
				runId: "run-001",
				planHash: "sha256:abc123",
				state: "pending",
				startedAt: validTimestamp,
			};

			const result = RunRecordSchema.parse(record);
			expect(result.runId).toBe("run-001");
			expect(result.planHash).toBe("sha256:abc123");
			expect(result.state).toBe("pending");
			expect(result.startedAt).toBe(validTimestamp);
			expect(result.completedAt).toBeUndefined();
			expect(result.metadata).toBeUndefined();
		});

		it("should validate a complete RunRecord", () => {
			const record: RunRecord = {
				runId: "run-001",
				planHash: "sha256:abc123def456",
				state: "completed",
				startedAt: "2024-01-15T10:30:00.000Z",
				completedAt: "2024-01-15T11:00:00.000Z",
				metadata: {
					prNumber: 42,
					branchName: "feature/new-thing",
					nested: { key: "value" },
				},
			};

			const result = RunRecordSchema.parse(record);
			expect(result.completedAt).toBe("2024-01-15T11:00:00.000Z");
			expect(result.metadata?.prNumber).toBe(42);
			expect((result.metadata?.nested as { key: string }).key).toBe("value");
		});

		it("should validate all run states in RunRecord", () => {
			const states: RunState[] = ["pending", "running", "completed", "failed", "aborted"];

			for (const state of states) {
				const record = {
					runId: "run-001",
					planHash: "sha256:abc",
					state,
					startedAt: validTimestamp,
				};

				const result = RunRecordSchema.parse(record);
				expect(result.state).toBe(state);
			}
		});

		it("should reject missing required fields", () => {
			expect(() => RunRecordSchema.parse({})).toThrow();
			expect(() =>
				RunRecordSchema.parse({
					runId: "run-001",
					planHash: "sha256:abc",
					state: "pending",
					// Missing startedAt
				})
			).toThrow();
			expect(() =>
				RunRecordSchema.parse({
					runId: "run-001",
					planHash: "sha256:abc",
					// Missing state
					startedAt: validTimestamp,
				})
			).toThrow();
		});

		it("should reject empty runId", () => {
			expect(() =>
				RunRecordSchema.parse({
					runId: "",
					planHash: "sha256:abc",
					state: "pending",
					startedAt: validTimestamp,
				})
			).toThrow();
		});

		it("should reject invalid timestamp format", () => {
			expect(() =>
				RunRecordSchema.parse({
					runId: "run-001",
					planHash: "sha256:abc",
					state: "pending",
					startedAt: "2024-01-15", // Not ISO 8601 datetime
				})
			).toThrow();

			expect(() =>
				RunRecordSchema.parse({
					runId: "run-001",
					planHash: "sha256:abc",
					state: "pending",
					startedAt: "invalid-timestamp",
				})
			).toThrow();
		});

		it("should use parseRunRecord function", () => {
			const record = parseRunRecord({
				runId: "run-001",
				planHash: "sha256:abc",
				state: "running",
				startedAt: validTimestamp,
			});
			expect(record.runId).toBe("run-001");
		});

		it("should return errors via safeParseRunRecord", () => {
			const result = safeParseRunRecord({});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.length).toBeGreaterThan(0);
			}
		});
	});

	describe("StepOutcomeSchema", () => {
		const validTimestamp = "2024-01-15T10:30:05.000Z";

		it("should validate a minimal StepOutcome", () => {
			const step: StepOutcome = {
				stepId: "step-001",
				runId: "run-001",
				nodeId: "pr-42",
				gateName: "lint",
				status: "pass",
				durationMs: 1234,
				timestamp: validTimestamp,
			};

			const result = StepOutcomeSchema.parse(step);
			expect(result.stepId).toBe("step-001");
			expect(result.runId).toBe("run-001");
			expect(result.nodeId).toBe("pr-42");
			expect(result.gateName).toBe("lint");
			expect(result.status).toBe("pass");
			expect(result.durationMs).toBe(1234);
			expect(result.logs).toBeUndefined();
			expect(result.artifacts).toBeUndefined();
		});

		it("should validate a complete StepOutcome", () => {
			const step: StepOutcome = {
				stepId: "step-001",
				runId: "run-001",
				nodeId: "pr-42",
				gateName: "test",
				status: "fail",
				durationMs: 5000,
				logs: "/var/log/test.log",
				artifacts: ["/artifacts/coverage.json", "/artifacts/report.html"],
				timestamp: validTimestamp,
			};

			const result = StepOutcomeSchema.parse(step);
			expect(result.logs).toBe("/var/log/test.log");
			expect(result.artifacts).toHaveLength(2);
			expect(result.artifacts).toContain("/artifacts/coverage.json");
		});

		it("should validate all step statuses", () => {
			const statuses: StepStatus[] = ["pass", "fail", "skipped", "blocked"];

			for (const status of statuses) {
				const step = {
					stepId: "step-001",
					runId: "run-001",
					nodeId: "pr-42",
					gateName: "test",
					status,
					durationMs: 100,
					timestamp: validTimestamp,
				};

				const result = StepOutcomeSchema.parse(step);
				expect(result.status).toBe(status);
			}
		});

		it("should accept zero duration", () => {
			const step = {
				stepId: "step-001",
				runId: "run-001",
				nodeId: "pr-42",
				gateName: "skipped-gate",
				status: "skipped",
				durationMs: 0,
				timestamp: validTimestamp,
			};

			const result = StepOutcomeSchema.parse(step);
			expect(result.durationMs).toBe(0);
		});

		it("should reject negative duration", () => {
			expect(() =>
				StepOutcomeSchema.parse({
					stepId: "step-001",
					runId: "run-001",
					nodeId: "pr-42",
					gateName: "test",
					status: "pass",
					durationMs: -100,
					timestamp: validTimestamp,
				})
			).toThrow();
		});

		it("should reject non-integer duration", () => {
			expect(() =>
				StepOutcomeSchema.parse({
					stepId: "step-001",
					runId: "run-001",
					nodeId: "pr-42",
					gateName: "test",
					status: "pass",
					durationMs: 100.5,
					timestamp: validTimestamp,
				})
			).toThrow();
		});

		it("should reject missing required fields", () => {
			expect(() => StepOutcomeSchema.parse({})).toThrow();
			expect(() =>
				StepOutcomeSchema.parse({
					stepId: "step-001",
					// Missing other required fields
				})
			).toThrow();
		});

		it("should use parseStepOutcome function", () => {
			const step = parseStepOutcome({
				stepId: "step-001",
				runId: "run-001",
				nodeId: "pr-42",
				gateName: "lint",
				status: "pass",
				durationMs: 1234,
				timestamp: validTimestamp,
			});
			expect(step.gateName).toBe("lint");
		});

		it("should return errors via safeParseStepOutcome", () => {
			const result = safeParseStepOutcome({});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.length).toBeGreaterThan(0);
			}
		});
	});

	describe("ReceiptSchema", () => {
		const validTimestamp = "2024-01-15T10:31:00.000Z";

		it("should validate a minimal Receipt", () => {
			const receipt: Receipt = {
				receiptId: "receipt-001",
				runId: "run-001",
				reason: "Scope expanded beyond initial plan",
				timestamp: validTimestamp,
			};

			const result = ReceiptSchema.parse(receipt);
			expect(result.receiptId).toBe("receipt-001");
			expect(result.runId).toBe("run-001");
			expect(result.reason).toBe("Scope expanded beyond initial plan");
			expect(result.approver).toBeUndefined();
		});

		it("should validate a complete Receipt", () => {
			const receipt: Receipt = {
				receiptId: "receipt-001",
				runId: "run-001",
				reason: "Security risk escalation",
				approver: "alice@example.com",
				timestamp: validTimestamp,
			};

			const result = ReceiptSchema.parse(receipt);
			expect(result.approver).toBe("alice@example.com");
		});

		it("should reject missing required fields", () => {
			expect(() => ReceiptSchema.parse({})).toThrow();
			expect(() =>
				ReceiptSchema.parse({
					receiptId: "receipt-001",
					runId: "run-001",
					// Missing reason and timestamp
				})
			).toThrow();
		});

		it("should reject empty reason", () => {
			expect(() =>
				ReceiptSchema.parse({
					receiptId: "receipt-001",
					runId: "run-001",
					reason: "",
					timestamp: validTimestamp,
				})
			).toThrow();
		});

		it("should reject invalid timestamp format", () => {
			expect(() =>
				ReceiptSchema.parse({
					receiptId: "receipt-001",
					runId: "run-001",
					reason: "Test reason",
					timestamp: "invalid-timestamp",
				})
			).toThrow();
		});

		it("should use parseReceipt function", () => {
			const receipt = parseReceipt({
				receiptId: "receipt-001",
				runId: "run-001",
				reason: "Test",
				timestamp: validTimestamp,
			});
			expect(receipt.receiptId).toBe("receipt-001");
		});

		it("should return errors via safeParseReceipt", () => {
			const result = safeParseReceipt({});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.length).toBeGreaterThan(0);
			}
		});
	});

	describe("Type exports", () => {
		it("should export RunState type", () => {
			const state: RunState = "running";
			expect(state).toBe("running");
		});

		it("should export StepStatus type", () => {
			const status: StepStatus = "pass";
			expect(status).toBe("pass");
		});

		it("should export RunRecord type", () => {
			const record: RunRecord = {
				runId: "run-001",
				planHash: "sha256:abc",
				state: "pending",
				startedAt: "2024-01-15T10:30:00.000Z",
			};
			expect(record.runId).toBe("run-001");
		});

		it("should export StepOutcome type", () => {
			const step: StepOutcome = {
				stepId: "step-001",
				runId: "run-001",
				nodeId: "pr-42",
				gateName: "lint",
				status: "pass",
				durationMs: 1234,
				timestamp: "2024-01-15T10:30:05.000Z",
			};
			expect(step.stepId).toBe("step-001");
		});

		it("should export Receipt type", () => {
			const receipt: Receipt = {
				receiptId: "receipt-001",
				runId: "run-001",
				reason: "Test",
				timestamp: "2024-01-15T10:31:00.000Z",
			};
			expect(receipt.receiptId).toBe("receipt-001");
		});

		it("should export ListRunsOptions type", () => {
			const options: ListRunsOptions = {
				limit: 10,
				offset: 0,
				state: "running",
			};
			expect(options.limit).toBe(10);
		});

		it("should export RunStore interface", () => {
			// Type-only check - RunStore is an interface
			// This verifies the interface is properly exported
			const mockStore: RunStore = {
				createRun: async () => {},
				updateRun: async () => {},
				getRun: async () => null,
				listRuns: async () => [],
				appendStep: async () => {},
				getStepsForRun: async () => [],
				saveReceipt: async () => {},
				getReceiptsForRun: async () => [],
				getRunCount: async () => 0,
				close: async () => {},
			};
			expect(mockStore).toBeDefined();
		});
	});

	describe("Timestamp Format Invariants", () => {
		it("should accept valid UTC ISO 8601 timestamps", () => {
			const timestamps = [
				"2024-01-15T10:30:00.000Z",
				"2024-12-31T23:59:59.999Z",
				"2020-01-01T00:00:00.000Z",
			];

			for (const timestamp of timestamps) {
				const record = parseRunRecord({
					runId: "run-001",
					planHash: "sha256:abc",
					state: "pending",
					startedAt: timestamp,
				});
				expect(record.startedAt).toBe(timestamp);
			}
		});

		it("should reject non-UTC timestamps", () => {
			const invalidTimestamps = [
				"2024-01-15T10:30:00", // No timezone
				"2024-01-15", // Date only
				"10:30:00Z", // Time only
				"Jan 15, 2024", // Human readable
			];

			for (const timestamp of invalidTimestamps) {
				expect(() =>
					RunRecordSchema.parse({
						runId: "run-001",
						planHash: "sha256:abc",
						state: "pending",
						startedAt: timestamp,
					})
				).toThrow();
			}
		});
	});

	describe("ID Ownership Invariants", () => {
		it("should allow any string format for caller-generated IDs", () => {
			// ULIDs
			const ulid = parseRunRecord({
				runId: "01HXYZ123ABCDEF456789",
				planHash: "sha256:abc",
				state: "pending",
				startedAt: "2024-01-15T10:30:00.000Z",
			});
			expect(ulid.runId).toBe("01HXYZ123ABCDEF456789");

			// UUIDs
			const uuid = parseRunRecord({
				runId: "550e8400-e29b-41d4-a716-446655440000",
				planHash: "sha256:abc",
				state: "pending",
				startedAt: "2024-01-15T10:30:00.000Z",
			});
			expect(uuid.runId).toBe("550e8400-e29b-41d4-a716-446655440000");

			// Custom formats
			const custom = parseRunRecord({
				runId: "run-2024-001",
				planHash: "sha256:abc",
				state: "pending",
				startedAt: "2024-01-15T10:30:00.000Z",
			});
			expect(custom.runId).toBe("run-2024-001");
		});
	});
});
