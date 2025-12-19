/**
 * Snapshot Builder Tests
 *
 * Tests for the TaskSnapshot_v1 builder that generates anchored hunks,
 * computes hashes, and manages scope boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SnapshotBuilder } from "../../../src/snapshot/builder.js";
import {
	TaskSnapshot_v1_Schema,
	computeCanonicalHash,
	computeSnapshotHash,
	TASK_CONTRACT_VERSION
} from "../../../src/schemas/task-contract.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("SnapshotBuilder", () => {
	const fixturesDir = path.join(__dirname, "../../fixtures/snapshot");
	let tempDir: string;

	beforeEach(async () => {
		// Create a temporary git repository for testing
		tempDir = path.join(__dirname, "../../fixtures/snapshot-temp");
		await fs.mkdir(tempDir, { recursive: true });

		// Initialize git repo
		await execa("git", ["init"], { cwd: tempDir });
		await execa("git", ["config", "user.name", "Test User"], { cwd: tempDir });
		await execa("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });

		// Copy fixture files
		await fs.copyFile(
			path.join(fixturesDir, "sample.ts"),
			path.join(tempDir, "sample.ts")
		);
		await fs.copyFile(
			path.join(fixturesDir, "package.json"),
			path.join(tempDir, "package.json")
		);

		// Create initial commit
		await execa("git", ["add", "."], { cwd: tempDir });
		await execa("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });
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
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-task-001",
			procedure: "Fix the divide function to handle division by zero",
			targetFiles: ["sample.ts"],
			commitSha,
			branchName: "main",
			verificationCmd: "npm test"
		});

		// Validate against schema
		const result = TaskSnapshot_v1_Schema.safeParse(snapshot);
		expect(result.success).toBe(true);

		// Check basic fields
		expect(snapshot.task_id).toBe("test-task-001");
		expect(snapshot.schema_version).toBe(TASK_CONTRACT_VERSION);
		expect(snapshot.commit_sha).toBe(commitSha);
		expect(snapshot.branch_name).toBe("main");
		expect(snapshot.procedure).toContain("divide");
		expect(snapshot.verification_cmd).toBe("npm test");
		expect(snapshot.expected_exit_code).toBe(0);

		// Check anchored hunks
		expect(snapshot.anchored_hunks).toHaveLength(1);
		expect(snapshot.anchored_hunks[0].file_path).toBe("sample.ts");

		// Check scope
		expect(snapshot.scope.cross_repo_allowed).toBe(false);
		expect(snapshot.scope.write_globs).toContain("sample.ts");
		expect(snapshot.scope.deny_globs).toContain("node_modules/**");

		// Check snapshot hash exists
		expect(snapshot.snapshot_hash).toBeTruthy();
		expect(snapshot.snapshot_hash.length).toBe(64); // SHA-256 hex is 64 chars
	});

	it("extractHunks handles file start/end boundaries", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, contextRadius: 2 });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		// Test with failure at line 1 (start of file)
		const snapshot1 = await builder.buildSnapshot({
			taskId: "test-boundary-start",
			procedure: "Fix issue at start of file",
			targetFiles: ["sample.ts"],
			failureInfo: {
				message: "Error at start",
				location: { file: "sample.ts", line: 1 }
			},
			commitSha,
			verificationCmd: "npm test"
		});

		const hunk1 = snapshot1.anchored_hunks[0];
		expect(hunk1.start_line).toBe(1); // Can't go below 1
		expect(hunk1.end_line).toBeGreaterThan(1); // Should include context after

		// Test with failure near end of file
		const fileContent = await fs.readFile(path.join(tempDir, "sample.ts"), "utf-8");
		const lineCount = fileContent.split("\n").length;

		const snapshot2 = await builder.buildSnapshot({
			taskId: "test-boundary-end",
			procedure: "Fix issue at end of file",
			targetFiles: ["sample.ts"],
			failureInfo: {
				message: "Error at end",
				location: { file: "sample.ts", line: lineCount }
			},
			commitSha,
			verificationCmd: "npm test"
		});

		const hunk2 = snapshot2.anchored_hunks[0];
		expect(hunk2.end_line).toBe(lineCount); // Can't go beyond file length
		expect(hunk2.start_line).toBeLessThan(lineCount); // Should include context before
	});

	it("extractHunks respects context radius", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir, contextRadius: 3 });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-context",
			procedure: "Fix divide function",
			targetFiles: ["sample.ts"],
			failureInfo: {
				message: "Division by zero error",
				location: { file: "sample.ts", line: 14 } // Line with divide function bug
			},
			commitSha,
			verificationCmd: "npm test"
		});

		const hunk = snapshot.anchored_hunks[0];

		// With context radius of 3, we should get ±3 lines around line 14
		expect(hunk.start_line).toBe(Math.max(1, 14 - 3));
		expect(hunk.end_line).toBeGreaterThanOrEqual(14);
		// Max 7 lines total: 3 before + center line + 3 after = 7 lines (diff of 6)
		expect(hunk.end_line - hunk.start_line).toBeLessThanOrEqual(6);
	});

	it("hunk hash is deterministic", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		// Build snapshot twice with same inputs
		const snapshot1 = await builder.buildSnapshot({
			taskId: "test-determinism-1",
			procedure: "Test procedure",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test"
		});

		const snapshot2 = await builder.buildSnapshot({
			taskId: "test-determinism-1", // Same task ID
			procedure: "Test procedure",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test"
		});

		// Hunk content hashes should be identical
		expect(snapshot1.anchored_hunks[0].content_hash).toBe(
			snapshot2.anchored_hunks[0].content_hash
		);

		// Content should be identical
		expect(snapshot1.anchored_hunks[0].content).toBe(
			snapshot2.anchored_hunks[0].content
		);

		// Manual verification: hash the content ourselves
		const expectedHash = computeCanonicalHash(snapshot1.anchored_hunks[0].content);
		expect(snapshot1.anchored_hunks[0].content_hash).toBe(expectedHash);
	});

	it("scope defaults are applied correctly", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-scope-defaults",
			procedure: "Test scope",
			targetFiles: ["sample.ts", "package.json"],
			commitSha,
			verificationCmd: "npm test"
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
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-scope-overrides",
			procedure: "Test scope overrides",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test",
			scopeOverrides: {
				read_globs: ["**/*.ts", "**/*.md"], // Override read globs
				cross_repo_allowed: true // Override cross-repo policy
			}
		});

		// Overridden fields
		expect(snapshot.scope.read_globs).toEqual(["**/*.ts", "**/*.md"]);
		expect(snapshot.scope.cross_repo_allowed).toBe(true);

		// Non-overridden fields should still have defaults
		expect(snapshot.scope.write_globs).toContain("sample.ts");
		expect(snapshot.scope.deny_globs).toContain("node_modules/**");
	});

	it("snapshot_hash matches content", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-hash-verification",
			procedure: "Test hash",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test"
		});

		// Recompute hash manually
		const { snapshot_hash, ...snapshotWithoutHash } = snapshot;
		const recomputedHash = computeSnapshotHash(snapshotWithoutHash);

		expect(snapshot.snapshot_hash).toBe(recomputedHash);
	});

	it("handles multiple target files", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-multiple-files",
			procedure: "Update multiple files",
			targetFiles: ["sample.ts", "package.json"],
			commitSha,
			verificationCmd: "npm test"
		});

		// Should have hunks for both files
		expect(snapshot.anchored_hunks).toHaveLength(2);

		const filePaths = snapshot.anchored_hunks.map(h => h.file_path);
		expect(filePaths).toContain("sample.ts");
		expect(filePaths).toContain("package.json");

		// Each hunk should have a valid hash
		for (const hunk of snapshot.anchored_hunks) {
			expect(hunk.content_hash).toBeTruthy();
			expect(hunk.content_hash.length).toBe(64); // SHA-256
		}
	});

	it("handles non-existent target files gracefully", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-missing-file",
			procedure: "Create new file",
			targetFiles: ["nonexistent.ts"],
			commitSha,
			verificationCmd: "npm test"
		});

		// Should create an empty hunk placeholder
		expect(snapshot.anchored_hunks).toHaveLength(1);
		expect(snapshot.anchored_hunks[0].file_path).toBe("nonexistent.ts");
		expect(snapshot.anchored_hunks[0].content).toBe("");
		expect(snapshot.anchored_hunks[0].start_line).toBe(1);
		expect(snapshot.anchored_hunks[0].end_line).toBe(1);
	});

	it("includes failure info when provided", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-failure-info",
			procedure: "Fix failure",
			targetFiles: ["sample.ts"],
			failureInfo: {
				message: "TypeError: Cannot divide by zero",
				location: { file: "sample.ts", line: 14, column: 10 },
				exitCode: 1
			},
			commitSha,
			verificationCmd: "npm test"
		});

		expect(snapshot.failure_info).toBeDefined();
		expect(snapshot.failure_info?.message).toBe("TypeError: Cannot divide by zero");
		expect(snapshot.failure_info?.location?.file).toBe("sample.ts");
		expect(snapshot.failure_info?.location?.line).toBe(14);
		expect(snapshot.failure_info?.location?.column).toBe(10);
		expect(snapshot.failure_info?.exit_code).toBe(1);
	});

	it("sets custom expected exit code", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-exit-code",
			procedure: "Test with custom exit code",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm run lint",
			expectedExitCode: 2
		});

		expect(snapshot.expected_exit_code).toBe(2);
	});

	it("includes source truth for tracked files", async () => {
		const builder = new SnapshotBuilder({ repoRoot: tempDir });

		const commitResult = await execa("git", ["rev-parse", "HEAD"], { cwd: tempDir });
		const commitSha = commitResult.stdout.trim();

		const snapshot = await builder.buildSnapshot({
			taskId: "test-source-truth",
			procedure: "Check source truth",
			targetFiles: ["sample.ts"],
			commitSha,
			verificationCmd: "npm test"
		});

		const hunk = snapshot.anchored_hunks[0];
		expect(hunk.source_truth).toBeDefined();
		expect(hunk.source_truth?.introducing_commit).toBe(commitSha);
		expect(hunk.source_truth?.author).toBe("Test User");
		expect(hunk.source_truth?.introduced_at).toBeTruthy();
	});
});
