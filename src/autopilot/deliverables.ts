/**
 * Deliverables management system for autopilot operations
 * Handles artifact tracking, versioning, cleanup, and CI/CD integration
 */

import * as fs from "fs";
import * as path from "path";
import { Plan } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { sha256 } from "../util/hash.js";

/**
 * Deliverables manifest schema
 * Links artifacts to original plan and execution context
 */
export interface DeliverablesManifest {
	schemaVersion: string;
	timestamp: string;
	planHash: string;
	runnerVersion: string;
	levelExecuted: number;
	profilePath: string;
	artifacts: ArtifactEntry[];
	executionContext: ExecutionContext;
}

export interface ArtifactEntry {
	name: string;
	path: string;
	type: "json" | "markdown" | "log";
	size: number;
	hash: string;
}

export interface ExecutionContext {
	workingDirectory: string;
	environment: string;
	actor?: string;
	correlationId?: string;
}

export interface RetentionPolicy {
	maxAge?: number; // days
	maxCount?: number; // number of deliverables to keep
	keepLatest: boolean;
}

export interface CleanupResult {
	removed: string[];
	kept: string[];
	freedSpace: number;
}

/**
 * Deliverables manager for autopilot operations
 * Manages artifact lifecycle, versioning, and cleanup
 */
export class DeliverablesManager {
	private deliverablesRoot: string;
	private profilePath: string;

	constructor(profilePath: string, customDeliverablesDir?: string) {
		this.profilePath = profilePath;
		this.deliverablesRoot = customDeliverablesDir || path.join(profilePath, "deliverables");
	}

	/**
	 * Create deliverables directory with manifest
	 */
	async createDeliverables(
		plan: Plan,
		level: number,
		runnerVersion: string,
		timestamp?: string
	): Promise<string> {
		const ts = timestamp || new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
		const deliverableDir = path.join(this.deliverablesRoot, `weave-${ts}`);

		// Create directory
		if (!fs.existsSync(deliverableDir)) {
			fs.mkdirSync(deliverableDir, { recursive: true });
		}

		// Calculate plan hash
		const planJSON = canonicalJSONStringify(plan);
		const planHash = sha256(planJSON);

		// Convert directory timestamp back to ISO format for manifest
		// Directory format: 2024-01-01T10-00-00 -> ISO: 2024-01-01T10:00:00Z
		// or with millis: 2024-01-01T10-00-00-123 -> ISO: 2024-01-01T10:00:00.123Z
		let isoTimestamp: string;
		if (ts.includes("T")) {
			// Has date-time separator, convert time part hyphens to colons
			const parts = ts.split("T");
			const datePart = parts[0];
			const timePart = parts[1];
			
			// Split time and milliseconds if present
			const timeSegments = timePart.split("-");
			if (timeSegments.length >= 3) {
				// Has at least HH-MM-SS
				const hours = timeSegments[0];
				const minutes = timeSegments[1];
				const seconds = timeSegments[2];
				const millis = timeSegments.length > 3 ? `.${timeSegments[3]}` : "";
				isoTimestamp = `${datePart}T${hours}:${minutes}:${seconds}${millis}Z`;
			} else {
				// Invalid format, fall back to current time
				isoTimestamp = new Date().toISOString();
			}
		} else {
			// No timestamp provided, use current time
			isoTimestamp = new Date().toISOString();
		}

		// Create initial manifest
		const manifest: DeliverablesManifest = {
			schemaVersion: "1.0.0",
			timestamp: isoTimestamp,
			planHash,
			runnerVersion,
			levelExecuted: level,
			profilePath: this.profilePath,
			artifacts: [],
			executionContext: {
				workingDirectory: process.cwd(),
				environment: process.env.CI ? "ci" : "local",
				actor: process.env.GITHUB_ACTOR,
				correlationId: process.env.CORRELATION_ID
			}
		};

		// Write manifest
		const manifestPath = path.join(deliverableDir, "manifest.json");
		fs.writeFileSync(manifestPath, canonicalJSONStringify(manifest) + "\n", "utf-8");

		return deliverableDir;
	}

	/**
	 * Register an artifact in the manifest
	 */
	async registerArtifact(
		deliverableDir: string,
		artifactPath: string,
		type: "json" | "markdown" | "log"
	): Promise<void> {
		const manifestPath = path.join(deliverableDir, "manifest.json");
		
		if (!fs.existsSync(manifestPath)) {
			throw new Error(`Manifest not found at ${manifestPath}`);
		}

		const manifestContent = fs.readFileSync(manifestPath, "utf-8");
		const manifest: DeliverablesManifest = JSON.parse(manifestContent);

		// Calculate artifact hash
		const artifactContent = fs.readFileSync(artifactPath, "utf-8");
		const artifactHash = sha256(artifactContent);

		// Get file stats
		const stats = fs.statSync(artifactPath);

		// Add artifact entry
		const entry: ArtifactEntry = {
			name: path.basename(artifactPath),
			path: path.relative(deliverableDir, artifactPath),
			type,
			size: stats.size,
			hash: artifactHash
		};

		manifest.artifacts.push(entry);

		// Update manifest
		fs.writeFileSync(manifestPath, canonicalJSONStringify(manifest) + "\n", "utf-8");
	}

