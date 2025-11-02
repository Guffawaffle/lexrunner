/**
 * Audit profile configurations
 */

export type AuditProfile = 'off' | 'basic' | 'soc2' | 'hipaa-strict';

export interface AuditProfileConfig {
	includeContext: ('git' | 'ci' | 'os')[];
	includeEnv: string[];
	redactRegex: string;
	hashPaths: boolean;
	retainDays: number;
	requireSignature: boolean;
	includeArtifactRefs: boolean;
	includeJobIds: boolean;
	strictRedaction: boolean;
}

/**
 * Default redaction regex - matches common secret patterns
 * Note: Case insensitivity is handled by the 'gi' flags when creating the RegExp
 */
export const DEFAULT_REDACT_REGEX = 'token|secret|pass|key|auth';

/**
 * Strict redaction regex - more comprehensive for HIPAA
 * Note: Case insensitivity is handled by the 'gi' flags when creating the RegExp
 */
export const STRICT_REDACT_REGEX = 'token|secret|pass|key|auth|api[_-]?key|bearer|credential|pwd|ssn|ein|dob';

/**
 * Profile configurations
 */
export const AUDIT_PROFILES: Record<AuditProfile, AuditProfileConfig | null> = {
	'off': null,
	'basic': {
		includeContext: [],
		includeEnv: [],
		redactRegex: DEFAULT_REDACT_REGEX,
		hashPaths: false,
		retainDays: 365, // 12 months
		requireSignature: false,
		includeArtifactRefs: false,
		includeJobIds: false,
		strictRedaction: false
	},
	'soc2': {
		includeContext: ['git', 'ci', 'os'],
		includeEnv: [], // Must be explicitly allowed
		redactRegex: DEFAULT_REDACT_REGEX,
		hashPaths: false,
		retainDays: 730, // 24 months
		requireSignature: true, // Stub for Phase 2
		includeArtifactRefs: true,
		includeJobIds: true,
		strictRedaction: false
	},
	'hipaa-strict': {
		includeContext: ['git', 'ci', 'os'],
		includeEnv: [], // Must be explicitly allowed
		redactRegex: STRICT_REDACT_REGEX,
		hashPaths: true,
		retainDays: 2190, // 6 years per HIPAA 45 CFR 164.316(b)(2)(i)
		requireSignature: true, // Stub for Phase 2
		includeArtifactRefs: true,
		includeJobIds: true,
		strictRedaction: true
	}
};

/**
 * Get profile configuration
 */
export function getProfileConfig(profile: AuditProfile): AuditProfileConfig | null {
	return AUDIT_PROFILES[profile];
}

/**
 * Merge profile config with custom options
 */
export function mergeProfileConfig(
	profile: AuditProfile,
	overrides: Partial<AuditProfileConfig> = {}
): AuditProfileConfig | null {
	const baseConfig = getProfileConfig(profile);
	if (!baseConfig) return null;

	return {
		...baseConfig,
		...overrides
	};
}
