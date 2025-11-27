/**
 * Artifact Discovery and Metadata
 *
 * Provides functionality to list and inspect artifacts and receipts for a run.
 * Artifacts include plan files, decision logs, failure logs, gate reports, and reports.
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { getRunDir, getRunsDir } from "./storage.js";

/** Default inline content threshold in bytes (10KB) */
const DEFAULT_INLINE_THRESHOLD = 10 * 1024;

/**
 * Artifact types with their path patterns
 */
export const ARTIFACT_TYPES = {
	plan: "plan.json",
	decision: "decisions.ndjson",
	failure: "failures.ndjson",
	gate: "gates/**/**/report.json",
	report: "reports/*.md",
	log: "logs/*.log",
} as const;

export type ArtifactType = keyof typeof ARTIFACT_TYPES;

/**
 * Input schema for listArtifacts
 */
export const ListArtifactsInputSchema = z.object({
	runId: z.string().describe("The unique run identifier"),
	type: z
		.enum(["plan", "decision", "failure", "gate", "report", "log"])
		.optional()
		.describe('Filter by type: "plan", "decision", "failure", "gate", "report", "log"'),
	path: z
		.string()
		.optional()
		.describe("Filter by path pattern (supports * and ** wildcards)"),
	latestOnly: z
		.boolean()
		.optional()
		.describe("Only return the most recent artifact of each type"),
	inline: z
		.boolean()
		.optional()
		.describe("Include content for small artifacts (< 10KB)"),
});

export type ListArtifactsInput = z.infer<typeof ListArtifactsInputSchema>;

/**
 * Artifact descriptor schema
 */
export const ArtifactDescriptorSchema = z.object({
	path: z.string().describe("Relative path within run directory"),
	type: z
		.enum(["plan", "decision", "failure", "gate", "report", "log"])
		.describe("Artifact type"),
	size: z.number().describe("File size in bytes"),
	createdAt: z.string().describe("ISO 8601 creation timestamp"),
	modifiedAt: z.string().describe("ISO 8601 modification timestamp"),
	content: z
		.string()
		.optional()
		.describe("File content (included if inline=true and size < threshold)"),
});

export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;

/**
 * Output schema for listArtifacts
 */
export const ListArtifactsOutputSchema = z.object({
	artifacts: z.array(ArtifactDescriptorSchema),
	totalCount: z.number().describe("Total number of artifacts found"),
});

export type ListArtifactsOutput = z.infer<typeof ListArtifactsOutputSchema>;

/**
 * Determine the artifact type from a file path
 */
export function getArtifactType(filePath: string): ArtifactType | null {
	const normalizedPath = filePath.replace(/\\/g, "/");

	if (normalizedPath === "plan.json") {
		return "plan";
	}
	if (normalizedPath === "decisions.ndjson") {
		return "decision";
	}
	if (normalizedPath === "failures.ndjson") {
		return "failure";
	}
	// Gate reports must be in gates/{item}/{gate}/report.json format (at least 2 subdirectories)
	if (normalizedPath.startsWith("gates/") && normalizedPath.endsWith("/report.json")) {
		const parts = normalizedPath.split("/");
		// gates/{item}/{gate}/report.json = 4 parts minimum
		if (parts.length >= 4) {
			return "gate";
		}
	}
	if (normalizedPath.startsWith("reports/") && normalizedPath.endsWith(".md")) {
		return "report";
	}
	if (normalizedPath.startsWith("logs/") && normalizedPath.endsWith(".log")) {
		return "log";
	}

	return null;
}

/**
 * Check if a path matches a glob pattern
 * Supports * (single segment) and ** (multiple segments)
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/");
	const normalizedPattern = pattern.replace(/\\/g, "/");

	// Convert glob pattern to regex
	const regexPattern = normalizedPattern
		// Escape regex special characters except * and **
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		// Replace ** with a placeholder
		.replace(/\*\*/g, "\0")
		// Replace * with single-segment match (anything except /)
		.replace(/\*/g, "[^/]*")
		// Replace placeholder with multi-segment match (anything)
		.replace(/\0/g, ".*");

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(normalizedPath);
}

/**
 * Recursively discover files in a directory
 */
