/**
 * Tests for Deliverables Management System
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeliverablesManager, RetentionPolicy } from '../src/autopilot/deliverables.js';
import { Plan } from '../src/schema.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('DeliverablesManager', () => {
	let testDir: string;
	let manager: DeliverablesManager;

	beforeEach(() => {
		testDir = path.join(os.tmpdir(), `lex-pr-deliverables-test-${Date.now()}`);
		fs.mkdirSync(testDir, { recursive: true });
		manager = new DeliverablesManager(testDir);
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('createDeliverables', () => {
		it('should create deliverables directory with manifest', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: [
					{
						name: "test-item",
						deps: [],
						gates: []
					}
				]
			};

			const deliverableDir = await manager.createDeliverables(plan, 1, "0.1.0");

			expect(fs.existsSync(deliverableDir)).toBe(true);
			
			const manifestPath = path.join(deliverableDir, "manifest.json");
			expect(fs.existsSync(manifestPath)).toBe(true);

			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			expect(manifest.schemaVersion).toBe("1.0.0");
			expect(manifest.levelExecuted).toBe(1);
			expect(manifest.runnerVersion).toBe("0.1.0");
			expect(manifest.planHash).toBeDefined();
			expect(manifest.planHash.length).toBeGreaterThan(0);
			expect(manifest.artifacts).toEqual([]);
			expect(manifest.executionContext).toBeDefined();
		});

		it('should use custom timestamp if provided', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			const timestamp = "2024-01-01T12-00-00";
			const deliverableDir = await manager.createDeliverables(plan, 1, "0.1.0", timestamp);

			expect(deliverableDir).toContain(`weave-${timestamp}`);
		});

		it('should calculate plan hash correctly', async () => {
			const plan1: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: [{ name: "item-1", deps: [], gates: [] }]
			};

			const plan2: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: [{ name: "item-1", deps: [], gates: [] }]
			};

			const dir1 = await manager.createDeliverables(plan1, 1, "0.1.0", "2024-01-01");
			const dir2 = await manager.createDeliverables(plan2, 1, "0.1.0", "2024-01-02");

			const manifest1 = JSON.parse(fs.readFileSync(path.join(dir1, "manifest.json"), "utf-8"));
			const manifest2 = JSON.parse(fs.readFileSync(path.join(dir2, "manifest.json"), "utf-8"));

			// Same plan should have same hash
			expect(manifest1.planHash).toBe(manifest2.planHash);
		});
	});

	describe('registerArtifact', () => {
		it('should register artifact in manifest', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			const deliverableDir = await manager.createDeliverables(plan, 1, "0.1.0");
			
			// Create test artifact
			const artifactPath = path.join(deliverableDir, "test-artifact.json");
			fs.writeFileSync(artifactPath, JSON.stringify({ test: "data" }), "utf-8");

			await manager.registerArtifact(deliverableDir, artifactPath, "json");

			const manifest = JSON.parse(fs.readFileSync(path.join(deliverableDir, "manifest.json"), "utf-8"));
			expect(manifest.artifacts.length).toBe(1);
			expect(manifest.artifacts[0].name).toBe("test-artifact.json");
			expect(manifest.artifacts[0].type).toBe("json");
			expect(manifest.artifacts[0].hash).toBeDefined();
			expect(manifest.artifacts[0].size).toBeGreaterThan(0);
		});

		it('should throw error if manifest not found', async () => {
			const nonExistentDir = path.join(testDir, "nonexistent");
			fs.mkdirSync(nonExistentDir, { recursive: true });
			
			const artifactPath = path.join(nonExistentDir, "artifact.json");
			fs.writeFileSync(artifactPath, "test", "utf-8");

			await expect(async () => {
				await manager.registerArtifact(nonExistentDir, artifactPath, "json");
			}).rejects.toThrow("Manifest not found");
		});
	});

	describe('updateLatestSymlink', () => {
		it('should create latest symlink', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			const deliverableDir = await manager.createDeliverables(plan, 1, "0.1.0");
			await manager.updateLatestSymlink(deliverableDir);

			const latestPath = path.join(manager.getDeliverablesRoot(), "latest");
			expect(fs.existsSync(latestPath)).toBe(true);
			
			const stats = fs.lstatSync(latestPath);
			expect(stats.isSymbolicLink()).toBe(true);
		});

		it('should update existing symlink', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			const dir1 = await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-01");
			await manager.updateLatestSymlink(dir1);

			const dir2 = await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-02");
			await manager.updateLatestSymlink(dir2);

			const latest = manager.getLatestPath();
			expect(latest).toBe(dir2);
		});
	});

	describe('listDeliverables', () => {
		it('should return empty array when no deliverables exist', async () => {
			const deliverables = await manager.listDeliverables();
			expect(deliverables).toEqual([]);
		});

		it('should list all deliverables sorted by timestamp', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-01T10-00-00");
			await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-03T10-00-00");
			await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-02T10-00-00");

			const deliverables = await manager.listDeliverables();
			
			expect(deliverables.length).toBe(3);
			
			// Should be sorted newest first
			expect(deliverables[0].timestamp).toContain("2024-01-03");
			expect(deliverables[1].timestamp).toContain("2024-01-02");
			expect(deliverables[2].timestamp).toContain("2024-01-01");
		});
	});

	describe('cleanup', () => {
		it('should remove old deliverables based on maxCount', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-01T10-00-00");
			await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-02T10-00-00");
			await manager.createDeliverables(plan, 1, "0.1.0", "2024-01-03T10-00-00");

			const policy: RetentionPolicy = {
				maxCount: 2,
				keepLatest: true
			};

			const result = await manager.cleanup(policy);

			expect(result.removed.length).toBe(1);
			expect(result.kept.length).toBe(2);
			expect(result.freedSpace).toBeGreaterThan(0);

			const remaining = await manager.listDeliverables();
			expect(remaining.length).toBe(2);
		});

		it('should remove old deliverables based on maxAge', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			// Create old deliverable (30 days ago)
			const oldDate = new Date();
			oldDate.setDate(oldDate.getDate() - 30);
			const oldTimestamp = oldDate.toISOString().replace(/[:.]/g, "-").replace("Z", "");

			await manager.createDeliverables(plan, 1, "0.1.0", oldTimestamp);
			await manager.createDeliverables(plan, 1, "0.1.0"); // Recent

			const policy: RetentionPolicy = {
				maxAge: 7, // 7 days
				keepLatest: true
			};

			const result = await manager.cleanup(policy);

			expect(result.removed.length).toBe(1);
			expect(result.kept.length).toBe(1);

			const remaining = await manager.listDeliverables();
			expect(remaining.length).toBe(1);
		});

		it('should always keep latest if keepLatest is true', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			// Create old deliverable
			const oldDate = new Date();
			oldDate.setDate(oldDate.getDate() - 30);
			const oldTimestamp = oldDate.toISOString().replace(/[:.]/g, "-").replace("Z", "");

			await manager.createDeliverables(plan, 1, "0.1.0", oldTimestamp);

			const policy: RetentionPolicy = {
				maxAge: 1, // 1 day - should remove everything
				keepLatest: true
			};

			const result = await manager.cleanup(policy);

			// Should keep latest even though it's older than maxAge
			expect(result.kept.length).toBe(1);

			const remaining = await manager.listDeliverables();
			expect(remaining.length).toBe(1);
		});

		it('should handle empty deliverables directory', async () => {
			const policy: RetentionPolicy = {
				maxCount: 5,
				keepLatest: true
			};

			const result = await manager.cleanup(policy);

			expect(result.removed.length).toBe(0);
			expect(result.kept.length).toBe(0);
			expect(result.freedSpace).toBe(0);
		});
	});

	describe('getLatestPath', () => {
		it('should return null when no latest symlink exists', () => {
			const latest = manager.getLatestPath();
			expect(latest).toBeNull();
		});

		it('should return path to latest deliverables', async () => {
			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			const deliverableDir = await manager.createDeliverables(plan, 1, "0.1.0");
			await manager.updateLatestSymlink(deliverableDir);

			const latest = manager.getLatestPath();
			expect(latest).toBe(deliverableDir);
		});
	});

	describe('custom deliverables directory', () => {
		it('should use custom deliverables directory', async () => {
			const customDir = path.join(testDir, "custom-deliverables");
			const customManager = new DeliverablesManager(testDir, customDir);

			const plan: Plan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: []
			};

			const deliverableDir = await customManager.createDeliverables(plan, 1, "0.1.0");

			expect(deliverableDir.startsWith(customDir)).toBe(true);
			expect(fs.existsSync(deliverableDir)).toBe(true);
		});
	});
});
