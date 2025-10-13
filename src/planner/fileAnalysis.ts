/**
 * File-Change Analysis Engine & Intersection Detection
 * Analyzes file changes across PRs to detect implicit dependencies and suggest merge order
 */

import type { Octokit } from "@octokit/rest";
import type {
	FileChange,
	PRFileChanges,
	FileIntersection,
	DependencySuggestion,
	ConflictPrediction,
	FileAnalysisResult,
	FileAnalysisCache
} from "./types.js";

/**
 * File analyzer for detecting PR dependencies based on file changes
 */
export class FileAnalyzer {
	private cache: Map<string, FileAnalysisCache> = new Map();
	private octokit: Octokit;
	private owner: string;
	private repo: string;

	constructor(octokit: Octokit, owner: string, repo: string) {
		this.octokit = octokit;
		this.owner = owner;
		this.repo = repo;
	}

	/**
	 * Fetch file changes for a specific PR
	 */
	async getPRFileChanges(prNumber: number, sha?: string): Promise<FileChange[]> {
		// Check cache first
		const cacheKey = `${prNumber}-${sha || 'latest'}`;
		const cached = this.cache.get(cacheKey);
		
		if (cached && (!sha || cached.sha === sha)) {
			return cached.files;
		}

		try {
			const { data: files } = await this.octokit.rest.pulls.listFiles({
				owner: this.owner,
				repo: this.repo,
				pull_number: prNumber,
				per_page: 100
			});

			const fileChanges: FileChange[] = files.map(file => ({
				filename: file.filename,
				status: file.status as "added" | "modified" | "removed" | "renamed",
				additions: file.additions,
				deletions: file.deletions,
				changes: file.changes,
				patch: file.patch,
				previousFilename: file.previous_filename
			}));

			// Cache the result
			const cacheEntry: FileAnalysisCache = {
				prNumber,
				sha: sha || 'latest',
				timestamp: new Date().toISOString(),
				files: fileChanges
			};
			this.cache.set(cacheKey, cacheEntry);

			return fileChanges;
		} catch (error: any) {
			throw new Error(`Failed to fetch file changes for PR #${prNumber}: ${error.message}`);
		}
	}

	/**
	 * Build file intersection matrix for multiple PRs
	 */
	async buildIntersectionMatrix(
		prs: Array<{ number: number; name: string; sha?: string }>
	): Promise<FileIntersection[]> {
		// Fetch file changes for all PRs
		const prFileChanges: PRFileChanges[] = await Promise.all(
			prs.map(async pr => ({
				prNumber: pr.number,
				prName: pr.name,
				files: await this.getPRFileChanges(pr.number, pr.sha)
			}))
		);

		const intersections: FileIntersection[] = [];

		// Compare each pair of PRs
		for (let i = 0; i < prFileChanges.length; i++) {
			for (let j = i + 1; j < prFileChanges.length; j++) {
				const pr1 = prFileChanges[i];
				const pr2 = prFileChanges[j];

				const sharedFiles = this.findSharedFiles(pr1.files, pr2.files);

				if (sharedFiles.length > 0) {
					const confidence = this.calculateIntersectionConfidence(
						pr1.files,
						pr2.files,
						sharedFiles
					);

					intersections.push({
						prs: [pr1.prName, pr2.prName],
						files: sharedFiles.sort(), // Deterministic ordering
						confidence
					});
				}
			}
		}

		// Sort for deterministic output
		intersections.sort((a, b) => {
			const prCompare = a.prs[0].localeCompare(b.prs[0]);
			if (prCompare !== 0) return prCompare;
			return a.prs[1].localeCompare(b.prs[1]);
		});

		return intersections;
	}

	/**
	 * Find files that are modified in both PRs
	 */
	private findSharedFiles(files1: FileChange[], files2: FileChange[]): string[] {
		const files1Set = new Set(files1.map(f => f.filename));
		const files2Set = new Set(files2.map(f => f.filename));

		const shared: string[] = [];
		for (const file of files1Set) {
			if (files2Set.has(file)) {
				shared.push(file);
			}
		}

		return shared;
	}

