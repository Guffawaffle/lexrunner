/**
 * Core audit emitter - NDJSON event stream with envelope stamping
 */

import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { EventEnvelope, EventLevel, Tool, Actor, Repo, Context } from './events.js';
import { AuditProfile, getProfileConfig, AuditProfileConfig } from './profiles.js';
import { redactObject, redactArgv, buildContext, hashPath } from './redaction.js';
import { generateManifest, writeManifest } from './manifest.js';
import { ingestSidecarFiles } from './sidecar.js';

export interface AuditOptions {
	profile: AuditProfile;
	dir: string;
	format?: 'jsonl';
	includeEnv?: string[];
	redactRegex?: string;
	hashPaths?: boolean;
	context?: ('git' | 'ci' | 'os')[];
	signer?: string;
	retainDays?: number;
	sample?: number;
}

export interface AuditSummary {
	schemaVersion: string;
	timestamp: string;
	sessionId: string;
	runId: string;
	profile: AuditProfile;
	totalEvents: number;
	eventsByType: Record<string, number>;
	duration: number;
	finalStatus: string;
}

export class AuditEmitter {
	private options: AuditOptions;
	private config: AuditProfileConfig | null;
	private auditDir: string;
	private ndjsonPath: string;
	private ndjsonStream: fs.WriteStream | null = null;
	private sessionId: string;
	private runId: string;
	private tool: Tool;
	private actor: Actor;
	private repo: Repo;
	private context?: Context;
	private eventCount = 0;
	private eventsByType: Record<string, number> = {};
	private startTime: number;
	private dropDir: string;
	private sidecarIngestInterval: NodeJS.Timeout | null = null;

	constructor(options: AuditOptions) {
		this.options = options;
		this.config = getProfileConfig(options.profile);
		this.auditDir = options.dir;
		this.ndjsonPath = path.join(this.auditDir, 'audit.ndjson');
		this.sessionId = ulid();
		this.runId = ulid();
		this.startTime = Date.now();

		// Tool info
		this.tool = {
			name: 'lex-pr-runner',
			version: process.env.npm_package_version || '0.1.0'
		};

		// Actor type
		this.actor = {
			type: process.env.MCP_SERVER ? 'mcp' : process.env.CI ? 'ci' : 'cli'
		};

		// Repo info
		this.repo = {};

		// Build context if profile requires it
		if (this.config) {
			const contextTypes = options.context || this.config.includeContext;
			const includeEnv = options.includeEnv || this.config.includeEnv;
			this.context = buildContext(contextTypes, undefined, includeEnv);
		}

		// Sidecar drop directory
		this.dropDir = `/tmp/lex-audit-session-${this.sessionId}`;
	}

