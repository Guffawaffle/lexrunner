/**
 * Guardrail Enforcement for Executors
 *
 * Enforces guardrail profiles (G_scope, G_tool, G_epist, G_style, G_audit)
 * for executor behavior. Provides runtime checking and violation detection.
 *
 * @module executors/guardrailEnforcement
 */

import { minimatch } from "minimatch";
import type {
	GuardrailProfile,
	G_scope,
	AccessPattern,
} from "../types/guardrails.js";

/**
 * Violation severity levels
 */
export type ViolationSeverity = "warning" | "error" | "critical";

/**
 * Guardrail violation entry
 */
export interface GuardrailViolation {
	/** Timestamp of the violation */
	timestamp: string;
	/** Type of guardrail violated */
	guardrailType: "scope" | "tool" | "epist" | "style" | "audit";
	/** Specific constraint violated */
	constraint: string;
	/** Human-readable message */
	message: string;
	/** Severity level */
	severity: ViolationSeverity;
	/** Context about the violation */
	context?: Record<string, unknown>;
}

/**
 * Result of enforcing guardrails
 */
export interface EnforcementResult {
	/** Whether enforcement passed */
	allowed: boolean;
	/** List of violations (if any) */
	violations: GuardrailViolation[];
	/** Optional blocking violation (highest severity) */
	blockingViolation?: GuardrailViolation;
}

/**
 * Check if a file path matches an access pattern
 *
 * @param filePath - The file path to check
 * @param pattern - The access pattern with glob support
 * @returns True if the path matches the pattern
 */
export function matchesAccessPattern(
	filePath: string,
	pattern: AccessPattern
): boolean {
	// Use consistent options: dot=true to match dotfiles, nocase=false for case-sensitive matching
	return minimatch(filePath, pattern.path, { dot: true, nocase: false });
}

/**
 * Check if file access is allowed by scope guardrails
 *
 * @param filePath - The file path to access
 * @param accessType - The type of access ("read" or "write")
 * @param scope - The scope guardrail configuration
 * @returns Enforcement result
 */
export function checkFileAccess(
	filePath: string,
	accessType: "read" | "write",
	scope: G_scope | undefined
): EnforcementResult {
	const violations: GuardrailViolation[] = [];

	if (!scope?.files) {
		// No file restrictions
		return { allowed: true, violations: [] };
	}

	// Check deny list first (deny takes precedence)
	for (const denyPattern of scope.files.deny ?? []) {
		if (
			denyPattern.access === accessType &&
			matchesAccessPattern(filePath, denyPattern)
		) {
			const violation: GuardrailViolation = {
				timestamp: new Date().toISOString(),
				guardrailType: "scope",
				constraint: "files.deny",
				message: `File access denied: ${accessType} access to "${filePath}" matches denied pattern "${denyPattern.path}"`,
				severity: "error",
				context: { filePath, accessType, pattern: denyPattern.path },
			};
			violations.push(violation);
			return {
				allowed: false,
				violations,
				blockingViolation: violation,
			};
		}
	}

	// If allow list exists, must match at least one pattern
	if (scope.files.allow && scope.files.allow.length > 0) {
		let allowed = false;
		for (const allowPattern of scope.files.allow) {
			if (
				allowPattern.access === accessType &&
				matchesAccessPattern(filePath, allowPattern)
			) {
				allowed = true;
				break;
			}
		}

		if (!allowed) {
			const violation: GuardrailViolation = {
				timestamp: new Date().toISOString(),
				guardrailType: "scope",
				constraint: "files.allow",
				message: `File access not permitted: ${accessType} access to "${filePath}" does not match any allowed pattern`,
				severity: "error",
				context: { filePath, accessType },
			};
			violations.push(violation);
			return {
				allowed: false,
				violations,
				blockingViolation: violation,
			};
		}
	}

	return { allowed: true, violations: [] };
}

/**
 * Check if network access is allowed by scope guardrails
 *
 * @param host - The network host/pattern to access
 * @param scope - The scope guardrail configuration
 * @returns Enforcement result
 */
