/**
 * Audit event emitter with schema validation
 */

import Ajv from 'ajv';
import { CURRENT_SCHEMA_VERSION, validateAuditEvent } from './schema.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load JSON schema
const schemaPath = path.join(__dirname, '../../schemas/audit-events.schema.json');
let auditSchema: any;
try {
	auditSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
} catch (error) {
	// Schema file not found - validation will fall back to basic validation
	console.warn(`Warning: Could not load audit schema from ${schemaPath}`);
}

// Initialize AJV validator
const ajv = new Ajv({ allErrors: true });
const validateWithSchema = auditSchema ? ajv.compile(auditSchema) : null;

/**
 * Audit event envelope structure
 */
export interface AuditEventEnvelope {
	schema_version: string;
	event: string;
	ts: string;
	level?: 'info' | 'warn' | 'error';
	session_id: string;
	run_id: string;
	tool: {
		name: string;
		version: string;
	};
	actor: {
		type: 'cli' | 'mcp' | 'ci';
		user?: string;
	};
	repo: {
		remote?: string;
		branch?: string;
		commit?: string;
	};
	context?: {
		git?: any;
		ci?: any;
		os?: any;
	};
	payload: any;
}

/**
 * Audit emitter for writing audit events
 */
export class AuditEmitter {
	private sessionId: string;
	private runId: string;
	private toolName: string;
	private toolVersion: string;
	private actorType: 'cli' | 'mcp' | 'ci';
	private outputPath?: string;
	private validateBeforeWrite: boolean;

	constructor(options: {
		sessionId: string;
		runId: string;
		toolName: string;
		toolVersion: string;
		actorType: 'cli' | 'mcp' | 'ci';
		outputPath?: string;
		validateBeforeWrite?: boolean;
	}) {
		this.sessionId = options.sessionId;
		this.runId = options.runId;
		this.toolName = options.toolName;
		this.toolVersion = options.toolVersion;
		this.actorType = options.actorType;
		this.outputPath = options.outputPath;
		this.validateBeforeWrite = options.validateBeforeWrite ?? true;
	}

	/**
	 * Build an audit event envelope
	 */
	private buildEnvelope(
		event: string,
		payload: any,
		level?: 'info' | 'warn' | 'error',
		context?: any
	): AuditEventEnvelope {
		const envelope: AuditEventEnvelope = {
			schema_version: CURRENT_SCHEMA_VERSION,
			event,
			ts: new Date().toISOString(),
			session_id: this.sessionId,
			run_id: this.runId,
			tool: {
				name: this.toolName,
				version: this.toolVersion
			},
			actor: {
				type: this.actorType,
				...(process.env.GITHUB_ACTOR && { user: process.env.GITHUB_ACTOR })
			},
			repo: {
				...(process.env.GITHUB_REPOSITORY && { remote: process.env.GITHUB_REPOSITORY }),
				...(process.env.GITHUB_REF_NAME && { branch: process.env.GITHUB_REF_NAME }),
				...(process.env.GITHUB_SHA && { commit: process.env.GITHUB_SHA })
			},
			payload,
			...(level && { level }),
			...(context && { context })
		};

		return envelope;
	}

	/**
	 * Validate event against schema
	 */
	private validate(envelope: AuditEventEnvelope): { valid: boolean; errors?: any[] } {
		// Try JSON Schema validation first if available
		if (validateWithSchema) {
			const valid = validateWithSchema(envelope);
			if (!valid && validateWithSchema.errors) {
				return {
					valid: false,
					errors: validateWithSchema.errors.map(err => ({
						path: err.instancePath || err.dataPath,
						message: err.message,
						params: err.params
					}))
				};
			}
			if (valid) {
				return { valid: true };
			}
		}

		// Fallback to basic validation
		const result = validateAuditEvent(envelope);
		if (!result.valid && result.errors) {
			return {
				valid: false,
				errors: result.errors.map(msg => ({ message: msg }))
			};
		}

		return { valid: true };
	}

	/**
	 * Emit an audit event
	 */
	async emit(
		event: string,
		payload: any,
		level?: 'info' | 'warn' | 'error',
		context?: any
	): Promise<void> {
		const envelope = this.buildEnvelope(event, payload, level, context);

		// Validate if enabled
		if (this.validateBeforeWrite) {
			const validation = this.validate(envelope);
			if (!validation.valid) {
				const errorMsg = validation.errors
					?.map(e => `${e.path ? e.path + ': ' : ''}${e.message}`)
					.join(', ');
				throw new Error(`Invalid audit event: ${errorMsg}`);
			}
		}

		// Write to output
		await this.write(envelope);
	}

	/**
	 * Write audit event to storage
	 */
	private async write(envelope: AuditEventEnvelope): Promise<void> {
		const line = JSON.stringify(envelope) + '\n';

		// Write to file if path is specified
		if (this.outputPath) {
			await fs.promises.appendFile(this.outputPath, line, 'utf-8');
		}

		// Always log to console for visibility
		console.log(`[AUDIT] ${JSON.stringify(envelope)}`);
	}
}

/**
 * Convenience function to emit an event
 */
export async function emitEvent(
	emitter: AuditEmitter,
	event: string,
	payload: any,
	level?: 'info' | 'warn' | 'error',
	context?: any
): Promise<void> {
	await emitter.emit(event, payload, level, context);
}