function discoverFiles(dir: string, basePath: string = ""): string[] {
	const files: string[] = [];

	if (!fs.existsSync(dir)) {
		return files;
	}

	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			// Skip 'artifacts' subdirectory as it's for user artifacts
			// Focus on known artifact locations
			files.push(...discoverFiles(fullPath, relativePath));
		} else if (entry.isFile()) {
			files.push(relativePath);
		}
	}

	return files;
}

/**
 * Build an artifact descriptor from a file
 */
function buildArtifactDescriptor(
	runDir: string,
	relativePath: string,
	type: ArtifactType,
	includeContent: boolean,
	inlineThreshold: number
): ArtifactDescriptor {
	const fullPath = path.join(runDir, relativePath);
	const stats = fs.statSync(fullPath);

	const descriptor: ArtifactDescriptor = {
		path: relativePath,
		type,
		size: stats.size,
		createdAt: stats.birthtime.toISOString(),
		modifiedAt: stats.mtime.toISOString(),
	};

	// Include content if requested and file is small enough
	if (includeContent && stats.size <= inlineThreshold) {
		try {
			descriptor.content = fs.readFileSync(fullPath, "utf-8");
		} catch {
			// If we can't read the file, don't include content
		}
	}

	return descriptor;
}

/**
 * List artifacts for a run
 *
 * Discovers and returns metadata for all artifacts in a run directory,
 * with optional filtering by type, path pattern, and recency.
 *
 * @param input - ListArtifactsInput with runId and optional filters
 * @param baseDir - Base directory for run storage (defaults to cwd)
 * @param inlineThreshold - Maximum size for inline content (defaults to 10KB)
 * @returns ListArtifactsOutput with artifacts array and total count
 */
export function listArtifacts(
	input: ListArtifactsInput,
	baseDir: string = process.cwd(),
	inlineThreshold: number = DEFAULT_INLINE_THRESHOLD
): ListArtifactsOutput {
	const runDir = getRunDir(input.runId, baseDir);

	if (!fs.existsSync(runDir)) {
		// Run directory doesn't exist, but the run state file might
		// This means no artifacts have been created yet
		return {
			artifacts: [],
			totalCount: 0,
		};
	}

	// Discover all files in the run directory
	const allFiles = discoverFiles(runDir);

	// Filter and build descriptors
	const artifacts: ArtifactDescriptor[] = [];

	for (const filePath of allFiles) {
		const artifactType = getArtifactType(filePath);

		// Skip files that don't match any known artifact type
		if (!artifactType) {
			continue;
		}

		// Apply type filter
		if (input.type && artifactType !== input.type) {
			continue;
		}

		// Apply path pattern filter
		if (input.path && !matchesPattern(filePath, input.path)) {
			continue;
		}

		const descriptor = buildArtifactDescriptor(
			runDir,
			filePath,
			artifactType,
			input.inline ?? false,
			inlineThreshold
		);

		artifacts.push(descriptor);
	}

	// Sort by modification time (newest first)
	artifacts.sort((a, b) => {
		return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
	});

	// Apply latestOnly filter
	let finalArtifacts = artifacts;
	if (input.latestOnly) {
		const latestByType = new Map<ArtifactType, ArtifactDescriptor>();

		for (const artifact of artifacts) {
			if (!latestByType.has(artifact.type)) {
				latestByType.set(artifact.type, artifact);
			}
		}

		finalArtifacts = Array.from(latestByType.values());
		// Re-sort after filtering
		finalArtifacts.sort((a, b) => {
			return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
		});
	}

	return {
		artifacts: finalArtifacts,
		totalCount: finalArtifacts.length,
	};
}

/**
 * Get a single artifact by path
 *
 * @param runId - The run identifier
 * @param artifactPath - Relative path to the artifact
 * @param baseDir - Base directory for run storage
 * @param includeContent - Whether to include file content
 * @returns ArtifactDescriptor or null if not found
 */
export function getArtifact(
	runId: string,
	artifactPath: string,
	baseDir: string = process.cwd(),
	includeContent: boolean = true
): ArtifactDescriptor | null {
	const runDir = getRunDir(runId, baseDir);
	const fullPath = path.join(runDir, artifactPath);

	if (!fs.existsSync(fullPath)) {
		return null;
	}

	const artifactType = getArtifactType(artifactPath);
	if (!artifactType) {
		return null;
	}

	return buildArtifactDescriptor(
		runDir,
		artifactPath,
		artifactType,
		includeContent,
		DEFAULT_INLINE_THRESHOLD
	);
}
