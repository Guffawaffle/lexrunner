/**
 * Audit Profiles
 * 
 * Defines audit profiles with default context settings
 */

/**
 * Audit profile configuration
 */
export interface AuditProfile {
	/** Profile name */
	name: string;
	/** Default context types to collect */
	defaultContext: ('git' | 'ci' | 'os')[];
	/** Description */
	description: string;
}

/**
 * Available audit profiles
 */
export const AUDIT_PROFILES: Record<string, AuditProfile> = {
	basic: {
		name: 'basic',
		defaultContext: [],
		description: 'Basic audit logging without context metadata',
	},
	soc2: {
		name: 'soc2',
		defaultContext: ['git', 'ci'],
		description: 'SOC 2 compliance audit with git and CI context',
	},
	'hipaa-strict': {
		name: 'hipaa-strict',
		defaultContext: ['git', 'ci'],
		description: 'HIPAA strict compliance audit (excludes OS to avoid sensitive hostnames)',
	},
};

/**
 * Get audit profile by name
 */
export function getAuditProfile(profileName: string): AuditProfile | undefined {
	return AUDIT_PROFILES[profileName];
}

/**
 * Get default context for profile
 */
export function getDefaultContext(profileName: string): ('git' | 'ci' | 'os')[] {
	const profile = getAuditProfile(profileName);
	return profile ? profile.defaultContext : [];
}
