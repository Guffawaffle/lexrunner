/**
 * PR metadata filtering for minimal context packaging
 * Filters PR data to include only essential information, with body gated by needs-context label
 */

import type { PullRequest } from "./types.js";

export interface MinimalPRMetadata {
	/** PR number */
	number: number;
	/** PR title */
	title: string;
	/** PR labels (always included) */
	labels: Array<{ name: string; color: string }>;
	/** PR body (only if needs-context label is present) */
	body?: string | null;
	/** Branch information */
	head: {
		ref: string;
		sha: string;
	};
	/** Base branch information */
	base: {
		ref: string;
		sha: string;
	};
	/** PR state */
	state: "open" | "closed" | "merged";
	/** Author */
	author: string;
	/** Created/updated timestamps */
	createdAt: string;
	updatedAt: string;
	/** Whether body was included */
	bodyIncluded: boolean;
}

export interface MinimalPRContext {
	/** Filtered PRs */
	prs: MinimalPRMetadata[];
	/** Count of PRs with body included */
	withBodyCount: number;
	/** Total size in characters */
	totalSize: number;
	/** Original size (if body was included for all) */
	originalSize: number;
	/** Size reduction percentage */
	reductionPercent: number;
}

/**
 * Labels that trigger inclusion of PR body
 */
const CONTEXT_LABELS = [
	"needs-context",
	"needs-body",
	"full-context",
];

/**
 * Check if PR should include body based on labels
 */
export function shouldIncludeBody(labels: Array<{ name: string }>): boolean {
	return labels.some(label => 
		CONTEXT_LABELS.some(contextLabel => 
			label.name.toLowerCase() === contextLabel.toLowerCase()
		)
	);
}

/**
 * Filter PR metadata to minimal context
 */
export function filterPRMetadata(pr: PullRequest): MinimalPRMetadata {
	const includeBody = shouldIncludeBody(pr.labels);

	return {
		number: pr.number,
		title: pr.title,
		labels: pr.labels,
		body: includeBody ? pr.body : undefined,
		head: {
			ref: pr.head.ref,
			sha: pr.head.sha,
		},
		base: {
			ref: pr.base.ref,
			sha: pr.base.sha,
		},
		state: pr.state,
		author: pr.user.login,
		createdAt: pr.createdAt,
		updatedAt: pr.updatedAt,
		bodyIncluded: includeBody,
	};
}

/**
 * Filter multiple PRs and calculate context metrics
 */
export function filterPRsWithMetrics(prs: PullRequest[]): MinimalPRContext {
	const filteredPRs = prs.map(filterPRMetadata);

	// Calculate sizes
	const totalSize = JSON.stringify(filteredPRs).length;
	const originalSize = JSON.stringify(prs.map(pr => ({
		...pr,
		// Simulate full PR data
		body: pr.body || '',
	}))).length;

	const withBodyCount = filteredPRs.filter(pr => pr.bodyIncluded).length;
	const reductionPercent = originalSize > 0 
		? ((originalSize - totalSize) / originalSize) * 100 
		: 0;

	return {
		prs: filteredPRs,
		withBodyCount,
		totalSize,
		originalSize,
		reductionPercent,
	};
}

/**
 * Format minimal PR metadata as compact text
 */
export function formatMinimalPR(pr: MinimalPRMetadata): string {
	const lines: string[] = [];

	lines.push(`# PR #${pr.number}: ${pr.title}`);
	lines.push(`Author: ${pr.author}`);
	lines.push(`State: ${pr.state}`);
	lines.push(`Branch: ${pr.head.ref} -> ${pr.base.ref}`);
	lines.push(`SHA: ${pr.head.sha.substring(0, 7)}`);

	if (pr.labels.length > 0) {
		lines.push(`Labels: ${pr.labels.map(l => l.name).join(', ')}`);
	}

	lines.push(`Created: ${pr.createdAt}`);
	lines.push(`Updated: ${pr.updatedAt}`);

	if (pr.bodyIncluded && pr.body) {
		lines.push('');
		lines.push('## Description');
		lines.push(pr.body);
	}

	return lines.join('\n');
}

/**
 * Format multiple PRs as compact text
 */
export function formatMinimalPRs(context: MinimalPRContext): string {
	const parts: string[] = [];

	parts.push(`# Pull Requests (${context.prs.length} total, ${context.withBodyCount} with body)`);
	parts.push(`Size: ${context.totalSize} chars (${context.reductionPercent.toFixed(1)}% reduction)`);
	parts.push('');

	for (const pr of context.prs) {
		parts.push(formatMinimalPR(pr));
		parts.push('');
	}

	return parts.join('\n');
}

/**
 * Add needs-context label to a PR (for client integration)
 */
export function markNeedsContext(pr: PullRequest): PullRequest {
	// Check if label already exists
	const hasLabel = pr.labels.some(l => 
		CONTEXT_LABELS.some(cl => l.name.toLowerCase() === cl.toLowerCase())
	);

	if (hasLabel) {
		return pr;
	}

	// Add needs-context label
	return {
		...pr,
		labels: [
			...pr.labels,
			{ name: "needs-context", color: "d4c5f9" },
		],
	};
}

/**
 * Extract essential fields from PR for minimal storage
 */
export interface EssentialPRData {
	number: number;
	title: string;
	labels: string[];
	branch: string;
	sha: string;
	state: string;
}

/**
 * Extract only essential data from PR
 */
export function extractEssentialData(pr: PullRequest | MinimalPRMetadata): EssentialPRData {
	return {
		number: pr.number,
		title: pr.title,
		labels: pr.labels.map(l => l.name),
		branch: pr.head.ref,
		sha: pr.head.sha.substring(0, 7),
		state: pr.state,
	};
}
