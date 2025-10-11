/**
 * Secrets Management Integration
 *
 * Provides secure credential handling with:
 * - Environment variable validation
 * - Secret rotation support
 * - Credential lifecycle management
 * - Integration with secret management systems
 */

/**
 * Secret metadata
 */
export interface SecretMetadata {
	/** Secret identifier */
	id: string;
	/** When the secret was created */
	createdAt: Date;
	/** When the secret expires (if applicable) */
	expiresAt?: Date;
	/** When the secret was last rotated */
	lastRotated?: Date;
	/** Secret source (env, vault, etc.) */
	source: 'env' | 'vault' | 'file' | 'parameter-store';
}

/**
 * Secret value with metadata
 */
export interface Secret {
	value: string;
	metadata: SecretMetadata;
}

/**
 * Secret provider interface
 */
export interface SecretProvider {
	/** Get secret by identifier */
	getSecret(id: string): Promise<Secret | null>;
	/** List available secrets */
	listSecrets(): Promise<string[]>;
	/** Check if secret exists */
	hasSecret(id: string): Promise<boolean>;
}

/**
 * Environment variable secret provider
 */
export class EnvironmentSecretProvider implements SecretProvider {
	private prefix: string;

	constructor(prefix: string = 'LEX_PR_') {
		this.prefix = prefix;
	}

	async getSecret(id: string): Promise<Secret | null> {
		const envVar = `${this.prefix}${id}`;
		const value = process.env[envVar];

		if (!value) {
			return null;
		}

		return {
			value,
			metadata: {
				id,
				createdAt: new Date(), // Unknown for env vars
				source: 'env',
			},
		};
	}

	async listSecrets(): Promise<string[]> {
		const secrets: string[] = [];

		for (const key of Object.keys(process.env)) {
			if (key.startsWith(this.prefix)) {
				secrets.push(key.substring(this.prefix.length));
			}
		}

		return secrets;
	}

	async hasSecret(id: string): Promise<boolean> {
		const envVar = `${this.prefix}${id}`;
		return process.env[envVar] !== undefined;
	}
}

/**
 * Secrets Manager
 * Central service for secure credential handling
 */
export class SecretsManager {
	private provider: SecretProvider;
	private cache: Map<string, Secret> = new Map();
	private cacheExpiry: number = 300000; // 5 minutes

	constructor(provider?: SecretProvider) {
		this.provider = provider || new EnvironmentSecretProvider();
	}

	/**
	 * Get secret value (with caching)
	 */
	async getSecret(id: string): Promise<string | null> {
		// Check cache first
		const cached = this.cache.get(id);
		if (cached) {
			// Check if expired
			if (cached.metadata.expiresAt && cached.metadata.expiresAt < new Date()) {
				this.cache.delete(id);
			} else {
				return cached.value;
			}
		}

		// Fetch from provider
		const secret = await this.provider.getSecret(id);
		if (!secret) {
			return null;
		}

		// Cache the secret
		this.cache.set(id, secret);

		// Schedule cache cleanup
		setTimeout(() => {
			this.cache.delete(id);
		}, this.cacheExpiry);

		return secret.value;
	}

	/**
	 * Get secret or throw error if not found
	 */
	async requireSecret(id: string): Promise<string> {
		const secret = await this.getSecret(id);
		if (!secret) {
			throw new Error(`Required secret '${id}' not found`);
		}
		return secret;
	}

	/**
	 * Validate required secrets exist
	 */
	async validateSecrets(requiredIds: string[]): Promise<{ valid: boolean; missing: string[] }> {
		const missing: string[] = [];

		for (const id of requiredIds) {
			const hasSecret = await this.provider.hasSecret(id);
			if (!hasSecret) {
				missing.push(id);
			}
		}

		return {
			valid: missing.length === 0,
			missing,
		};
	}

	/**
	 * Get GitHub token from standard locations
	 */
	async getGitHubToken(): Promise<string | null> {
		// Try standard environment variables
		const envVars = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT'];

		for (const envVar of envVars) {
			const value = process.env[envVar];
			if (value) {
				return value;
			}
		}

		// Try from secrets manager
		return this.getSecret('GITHUB_TOKEN');
	}

	/**
	 * Redact secret from logs/output
	 */
	redactSecret(text: string, secretValue: string): string {
		if (!secretValue) {
			return text;
		}
		return text.replace(new RegExp(secretValue, 'g'), '***REDACTED***');
	}