	/**
	 * Calculate confidence level for intersection based on change types
	 */
	private calculateIntersectionConfidence(
		files1: FileChange[],
		files2: FileChange[],
		sharedFiles: string[]
	): number {
		if (sharedFiles.length === 0) return 0;

		let totalScore = 0;
		const fileMap1 = new Map(files1.map(f => [f.filename, f]));
		const fileMap2 = new Map(files2.map(f => [f.filename, f]));

		for (const filename of sharedFiles) {
			const file1 = fileMap1.get(filename);
			const file2 = fileMap2.get(filename);

			if (!file1 || !file2) continue;

			// Higher confidence for modifications to same file
			if (file1.status === "modified" && file2.status === "modified") {
				totalScore += 1.0;
			} else if (file1.status === "added" || file2.status === "added") {
				// Lower confidence if one is adding the file
				totalScore += 0.3;
			} else if (file1.status === "removed" || file2.status === "removed") {
				// Medium confidence for deletions
				totalScore += 0.5;
			} else {
				totalScore += 0.6;
			}
		}

		// Normalize to 0-1 range
		return Math.min(totalScore / sharedFiles.length, 1.0);
	}

	/**
	 * Predict potential conflicts based on file overlaps
	 */
	async predictConflicts(
		prs: Array<{ number: number; name: string; sha?: string }>
	): Promise<ConflictPrediction[]> {
		const prFileChanges: PRFileChanges[] = await Promise.all(
			prs.map(async pr => ({
				prNumber: pr.number,
				prName: pr.name,
				files: await this.getPRFileChanges(pr.number, pr.sha)
			}))
		);

		const conflicts: ConflictPrediction[] = [];

		// Check for conflicts between each pair
		for (let i = 0; i < prFileChanges.length; i++) {
			for (let j = i + 1; j < prFileChanges.length; j++) {
				const pr1 = prFileChanges[i];
				const pr2 = prFileChanges[j];

				const sharedFiles = this.findSharedFiles(pr1.files, pr2.files);

				if (sharedFiles.length > 0) {
					const severity = this.assessConflictSeverity(
						pr1.files,
						pr2.files,
						sharedFiles
					);

					if (severity !== "low") {
						conflicts.push({
							prs: [pr1.prName, pr2.prName].sort(), // Deterministic
							files: sharedFiles.sort(),
							severity,
							reason: this.generateConflictReason(pr1.files, pr2.files, sharedFiles)
						});
					}
				}
			}
		}

		// Sort for deterministic output
		conflicts.sort((a, b) => {
			const prCompare = a.prs[0].localeCompare(b.prs[0]);
			if (prCompare !== 0) return prCompare;
			return a.prs[1].localeCompare(b.prs[1]);
		});

		return conflicts;
	}

	/**
	 * Assess severity of potential conflict
	 */
	private assessConflictSeverity(
		files1: FileChange[],
		files2: FileChange[],
		sharedFiles: string[]
	): "low" | "medium" | "high" {
		const fileMap1 = new Map(files1.map(f => [f.filename, f]));
		const fileMap2 = new Map(files2.map(f => [f.filename, f]));

		let highRiskCount = 0;
		let mediumRiskCount = 0;

		for (const filename of sharedFiles) {
			const file1 = fileMap1.get(filename);
			const file2 = fileMap2.get(filename);

			if (!file1 || !file2) continue;

			// Both modifying the same file = high risk
			if (file1.status === "modified" && file2.status === "modified") {
				// Check if changes are substantial
				if (file1.changes > 10 || file2.changes > 10) {
					highRiskCount++;
				} else {
					mediumRiskCount++;
				}
			} else if (file1.status === "removed" || file2.status === "removed") {
				// One deleting what the other modifies
				highRiskCount++;
			}
		}

		if (highRiskCount > 0) return "high";
		if (mediumRiskCount > 0) return "medium";
		return "low";
	}

	/**
	 * Generate human-readable conflict reason
	 */
	private generateConflictReason(
		files1: FileChange[],
		files2: FileChange[],
		sharedFiles: string[]
	): string {
		const fileMap1 = new Map(files1.map(f => [f.filename, f]));
		const fileMap2 = new Map(files2.map(f => [f.filename, f]));

		const reasons: string[] = [];

		for (const filename of sharedFiles.slice(0, 3)) { // Limit to first 3 files
			const file1 = fileMap1.get(filename);
			const file2 = fileMap2.get(filename);

			if (!file1 || !file2) continue;

			if (file1.status === "modified" && file2.status === "modified") {
				reasons.push(`Both modify ${filename}`);
			} else if (file1.status === "removed" || file2.status === "removed") {
				reasons.push(`Conflicting changes to ${filename}`);
			}
		}

		if (sharedFiles.length > 3) {
			reasons.push(`... and ${sharedFiles.length - 3} more files`);
		}

		return reasons.join("; ");
	}

