/**
 * Guardrail Profile Types (v0.3.0 Section 4)
 *
 * Defines the five guardrail class interfaces for constraining executor behavior.
 * These types are composable and can be combined into profiles.
 *
 * @module types/guardrails
 */

import { z, type ZodSafeParseResult } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// G_scope — Access Boundaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * File or directory access pattern.
 * Supports glob patterns for flexible matching.
 *
 * @example
 * ```typescript
 * const pattern: AccessPattern = {
 *   path: "src/**\/*.ts",
 *   access: "read"
 * };
 * ```
 */
export const AccessPatternSchema = z.object({
  /** Glob pattern for file/directory matching */
  path: z.string().min(1),
  /** Access level: read-only or read-write */
  access: z.enum(["read", "write"]),
});
export type AccessPattern = z.infer<typeof AccessPatternSchema>;

/**
 * G_scope — Scope Guardrail
 *
 * Defines what resources may be accessed by an executor.
 * Controls file system access, network access, and environment variables.
 *
 * @example
 * ```typescript
 * const scope: G_scope = {
 *   files: {
 *     allow: [{ path: "src/**", access: "read" }],
 *     deny: [{ path: "**\/.env*", access: "read" }]
 *   },
 *   network: {
 *     allow: ["api.github.com"],
 *     deny: ["*"]
 *   },
 *   env: {
 *     allow: ["NODE_ENV", "CI"],
 *     deny: ["*_SECRET", "*_TOKEN"]
 *   }
 * };
 * ```
 */
export const G_scopeSchema = z.object({
  /** File system access boundaries */
  files: z
    .object({
      /** Allowed file access patterns */
      allow: z.array(AccessPatternSchema).default([]),
      /** Denied file access patterns (takes precedence over allow) */
      deny: z.array(AccessPatternSchema).default([]),
    })
    .optional(),
  /** Network access boundaries */
  network: z
    .object({
      /** Allowed network hosts/patterns */
      allow: z.array(z.string()).default([]),
      /** Denied network hosts/patterns (takes precedence over allow) */
      deny: z.array(z.string()).default([]),
    })
    .optional(),
  /** Environment variable access boundaries */
  env: z
    .object({
      /** Allowed environment variable patterns */
      allow: z.array(z.string()).default([]),
      /** Denied environment variable patterns (takes precedence over allow) */
      deny: z.array(z.string()).default([]),
    })
    .optional(),
});
export type G_scope = z.infer<typeof G_scopeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// G_tool — Tool Invocation Boundaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool constraint definition.
 * Specifies allowed arguments and rate limits for a tool.
 *
 * @example
 * ```typescript
 * const constraint: ToolConstraint = {
 *   name: "git",
 *   allowedArgs: ["status", "diff", "log"],
 *   maxInvocations: 100
 * };
 * ```
 */
export const ToolConstraintSchema = z.object({
  /** Tool name or pattern */
  name: z.string().min(1),
  /** Allowed argument patterns (empty = all allowed) */
  allowedArgs: z.array(z.string()).default([]),
  /** Denied argument patterns */
  deniedArgs: z.array(z.string()).default([]),
  /** Maximum invocations per session (undefined = unlimited) */
  maxInvocations: z.number().int().positive().optional(),
});
export type ToolConstraint = z.infer<typeof ToolConstraintSchema>;

/**
 * G_tool — Tool Guardrail
 *
 * Defines which tools may be called and with what constraints.
 * Controls CLI tools, MCP tools, and shell commands.
 *
 * @example
 * ```typescript
 * const tool: G_tool = {
 *   allow: [
 *     { name: "npm", allowedArgs: ["run", "test", "build"] },
 *     { name: "git", allowedArgs: ["status", "diff"] }
 *   ],
 *   deny: [
 *     { name: "rm", deniedArgs: ["-rf"] },
 *     { name: "curl" }
 *   ],
 *   requireConfirmation: ["git push", "npm publish"]
 * };
 * ```
 */
export const G_toolSchema = z.object({
  /** Allowed tools with optional constraints */
  allow: z.array(ToolConstraintSchema).default([]),
  /** Denied tools (takes precedence over allow) */
  deny: z.array(ToolConstraintSchema).default([]),
  /** Tool invocations requiring user confirmation */
  requireConfirmation: z.array(z.string()).default([]),
});
export type G_tool = z.infer<typeof G_toolSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// G_epist — Epistemic Guardrail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uncertainty threshold configuration.
 * Defines when to escalate or pause based on confidence levels.
 *
 * @example
 * ```typescript
 * const threshold: UncertaintyThreshold = {
 *   level: 0.3,
 *   action: "escalate"
 * };
 * ```
 */
