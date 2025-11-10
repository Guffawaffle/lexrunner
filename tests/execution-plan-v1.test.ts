/**
 * Tests for Execution Plan v1 Schema validation
 *
 * Run with: npx tsx --test tests/execution-plan-v1.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import {
	ExecutionPlanV1Schema,
	SubIssueSchema,
} from "../.smartergpt/schemas/execution-plan-v1.js";
import type { FeatureSpecV0 } from "../.smartergpt/schemas/feature-spec-v0.js";

describe("SubIssueSchema", () => {
	test("validates valid sub-issue", () => {
		const validSubIssue = {
			id: "feature-impl",
			title: "Implement feature",
			description: "Implementation details",
			type: "feature",
			acceptanceCriteria: ["AC1", "AC2"],
			dependsOn: [],
		};

		const result = SubIssueSchema.safeParse(validSubIssue);
		assert.ok(result.success, "Valid sub-issue should parse successfully");
	});

	test("validates sub-issue with dependencies", () => {
		const validSubIssue = {
			id: "tests",
			title: "Add tests",
			description: "Test implementation",
			type: "testing",
			acceptanceCriteria: ["AC1"],
			dependsOn: ["feature-impl"],
		};

		const result = SubIssueSchema.safeParse(validSubIssue);
		assert.ok(
			result.success,
			"Valid sub-issue with dependencies should parse successfully"
		);
	});

	test("rejects invalid sub-issue type", () => {
		const invalidSubIssue = {
			id: "invalid",
			title: "Test",
			description: "Test",
			type: "invalid-type",
			acceptanceCriteria: ["AC1"],
			dependsOn: [],
		};

		const result = SubIssueSchema.safeParse(invalidSubIssue);
		assert.ok(!result.success, "Sub-issue with invalid type should fail");
	});

	test("rejects invalid id format", () => {
		const invalidSubIssue = {
			id: "Invalid_ID",
			title: "Test",
			description: "Test",
			type: "feature",
			acceptanceCriteria: ["AC1"],
			dependsOn: [],
		};

		const result = SubIssueSchema.safeParse(invalidSubIssue);
		assert.ok(
			!result.success,
			"Sub-issue with invalid id format should fail"
		);
	});

	test("validates all sub-issue types", () => {
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
			assert.ok(
				result.success,
				`Sub-issue with type '${type}' should parse successfully`
			);
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

	test("validates valid execution plan", () => {
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
		assert.ok(
			result.success,
			"Valid execution plan should parse successfully"
		);
	});

	test("validates execution plan with multiple sub-issues", () => {
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
		assert.ok(
			result.success,
			"Valid execution plan with multiple sub-issues should parse successfully"
		);
	});

	test("rejects empty sub-issues array", () => {
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
		assert.ok(!result.success, "Plan with empty sub-issues should fail");
	});

	test("rejects invalid schema version", () => {
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
		assert.ok(
			!result.success,
			"Plan with wrong schema version should fail"
		);
	});

	test("rejects missing epic fields", () => {
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
		assert.ok(
			!result.success,
			"Plan with missing epic description should fail"
		);
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
