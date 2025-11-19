import { describe, it, expect } from "vitest";
import {
	ExecutionPlanV1Schema,
	SubIssueSchema,
} from "../.smartergpt/schemas/execution-plan-v1.js";
import type { FeatureSpecV0 } from "../.smartergpt/schemas/feature-spec-v0.js";

describe("SubIssueSchema", () => {
	it("validates valid sub-issue", () => {
		const validSubIssue = {
			id: "feature-impl",
			title: "Implement feature",
			description: "Implementation details",
			type: "feature",
			acceptanceCriteria: ["AC1", "AC2"],
			dependsOn: [],
		};

		const result = SubIssueSchema.safeParse(validSubIssue);
		expect(result.success).toBe(true);
	});

	it("validates sub-issue with dependencies", () => {
		const validSubIssue = {
			id: "tests",
			title: "Add tests",
			description: "Test implementation",
			type: "testing",
			acceptanceCriteria: ["AC1"],
			dependsOn: ["feature-impl"],
		};

		const result = SubIssueSchema.safeParse(validSubIssue);
		expect(result.success).toBe(true);
	});

	it("rejects invalid sub-issue type", () => {
		const invalidSubIssue = {
			id: "invalid",
			title: "Test",
			description: "Test",
			type: "invalid-type",
			acceptanceCriteria: ["AC1"],
			dependsOn: [],
		};

		const result = SubIssueSchema.safeParse(invalidSubIssue);
		expect(result.success).toBe(false);
	});

	it("rejects invalid id format", () => {
		const invalidSubIssue = {
			id: "Invalid_ID",
			title: "Test",
			description: "Test",
			type: "feature",
			acceptanceCriteria: ["AC1"],
			dependsOn: [],
		};

		const result = SubIssueSchema.safeParse(invalidSubIssue);
		expect(result.success).toBe(false);
	});

	it("validates all sub-issue types", () => {
		const types = ["feature", "testing", "docs"] as const;

		types.forEach((type) => {
			const subIssue = {
				id: `${type}-id`,
				title: "Test",
				description: "Test",
				type,
				acceptanceCriteria: ["AC1"],
				dependsOn: [],
			};

			const result = SubIssueSchema.safeParse(subIssue);
			expect(result.success).toBe(true);
		});
	});
});

describe("ExecutionPlanV1Schema", () => {
	const validSourceSpec: FeatureSpecV0 = {
		schemaVersion: "0.1.0",
		title: "Test Feature",
		description: "Test description",
		acceptanceCriteria: ["AC1", "AC2"],
		repo: "owner/repo",
		createdAt: "2025-11-09T14:30:00.000Z",
	};

	it("validates valid execution plan", () => {
		const validPlan = {
			schemaVersion: "1.0.0",
			sourceSpec: validSourceSpec,
			epic: {
				title: "Test Epic",
				description: "Epic description",
				acceptanceCriteria: ["AC1", "AC2"],
			},
			subIssues: [
				{
					id: "feature-impl",
					title: "Implement feature",
					description: "Implementation details",
					type: "feature",
					acceptanceCriteria: ["AC1"],
					dependsOn: [],
				},
			],
			createdAt: "2025-11-09T14:35:00.000Z",
		};

		const result = ExecutionPlanV1Schema.safeParse(validPlan);
		expect(result.success).toBe(true);
	});

	it("validates execution plan with multiple sub-issues", () => {
		const validPlan = {
			schemaVersion: "1.0.0",
			sourceSpec: validSourceSpec,
			epic: {
				title: "Test Epic",
				description: "Epic description",
				acceptanceCriteria: ["AC1"],
			},
			subIssues: [
				{
					id: "feature-impl",
					title: "Implement feature",
					description: "Implementation",
					type: "feature",
					acceptanceCriteria: ["AC1"],
					dependsOn: [],
				},
				{
					id: "tests",
					title: "Add tests",
					description: "Testing",
					type: "testing",
					acceptanceCriteria: ["AC1"],
					dependsOn: ["feature-impl"],
				},
				{
					id: "docs",
					title: "Add docs",
					description: "Documentation",
					type: "docs",
					acceptanceCriteria: ["AC1"],
					dependsOn: ["feature-impl"],
				},
			],
			createdAt: "2025-11-09T14:35:00.000Z",
		};

		const result = ExecutionPlanV1Schema.safeParse(validPlan);
		expect(result.success).toBe(true);
	});

	it("rejects empty sub-issues array", () => {
		const invalidPlan = {
			schemaVersion: "1.0.0",
			sourceSpec: validSourceSpec,
			epic: {
				title: "Test",
				description: "Test",
				acceptanceCriteria: ["AC1"],
			},
			subIssues: [],
			createdAt: "2025-11-09T14:35:00.000Z",
		};

		const result = ExecutionPlanV1Schema.safeParse(invalidPlan);
		expect(result.success).toBe(false);
	});

	it("rejects invalid schema version", () => {
		const invalidPlan = {
			schemaVersion: "0.1.0",
			sourceSpec: validSourceSpec,
			epic: {
				title: "Test",
				description: "Test",
				acceptanceCriteria: ["AC1"],
			},
			subIssues: [
				{
					id: "feature-impl",
					title: "Test",
					description: "Test",
					type: "feature",
					acceptanceCriteria: ["AC1"],
					dependsOn: [],
				},
			],
			createdAt: "2025-11-09T14:35:00.000Z",
		};

		const result = ExecutionPlanV1Schema.safeParse(invalidPlan);
		expect(result.success).toBe(false);
	});

	it("rejects missing epic fields", () => {
		const invalidPlan = {
			schemaVersion: "1.0.0",
			sourceSpec: validSourceSpec,
			epic: {
				title: "Test",
				// missing description
				acceptanceCriteria: ["AC1"],
			},
			subIssues: [
				{
					id: "feature-impl",
					title: "Test",
					description: "Test",
					type: "feature",
					acceptanceCriteria: ["AC1"],
					dependsOn: [],
				},
			],
			createdAt: "2025-11-09T14:35:00.000Z",
		};

		const result = ExecutionPlanV1Schema.safeParse(invalidPlan);
		expect(result.success).toBe(false);
	});

	test("rejects invalid source spec", () => {
		const invalidPlan = {
			schemaVersion: "1.0.0",
			sourceSpec: {
				schemaVersion: "0.1.0",
				title: "Test",
				// missing required fields
			},
			epic: {
				title: "Test",
				description: "Test",
				acceptanceCriteria: ["AC1"],
			},
			subIssues: [
				{
					id: "feature-impl",
					title: "Test",
					description: "Test",
					type: "feature",
					acceptanceCriteria: ["AC1"],
					dependsOn: [],
				},
			],
			createdAt: "2025-11-09T14:35:00.000Z",
		};

		const result = ExecutionPlanV1Schema.safeParse(invalidPlan);
		assert.ok(!result.success, "Plan with invalid source spec should fail");
	});
});