export const UncertaintyThresholdSchema = z.object({
  /** Confidence threshold (0-1, where 0 = no confidence, 1 = full confidence) */
  level: z.number().min(0).max(1),
  /** Action to take when confidence falls below threshold */
  action: z.enum(["continue", "warn", "escalate", "halt"]),
});
export type UncertaintyThreshold = z.infer<typeof UncertaintyThresholdSchema>;

/**
 * G_epist — Epistemic Guardrail
 *
 * Defines honesty and uncertainty handling requirements.
 * Controls how the executor should handle ambiguity and knowledge limits.
 *
 * @example
 * ```typescript
 * const epist: G_epist = {
 *   requireSourceCitation: true,
 *   uncertaintyHandling: {
 *     level: 0.5,
 *     action: "escalate"
 *   },
 *   prohibitHallucination: true,
 *   allowedAssumptions: ["standard TypeScript project structure"],
 *   requireExplicitUncertainty: true
 * };
 * ```
 */
export const G_epistSchema = z.object({
  /** Whether to require citations for factual claims */
  requireSourceCitation: z.boolean().default(false),
  /** Uncertainty threshold configuration */
  uncertaintyHandling: UncertaintyThresholdSchema.optional(),
  /** Prohibit generating content without factual basis */
  prohibitHallucination: z.boolean().default(true),
  /** Allowed assumptions the executor may make */
  allowedAssumptions: z.array(z.string()).default([]),
  /** Require explicit uncertainty markers in output */
  requireExplicitUncertainty: z.boolean().default(false),
});
export type G_epist = z.infer<typeof G_epistSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// G_style — Output Format Guardrail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output format constraint.
 *
 * @example
 * ```typescript
 * const format: OutputFormat = {
 *   type: "json",
 *   schema: "execution-plan-v1"
 * };
 * ```
 */
export const OutputFormatSchema = z.object({
  /** Output format type */
  type: z.enum(["text", "json", "yaml", "markdown", "code"]),
  /** Optional schema reference for structured output */
  schema: z.string().optional(),
  /** Maximum output length (characters) */
  maxLength: z.number().int().positive().optional(),
});
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

/**
 * G_style — Style Guardrail
 *
 * Defines output format constraints and stylistic requirements.
 * Controls formatting, language, and structural conventions.
 *
 * @example
 * ```typescript
 * const style: G_style = {
 *   outputFormat: { type: "json", schema: "gate-result" },
 *   language: "en-US",
 *   codeStyle: {
 *     indentation: "tabs",
 *     lineLength: 100,
 *     conventions: ["no-console", "prefer-const"]
 *   },
 *   prohibitedPatterns: ["TODO", "FIXME"],
 *   requiredSections: ["summary", "changes", "testing"]
 * };
 * ```
 */
export const G_styleSchema = z.object({
  /** Output format requirements */
  outputFormat: OutputFormatSchema.optional(),
  /** Language/locale for output */
  language: z.string().default("en-US"),
  /** Code style constraints */
  codeStyle: z
    .object({
      /** Indentation style */
      indentation: z.enum(["tabs", "spaces"]).optional(),
      /** Maximum line length */
      lineLength: z.number().int().positive().optional(),
      /** Style conventions to follow */
      conventions: z.array(z.string()).default([]),
    })
    .optional(),
  /** Patterns prohibited in output */
  prohibitedPatterns: z.array(z.string()).default([]),
  /** Required sections in structured output */
  requiredSections: z.array(z.string()).default([]),
});
export type G_style = z.infer<typeof G_styleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// G_audit — Audit and Logging Guardrail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frame capture requirements.
 *
 * @example
 * ```typescript
 * const frame: FrameRequirement = {
 *   trigger: "on-complete",
 *   requiredFields: ["summary_caption", "module_scope", "status_snapshot"]
 * };
 * ```
 */
export const FrameRequirementSchema = z.object({
  /** When to capture a frame */
  trigger: z.enum(["on-start", "on-complete", "on-error", "on-milestone", "periodic"]),
  /** Required fields in the frame */
  requiredFields: z.array(z.string()).default([]),
  /** Optional: interval for periodic frames (seconds) */
  intervalSeconds: z.number().int().positive().optional(),
});
export type FrameRequirement = z.infer<typeof FrameRequirementSchema>;

