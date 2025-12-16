/**
 * Guardrail Enforcement Runtime (LPR-047)
 *
 * Implements runtime enforcement of guardrail profiles during executor execution.
 * Each guardrail class can be enabled/disabled independently and produces
 * actionable error messages on violation.
 *
 * @module executors/guardrailEnforcement
 */

import { minimatch } from "minimatch";
import type {
	GuardrailProfile,
	G_scope,
	G_tool,
	G_epist,
	G_style,
	G_audit,
} from "../types/guardrails.js";

// ─────────────────────────────────────────────────────────────────────────────
// Logger Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logger interface for guardrail warnings and notifications
 */
export interface GuardrailLogger {
	warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default console logger
 */
export const defaultGuardrailLogger: GuardrailLogger = {
	warn(message: string, context?: Record<string, unknown>): void {
		if (context && Object.keys(context).length > 0) {
			console.warn(message, context);
		} else {
			console.warn(message);
		}
	},
};

/**
 * Silent logger for testing or when warnings should be suppressed
 */
export const silentGuardrailLogger: GuardrailLogger = {
	warn(_message: string, _context?: Record<string, unknown>): void {
		// Intentionally silent
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// GuardrailViolation Error Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class for all guardrail violations
 */
export class GuardrailViolation extends Error {
	constructor(
		public readonly guardrailType:
			| "scope"
			| "tool"
			| "epistemic"
			| "style"
			| "audit",
		public readonly message: string,
		public readonly details: Record<string, unknown> = {}
	) {
		super(message);
		this.name = "GuardrailViolation";
	}
}

/**
 * Scope guardrail violation (file/network/env access)
 */
export class ScopeViolation extends GuardrailViolation {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("scope", message, details);
		this.name = "ScopeViolation";
	}
}

/**
 * Tool guardrail violation (tool budget/constraints)
 */
export class ToolViolation extends GuardrailViolation {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("tool", message, details);
		this.name = "ToolViolation";
	}
}

/**
 * Epistemic guardrail violation (uncertainty/honesty)
 */
export class EpistemicViolation extends GuardrailViolation {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("epistemic", message, details);
		this.name = "EpistemicViolation";
	}
}

/**
 * Style guardrail violation (output format)
 */
export class StyleViolation extends GuardrailViolation {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("style", message, details);
		this.name = "StyleViolation";
	}
}

/**
 * Audit guardrail violation (logging requirements)
 */
