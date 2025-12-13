import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadPlan } from "../src/schema.js";
import { ExecutionState } from "../src/executionState.js";
import type { HostilityScore } from "../src/hostility/score.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function makeHostilityScore(total: number): HostilityScore {
	const clamped = Math.max(0, Math.min(1, total));
	const status = clamped < 0.3 ? "low" : clamped < 0.6 ? "medium" : "high";
	const component = {
		score: clamped,
		status:
			clamped < 0.3
				? ("good" as const)
				: clamped < 0.6
				? ("warning" as const)
				: ("critical" as const),
		details: "test",
		recommendation: "test",
	};

	return {
		total: clamped,
		status,
		components: {
			constraintClarity: component,
			requirementExplicitness: component,
			problemBoundedness: component,
			receiptCompleteness: component,
			errorRecoverability: component,
			stateCoherence: component,
			modelContinuity: component,
		},
		recommendations: ["test"],
	};
}

async function importGatesWithMockedHostility(hostilityScore: HostilityScore) {
	vi.resetModules();
	vi.doMock("../src/hostility/index.js", () => ({
		runEnvironmentQualityCheck: () => hostilityScore,
	}));
	return await import("../src/gates.js");
}

describe("executeGatesWithPolicy (hostility timeout adjustment)", () => {
	let tempDir: string;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "gates-policy-timeout-")
		);
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {
			// Suppress timeout adjustment audit logs in test output
		});
	});

	afterEach(() => {
		logSpy.mockRestore();
		vi.doUnmock("../src/hostility/index.js");
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("extends gate timeouts in high hostility environments", async () => {
		const planJson = JSON.stringify({
			schemaVersion: "1.0.0",
			target: "main",
			policy: {
				requiredGates: [],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: "strict-required" },
			},
			items: [
				{
					name: "A",
					deps: [],
					gates: [
						{
							name: "slow",
							run: 'bash -c "sleep 0.55"',
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
			],
		});

		const plan = loadPlan(planJson);
		const executionState = new ExecutionState(plan);
		const { executeGatesWithPolicy } = await importGatesWithMockedHostility(
			makeHostilityScore(1.0)
		);

		// Base timeout is intentionally too small for the gate; high hostility should extend it.
		await executeGatesWithPolicy(
			plan,
			executionState,
			tempDir,
			300,
			undefined,
			true,
			tempDir
		);

		const node = executionState.getNodeResult("A");
		expect(node).toBeDefined();
		expect(node?.gates.find((g) => g.gate === "slow")?.status).toBe("pass");
		expect(node?.status).toBe("pass");
	}, 10000);

	it("does not extend timeouts in low hostility environments", async () => {
		const planJson = JSON.stringify({
			schemaVersion: "1.0.0",
			target: "main",
			policy: {
				requiredGates: [],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: "strict-required" },
			},
			items: [
				{
					name: "A",
					deps: [],
					gates: [
						{
							name: "slow",
							run: 'bash -c "sleep 0.55"',
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
			],
		});

		const plan = loadPlan(planJson);
		const executionState = new ExecutionState(plan);
		const { executeGatesWithPolicy } = await importGatesWithMockedHostility(
			makeHostilityScore(0.0)
		);

		// Base timeout is too small, and low hostility should keep it unchanged.
		await executeGatesWithPolicy(
			plan,
			executionState,
			tempDir,
			300,
			undefined,
			true,
			tempDir
		);

		const node = executionState.getNodeResult("A");
		expect(node).toBeDefined();
		expect(node?.gates.find((g) => g.gate === "slow")?.status).toBe("fail");
		expect(node?.status).toBe("fail");
	}, 10000);
});
