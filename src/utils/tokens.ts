/**
 * Token expansion utilities for path templates
 */

import * as fs from "fs";
import * as path from "path";
import { simpleGit } from "simple-git";

/**
 * Git context information
 */
export interface GitContext {
	owner?: string;
	repo?: string;
	branch?: string;
	remote?: string;
}

/**
 * Get git context from the current repository
 * 
 * @param baseDir - Base directory to check for git repository
 * @returns Git context information
 */
export async function getGitContext(baseDir: string = process.cwd()): Promise<GitContext> {
	const git = simpleGit(baseDir);
	
	try {
		// Check if we're in a git repository
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			return {};
		}
		
		// Get current branch
		const branchSummary = await git.branchLocal();
		const branch = branchSummary.current;
		
		// Get remote URL
		const remotes = await git.getRemotes(true);
		const origin = remotes.find(r => r.name === 'origin');
		
		if (origin?.refs?.fetch) {
			const remoteUrl = origin.refs.fetch;
			const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
			
			if (match) {
				return {
					owner: match[1],
					repo: match[2],
					branch,
					remote: remoteUrl
				};
			}
		}
		
		return { branch };
	} catch (error) {
		// If git operations fail, return empty context
		return {};
	}
}

/**
 * Expand tokens in a path template
 * 
 * Supported tokens:
 * - {timestamp} - ISO 8601 timestamp
 * - {date} - YYYY-MM-DD date
 * - {repo} - Repository name
 * - {owner} - Repository owner
 * - {branch} - Current git branch
 * 
 * @param template - Path template with tokens
 * @param context - Additional context for token expansion
 * @returns Expanded path
 */
export function expandTokens(
	template: string,
	context: {
		timestamp?: string;
		date?: string;
		repo?: string;
		owner?: string;
		branch?: string;
	} = {}
): string {
	let result = template;
	
	// Timestamp token
	if (result.includes('{timestamp}')) {
		const timestamp = context.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
		result = result.replace(/\{timestamp\}/g, timestamp);
	}
	
	// Date token
	if (result.includes('{date}')) {
		const date = context.date || new Date().toISOString().split('T')[0];
		result = result.replace(/\{date\}/g, date);
	}
	
	// Repository tokens
	if (result.includes('{repo}') && context.repo) {
		result = result.replace(/\{repo\}/g, context.repo);
	}
	
	if (result.includes('{owner}') && context.owner) {
		result = result.replace(/\{owner\}/g, context.owner);
	}
	
	if (result.includes('{branch}') && context.branch) {
		result = result.replace(/\{branch\}/g, context.branch);
	}
	
	return result;
}