	/**
	 * Clear secret cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Check if secrets need rotation (based on age)
	 */
	async checkRotationNeeded(id: string, maxAgeDays: number = 90): Promise<boolean> {
		const secret = await this.provider.getSecret(id);
		if (!secret) {
			return false;
		}

		if (!secret.metadata.lastRotated && !secret.metadata.createdAt) {
			return false;
		}

		const referenceDate = secret.metadata.lastRotated || secret.metadata.createdAt;
		const ageMs = Date.now() - referenceDate.getTime();
		const ageDays = ageMs / (1000 * 60 * 60 * 24);

		return ageDays > maxAgeDays;
	}
}

/**
 * Global secrets manager instance
 */
export const secretsManager = new SecretsManager();

/**
 * Secret detection patterns
 */
export interface SecretPattern {
	/** Pattern name */
	name: string;
	/** Pattern description */
	description: string;
	/** Regex pattern to match */
	pattern: RegExp;
	/** Entropy threshold (optional) */
	entropyThreshold?: number;
}

/**
 * Confidence level for detected secrets (M2)
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Detected secret in content
 */
export interface DetectedSecret {
	/** Pattern that matched */
	pattern: SecretPattern;
	/** Matched value (redacted) */
	value: string;
	/** Line number where found */
	line?: number;
	/** Column number where found */
	column?: number;
	/** Context around the match */
	context?: string;
	/** Confidence score (0-1) */
	confidence?: number;
	/** Categorical confidence level (M2) */
	confidenceLevel?: ConfidenceLevel;
}

/**
 * Common secret patterns to detect
 */
export const SECRET_PATTERNS: SecretPattern[] = [
	{
		name: 'github_token',
		description: 'GitHub Personal Access Token',
		pattern: /\b(ghp_[A-Za-z0-9]{36})(?![A-Za-z0-9])/g,
	},
	{
		name: 'github_oauth',
		description: 'GitHub OAuth Access Token',
		pattern: /\b(gho_[A-Za-z0-9]{36})(?![A-Za-z0-9])/g,
	},
	{
		name: 'github_app_token',
		description: 'GitHub App Token',
		pattern: /\b(ghs_[A-Za-z0-9]{36})(?![A-Za-z0-9])/g,
	},
	{
		name: 'github_refresh_token',
		description: 'GitHub Refresh Token',
		pattern: /\b(ghr_[A-Za-z0-9]{36})(?![A-Za-z0-9])/g,
	},
	{
		name: 'aws_access_key',
		description: 'AWS Access Key ID',
		pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
	},
	{
		name: 'aws_secret_key',
		description: 'AWS Secret Access Key',
		pattern: /(?:aws.{0,20}secret|secret.{0,20}key).{0,20}["']([A-Za-z0-9/+=]{40})["']/gi,
	},
	{
		name: 'slack_token',
		description: 'Slack Token',
		pattern: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32})\b/g,
	},
	{
		name: 'slack_webhook',
		description: 'Slack Webhook URL',
		pattern: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/g,
	},
	{
		name: 'private_key',
		description: 'Private Key',
		pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
	},
	{
		name: 'generic_api_key',
		description: 'Generic API Key',
		pattern: /(?:api[_-]?key|apikey|api[_-]?secret).{0,20}["']([a-zA-Z0-9_\-]{20,})["']/gi,
	},
	{
		name: 'jwt_token',
		description: 'JWT Token',
		pattern: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
	},
	{
		name: 'password',
		description: 'Password in Code',
		pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"']{8,})["']/gi,
	},
];

/**
 * Plan Secrets Scanner
 * Scans plan content for accidentally exposed secrets
 */
export class PlanSecretsScanner {
	private patterns: SecretPattern[];

	constructor(patterns?: SecretPattern[]) {
		this.patterns = patterns || SECRET_PATTERNS;
	}

	/**
	 * Classify confidence level based on pattern characteristics (M2)
	 *
	 * High: Specific prefixes (ghp_, gho_, ghs_, AKIA...), private key delimiters, Slack webhook
	 * Medium: JWT, generic API key pattern (structured)
	 * Low: Password assignments / loose heuristics
	 */
	private classifyConfidenceLevel(patternName: string, value: string): ConfidenceLevel {
		// High confidence patterns (very specific signatures)
		if (patternName.startsWith('github_') && /^gh[poas]_/.test(value)) {
			return 'high';
		}
		if (patternName === 'aws_access_key' && /^AKIA/.test(value)) {
			return 'high';
		}
		if (patternName === 'private_key' && value.includes('-----BEGIN')) {
			return 'high';
		}
		if (patternName === 'slack_webhook' && value.includes('hooks.slack.com')) {
			return 'high';
		}

		// Medium confidence patterns (structured but less specific)
		if (patternName === 'jwt_token') {
			return 'medium';
		}
		if (patternName === 'generic_api_key') {
			return 'medium';
		}
		if (patternName === 'slack_token' && /^xox[baprs]-/.test(value)) {
			return 'medium';
		}

		// Low confidence patterns (loose heuristics)
		if (patternName === 'password') {
			return 'low';
		}
		if (patternName === 'aws_secret_key') {
			return 'low'; // Context-dependent pattern
		}

		// Default fallback
		return 'medium';
	}