/**
 * G_audit — Audit Guardrail
 *
 * Defines logging and frame capture requirements.
 * Controls what must be recorded for auditability and traceability.
 *
 * @example
 * ```typescript
 * const audit: G_audit = {
 *   logLevel: "info",
 *   frames: [
 *     { trigger: "on-start", requiredFields: ["reference_point"] },
 *     { trigger: "on-complete", requiredFields: ["summary_caption", "status_snapshot"] }
 *   ],
 *   captureInputs: true,
 *   captureOutputs: true,
 *   retentionDays: 90,
 *   sensitiveFields: ["api_key", "token", "password"]
 * };
 * ```
 */
export const G_auditSchema = z.object({
  /** Minimum log level */
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Frame capture requirements */
  frames: z.array(FrameRequirementSchema).default([]),
  /** Whether to capture input data */
  captureInputs: z.boolean().default(true),
  /** Whether to capture output data */
  captureOutputs: z.boolean().default(true),
  /** Log retention period in days */
  retentionDays: z.number().int().positive().optional(),
  /** Fields to redact from logs */
  sensitiveFields: z.array(z.string()).default([]),
});
export type G_audit = z.infer<typeof G_auditSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// GuardrailProfile — Composable Profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GuardrailProfile — Composable Guardrail Configuration
 *
 * Combines all five guardrail classes into a single profile.
 * Profiles can be composed by merging multiple profiles together.
 *
 * @example
 * ```typescript
 * const profile: GuardrailProfile = {
 *   name: "senior-dev-reviewer",
 *   version: "1.0.0",
 *   description: "Guardrails for senior developer code review",
 *   scope: {
 *     files: {
 *       allow: [{ path: "src/**", access: "read" }],
 *       deny: [{ path: "**\/.env*", access: "read" }]
 *     }
 *   },
 *   tool: {
 *     allow: [{ name: "git", allowedArgs: ["diff", "log", "show"] }]
 *   },
 *   epist: {
 *     prohibitHallucination: true,
 *     requireExplicitUncertainty: true
 *   },
 *   style: {
 *     outputFormat: { type: "markdown" }
 *   },
 *   audit: {
 *     frames: [{ trigger: "on-complete", requiredFields: ["summary_caption"] }]
 *   }
 * };
 * ```
 */
export const GuardrailProfileSchema = z.object({
  /** Profile identifier */
  name: z.string().min(1),
  /** Profile version (semver) */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver format (x.y.z)"),
  /** Human-readable description */
  description: z.string().optional(),
  /** Profiles this profile extends (inheritance) */
  extends: z.array(z.string()).default([]),
  /** Scope guardrails */
  scope: G_scopeSchema.optional(),
  /** Tool guardrails */
  tool: G_toolSchema.optional(),
  /** Epistemic guardrails */
  epist: G_epistSchema.optional(),
  /** Style guardrails */
  style: G_styleSchema.optional(),
  /** Audit guardrails */
  audit: G_auditSchema.optional(),
});
export type GuardrailProfile = z.infer<typeof GuardrailProfileSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a guardrail profile.
 *
 * @param profile - The profile data to validate
 * @returns Validated GuardrailProfile
 * @throws {z.ZodError} If validation fails
 *
 * @example
 * ```typescript
 * const profile = validateGuardrailProfile({
 *   name: "test",
 *   version: "1.0.0"
 * });
 * ```
 */
export function validateGuardrailProfile(profile: unknown): GuardrailProfile {
  return GuardrailProfileSchema.parse(profile);
}

/**
 * Safely validate a guardrail profile.
 *
 * @param profile - The profile data to validate
 * @returns Validation result with success flag and data/error
 *
 * @example
 * ```typescript
 * const result = safeValidateGuardrailProfile(data);
 * if (result.success) {
 *   console.log(result.data.name);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function safeValidateGuardrailProfile(
  profile: unknown
): ZodSafeParseResult<GuardrailProfile> {
  return GuardrailProfileSchema.safeParse(profile);
}

/**
 * Validate individual guardrail types.
 */
export const validateG_scope = (data: unknown) => G_scopeSchema.parse(data);
export const validateG_tool = (data: unknown) => G_toolSchema.parse(data);
export const validateG_epist = (data: unknown) => G_epistSchema.parse(data);
export const validateG_style = (data: unknown) => G_styleSchema.parse(data);
export const validateG_audit = (data: unknown) => G_auditSchema.parse(data);
