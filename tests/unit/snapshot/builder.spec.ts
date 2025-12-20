/**
 * Snapshot Builder Tests
 *
 * Tests for the TaskSnapshot_v1 builder that generates anchored hunks,
 * computes hashes, and manages scope boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SnapshotBuilder } from "../../../src/snapshot/builder.js";
import {
	TaskSnapshot_v1,
	computeCanonicalHash,
	computeSnapshotHash,
	TASK_CONTRACT_VERSION,
} from "../../../src/schemas/task-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("SnapshotBuilder", () => {
	const fixturesDir = path.join(__dirname, "../../fixtures/snapshot");
	let tempDir: string;
	const repoId = "example/repo";
	const commitSha = "abcdef1";

	beforeEach(async () => {
		// Create a temporary directory for testing (no git commits; see AGENTS.md)
		tempDir = path.join(__dirname, "../../fixtures/snapshot-temp");
		await fs.rm(tempDir, { recursive: true, force: true });
		await fs.mkdir(tempDir, { recursive: true });

		// Copy fixture files
		await fs.copyFile(
			path.join(fixturesDir, "sample.ts"),
			path.join(tempDir, "sample.ts")
		);
		await fs.copyFile(
			path.join(fixturesDir, "package.json"),
			path.join(tempDir, "package.json")
		);
	});

	afterEach(async () => {
		// Clean up temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	it("buildSnapshot generates valid TaskSnapshot_v1", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-task-001",
			procedure: "Fix the divide function to handle division by zero",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Division by zero",
				fileRel: "sample.ts",
				line: 14,
				runnerOutputSnip: "Error: Division by zero",
			},
		});

		const result = TaskSnapshot_v1.safeParse(snapshot);
		expect(result.success).toBe(true);

		expect(snapshot.schema_version).toBe(TASK_CONTRACT_VERSION);
		expect(snapshot.task_id).toBe("test-task-001");
		expect(snapshot.procedure).toContain("divide");
		expect(snapshot.repo.id).toBe(repoId);
		expect(snapshot.repo.root).toBe(tempDir);
		expect(snapshot.repo.commit_sha).toBe(commitSha);

		expect(snapshot.scope.cross_repo_allowed).toBe(false);
		expect(snapshot.scope.write_globs).toContain("sample.ts");
		expect(snapshot.scope.deny_globs).toContain("node_modules/**");

		expect(snapshot.failure.file_rel).toBe("sample.ts");
		expect(snapshot.failure.message).toBe("Division by zero");
		expect(snapshot.failure.line).toBe(14);
		expect(snapshot.failure.runner_output_snip).toContain("Division");

		expect(snapshot.targets).toHaveLength(1);
		expect(snapshot.targets[0].path_rel).toBe("sample.ts");
		expect(snapshot.targets[0].hunk).toContain("export function divide");
		expect(snapshot.targets[0].hunk_sha256).toMatch(
			/^sha256:[a-f0-9]{64}$/
		);

		expect(snapshot.verification.cmd).toBe("npm test");
		expect(snapshot.verification.expect.exit_code).toBe(0);

		expect(snapshot.budget.truncated_fields).toEqual([]);
		expect(snapshot.receipt_schema_id).toBe("task-receipt-v1");
		expect(snapshot.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("extractHunks handles file start/end boundaries", async () => {
		const builder = new SnapshotBuilder({
			repoRoot: tempDir,
			repoId,
			contextRadius: 2,
		});

		const fileContent = await fs.readFile(
			path.join(tempDir, "sample.ts"),
			"utf-8"
		);
		const fileLines = fileContent.split("\n");
		const firstLine = fileLines[0];
		const lastNonEmptyLine = [...fileLines]
			.reverse()
			.find((l) => l.length > 0);

		// Failure at line 1 should include the first line.
		const snapshotStart = await builder.buildSnapshot({
			taskId: "test-boundary-start",
			procedure: "Fix issue at start of file",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Error at start",
				fileRel: "sample.ts",
				line: 1,
				runnerOutputSnip: "",
			},
		});
		expect(snapshotStart.targets[0].hunk.split("\n")[0]).toBe(firstLine);

		// Failure near EOF should include the last non-empty line.
		const snapshotEnd = await builder.buildSnapshot({
			taskId: "test-boundary-end",
			procedure: "Fix issue at end of file",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Error at end",
				fileRel: "sample.ts",
				line: fileLines.length,
				runnerOutputSnip: "",
			},
		});
		if (lastNonEmptyLine) {
			expect(snapshotEnd.targets[0].hunk).toContain(lastNonEmptyLine);
		}
	});

	it("extractHunks respects context radius", async () => {
		const builder = new SnapshotBuilder({
			repoRoot: tempDir,
			repoId,
			contextRadius: 3,
		});

		const snapshot = await builder.buildSnapshot({
			taskId: "test-context",
			procedure: "Fix divide function",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Division by zero error",
				fileRel: "sample.ts",
				line: 14,
				runnerOutputSnip: "",
			},
		});

		const hunkLines = snapshot.targets[0].hunk.split("\n");
		// Max 7 lines total: 3 before + center line + 3 after.
		expect(hunkLines.length).toBeLessThanOrEqual(7);
	});

	it("hunk hash is deterministic", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot1 = await builder.buildSnapshot({
			taskId: "test-determinism-1",
			procedure: "Test procedure",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
		});

		const snapshot2 = await builder.buildSnapshot({
			taskId: "test-determinism-1", // Same task ID
			procedure: "Test procedure",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
		});

		expect(snapshot1.targets[0].hunk).toBe(snapshot2.targets[0].hunk);
		expect(snapshot1.targets[0].hunk_sha256).toBe(
			snapshot2.targets[0].hunk_sha256
		);

		const expectedHash = computeCanonicalHash(snapshot1.targets[0].hunk);
		expect(snapshot1.targets[0].hunk_sha256).toBe(expectedHash);
	});

	it("scope defaults are applied correctly", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-scope-defaults",
			procedure: "Test scope",
			targetFiles: ["sample.ts", "package.json"],
			commitSha,
			verificationCmd: "npm test",
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
		});

		// Check default read globs
		expect(snapshot.scope.read_globs).toContain("**/*.ts");
		expect(snapshot.scope.read_globs).toContain("**/*.json");
		expect(snapshot.scope.read_globs).toContain("docs/**");

		// Check write globs match target files
		expect(snapshot.scope.write_globs).toContain("sample.ts");
		expect(snapshot.scope.write_globs).toContain("package.json");
		expect(snapshot.scope.write_globs).toHaveLength(2);

		// Check deny patterns
		expect(snapshot.scope.deny_globs).toContain("node_modules/**");
		expect(snapshot.scope.deny_globs).toContain("dist/**");
		expect(snapshot.scope.deny_globs).toContain(".git/**");
		expect(snapshot.scope.deny_globs).toContain("*.lock");

		// Check cross-repo policy
		expect(snapshot.scope.cross_repo_allowed).toBe(false);
	});

	it("scope overrides merge with defaults", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-scope-overrides",
			procedure: "Test scope overrides",
			targetFiles: ["sample.ts"],
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
			commitSha,
			verificationCmd: "npm test",
			scopeOverrides: {
				read_globs: ["**/*.ts", "**/*.md"], // Override read globs
				cross_repo_allowed: true, // Override cross-repo policy
			},
		});

		// Overridden fields
		expect(snapshot.scope.read_globs).toEqual(["**/*.ts", "**/*.md"]);
		expect(snapshot.scope.cross_repo_allowed).toBe(true);

		// Non-overridden fields should still have defaults
		expect(snapshot.scope.write_globs).toContain("sample.ts");
		expect(snapshot.scope.deny_globs).toContain("node_modules/**");
	});

	it("snapshot_hash matches content", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-hash-verification",
			procedure: "Test hash",
			targetFiles: ["sample.ts"],
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
			commitSha,
			verificationCmd: "npm test",
		});

		// Recompute hash manually
		const { snapshot_hash, ...snapshotWithoutHash } = snapshot;
		const recomputedHash = computeSnapshotHash(snapshotWithoutHash);

		expect(snapshot.snapshot_hash).toBe(recomputedHash);
	});

	it("handles multiple target files", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-multiple-files",
			procedure: "Update multiple files",
			targetFiles: ["sample.ts", "package.json"],
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
			commitSha,
			verificationCmd: "npm test",
		});

		expect(snapshot.targets).toHaveLength(2);

		const filePaths = snapshot.targets.map((t) => t.path_rel);
		expect(filePaths).toContain("sample.ts");
		expect(filePaths).toContain("package.json");

		for (const target of snapshot.targets) {
			expect(target.hunk_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
		}
	});

	it("handles non-existent target files gracefully", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-missing-file",
			procedure: "Create new file",
			targetFiles: ["nonexistent.ts"],
			failure: {
				message: "Missing file",
				fileRel: "nonexistent.ts",
				runnerOutputSnip: "",
			},
			commitSha,
			verificationCmd: "npm test",
		});

		expect(snapshot.targets).toHaveLength(1);
		expect(snapshot.targets[0].path_rel).toBe("nonexistent.ts");
		expect(snapshot.targets[0].hunk).toBe("");
		expect(snapshot.targets[0].hunk_sha256).toBe(computeCanonicalHash(""));
	});

	it("includes failure evidence", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-failure-evidence",
			procedure: "Fix failure",
			targetFiles: ["sample.ts"],
			failure: {
				message: "TypeError: Cannot divide by zero",
				fileRel: "sample.ts",
				line: 14,
				runnerOutputSnip: "TypeError: Cannot divide by zero",
				excerpt: "divide(1, 0)",
			},
			commitSha,
			verificationCmd: "npm test",
		});

		expect(snapshot.failure.message).toBe(
			"TypeError: Cannot divide by zero"
		);
		expect(snapshot.failure.file_rel).toBe("sample.ts");
		expect(snapshot.failure.line).toBe(14);
		expect(snapshot.failure.runner_output_snip).toContain("TypeError");
		expect(snapshot.failure.excerpt).toBe("divide(1, 0)");
	});

	it("sets custom expected exit code", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, repoId });

		const snapshot = await builder.buildSnapshot({
			taskId: "test-exit-code",
			procedure: "Test with custom exit code",
			targetFiles: ["sample.ts"],
			failure: {
				message: "Fail",
				fileRel: "sample.ts",
				runnerOutputSnip: "",
			},
			commitSha,
			verificationCmd: "npm run lint",
			expectedExitCode: 2,
		});

		expect(snapshot.verification.expect.exit_code).toBe(2);
	});
});