	/**
	 * Scan text content for secrets
	 */
	scanText(content: string): DetectedSecret[] {
		const detected: DetectedSecret[] = [];
		const lines = content.split('\n');

		for (const pattern of this.patterns) {
			// Clone regex to avoid shared lastIndex state (B3 requirement)
			const source = pattern.pattern.source;
			const flags = pattern.pattern.flags.includes('g') ? pattern.pattern.flags : pattern.pattern.flags + 'g';
			const regex = new RegExp(source, flags);
			let match: RegExpExecArray | null;
			while ((match = regex.exec(content)) !== null) {
				const matchValue = match[1] || match[0];
				const position = this.findPosition(content, match.index);
				const context = position.line !== undefined ? lines[position.line - 1] : undefined;
				// Simple confidence heuristic: longer tokens & specific pattern names rank higher
				const baseLen = Math.min(matchValue.length, 64);
				let confidence = baseLen / 64; // 0..1 scaled by length (cap 64)
				// Pattern based weighting
				if (/private|secret|token|key/i.test(pattern.name)) confidence = Math.min(1, confidence * 1.1 + 0.1);
				if (/password/i.test(pattern.name)) confidence = Math.min(1, confidence * 0.9 + 0.05);

				// M2: Classify categorical confidence level
				const confidenceLevel = this.classifyConfidenceLevel(pattern.name, matchValue);

				detected.push({
					pattern,
					value: this.redact(matchValue),
					line: position.line,
					column: position.column,
					context: context ? this.redact(context) : undefined,
					confidence: Number(confidence.toFixed(3)),
					confidenceLevel,
				});
			}
		}

		// Deterministic ordering: pattern name, line, column
		detected.sort((a, b) => {
			const pn = a.pattern.name.localeCompare(b.pattern.name);
			if (pn !== 0) return pn;
			const la = a.line || 0;
			const lb = b.line || 0;
			if (la !== lb) return la - lb;
			const ca = a.column || 0;
			const cb = b.column || 0;
			if (ca !== cb) return ca - cb;
			return 0;
		});

		return detected;
	}

	/**
	 * Scan JSON object for secrets
	 */
	scanObject(obj: any): DetectedSecret[] {
		const jsonString = JSON.stringify(obj, null, 2);
		return this.scanText(jsonString);
	}

	/**
	 * Scan plan file content
	 */
	async scanPlanFile(filePath: string): Promise<DetectedSecret[]> {
		const { readFile } = await import('fs/promises');
		const content = await readFile(filePath, 'utf-8');
		return this.scanText(content);
	}

	/**
	 * Generate secrets scan report
	 */
	generateReport(detected: DetectedSecret[]): string {
		if (detected.length === 0) {
			return '✅ No secrets detected';
		}
		const lines: string[] = [];
		lines.push(`Found ${detected.length} potential secret(s):`);
		for (const secret of detected) {
			const conf = secret.confidence !== undefined ? ` (confidence: ${secret.confidence})` : '';
			lines.push(`- ${secret.pattern.name}${conf} — ${secret.pattern.description}`);
			if (secret.line !== undefined) {
				lines.push(`  Line ${secret.line}, Column ${secret.column}`);
			}
			if (secret.context) {
				lines.push(`  Context: ${secret.context}`);
			}
		}
		lines.push('Remove or rotate these secrets before committing.');
		return lines.join('\n');
	}

	/**
	 * Redact secret value for safe display
	 */
	private redact(value: string): string {
		if (value.length <= 8) {
			return '***';
		}
		return value.substring(0, 4) + '***' + value.substring(value.length - 4);
	}

	/**
	 * Find line and column position of match
	 */
	private findPosition(content: string, index: number): { line?: number; column?: number } {
		const lines = content.substring(0, index).split('\n');
		return {
			line: lines.length,
			column: lines[lines.length - 1].length + 1,
		};
	}
}