export function checkNetworkAccess(
	host: string,
	scope: G_scope | undefined
): EnforcementResult {
	const violations: GuardrailViolation[] = [];

	if (!scope?.network) {
		// No network restrictions
		return { allowed: true, violations: [] };
	}

	// Check deny list first
	for (const denyPattern of scope.network.deny ?? []) {
		if (minimatch(host, denyPattern, { dot: true, nocase: false })) {
			const violation: GuardrailViolation = {
				timestamp: new Date().toISOString(),
				guardrailType: "scope",
				constraint: "network.deny",
				message: `Network access denied: access to "${host}" matches denied pattern "${denyPattern}"`,
				severity: "error",
				context: { host, pattern: denyPattern },
			};
			violations.push(violation);
			return {
				allowed: false,
				violations,
				blockingViolation: violation,
			};
		}
	}

	// If allow list exists, must match at least one pattern
	if (scope.network.allow && scope.network.allow.length > 0) {
		let allowed = false;
		for (const allowPattern of scope.network.allow) {
			if (minimatch(host, allowPattern, { dot: true, nocase: false })) {
				allowed = true;
				break;
			}
		}

		if (!allowed) {
			const violation: GuardrailViolation = {
				timestamp: new Date().toISOString(),
				guardrailType: "scope",
				constraint: "network.allow",
				message: `Network access not permitted: access to "${host}" does not match any allowed pattern`,
				severity: "error",
				context: { host },
			};
			violations.push(violation);
			return {
				allowed: false,
				violations,
				blockingViolation: violation,
			};
		}
	}

	return { allowed: true, violations: [] };
}

/**
 * Check if environment variable access is allowed by scope guardrails
 *
 * @param envVar - The environment variable name
 * @param scope - The scope guardrail configuration
 * @returns Enforcement result
 */
export function checkEnvAccess(
	envVar: string,
	scope: G_scope | undefined
): EnforcementResult {
	const violations: GuardrailViolation[] = [];

	if (!scope?.env) {
		// No env restrictions
		return { allowed: true, violations: [] };
	}

	// Check deny list first
	for (const denyPattern of scope.env.deny ?? []) {
		if (minimatch(envVar, denyPattern, { dot: true, nocase: false })) {
			const violation: GuardrailViolation = {
				timestamp: new Date().toISOString(),
				guardrailType: "scope",
				constraint: "env.deny",
				message: `Environment variable access denied: access to "${envVar}" matches denied pattern "${denyPattern}"`,
				severity: "error",
				context: { envVar, pattern: denyPattern },
			};
			violations.push(violation);
			return {
				allowed: false,
				violations,
				blockingViolation: violation,
			};
		}
	}

	// If allow list exists, must match at least one pattern
	if (scope.env.allow && scope.env.allow.length > 0) {
		let allowed = false;
		for (const allowPattern of scope.env.allow) {
			if (minimatch(envVar, allowPattern, { dot: true, nocase: false })) {
				allowed = true;
				break;
			}
		}

		if (!allowed) {
			const violation: GuardrailViolation = {
				timestamp: new Date().toISOString(),
				guardrailType: "scope",
				constraint: "env.allow",
				message: `Environment variable access not permitted: access to "${envVar}" does not match any allowed pattern`,
				severity: "error",
				context: { envVar },
			};
			violations.push(violation);
			return {
				allowed: false,
				violations,
				blockingViolation: violation,
			};
		}
	}

	return { allowed: true, violations: [] };
}

/**
 * Enforce a guardrail profile for a given action
 *
 * @param profile - The guardrail profile to enforce
 * @param action - The action being attempted
 * @returns Enforcement result
 */
export function enforceGuardrail(
	profile: GuardrailProfile,
	action: {
		type: "file_access" | "network_access" | "env_access";
		target: string;
		accessType?: "read" | "write";
	}
): EnforcementResult {
	switch (action.type) {
		case "file_access":
			if (!action.accessType) {
				throw new Error("accessType required for file_access action");
			}
			return checkFileAccess(action.target, action.accessType, profile.scope);
		case "network_access":
			return checkNetworkAccess(action.target, profile.scope);
		case "env_access":
			return checkEnvAccess(action.target, profile.scope);
		default: {
			// Exhaustive check - TypeScript should prevent this
			const _exhaustive: never = action.type;
			throw new Error(`Unknown action type: ${_exhaustive}`);
		}
	}
}