	/**
	 * Create or update 'latest' symlink to most recent deliverables
	 */
	async updateLatestSymlink(deliverableDir: string): Promise<void> {
		const latestLink = path.join(this.deliverablesRoot, "latest");

		// Remove existing symlink if it exists
		if (fs.existsSync(latestLink)) {
			const stats = fs.lstatSync(latestLink);
			if (stats.isSymbolicLink()) {
				fs.unlinkSync(latestLink);
			}
		}

		// Create new symlink (relative path for portability)
		const relativePath = path.relative(this.deliverablesRoot, deliverableDir);
		fs.symlinkSync(relativePath, latestLink, "dir");
	}

	/**
	 * List all deliverables with their manifests
	 */
	async listDeliverables(): Promise<DeliverablesManifest[]> {
		if (!fs.existsSync(this.deliverablesRoot)) {
			return [];
		}

		const deliverables: DeliverablesManifest[] = [];
		const entries = fs.readdirSync(this.deliverablesRoot, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.startsWith("weave-")) {
				const manifestPath = path.join(this.deliverablesRoot, entry.name, "manifest.json");
				if (fs.existsSync(manifestPath)) {
					const content = fs.readFileSync(manifestPath, "utf-8");
					const manifest = JSON.parse(content);
					// Store the directory name in the manifest for later reference
					(manifest as any)._dirName = entry.name;
					deliverables.push(manifest);
				}
			}
		}

		// Sort by timestamp (newest first)
		deliverables.sort((a, b) => {
			return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
		});

		return deliverables;
	}

	/**
	 * Clean up old deliverables based on retention policy
	 */
	async cleanup(policy: RetentionPolicy): Promise<CleanupResult> {
		const deliverables = await this.listDeliverables();
		const result: CleanupResult = {
			removed: [],
			kept: [],
			freedSpace: 0
		};

		if (deliverables.length === 0) {
			return result;
		}

		// Determine which deliverables to keep
		let toKeep = deliverables;

		// Apply maxCount policy
		if (policy.maxCount !== undefined && policy.maxCount > 0) {
			toKeep = toKeep.slice(0, policy.maxCount);
		}

		// Apply maxAge policy
		if (policy.maxAge !== undefined && policy.maxAge > 0) {
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - policy.maxAge);
			toKeep = toKeep.filter(d => new Date(d.timestamp) > cutoffDate);
		}

		// Ensure latest is kept if policy requires it
		if (policy.keepLatest && deliverables.length > 0 && !toKeep.includes(deliverables[0])) {
			toKeep = [deliverables[0], ...toKeep];
		}

		// Build keep set
		const keepSet = new Set(toKeep.map(d => d.timestamp));

		// Remove deliverables not in keep set
		for (const deliverable of deliverables) {
			const dirName = (deliverable as any)._dirName || `weave-${deliverable.timestamp.replace(/[:.]/g, "-").replace("Z", "")}`;
			const dirPath = path.join(this.deliverablesRoot, dirName);

			if (!keepSet.has(deliverable.timestamp)) {
				// Calculate size before removal
				const size = this.calculateDirectorySize(dirPath);
				
				// Remove directory
				fs.rmSync(dirPath, { recursive: true, force: true });
				
				result.removed.push(dirPath);
				result.freedSpace += size;
			} else {
				result.kept.push(dirPath);
			}
		}

		return result;
	}

	/**
	 * Calculate total size of a directory
	 */
	private calculateDirectorySize(dirPath: string): number {
		let size = 0;

		if (!fs.existsSync(dirPath)) {
			return 0;
		}

		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = path.join(dirPath, entry.name);
			if (entry.isDirectory()) {
				size += this.calculateDirectorySize(entryPath);
			} else {
				const stats = fs.statSync(entryPath);
				size += stats.size;
			}
		}

		return size;
	}

	/**
	 * Get deliverables root directory
	 */
	getDeliverablesRoot(): string {
		return this.deliverablesRoot;
	}

	/**
	 * Get latest deliverables directory path
	 */
	getLatestPath(): string | null {
		const latestLink = path.join(this.deliverablesRoot, "latest");
		
		if (fs.existsSync(latestLink)) {
			const stats = fs.lstatSync(latestLink);
			if (stats.isSymbolicLink()) {
				const target = fs.readlinkSync(latestLink);
				return path.join(this.deliverablesRoot, target);
			}
		}

		return null;
	}
}
