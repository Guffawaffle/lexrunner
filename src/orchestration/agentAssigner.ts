/**
 * Agent Assigner - Bulk assign GitHub Copilot agents to batched issues
 * Handles rate limits and errors gracefully with exponential backoff
 */

import { retryWithBackoff, classifyError } from "../core/errorRecovery.js";

export interface AssignmentResult {
	issueNumber: number;
	status: 'success' | 'skipped' | 'failed';
	assignedAt?: string;
	agentUrl?: string;
	reason?: string;
	error?: string;
}

export interface AssignmentLog {
	batchId: string;
	assignedAt: string;
	results: AssignmentResult[];
	summary: {
		assigned: number;
		skipped: number;
		failed: number;
	};
}

export interface AssignmentOptions {
	repo: string;
	dryRun?: boolean;
	stagger?: number;
}

/**
 * Sleep helper for staggering requests
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Assign single issue with retry logic for rate limiting
 */
async function assignAgentWithRetry(
	issueNumber: number,
	repo: string,
	assignFn: (repo: string, issueNumber: number) => Promise<any>,
	maxRetries: number = 4
): Promise<AssignmentResult> {
	let retries = 0;
	let backoff = 10000; // 10 seconds

	while (retries < maxRetries) {
		try {
			// Call GitHub Copilot agent assignment
			const result = await assignFn(repo, issueNumber);
			return {
				issueNumber,
				status: 'success',
				assignedAt: new Date().toISOString(),
				agentUrl: result?.url || `https://github.com/${repo}/issues/${issueNumber}`,
			};
		} catch (error: any) {
			const classified = classifyError(error, `Assigning agent to issue ${issueNumber}`);
			
			// Check for rate limiting (HTTP 429 or rate limit error)
			if (error.status === 429 || classified.code === 'GITHUB_RATE_LIMIT') {
				retries++;
				if (retries >= maxRetries) {
					return {
						issueNumber,
						status: 'failed',
						error: 'Max retries exceeded (rate limit)',
					};
				}
				// Wait with exponential backoff
				await sleep(backoff);
				backoff *= 2;
				continue;
			}
			
			// Check if already assigned
			if (error.message?.includes('already assigned') || error.message?.includes('Agent already exists')) {
				return {
					issueNumber,
					status: 'skipped',
					reason: 'Issue already assigned',
				};
			}
			
			// Other errors - fail immediately
			return {
				issueNumber,
				status: 'failed',
				error: error.message || String(error),
			};
		}
	}

	// Should never reach here, but satisfy TypeScript
	return {
		issueNumber,
		status: 'failed',
		error: 'Unexpected retry loop exit',
	};
}

/**
 * Bulk-assign GitHub Copilot agents to issues
 * 
 * @param issues - List of issue numbers to assign
 * @param options - Assignment options (dry-run, stagger, etc.)
 * @param assignFn - Function to assign agent to an issue
 * @returns Assignment log with results
 */
export async function assignAgentsToBatch(
	issues: number[],
	options: AssignmentOptions,
	assignFn: (repo: string, issueNumber: number) => Promise<any>
): Promise<AssignmentLog> {
	const batchId = `batch-${Date.now()}`;
	const assignedAt = new Date().toISOString();
	const results: AssignmentResult[] = [];
	const staggerMs = (options.stagger ?? 5) * 1000;

	// Dry-run mode - just validate inputs
	if (options.dryRun) {
		return {
			batchId,
			assignedAt,
			results: issues.map(issueNumber => ({
				issueNumber,
				status: 'success' as const,
				assignedAt: undefined,
				agentUrl: undefined,
			})),
			summary: {
				assigned: 0,
				skipped: 0,
				failed: 0,
			},
		};
	}

	// Assign agents with stagger delay
	for (let i = 0; i < issues.length; i++) {
		const issueNumber = issues[i];
		
		// Add stagger delay between assignments (except first)
		if (i > 0) {
			await sleep(staggerMs);
		}

		// Assign with retry logic
		const result = await assignAgentWithRetry(
			issueNumber,
			options.repo,
			assignFn
		);
		
		results.push(result);
	}

	// Calculate summary
	const summary = {
		assigned: results.filter(r => r.status === 'success').length,
		skipped: results.filter(r => r.status === 'skipped').length,
		failed: results.filter(r => r.status === 'failed').length,
	};

	return {
		batchId,
		assignedAt,
		results,
		summary,
	};
}

/**
 * Format assignment log as human-readable output
 */
export function formatAssignmentLog(log: AssignmentLog, repo: string): string {
	const lines: string[] = [];
	
	lines.push(`Agent Assignment (${log.batchId})`);
	lines.push('='.repeat(40));
	
	for (const result of log.results) {
		const prefix = result.status === 'success' ? '✅' : 
		               result.status === 'skipped' ? '⏭️' : '❌';
		const issueRef = `${repo}#${result.issueNumber}`;
		
		if (result.status === 'success') {
			lines.push(`${prefix} ${issueRef}: assigned at ${result.assignedAt}`);
		} else if (result.status === 'skipped') {
			lines.push(`${prefix} ${issueRef}: ${result.reason || 'skipped'}`);
		} else {
			lines.push(`${prefix} ${issueRef}: ${result.error || 'failed'}`);
		}
	}
	
	lines.push('');
	lines.push(`Summary: ${log.summary.assigned} assigned, ${log.summary.skipped} skipped, ${log.summary.failed} failed`);
	
	return lines.join('\n');
}
