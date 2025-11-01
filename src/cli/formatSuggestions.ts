/**
 * Format dependency suggestions for human review
 * Supports table, JSON, and markdown output formats
 */

import type { DependencyScore } from "../planner/dependencyScoring.js";

/**
 * Output format options
 */
export type SuggestionFormat = "table" | "json" | "markdown";

/**
 * Categorize score by confidence level
 */
function getConfidenceLevel(score: number): "high" | "medium" | "low" {
	if (score >= 0.7) return "high";
	if (score >= 0.5) return "medium";
	return "low";
}

/**
 * Format suggestions as a table for console output
 */
export function formatSuggestionsAsTable(
	suggestions: DependencyScore[],
	threshold?: number
): string {
	if (suggestions.length === 0) {
		return "No dependency suggestions found.\n";
	}

	const lines: string[] = [];
	lines.push("=== Dependency Suggestions ===\n");

	for (const suggestion of suggestions) {
		const confidence = getConfidenceLevel(suggestion.score);
		const scoreStr = suggestion.score.toFixed(2);
		
		lines.push(`${suggestion.from} → ${suggestion.to}  [score: ${scoreStr}] ${suggestion.reason}`);
		
		// Add evidence details
		if (suggestion.evidence.explicit && suggestion.evidence.explicit.length > 0) {
			const evidenceStr = suggestion.evidence.explicit.join(", ");
			lines.push(`  Evidence: "${evidenceStr}" in PR description`);
		} else if (suggestion.evidence.files && suggestion.evidence.files.length > 0) {
			const fileCount = suggestion.evidence.files.length;
			const dirExample = extractDirectory(suggestion.evidence.files[0]);
			lines.push(`  Evidence: ${fileCount} shared file${fileCount > 1 ? 's' : ''} ${dirExample ? `(${dirExample})` : ''}`);
		}
		
		lines.push(`  Confidence: ${confidence.charAt(0).toUpperCase() + confidence.slice(1)}`);
		
		// Add warning for low-confidence suggestions
		if (confidence === "low" && threshold !== undefined) {
			lines.push(`  (below typical threshold of ${threshold.toFixed(1)})`);
		}
		
		lines.push("");
	}

	// Summary
	const highConfidence = suggestions.filter(s => s.score >= 0.7).length;
	const lowConfidence = suggestions.filter(s => s.score < 0.5).length;
	
	lines.push(`Total: ${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''} (${highConfidence} high-confidence${lowConfidence > 0 ? `, ${lowConfidence} low-confidence` : ''})`);

	return lines.join("\n");
}

/**
 * Format suggestions as JSON
 */
export function formatSuggestionsAsJSON(suggestions: DependencyScore[]): string {
	const output = {
		suggestions: suggestions.map(s => ({
			from: s.from,
			to: s.to,
			score: s.score,
			reason: s.reason,
			evidence: s.evidence,
			confidence: getConfidenceLevel(s.score)
		})),
		summary: {
			total: suggestions.length,
			highConfidence: suggestions.filter(s => s.score >= 0.7).length,
			mediumConfidence: suggestions.filter(s => s.score >= 0.5 && s.score < 0.7).length,
			lowConfidence: suggestions.filter(s => s.score < 0.5).length
		}
	};

	return JSON.stringify(output, null, 2);
}

/**
 * Format suggestions as Markdown
 */
export function formatSuggestionsAsMarkdown(suggestions: DependencyScore[]): string {
	if (suggestions.length === 0) {
		return "# Dependency Suggestions\n\nNo dependency suggestions found.\n";
	}

	const lines: string[] = [];
	lines.push("# Dependency Suggestions\n");

	// Group by confidence level
	const highConfidence = suggestions.filter(s => s.score >= 0.7);
	const mediumConfidence = suggestions.filter(s => s.score >= 0.5 && s.score < 0.7);
	const lowConfidence = suggestions.filter(s => s.score < 0.5);

	if (highConfidence.length > 0) {
		lines.push("## High Confidence (score ≥ 0.7)\n");
		for (const suggestion of highConfidence) {
			lines.push(`### ${suggestion.from} → ${suggestion.to} [${suggestion.score.toFixed(2)}]`);
			lines.push(`- **Reason:** ${suggestion.reason}`);
			
			if (suggestion.evidence.explicit && suggestion.evidence.explicit.length > 0) {
				const evidenceStr = suggestion.evidence.explicit.join(", ");
				lines.push(`- **Evidence:** "${evidenceStr}" in PR description`);
			} else if (suggestion.evidence.files && suggestion.evidence.files.length > 0) {
				const fileCount = suggestion.evidence.files.length;
				const dirExample = extractDirectory(suggestion.evidence.files[0]);
				lines.push(`- **Evidence:** ${fileCount} shared file${fileCount > 1 ? 's' : ''} ${dirExample ? `in \`${dirExample}\`` : ''}`);
			}
			
			lines.push("");
		}
	}

	if (mediumConfidence.length > 0) {
		lines.push("## Medium Confidence (0.5 ≤ score < 0.7)\n");
		for (const suggestion of mediumConfidence) {
			lines.push(`### ${suggestion.from} → ${suggestion.to} [${suggestion.score.toFixed(2)}]`);
			lines.push(`- **Reason:** ${suggestion.reason}`);
			
			if (suggestion.evidence.files && suggestion.evidence.files.length > 0) {
				const fileCount = suggestion.evidence.files.length;
				const dirExample = extractDirectory(suggestion.evidence.files[0]);
				lines.push(`- **Evidence:** ${fileCount} shared file${fileCount > 1 ? 's' : ''} ${dirExample ? `in \`${dirExample}\`` : ''}`);
			}
			
			lines.push("");
		}
	}

	if (lowConfidence.length > 0) {
		lines.push("## Low Confidence (score < 0.5)\n");
		for (const suggestion of lowConfidence) {
			lines.push(`### ${suggestion.from} → ${suggestion.to} [${suggestion.score.toFixed(2)}]`);
			lines.push(`- **Reason:** ${suggestion.reason}`);
			lines.push("");
		}
	}

	// Summary
	lines.push("---\n");
	const summary = [];
	if (highConfidence.length > 0) summary.push(`${highConfidence.length} high-confidence`);
	if (mediumConfidence.length > 0) summary.push(`${mediumConfidence.length} medium-confidence`);
	if (lowConfidence.length > 0) summary.push(`${lowConfidence.length} low-confidence`);
	lines.push(`**Summary:** ${summary.join(", ")}`);

	return lines.join("\n");
}

/**
 * Format suggestions based on the requested format
 */
export function formatSuggestions(
	suggestions: DependencyScore[],
	format: SuggestionFormat = "table",
	threshold?: number
): string {
	switch (format) {
		case "json":
			return formatSuggestionsAsJSON(suggestions);
		case "markdown":
			return formatSuggestionsAsMarkdown(suggestions);
		case "table":
		default:
			return formatSuggestionsAsTable(suggestions, threshold);
	}
}

/**
 * Extract directory from file path for display
 */
function extractDirectory(filePath: string): string | null {
	const parts = filePath.split("/");
	if (parts.length > 1) {
		return parts.slice(0, -1).join("/") + "/";
	}
	return null;
}