	/**
	 * Generate dependency suggestions based on file analysis
	 */
	async suggestDependencies(
		prs: Array<{ number: number; name: string; sha?: string }>
	): Promise<DependencySuggestion[]> {
		const intersections = await this.buildIntersectionMatrix(prs);
		const suggestions: DependencySuggestion[] = [];

		for (const intersection of intersections) {
			if (intersection.confidence >= 0.6) {
				// Suggest dependency if confidence is high enough
				suggestions.push({
					from: intersection.prs[0],
					to: intersection.prs[1],
					reason: "shared file modifications",
					confidence: intersection.confidence,
					sharedFiles: intersection.files,
					heuristic: "shared-files"
				});
			}
		}

		// Sort for deterministic output
		suggestions.sort((a, b) => {
			const fromCompare = a.from.localeCompare(b.from);
			if (fromCompare !== 0) return fromCompare;
			return a.to.localeCompare(b.to);
		});

		return suggestions;
	}

	/**
	 * Generate dependency suggestions using multiple heuristics
	 */
	async suggestDependenciesWithHeuristics(
		prs: Array<{ number: number; name: string; sha?: string }>
	): Promise<DependencySuggestion[]> {
		// Fetch file changes for all PRs once
		const prFileChanges = await Promise.all(
			prs.map(async pr => ({
				prNumber: pr.number,
				prName: pr.name,
				files: await this.getPRFileChanges(pr.number, pr.sha)
			}))
		);

		const suggestions: DependencySuggestion[] = [];

		// Heuristic 1: Shared file modifications
		const sharedFileSuggestions = this.heuristicSharedFiles(prFileChanges);
		suggestions.push(...sharedFileSuggestions);

		// Heuristic 2: Directory proximity
		const proximitysuggestions = this.heuristicDirectoryProximity(prFileChanges);
		suggestions.push(...proximitysuggestions);

		// Heuristic 3: Test overlap
		const testOverlapSuggestions = this.heuristicTestOverlap(prFileChanges);
		suggestions.push(...testOverlapSuggestions);

		// Deduplicate suggestions (keep highest confidence for each PR pair)
		const suggestionMap = new Map<string, DependencySuggestion>();
		for (const suggestion of suggestions) {
			const key = `${suggestion.from}::${suggestion.to}`;
			const existing = suggestionMap.get(key);
			if (!existing || suggestion.confidence > existing.confidence) {
				suggestionMap.set(key, suggestion);
			}
		}

		const deduped = Array.from(suggestionMap.values());

		// Sort for deterministic output: confidence desc, then from/to asc
		deduped.sort((a, b) => {
			// Primary: confidence descending
			const confCompare = b.confidence - a.confidence;
			if (Math.abs(confCompare) > 0.001) return confCompare;
			
			// Secondary: from ascending
			const fromCompare = a.from.localeCompare(b.from);
			if (fromCompare !== 0) return fromCompare;
			
			// Tertiary: to ascending
			return a.to.localeCompare(b.to);
		});

		return deduped;
	}

	/**
	 * Heuristic 1: Shared file modifications
	 */
	private heuristicSharedFiles(
		prFileChanges: Array<{ prNumber: number; prName: string; files: FileChange[] }>
	): DependencySuggestion[] {
		const suggestions: DependencySuggestion[] = [];

		for (let i = 0; i < prFileChanges.length; i++) {
			for (let j = i + 1; j < prFileChanges.length; j++) {
				const pr1 = prFileChanges[i];
				const pr2 = prFileChanges[j];

				const sharedFiles = this.findSharedFiles(pr1.files, pr2.files);

				if (sharedFiles.length > 0) {
					const confidence = this.calculateIntersectionConfidence(
						pr1.files,
						pr2.files,
						sharedFiles
					);

					if (confidence >= 0.6) {
						suggestions.push({
							from: pr1.prName,
							to: pr2.prName,
							reason: "shared file modifications",
							confidence,
							sharedFiles: sharedFiles.sort(),
							heuristic: "shared-files"
						});
					}
				}
			}
		}

		return suggestions;
	}

