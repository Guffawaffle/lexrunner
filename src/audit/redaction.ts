/**
 * Redaction and privacy utilities for audit logs
 */

import { createHash } from 'node:crypto';

/**
 * Redact secrets from text using regex pattern
 * Matches patterns like "password=value", "password: value", "password is value", "bearer value"
 * and redacts the value part
 */
export function redactSecrets(text: string, pattern: string): string {
	try {
		// First, validate the pattern by trying to create a regex with it
		new RegExp(pattern, 'gi');

		// Match keyword followed by optional separator (=, :, is) and optional spaces, then capture the value
		// Value is captured as: non-whitespace characters or quoted strings
		const regex = new RegExp(`(${pattern})\\s*(?:=|:|is|:=)?\\s*([^\\s"']+|"[^"]*"|'[^']*')`, 'gi');
		return text.replace(regex, '$1 ***REDACTED***');
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

// Conservative PHI pattern set; disabled by default unless profile enables it.
export const PHI_PATTERNS: RegExp[] = [
	/\b\d{3}-\d{2}-\d{4}\b/g,                           // SSN
	/\b\d{2}-\d{7}\b/g,                                 // EIN
	/\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g // DOB (ISO)
];

/**
 * Redact PHI patterns from a string
 */
export function redactPHI(text: string, enable = false): { text: string; flagged: boolean } {
	if (!enable) return { text, flagged: false };
	let flagged = false;
	let result = text;
	for (const re of PHI_PATTERNS) {
		if (re.test(result)) {
			flagged = true;
			result = result.replace(re, '***REDACTED***');
		}
	}
	return { text: result, flagged };
}

/**
 * Redact PHI patterns from an object (recursively applies to string values)
 * More efficient than stringify + parse roundtrip
 */
export function redactPHIFromObject(obj: any): { obj: any; flagged: boolean } {
	let flagged = false;

	function redactValue(value: any): any {
		if (typeof value === 'string') {
			const { text, flagged: wasRedacted } = redactPHI(value, true);
			if (wasRedacted) {
				flagged = true;
			}
			return text;
		} else if (Array.isArray(value)) {
			return value.map(redactValue);
		} else if (value !== null && typeof value === 'object') {
			const redacted: any = {};
			for (const key in value) {
				redacted[key] = redactValue(value[key]);
			}
			return redacted;
		}
		return value;
	}

	return { obj: redactValue(obj), flagged };
}
