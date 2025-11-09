/**
 * Token expansion utilities for templates
 */

import { execa } from 'execa';
import * as path from 'path';

export interface GitContext {
	branch?: string;
	commit?: string;
	remote?: string;
}

/**
 * Get git context from working directory
 */
export async function getGitContext(cwd: string): Promise<GitContext> {
	try {
		const { stdout: branch } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
		const { stdout: commit } = await execa('git', ['rev-parse', '--short', 'HEAD'], { cwd });
		const { stdout: remote } = await execa('git', ['remote', 'get-url', 'origin'], { cwd }).catch(() => ({ stdout: '' }));
		
		return {
			branch: branch.trim(),
			commit: commit.trim(),
			remote: remote.trim()
		};
	} catch {
		return {};
	}
}

/**
 * Expand tokens in string template
 */
export function expandTokens(template: string, context: Record<string, any>): string {
	let result = template;
	
	for (const [key, value] of Object.entries(context)) {
		if (value !== undefined && value !== null) {
			result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
		}
	}
	
	return result;
}