	/**
	 * Heuristic 2: Directory proximity
	 * PRs modifying files in the same directory structure likely related
	 */
	private heuristicDirectoryProximity(
		prFileChanges: Array<{ prNumber: number; prName: string; files: FileChange[] }>
	): DependencySuggestion[] {
		const suggestions: DependencySuggestion[] = [];

		for (let i = 0; i < prFileChanges.length; i++) {
			for (let j = i + 1; j < prFileChanges.length; j++) {
				const pr1 = prFileChanges[i];
				const pr2 = prFileChanges[j];

				// Get directories for each PR
				const dirs1 = new Set(pr1.files.map(f => this.getDirectoryPath(f.filename)));
				const dirs2 = new Set(pr2.files.map(f => this.getDirectoryPath(f.filename)));

				// Find common directories
				const commonDirs = Array.from(dirs1).filter(d => dirs2.has(d));

				if (commonDirs.length > 0) {
					// Calculate confidence based on directory overlap
					const totalDirs = new Set([...dirs1, ...dirs2]).size;
					const confidence = Math.min(commonDirs.length / totalDirs, 0.8);

					if (confidence >= 0.3) {
						suggestions.push({
							from: pr1.prName,
							to: pr2.prName,
							reason: `both modify files in ${commonDirs.length} common director${commonDirs.length === 1 ? 'y' : 'ies'}`,
							confidence,
							sharedFiles: commonDirs.sort(),
							heuristic: "directory-proximity"
						});
					}
				}
			}
		}

		return suggestions;
	}

	/**
	 * Heuristic 3: Test overlap
	 * PRs that modify the same test files or test the same modules
	 */
	private heuristicTestOverlap(
		prFileChanges: Array<{ prNumber: number; prName: string; files: FileChange[] }>
	): DependencySuggestion[] {
		const suggestions: DependencySuggestion[] = [];

		for (let i = 0; i < prFileChanges.length; i++) {
			for (let j = i + 1; j < prFileChanges.length; j++) {
				const pr1 = prFileChanges[i];
				const pr2 = prFileChanges[j];

				// Find test files in each PR
				const testFiles1 = pr1.files.filter(f => this.isTestFile(f.filename));
				const testFiles2 = pr2.files.filter(f => this.isTestFile(f.filename));

				if (testFiles1.length === 0 || testFiles2.length === 0) continue;

				// Check for shared test files
				const sharedTests = this.findSharedFiles(testFiles1, testFiles2);
				
				if (sharedTests.length > 0) {
					// Higher confidence for shared test files
					const confidence = Math.min(0.7 + (sharedTests.length * 0.05), 0.85);

					suggestions.push({
						from: pr1.prName,
						to: pr2.prName,
						reason: `both modify ${sharedTests.length} shared test file${sharedTests.length === 1 ? '' : 's'}`,
						confidence,
						sharedFiles: sharedTests.sort(),
						heuristic: "test-overlap"
					});
				} else {
					// Check for testing same modules (test file names suggest same code)
					const modules1 = testFiles1.map(f => this.getTestedModule(f.filename));
					const modules2 = testFiles2.map(f => this.getTestedModule(f.filename));
					const sharedModules = modules1.filter(m => modules2.includes(m));

					if (sharedModules.length > 0) {
						const confidence = Math.min(0.5 + (sharedModules.length * 0.05), 0.65);

						suggestions.push({
							from: pr1.prName,
							to: pr2.prName,
							reason: `tests for same module${sharedModules.length === 1 ? '' : 's'}`,
							confidence,
							sharedFiles: sharedModules.sort(),
							heuristic: "test-overlap"
						});
					}
				}
			}
		}

		return suggestions;
	}

	/**
	 * Extract directory path from filename
	 */
	private getDirectoryPath(filename: string): string {
		const lastSlash = filename.lastIndexOf('/');
		return lastSlash > 0 ? filename.substring(0, lastSlash) : '';
	}

	/**
	 * Check if file is a test file
	 */
	private isTestFile(filename: string): boolean {
		return /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filename) ||
		       filename.includes('__tests__') ||
		       filename.includes('/tests/') ||
		       filename.includes('/test/');
	}

	/**
	 * Extract module name from test file
	 */
	private getTestedModule(testFilename: string): string {
		// Remove test suffix and directory to get module name
		const basename = testFilename.split('/').pop() || '';
		return basename.replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, '');
	}

	/**
	 * Perform complete file analysis on a set of PRs
	 */
	async analyzeFiles(
		prs: Array<{ number: number; name: string; sha?: string }>
	): Promise<FileAnalysisResult> {
		const [fileIntersections, suggestions, conflicts] = await Promise.all([
			this.buildIntersectionMatrix(prs),
			this.suggestDependencies(prs),
			this.predictConflicts(prs)
		]);

		return {
			fileIntersections,
			suggestions,
			conflicts
		};
	}

	/**
	 * Clear the cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { size: number; entries: string[] } {
		return {
			size: this.cache.size,
			entries: Array.from(this.cache.keys()).sort()
		};
	}
}

/**
 * Factory function to create FileAnalyzer instance
 */
export function createFileAnalyzer(
	octokit: Octokit,
	owner: string,
	repo: string
): FileAnalyzer {
	return new FileAnalyzer(octokit, owner, repo);
}
