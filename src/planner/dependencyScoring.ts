/**
 * Dependency Scoring & Weighting System
 * Unified scoring model for combining explicit dependencies with file-overlap heuristics
 */

import type { FileAnalyzer } from "./fileAnalysis.js";
import { parsePRDescription } from "./dependencyParser.js";

/**
 * Scored dependency between two PRs
 */
export interface DependencyScore {
	from: string;          // PR-123
	to: string;            // PR-456
	score: number;         // [0.0, 1.0]
	reason: string;        // "explicit-footer" | "shared-files" | "directory-proximity" | "test-overlap"
	evidence: {
		explicit?: string[]; // ["Depends-on: Guffawaffle/lex-pr-runner#456"]
		files?: string[];    // ["src/foo.ts", "src/bar.ts"]
		confidence?: number; // Original heuristic confidence
	};
}

/**
 * Options for configuring the scoring algorithm
 */
export interface ScoringOptions {
	weights?: {
		explicit?: number;        // default: 1.0
		sharedFiles?: number;     // default: 0.9 (max score for shared files)
		directoryProximity?: number; // default: 0.7 (max score for directory proximity)
		testOverlap?: number;     // default: 0.6 (max score for test overlap)
	};
	threshold?: number;         // default: 0.3 (filter out low scores)
}

/**
 * Default weights for scoring
 */
const DEFAULT_WEIGHTS = {
	explicit: 1.0,
	sharedFiles: 0.9,      // Max score for shared files heuristic
	directoryProximity: 0.7, // Max score for directory proximity
	testOverlap: 0.6       // Max score for test overlap
};

/**
 * Default threshold for filtering low-confidence scores
 */
const DEFAULT_THRESHOLD = 0.3;

/**
 * Combine explicit dependencies and file analysis into scored ranking
 */
export async function scoreDependencies(
	prs: Array<{ number: number; name: string; body: string | null; sha?: string }>,
	fileAnalyzer: FileAnalyzer,
	options?: ScoringOptions
): Promise<DependencyScore[]> {
	const weights = { ...DEFAULT_WEIGHTS, ...options?.weights };
	const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

	const scores: DependencyScore[] = [];

	// 1. Extract explicit dependencies (score: 1.0)
	const explicitScores = extractExplicitDependencies(prs, weights.explicit);
	scores.push(...explicitScores);

	// 2. Get file-based suggestions using heuristics
	const fileSuggestions = await fileAnalyzer.suggestDependenciesWithHeuristics(prs);

	// 3. Convert file suggestions to scores
	for (const suggestion of fileSuggestions) {
		const score = calculateScoreFromHeuristic(
			suggestion.heuristic,
			suggestion.confidence,
			weights
		);

		if (score >= threshold) {
			scores.push({
				from: suggestion.from,
				to: suggestion.to,
				score,
				reason: mapHeuristicToReason(suggestion.heuristic),
				evidence: {
					files: suggestion.sharedFiles,
					confidence: suggestion.confidence
				}
			});
		}
	}

	// 4. Merge duplicate scores (keep max)
	const merged = mergeDuplicateScores(scores);

	// 5. Sort deterministically
	const sorted = sortScores(merged);

	return sorted;
}

/**
 * Extract explicit dependencies from PR descriptions
 */
function extractExplicitDependencies(
	prs: Array<{ number: number; name: string; body: string | null }>,
	explicitWeight: number
): DependencyScore[] {
	const scores: DependencyScore[] = [];

	for (const pr of prs) {
		const parsed = parsePRDescription(pr.number, pr.body);

		for (const dep of parsed.dependencies) {
			// Convert dependency reference to PR name format
			const toName = convertDepRefToPRName(dep);

			scores.push({
				from: pr.name,
				to: toName,
				score: explicitWeight,
				reason: "explicit-footer",
				evidence: {
					explicit: [dep]
				}
			});
		}
	}

	return scores;
}

/**
 * Convert dependency reference (#123, PR-123, owner/repo#123) to PR name format
 */
