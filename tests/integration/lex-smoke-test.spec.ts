/**
 * Lex Integration Smoke Test
 *
 * Validates that LexRunner can successfully import and use the Lex package (@smartergpt/lex).
 * Tests the public API surface to ensure packaging integration is working correctly.
 *
 * Covers:
 * - Frame creation (createFrame)
 * - Frame recall (searchFrames)
 * - Module ID validation (validateModuleIds)
 * - Atlas Frame generation (generateAtlasFrame)
 * - TypeScript type availability
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import type Database from "better-sqlite3-multiple-ciphers";

// Import from Lex package - testing the public API surface
import { createFrame } from "@smartergpt/lex/types";
import type { Frame } from "@smartergpt/lex/types";
import {
	getDb,
	closeDb,
	saveFrame,
	searchFrames,
} from "@smartergpt/lex/store";
import { validateModuleIds } from "@smartergpt/lex/module-ids";
import { generateAtlasFrame } from "@smartergpt/lex/atlas";
import type { Policy } from "@smartergpt/lex/policy";

describe("Lex Integration Smoke Test", () => {
	const testDbPath = path.join(__dirname, "../../tmp-lex-smoke-test.db");
	let db: Database.Database;

	beforeAll(() => {
		// Clean up any existing test database
		if (fs.existsSync(testDbPath)) {
			fs.unlinkSync(testDbPath);
		}
		// Initialize test database
		db = getDb(testDbPath);
	});

	afterAll(() => {
		// Clean up
		if (db) {
			closeDb(db);
		}
		if (fs.existsSync(testDbPath)) {
			fs.unlinkSync(testDbPath);
		}
	});

	describe("Frame Creation (createFrame)", () => {
		it("should create a valid Frame object with required fields", () => {
			const frame = createFrame({
				branch: "main",
				module_scope: ["services/auth", "api/middleware"],
				summary_caption: "Added JWT validation",
				reference_point: "Implementing user authentication",
				next_action: "Wire up password reset flow",
			});

			// Verify TypeScript types are available and working
			expect(frame).toBeDefined();
			expect(frame.branch).toBe("main");
			expect(frame.module_scope).toEqual(["services/auth", "api/middleware"]);
			expect(frame.summary_caption).toBe("Added JWT validation");
			expect(frame.reference_point).toBe("Implementing user authentication");
			expect(frame.status_snapshot.next_action).toBe("Wire up password reset flow");
			expect(frame.id).toBeDefined();
			expect(frame.timestamp).toBeDefined();
		});

		it("should create a Frame with optional fields", () => {
			const frame = createFrame({
				branch: "feature/test",
				module_scope: ["test/module"],
				summary_caption: "Test summary",
				reference_point: "Test reference",
				next_action: "Test action",
				keywords: ["test", "smoke"],
				runId: "run-123",
				executorRole: "test-executor",
				toolCalls: ["tool1", "tool2"],
			});

			expect(frame.keywords).toEqual(["test", "smoke"]);
			expect(frame.runId).toBe("run-123");
			expect(frame.executorRole).toBe("test-executor");
			expect(frame.toolCalls).toEqual(["tool1", "tool2"]);
		});

		it("should support TypeScript type checking", () => {
			const frame: Frame = createFrame({
				branch: "main",
				module_scope: ["module1"],
				summary_caption: "Type test",
				reference_point: "Type reference",
				next_action: "Type action",
			});

			// If TypeScript types are working, this will compile
			expect(frame.id).toBeDefined();
		});
	});

	describe("Frame Recall (searchFrames)", () => {
		beforeAll(async () => {
			// Save some test frames for recall
			const frame1 = createFrame({
				branch: "main",
				module_scope: ["services/auth"],
				summary_caption: "Implemented JWT authentication",
				reference_point: "User authentication system",
				next_action: "Add refresh token support",
				keywords: ["auth", "jwt"],
			});

			const frame2 = createFrame({
				branch: "main",
				module_scope: ["api/middleware"],
				summary_caption: "Added request validation middleware",
				reference_point: "API security improvements",
				next_action: "Add rate limiting",
				keywords: ["api", "validation"],
			});

			await saveFrame(db, frame1);
			await saveFrame(db, frame2);
		});

		it("should recall frames by keyword search", () => {
			const results = searchFrames(db, "authentication");

			expect(results).toBeDefined();
			expect(results.frames).toBeDefined();
			expect(Array.isArray(results.frames)).toBe(true);
			expect(results.frames.length).toBeGreaterThan(0);

			const frame = results.frames[0];
			expect(frame.summary_caption).toContain("JWT authentication");
		});

		it("should recall frames by module scope", () => {
			const results = searchFrames(db, "auth");

			expect(results.frames.length).toBeGreaterThan(0);
			const authFrame = results.frames.find((f) =>
				f.module_scope.includes("services/auth")
			);
			expect(authFrame).toBeDefined();
		});

		it("should return empty results for non-existent search", () => {
			const results = searchFrames(db, "nonexistentquerythatdoesntmatch");

			expect(results.frames).toEqual([]);
		});
	});

	describe("Module ID Validation (validateModuleIds)", () => {
		const testPolicy: Policy = {
			critical_rule:
				"Modules must be explicitly defined in policy before use",
			schema_version: "1.0.0",
			modules: {
				"services/auth": {
					module_id: "services/auth",
					mayCall: ["services/user"],
				},
				"services/user": {
					module_id: "services/user",
					mayCall: [],
				},
				"api/middleware": {
					module_id: "api/middleware",
					mayCall: ["services/auth"],
				},
			},
			edges: [],
		};

		it("should validate existing module IDs", async () => {
			const result = await validateModuleIds(
				["services/auth", "services/user"],
				testPolicy
			);

			expect(result).toBeDefined();
			expect(result.valid).toBe(true);
			expect(result.canonical).toEqual(["services/auth", "services/user"]);
		});

		it("should detect invalid module IDs", async () => {
			const result = await validateModuleIds(
				["services/auth", "nonexistent/module"],
				testPolicy
			);

			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should support TypeScript types for ValidationResult", async () => {
			const result = await validateModuleIds(["services/auth"], testPolicy);

			// TypeScript should allow accessing these properties
			expect(typeof result.valid).toBe("boolean");
			if (result.valid) {
				expect(Array.isArray(result.canonical)).toBe(true);
			}
			if (!result.valid && result.errors) {
				expect(Array.isArray(result.errors)).toBe(true);
			}
		});
	});

	describe("Atlas Frame Generation (generateAtlasFrame)", () => {
		// For Atlas frame generation, we need a policy file on disk
		// Create a temporary policy file for testing
		const tempPolicyPath = path.join(__dirname, "../../tmp-test-policy.json");
		const testPolicy = {
			critical_rule: "Test policy for Atlas generation",
			schema_version: "1.0.0",
			modules: {
				"services/auth": {
					module_id: "services/auth",
					mayCall: ["services/user", "database/auth"],
					forbidden: [
						{
							target: "services/admin",
							reason: "Auth service cannot access admin",
						},
					],
				},
				"services/user": {
					module_id: "services/user",
					mayCall: ["database/users"],
				},
				"database/auth": {
					module_id: "database/auth",
					mayCall: [],
				},
				"database/users": {
					module_id: "database/users",
					mayCall: [],
				},
			},
			edges: [],
		};

		beforeAll(() => {
			// Write policy file for Atlas generation
			fs.writeFileSync(tempPolicyPath, JSON.stringify(testPolicy, null, 2));
		});

		afterAll(() => {
			// Clean up policy file
			if (fs.existsSync(tempPolicyPath)) {
				fs.unlinkSync(tempPolicyPath);
			}
		});

		it("should generate an Atlas Frame for seed modules", () => {
			const atlasFrame = generateAtlasFrame(
				["services/auth"],
				1, // fold radius of 1
				tempPolicyPath
			);

			expect(atlasFrame).toBeDefined();
			expect(atlasFrame.seed_modules).toEqual(["services/auth"]);
			expect(atlasFrame.fold_radius).toBe(1);
			expect(Array.isArray(atlasFrame.modules)).toBe(true);
			expect(Array.isArray(atlasFrame.edges)).toBe(true);
			// critical_rule comes from the policy file
			expect(atlasFrame.critical_rule).toBeDefined();
			expect(typeof atlasFrame.critical_rule).toBe("string");
			expect(atlasFrame.atlas_timestamp).toBeDefined();
		});

		it("should include seed module and its neighbors", () => {
			const atlasFrame = generateAtlasFrame(
				["services/auth"],
				1,
				tempPolicyPath
			);

			// Should include the seed module
			const authModule = atlasFrame.modules.find(
				(m) => m.id === "services/auth"
			);
			expect(authModule).toBeDefined();

			// Should include at least the seed module
			expect(atlasFrame.modules.length).toBeGreaterThanOrEqual(1);

			// Should have edges if neighbors are included
			expect(Array.isArray(atlasFrame.edges)).toBe(true);
		});

		it("should support TypeScript types for AtlasFrame", () => {
			const atlasFrame = generateAtlasFrame(
				["services/auth"],
				1,
				tempPolicyPath
			);

			// TypeScript should allow accessing these properties
			expect(typeof atlasFrame.fold_radius).toBe("number");
			expect(Array.isArray(atlasFrame.seed_modules)).toBe(true);
			expect(typeof atlasFrame.critical_rule).toBe("string");
		});

		it("should expand with larger fold radius", () => {
			const radius1 = generateAtlasFrame(
				["services/auth"],
				1,
				tempPolicyPath
			);
			const radius2 = generateAtlasFrame(
				["services/auth"],
				2,
				tempPolicyPath
			);

			// Larger radius should include at least as many modules
			expect(radius2.modules.length).toBeGreaterThanOrEqual(
				radius1.modules.length
			);
		});
	});

	describe("TypeScript Type Availability", () => {
		it("should export Frame type", () => {
			const frame: Frame = createFrame({
				branch: "main",
				module_scope: ["test"],
				summary_caption: "Type check",
				reference_point: "Type test",
				next_action: "Verify types",
			});

			expect(frame).toBeDefined();
		});

		it("should export Policy type", () => {
			const policy: Policy = {
				critical_rule: "Test rule",
				schema_version: "1.0.0",
				modules: {},
				edges: [],
			};

			expect(policy).toBeDefined();
		});
	});
});