export class AuditViolation extends GuardrailViolation {
	constructor(message: string, details: Record<string, unknown> = {}) {
		super("audit", message, details);
		this.name = "AuditViolation";
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardrail Enforcement Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for which guardrails are enabled
 */
export interface GuardrailEnforcementConfig {
	/** Enable scope enforcement */
	scope?: boolean;
	/** Enable tool enforcement */
	tool?: boolean;
	/** Enable epistemic enforcement */
	epistemic?: boolean;
	/** Enable style enforcement */
	style?: boolean;
	/** Enable audit enforcement */
	audit?: boolean;
}

/**
 * Default enforcement config (all enabled)
 */
export const DEFAULT_ENFORCEMENT_CONFIG: GuardrailEnforcementConfig = {
	scope: true,
	tool: true,
	epistemic: true,
	style: true,
	audit: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scope Guardrail Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper function to check if an access pattern permits the requested access type.
 * Write access patterns allow both read and write.
 * Read access patterns only allow read.
 */
function isAccessPermitted(
	patternAccess: "read" | "write",
	requestedAccess: "read" | "write"
): boolean {
	return (
		patternAccess === requestedAccess ||
		(patternAccess === "write" && requestedAccess === "read")
	);
}

/**
 * Check if a file path is allowed under scope guardrails
 *
 * @throws {ScopeViolation} if access is denied
 */
export function enforceFileAccess(
	scope: G_scope | undefined,
	filePath: string,
	accessType: "read" | "write"
): void {
	if (!scope?.files) return;

	const { allow, deny } = scope.files;

	// Check deny patterns first (they take precedence)
	for (const pattern of deny) {
		if (
			minimatch(filePath, pattern.path) &&
			isAccessPermitted(pattern.access, accessType)
		) {
			throw new ScopeViolation(
				`File access denied: ${accessType} access to "${filePath}" is prohibited`,
				{
					filePath,
					accessType,
					deniedPattern: pattern.path,
				}
			);
		}
	}

	// If allow list exists and is not empty, check if path matches
	if (allow.length > 0) {
		const allowed = allow.some(
			(pattern) =>
				minimatch(filePath, pattern.path) &&
				isAccessPermitted(pattern.access, accessType)
		);

		if (!allowed) {
			throw new ScopeViolation(
				`File access denied: ${accessType} access to "${filePath}" not in allow list`,
				{
					filePath,
					accessType,
					allowedPatterns: allow.map((p) => p.path),
				}
			);
		}
	}
}

/**
 * Check if network access is allowed under scope guardrails
 *
 * @throws {ScopeViolation} if access is denied
 */
export function enforceNetworkAccess(
	scope: G_scope | undefined,
	host: string
): void {
	if (!scope?.network) return;

	const { allow, deny } = scope.network;

	// Check deny patterns first
	for (const pattern of deny) {
		if (minimatch(host, pattern)) {
			throw new ScopeViolation(
				`Network access denied: connection to "${host}" is prohibited`,
				{
					host,
					deniedPattern: pattern,
				}
			);
		}
	}

	// If allow list exists and is not empty, check if host matches
	if (allow.length > 0) {
		const allowed = allow.some((pattern) => minimatch(host, pattern));

		if (!allowed) {
			throw new ScopeViolation(
				`Network access denied: connection to "${host}" not in allow list`,
				{
					host,
					allowedPatterns: allow,
				}
			);
		}
	}
}

/**
 * Check if environment variable access is allowed under scope guardrails
 *
 * @throws {ScopeViolation} if access is denied
 */
export function enforceEnvAccess(
	scope: G_scope | undefined,
	envVar: string
): void {
	if (!scope?.env) return;

	const { allow, deny } = scope.env;

	// Check deny patterns first
	for (const pattern of deny) {
		if (minimatch(envVar, pattern)) {
			throw new ScopeViolation(
				`Environment variable access denied: "${envVar}" is prohibited`,
				{
					envVar,
					deniedPattern: pattern,
				}
			);
		}
	}

	// If allow list exists and is not empty, check if envVar matches
	if (allow.length > 0) {
		const allowed = allow.some((pattern) => minimatch(envVar, pattern));

		if (!allowed) {
			throw new ScopeViolation(
				`Environment variable access denied: "${envVar}" not in allow list`,
				{
					envVar,
					allowedPatterns: allow,
				}
			);
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Guardrail Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool invocation tracker for rate limiting
 */
class ToolInvocationTracker {
	private invocations = new Map<string, number>();

	recordInvocation(toolName: string): void {
		const count = this.invocations.get(toolName) || 0;
		this.invocations.set(toolName, count + 1);
	}

	getInvocationCount(toolName: string): number {
		return this.invocations.get(toolName) || 0;
	}

	reset(): void {
		this.invocations.clear();
	}
}

const toolTracker = new ToolInvocationTracker();

/**
 * Check if a tool invocation is allowed under tool guardrails
 *
 * @throws {ToolViolation} if invocation is denied
 */
export function enforceToolInvocation(
	tool: G_tool | undefined,
	toolName: string,
	args: string[] = [],
	logger: GuardrailLogger = defaultGuardrailLogger
): void {
	if (!tool) return;

	const { allow, deny, requireConfirmation } = tool;

	// Check deny list first
	for (const constraint of deny) {
		if (minimatch(toolName, constraint.name)) {
			// Check denied args
			const deniedArg = constraint.deniedArgs.find((arg) =>
				args.some((a) => minimatch(a, arg))
			);
			if (deniedArg) {
				throw new ToolViolation(
					`Tool invocation denied: "${toolName}" with argument "${deniedArg}" is prohibited`,
					{
						toolName,
						args,
						deniedArg,
					}
				);
			}

			// If no allowed args specified, tool is completely denied
			if (constraint.allowedArgs.length === 0) {
				throw new ToolViolation(
					`Tool invocation denied: "${toolName}" is prohibited`,
					{
						toolName,
						args,
					}
				);
			}
		}
	}

	// Check allow list
	if (allow.length > 0) {
		const matchingConstraint = allow.find((constraint) =>
			minimatch(toolName, constraint.name)
		);

		if (!matchingConstraint) {
			throw new ToolViolation(
				`Tool invocation denied: "${toolName}" not in allow list`,
				{
					toolName,
					args,
					allowedTools: allow.map((c) => c.name),
				}
			);
		}

		// Check allowed args
		if (matchingConstraint.allowedArgs.length > 0 && args.length > 0) {
			const allArgsAllowed = args.every((arg) =>
				matchingConstraint.allowedArgs.some((pattern) =>
					minimatch(arg, pattern)
				)
			);

			if (!allArgsAllowed) {
				throw new ToolViolation(
					`Tool invocation denied: "${toolName}" with disallowed arguments`,
					{
						toolName,
						args,
						allowedArgs: matchingConstraint.allowedArgs,
					}
				);
			}
		}

		// Check invocation limits
		if (matchingConstraint.maxInvocations !== undefined) {
			const currentCount = toolTracker.getInvocationCount(toolName);
			if (currentCount >= matchingConstraint.maxInvocations) {
				throw new ToolViolation(
					`Tool invocation limit exceeded: "${toolName}" (${currentCount}/${matchingConstraint.maxInvocations})`,
					{
						toolName,
						currentCount,
						limit: matchingConstraint.maxInvocations,
					}
				);
			}
		}
	}

	// Check if confirmation required (warning, not blocking)
	const fullCommand = `${toolName} ${args.join(" ")}`;
	const needsConfirmation = requireConfirmation.some((pattern) =>
		minimatch(fullCommand, pattern)
	);

	if (needsConfirmation) {
		logger.warn(
			`[GUARDRAIL] Tool "${fullCommand}" requires confirmation before execution`,
			{ toolName, args, fullCommand }
		);
	}

	// Record successful invocation
	toolTracker.recordInvocation(toolName);
}

/**
 * Reset tool invocation tracker (for testing)
 */
export function resetToolTracker(): void {
	toolTracker.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Epistemic Guardrail Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if uncertainty level requires escalation
 *
 * @throws {EpistemicViolation} if uncertainty threshold exceeded
 */
export function enforceUncertaintyThreshold(
	epist: G_epist | undefined,
	confidenceLevel: number,
	context: string,
	logger: GuardrailLogger = defaultGuardrailLogger
): void {
	if (!epist?.uncertaintyHandling) return;

	const { level, action } = epist.uncertaintyHandling;

	if (confidenceLevel < level) {
		const message = `Uncertainty threshold exceeded: confidence ${confidenceLevel} < ${level} for "${context}"`;
		const details = {
			confidenceLevel,
			threshold: level,
			context,
			action,
		};

		switch (action) {
			case "halt":
				throw new EpistemicViolation(
					`${message} - execution halted`,
					details
				);
			case "escalate":
				throw new EpistemicViolation(
					`${message} - requires escalation`,
					details
				);
			case "warn":
				logger.warn(`[GUARDRAIL] ${message}`, details);
				break;
			case "continue":
				// No action needed
				break;
		}
	}
}

/**
 * Validate that assumptions are allowed
 *
 * @throws {EpistemicViolation} if assumption is not allowed
 */
export function enforceAllowedAssumptions(
	epist: G_epist | undefined,
	assumption: string
): void {
	if (!epist?.allowedAssumptions) return;

	const allowed = epist.allowedAssumptions.some((pattern) =>
		assumption.toLowerCase().includes(pattern.toLowerCase())
	);

	if (!allowed) {
		throw new EpistemicViolation(
			`Assumption not allowed: "${assumption}"`,
			{
				assumption,
				allowedAssumptions: epist.allowedAssumptions,
			}
		);
	}
}

/**
 * Enforce citation requirements
 *
 * @throws {EpistemicViolation} if citation is required but missing
 */
export function enforceCitationRequirement(
	epist: G_epist | undefined,
	claim: string,
	hasCitation: boolean
): void {
	if (!epist?.requireSourceCitation) return;

	if (!hasCitation) {
		throw new EpistemicViolation(
			`Source citation required for claim: "${claim}"`,
			{
				claim,
			}
		);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Style Guardrail Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforce output format requirements
 *
 * @throws {StyleViolation} if output format is incorrect
 */
export function enforceOutputFormat(
	style: G_style | undefined,
	output: string,
	expectedType?: "text" | "json" | "yaml" | "markdown" | "code"
): void {
	if (!style?.outputFormat) return;

	const { type, maxLength } = style.outputFormat;

	// Check type if expected type is provided
	if (expectedType && type !== expectedType) {
		throw new StyleViolation(
			`Output format mismatch: expected ${type}, got ${expectedType}`,
			{
				expectedType: type,
				actualType: expectedType,
			}
		);
	}

	// Check max length
	if (maxLength !== undefined && output.length > maxLength) {
		throw new StyleViolation(
			`Output exceeds maximum length: ${output.length} > ${maxLength}`,
			{
				outputLength: output.length,
				maxLength,
			}
		);
	}
}

/**
 * Enforce prohibited patterns
 *
 * @throws {StyleViolation} if prohibited pattern found
 */
export function enforceProhibitedPatterns(
	style: G_style | undefined,
	output: string
): void {
	if (!style?.prohibitedPatterns || style.prohibitedPatterns.length === 0)
		return;

	for (const pattern of style.prohibitedPatterns) {
		if (output.includes(pattern)) {
			throw new StyleViolation(
				`Prohibited pattern found in output: "${pattern}"`,
				{
					pattern,
					position: output.indexOf(pattern),
				}
			);
		}
	}
}

/**
 * Enforce required sections in output
 *
 * @throws {StyleViolation} if required section is missing
 */
export function enforceRequiredSections(
	style: G_style | undefined,
	output: string,
	sections: string[]
): void {
	if (!style?.requiredSections || style.requiredSections.length === 0) return;

	const missingSections = style.requiredSections.filter(
		(required) => !sections.includes(required)
	);

	if (missingSections.length > 0) {
		throw new StyleViolation(
			`Missing required sections: ${missingSections.join(", ")}`,
			{
				missingSections,
				requiredSections: style.requiredSections,
				providedSections: sections,
			}
		);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Guardrail Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforce minimum log level
 */
export function enforceLogLevel(
	audit: G_audit | undefined,
	logLevel: "debug" | "info" | "warn" | "error",
	minimumLevel?: "debug" | "info" | "warn" | "error"
): void {
	if (!audit) return;

	const requiredLevel = minimumLevel ?? audit.logLevel;
	const levels = ["debug", "info", "warn", "error"];
	const requiredIndex = levels.indexOf(requiredLevel);
	const providedIndex = levels.indexOf(logLevel);

	if (providedIndex < requiredIndex) {
		throw new AuditViolation(
			`Log level too low: ${logLevel} < ${requiredLevel}`,
			{
				providedLevel: logLevel,
				requiredLevel,
			}
		);
	}
}

/**
 * Enforce frame requirements
 *
 * @throws {AuditViolation} if required frame fields are missing
 */
export function enforceFrameRequirements(
	audit: G_audit | undefined,
	trigger: "on-start" | "on-complete" | "on-error" | "on-milestone" | "periodic",
	providedFields: string[]
): void {
	if (!audit?.frames || audit.frames.length === 0) return;

	const requirement = audit.frames.find((f) => f.trigger === trigger);
	if (!requirement) return;

	const missingFields = requirement.requiredFields.filter(
		(field) => !providedFields.includes(field)
	);

	if (missingFields.length > 0) {
		throw new AuditViolation(
			`Missing required frame fields for ${trigger}: ${missingFields.join(", ")}`,
			{
				trigger,
				missingFields,
				requiredFields: requirement.requiredFields,
				providedFields,
			}
		);
	}
}

/**
 * Check if sensitive fields need redaction
 */
export function checkSensitiveFields(
	audit: G_audit | undefined,
	fieldName: string
): boolean {
	if (!audit?.sensitiveFields || audit.sensitiveFields.length === 0)
		return false;

	return audit.sensitiveFields.some((pattern) =>
		minimatch(fieldName.toLowerCase(), pattern.toLowerCase())
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guardrail enforcement context for an executor session
 */
export class GuardrailEnforcer {
	constructor(
		private profile: GuardrailProfile | undefined,
		private config: GuardrailEnforcementConfig = DEFAULT_ENFORCEMENT_CONFIG,
		private logger: GuardrailLogger = defaultGuardrailLogger
	) {}

	/**
	 * Enforce scope guardrails for file access
	 */
	enforceFileAccess(filePath: string, accessType: "read" | "write"): void {
		if (!this.config.scope || !this.profile?.scope) return;
		enforceFileAccess(this.profile.scope, filePath, accessType);
	}

	/**
	 * Enforce scope guardrails for network access
	 */
	enforceNetworkAccess(host: string): void {
		if (!this.config.scope || !this.profile?.scope) return;
		enforceNetworkAccess(this.profile.scope, host);
	}

	/**
	 * Enforce scope guardrails for environment variable access
	 */
	enforceEnvAccess(envVar: string): void {
		if (!this.config.scope || !this.profile?.scope) return;
		enforceEnvAccess(this.profile.scope, envVar);
	}

	/**
	 * Enforce tool guardrails for tool invocation
	 */
	enforceToolInvocation(toolName: string, args: string[] = []): void {
		if (!this.config.tool || !this.profile?.tool) return;
		enforceToolInvocation(this.profile.tool, toolName, args, this.logger);
	}

	/**
	 * Enforce epistemic guardrails for uncertainty
	 */
	enforceUncertaintyThreshold(
		confidenceLevel: number,
		context: string
	): void {
		if (!this.config.epistemic || !this.profile?.epist) return;
		enforceUncertaintyThreshold(
			this.profile.epist,
			confidenceLevel,
			context,
			this.logger
		);
	}

	/**
	 * Enforce epistemic guardrails for assumptions
	 */
	enforceAllowedAssumptions(assumption: string): void {
		if (!this.config.epistemic || !this.profile?.epist) return;
		enforceAllowedAssumptions(this.profile.epist, assumption);
	}

	/**
	 * Enforce epistemic guardrails for citations
	 */
	enforceCitationRequirement(claim: string, hasCitation: boolean): void {
		if (!this.config.epistemic || !this.profile?.epist) return;
		enforceCitationRequirement(this.profile.epist, claim, hasCitation);
	}

	/**
	 * Enforce style guardrails for output format
	 */
	enforceOutputFormat(
		output: string,
		expectedType?: "text" | "json" | "yaml" | "markdown" | "code"
	): void {
		if (!this.config.style || !this.profile?.style) return;
		enforceOutputFormat(this.profile.style, output, expectedType);
	}

	/**
	 * Enforce style guardrails for prohibited patterns
	 */
	enforceProhibitedPatterns(output: string): void {
		if (!this.config.style || !this.profile?.style) return;
		enforceProhibitedPatterns(this.profile.style, output);
	}

	/**
	 * Enforce style guardrails for required sections
	 */
	enforceRequiredSections(output: string, sections: string[]): void {
		if (!this.config.style || !this.profile?.style) return;
		enforceRequiredSections(this.profile.style, output, sections);
	}

	/**
	 * Enforce audit guardrails for log level
	 */
	enforceLogLevel(
		logLevel: "debug" | "info" | "warn" | "error",
		minimumLevel?: "debug" | "info" | "warn" | "error"
	): void {
		if (!this.config.audit || !this.profile?.audit) return;
		enforceLogLevel(this.profile.audit, logLevel, minimumLevel);
	}

	/**
	 * Enforce audit guardrails for frame requirements
	 */
	enforceFrameRequirements(
		trigger:
			| "on-start"
			| "on-complete"
			| "on-error"
			| "on-milestone"
			| "periodic",
		providedFields: string[]
	): void {
		if (!this.config.audit || !this.profile?.audit) return;
		enforceFrameRequirements(this.profile.audit, trigger, providedFields);
	}

	/**
	 * Check if field is sensitive and needs redaction
	 */
	isSensitiveField(fieldName: string): boolean {
		if (!this.config.audit || !this.profile?.audit) return false;
		return checkSensitiveFields(this.profile.audit, fieldName);
	}

	/**
	 * Get enforcement configuration
	 */
	getConfig(): GuardrailEnforcementConfig {
		return { ...this.config };
	}

	/**
	 * Get active profile
	 */
	getProfile(): GuardrailProfile | undefined {
		return this.profile;
	}
}

/**
 * Create a guardrail enforcer with optional configuration
 */
export function createGuardrailEnforcer(
	profile: GuardrailProfile | undefined,
	config?: GuardrailEnforcementConfig,
	logger?: GuardrailLogger
): GuardrailEnforcer {
	return new GuardrailEnforcer(
		profile,
		config ?? DEFAULT_ENFORCEMENT_CONFIG,
		logger ?? defaultGuardrailLogger
	);
}