function convertDepRefToPRName(dep: string): string {
	// Extract PR number from various formats
	if (dep.startsWith('#')) {
		// #123 -> PR-123
		return `PR-${dep.substring(1)}`;
	}

	if (dep.match(/^PR-\d+$/i)) {
		// PR-123 -> PR-123 (uppercase)
		return dep.toUpperCase();
	}

	if (dep.includes('#')) {
		// owner/repo#123 -> PR-123
		const prNumber = dep.split('#')[1];
		return `PR-${prNumber}`;
	}

	return dep;
}

/**
 * Calculate score from heuristic type and confidence
 */
function calculateScoreFromHeuristic(
	heuristic: string | undefined,
	confidence: number,
	weights: Record<string, number>
): number {
	switch (heuristic) {
		case "shared-files":
			// Shared files: scale confidence to weight (max score)
			// confidence in [0, 1] maps to [0, weight]
			return confidence * weights.sharedFiles;

		case "directory-proximity":
			// Directory proximity: scale confidence to weight
			return confidence * weights.directoryProximity;

		case "test-overlap":
			// Test overlap: scale confidence to weight
			return confidence * weights.testOverlap;

		default:
			// Unknown heuristic - use raw confidence
			return confidence;
	}
}

/**
 * Map heuristic type to human-readable reason
 */
function mapHeuristicToReason(heuristic: string | undefined): string {
	switch (heuristic) {
		case "shared-files":
			return "shared-files";
		case "directory-proximity":
			return "directory-proximity";
		case "test-overlap":
			return "test-overlap";
		default:
			return "heuristic";
	}
}

/**
 * Merge multiple signals for same PR pair (take max score)
 */
export function mergeDuplicateScores(scores: DependencyScore[]): DependencyScore[] {
	const scoreMap = new Map<string, DependencyScore>();

	for (const score of scores) {
		const key = `${score.from}::${score.to}`;
		const existing = scoreMap.get(key);

		if (!existing || score.score > existing.score) {
			// Keep the higher score
			scoreMap.set(key, score);
		} else if (score.score === existing.score) {
			// Merge evidence for same score
			const mergedEvidence = {
				...existing.evidence,
				explicit: [
					...(existing.evidence.explicit || []),
					...(score.evidence.explicit || [])
				],
				files: [
					...(existing.evidence.files || []),
					...(score.evidence.files || [])
				]
			};

			// Remove duplicates and sort
			if (mergedEvidence.explicit) {
				mergedEvidence.explicit = [...new Set(mergedEvidence.explicit)].sort();
			}
			if (mergedEvidence.files) {
				mergedEvidence.files = [...new Set(mergedEvidence.files)].sort();
			}

			scoreMap.set(key, {
				...existing,
				evidence: mergedEvidence
			});
		}
	}

	return Array.from(scoreMap.values());
}

/**
 * Deterministic sorting: score desc, prNumber asc, timestamp asc
 */
export function sortScores(scores: DependencyScore[]): DependencyScore[] {
	return scores.slice().sort((a, b) => {
		// Primary: score descending
		const scoreCompare = b.score - a.score;
		if (Math.abs(scoreCompare) > 0.001) {
			return scoreCompare;
		}

		// Secondary: from PR number ascending
		const fromNumA = extractPRNumber(a.from);
		const fromNumB = extractPRNumber(b.from);
		if (fromNumA !== fromNumB) {
			return fromNumA - fromNumB;
		}

		// Tertiary: to PR number ascending
		const toNumA = extractPRNumber(a.to);
		const toNumB = extractPRNumber(b.to);
		if (toNumA !== toNumB) {
			return toNumA - toNumB;
		}

		// Quaternary: alphabetical by from
		const fromCompare = a.from.localeCompare(b.from);
		if (fromCompare !== 0) {
			return fromCompare;
		}

		// Final: alphabetical by to
		return a.to.localeCompare(b.to);
	});
}

/**
 * Extract PR number from PR name (PR-123 -> 123)
 */
function extractPRNumber(prName: string): number {
	const match = prName.match(/PR-(\d+)/i);
	return match ? parseInt(match[1], 10) : 0;
}
