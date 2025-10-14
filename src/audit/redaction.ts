/**
 * Redaction and privacy utilities for audit logs
 */

import { createHash } from 'node:crypto';

/**
 * Redact secrets from text using regex pattern
 */
export function redactSecrets(text: string, pattern: string): string {
	try {
		const regex = new RegExp(pattern, 'gi');
		return text.replace(regex, '***REDACTED***');
	} catch (error) {
		// If regex is invalid, return text unchanged
		console.warn(`Invalid redaction pattern: ${pattern}`, error);
		return text;
	}
}

/**
 * Redact secrets from object values
 */
export function redactObject(obj: any, pattern: string): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === 'string') {
		return redactSecrets(obj, pattern);
	}

	if (Array.isArray(obj)) {
		return obj.map(item => redactObject(item, pattern));
	}

	if (typeof obj === 'object') {
		const redacted: any = {};
		for (const [key, value] of Object.entries(obj)) {
			// Redact key if it matches pattern
			const shouldRedactKey = new RegExp(pattern, 'gi').test(key);
			if (shouldRedactKey) {
				redacted[key] = '***REDACTED***';
			} else {
				redacted[key] = redactObject(value, pattern);
			}
		}
		return redacted;
	}

	return obj;
}

/**
 * Hash file path for privacy
 */
export function hashPath(filePath: string): string {
	return createHash('sha256').update(filePath).digest('hex').substring(0, 16);
}

/**
 * Sanitize environment variables based on allowlist
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv, allowlist: string[]): Record<string, string> {
	const sanitized: Record<string, string> = {};
	
	for (const key of allowlist) {
		if (env[key]) {
			sanitized[key] = env[key] as string;
		}
	}
	
	return sanitized;
}

/**
 * Redact command line arguments
 */
export function redactArgv(argv: string[], pattern: string): string[] {
	return argv.map(arg => {
		// Check if this looks like a secret (contains equals or follows a flag)
		if (arg.includes('=')) {
			const [key, value] = arg.split('=', 2);
			if (new RegExp(pattern, 'gi').test(key)) {
				return `${key}=***REDACTED***`;
			}
			if (value && new RegExp(pattern, 'gi').test(value)) {
				return `${key}=***REDACTED***`;
			}
		}
		
		// Redact if the arg itself matches pattern
		if (new RegExp(pattern, 'gi').test(arg)) {
			return '***REDACTED***';
		}
		
		return arg;
	});
}

/**
 * Sanitize file content - remove code bodies, keep metadata
 */
export function sanitizeFileContent(content: string, maxLength: number = 1000): string {
	if (content.length <= maxLength) {
		return content;
	}
	return content.substring(0, maxLength) + '... [truncated]';
}

/**
 * Build context blocks based on configuration
 */
export function buildContext(
	includeContextTypes: ('git' | 'ci' | 'os')[],
	gitInfo?: { branch?: string; commit?: string; remote?: string },
	includeEnv: string[] = []
): {
	git?: Record<string, any>;
	ci?: Record<string, any>;
	os?: Record<string, any>;
} {
	const context: any = {};

	if (includeContextTypes.includes('git') && gitInfo) {
		context.git = {
			branch: gitInfo.branch,
			commit: gitInfo.commit,
			remote: gitInfo.remote
		};
	}

	if (includeContextTypes.includes('ci')) {
		context.ci = {
			name: process.env.CI_NAME || process.env.GITHUB_ACTIONS ? 'github-actions' : undefined,
			job_id: process.env.GITHUB_RUN_ID,
			job_number: process.env.GITHUB_RUN_NUMBER,
			workflow: process.env.GITHUB_WORKFLOW,
			actor: process.env.GITHUB_ACTOR
		};
		// Remove undefined values
		Object.keys(context.ci).forEach(key => {
			if (context.ci[key] === undefined) delete context.ci[key];
		});
	}

	if (includeContextTypes.includes('os')) {
		context.os = {
			platform: process.platform,
			arch: process.arch,
			node_version: process.version,
			env: sanitizeEnv(process.env, includeEnv)
		};
	}

	return context;
}