	/**
	 * Initialize emitter - create directory and files
	 */
	async init(): Promise<void> {
		// Create audit directory
		if (!fs.existsSync(this.auditDir)) {
			fs.mkdirSync(this.auditDir, { recursive: true });
		}

		// Create drop directory for sidecar files
		if (!fs.existsSync(this.dropDir)) {
			fs.mkdirSync(this.dropDir, { recursive: true });
		}

		// Set environment variables for gates
		process.env.LEX_AUDIT_DROP_DIR = this.dropDir;
		process.env.LEX_AUDIT_SESSION_ID = this.sessionId;

		// Open NDJSON stream
		this.ndjsonStream = fs.createWriteStream(this.ndjsonPath, { flags: 'a' });

		// Write schema file
		const schemaPath = path.join(this.auditDir, 'audit.schema.json');
		const schema = {
			$schema: 'http://json-schema.org/draft-07/schema#',
			version: '0.1.0',
			description: 'Audit event envelope schema',
			type: 'object',
			required: ['schema_version', 'event', 'ts', 'level', 'session_id', 'run_id', 'tool', 'actor', 'repo', 'payload'],
			properties: {
				schema_version: { type: 'string' },
				event: { type: 'string' },
				ts: { type: 'string', format: 'date-time' },
				level: { type: 'string', enum: ['info', 'warn', 'error'] },
				session_id: { type: 'string' },
				run_id: { type: 'string' },
				tool: { type: 'object' },
				actor: { type: 'object' },
				repo: { type: 'object' },
				context: { type: 'object' },
				payload: { type: 'object' }
			}
		};
		fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));

		// Start periodic sidecar ingestion
		this.startSidecarIngestion();
	}

	/**
	 * Emit an audit event
	 */
	async emit(event: string, payload: any, level: EventLevel = 'info'): Promise<void> {
		if (!this.config || !this.ndjsonStream) {
			return; // Profile is 'off' or not initialized
		}

		// Apply sampling if configured
		if (this.options.sample && this.options.sample < 100) {
			if (Math.random() * 100 > this.options.sample) {
				return; // Skip this event
			}
		}

		// Redact payload if needed
		let redactedPayload = payload;
		const redactRegex = this.options.redactRegex || this.config.redactRegex;
		if (redactRegex) {
			redactedPayload = redactObject(payload, redactRegex);
		}

		// Hash paths if needed
		if (this.options.hashPaths || this.config.hashPaths) {
			if (redactedPayload.path) {
				redactedPayload.path = hashPath(redactedPayload.path);
			}
			if (redactedPayload.files && Array.isArray(redactedPayload.files)) {
				redactedPayload.files = redactedPayload.files.map((f: string) => hashPath(f));
			}
		}

		// Build envelope
		const envelope: EventEnvelope = {
			schema_version: '0.1.0',
			event,
			ts: new Date().toISOString(),
			level,
			session_id: this.sessionId,
			run_id: this.runId,
			tool: this.tool,
			actor: this.actor,
			repo: this.repo,
			context: this.context,
			payload: redactedPayload
		};

		// Write to NDJSON stream
		this.ndjsonStream.write(JSON.stringify(envelope) + '\n');

		// Track event
		this.eventCount++;
		this.eventsByType[event] = (this.eventsByType[event] || 0) + 1;
	}

	/**
	 * Set repository context
	 */
	setRepo(repo: Partial<Repo>): void {
		this.repo = { ...this.repo, ...repo };
	}

	/**
	 * Start periodic sidecar ingestion
	 */
	private startSidecarIngestion(): void {
		this.sidecarIngestInterval = setInterval(async () => {
			await this.ingestSidecar();
		}, 5000); // Every 5 seconds
	}

	/**
	 * Ingest sidecar files
	 */
	async ingestSidecar(): Promise<void> {
		if (!this.config) return;

		const envelope = {
			schema_version: '0.1.0',
			session_id: this.sessionId,
			run_id: this.runId,
			tool: this.tool,
			actor: this.actor,
			repo: this.repo,
			context: this.context
		};

		await ingestSidecarFiles(this.dropDir, envelope, async (event) => {
			// Apply redaction to ingested events
			const redactRegex = this.options.redactRegex || this.config!.redactRegex;
			if (redactRegex) {
				event.payload = redactObject(event.payload, redactRegex);
			}

			// Write to stream
			if (this.ndjsonStream) {
				this.ndjsonStream.write(JSON.stringify(event) + '\n');
				this.eventCount++;
				this.eventsByType[event.event] = (this.eventsByType[event.event] || 0) + 1;
			}
		});
	}

	/**
	 * Finalize audit - write summary and manifest
	 */
	async finalize(finalStatus: string = 'success'): Promise<void> {
		// Stop sidecar ingestion
		if (this.sidecarIngestInterval) {
			clearInterval(this.sidecarIngestInterval);
			this.sidecarIngestInterval = null;
		}

		// Final sidecar ingestion
		await this.ingestSidecar();

		// Close NDJSON stream
		if (this.ndjsonStream) {
			this.ndjsonStream.end();
			this.ndjsonStream = null;
		}

		if (!this.config) return;

		const duration = Date.now() - this.startTime;

		// Write summary
		const summary: AuditSummary = {
			schemaVersion: '1.0.0',
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
			runId: this.runId,
			profile: this.options.profile,
			totalEvents: this.eventCount,
			eventsByType: this.eventsByType,
			duration,
			finalStatus
		};

		const summaryPath = path.join(this.auditDir, 'audit-summary.json');
		fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

		// Generate and write manifest
		const manifest = await generateManifest(this.auditDir);
		await writeManifest(this.auditDir, manifest);

		// Create signature stub (Phase 2)
		if (this.config.requireSignature) {
			const sigPath = path.join(this.auditDir, 'audit.sig');
			fs.writeFileSync(sigPath, '# Signature stub - Phase 2 implementation pending\n');
		}
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string {
		return this.sessionId;
	}

	/**
	 * Get run ID
	 */
	getRunId(): string {
		return this.runId;
	}

	/**
	 * Get drop directory
	 */
	getDropDir(): string {
		return this.dropDir;
	}
}

/**
 * Initialize audit emitter
 */
export async function initAuditEmitter(options: AuditOptions): Promise<AuditEmitter> {
	const emitter = new AuditEmitter(options);
	await emitter.init();
	return emitter;
}

/**
 * Emit an audit event
 */
export async function emitEvent(
	emitter: AuditEmitter,
	event: string,
	payload: any,
	level?: EventLevel
): Promise<void> {
	await emitter.emit(event, payload, level);
}

/**
 * Finalize audit
 */
export async function finalizeAudit(emitter: AuditEmitter, finalStatus?: string): Promise<void> {
	await emitter.finalize(finalStatus);
}
