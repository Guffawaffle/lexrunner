/**
 * Core audit emitter - NDJSON event stream with envelope stamping
 */

import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { EventEnvelope, EventLevel, Tool, Actor, Repo, Context } from './events.js';
import { AuditProfile, getProfileConfig, AuditProfileConfig } from './profiles.js';
import { redactObject, redactArgv, buildContext, hashPath, redactPHI } from './redaction.js';
import { generateManifest, writeManifest } from './manifest.js';
import { ingestSidecarFiles } from './sidecar.js';
import * as crypto from 'crypto';

export interface AuditOptions {
	profile: AuditProfile;
	dir: string;
	format?: 'jsonl';
	includeEnv?: string[];
	redactRegex?: string;
	hashPaths?: boolean;
	context?: ('git' | 'ci' | 'os')[];
	contextTypes?: ('git' | 'ci' | 'os')[]; // Alias for context
	signer?: string;
	retainDays?: number;
	sample?: number;
	sessionId?: string; // Optional override for testing
	runId?: string; // Optional override for testing
	tool?: { name: string; version: string }; // Optional override for testing
	// Optional HIPAA-related toggles
	phiRedaction?: boolean; // redact PHI patterns when true
	encryptionKeyHex?: string; // optional AES-256-GCM key (hex) to encrypt ndjson at finalize
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
		this.sessionId = options.sessionId || ulid();
		this.runId = options.runId || ulid();
		this.startTime = Date.now();

		// Tool info (with optional override for testing)
		this.tool = options.tool || {
			name: 'lex-pr-runner',
			version: process.env.npm_package_version || '0.1.0'
		};

		// Actor type
		this.actor = {
			type: process.env.MCP_SERVER ? 'mcp' : process.env.CI ? 'ci' : 'cli'
		};

		// Repo info
		this.repo = {};

		// Context will be built during init()
		this.context = {};

		// Sidecar drop directory
		this.dropDir = `/tmp/lex-audit-session-${this.sessionId}`;
	}

	/**
	 * Initialize emitter - create directory and files
	 */
	async init(): Promise<void> {
		// If profile is 'off', skip all initialization
		if (!this.config || this.options.profile === 'off') {
			return;
		}

		// Build context if profile requires it
		if (this.config) {
			const contextTypes = this.options.contextTypes || this.options.context || this.config.includeContext;

			// Try to collect git context if requested
			let gitInfo: { branch?: string; commit?: string; remote?: string } | undefined;
			if (contextTypes.includes('git')) {
				try {
					const { execa } = await import('execa');
					const commit = await execa('git', ['rev-parse', 'HEAD']).then(r => r.stdout).catch(() => undefined);
					const branch = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD']).then(r => r.stdout).catch(() => undefined);
					const remote = await execa('git', ['remote', 'get-url', 'origin']).then(r => r.stdout).catch(() => undefined);
					if (commit || branch || remote) {
						gitInfo = { commit, branch, remote };
					}
				} catch {
					// Git not available, context will be empty
				}
			}

			const includeEnv = this.options.includeEnv || this.config.includeEnv;
			this.context = buildContext(contextTypes, gitInfo, includeEnv);
		}

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

		// Create empty NDJSON file if it doesn't exist
		if (!fs.existsSync(this.ndjsonPath)) {
			fs.writeFileSync(this.ndjsonPath, '');
		}

		// Open NDJSON stream
		this.ndjsonStream = fs.createWriteStream(this.ndjsonPath, { flags: 'a', autoClose: true });
		// Guard against stream errors (e.g., directory removed concurrently in tests)
		this.ndjsonStream.on('error', (err) => {
			console.warn('[lex-pr] audit: ndjson stream error (ignored)', String(err));
		});

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
		if (this.options.sample !== undefined && this.options.sample < 100) {
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

		// PHI redaction (opt-in)
		if (this.options.phiRedaction) {
			try {
				const line = JSON.stringify(redactedPayload);
				const { text, flagged } = redactPHI(line, true);
				if (flagged) {
					// Mark payload to indicate PHI was detected and redacted
					if (typeof redactedPayload === 'object' && redactedPayload !== null) {
						(redactedPayload as any)._phi_redacted = true;
					}
					// Replace payload with parsed redacted text when possible
					try {
						redactedPayload = JSON.parse(text);
					} catch {
						// Keep as original redacted string in worst case
						redactedPayload = text;
					}
				}
			} catch {
				// ignore PHI redaction failures
			}
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

		// Prepare line
		let line = JSON.stringify(envelope) + '\n';
		try {
			if (this.ndjsonStream && !this.ndjsonStream.destroyed) {
				this.ndjsonStream.write(line);
			}
		} catch (e) {
			console.warn('[lex-pr] audit: ndjson write failed (ignored)', String(e));
		}

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
			try {
				await this.ingestSidecar();
			} catch (e) {
				// Don't let sidecar ingestion errors bubble and kill the test runner
				console.warn('[lex-pr] audit: sidecar ingestion error (ignored)', String(e));
			}
		}, 5000); // Every 5 seconds

		// Ensure the interval does not keep the Node event loop alive if finalize() is not called
		try {
			// Some Node timers have unref() to allow process to exit
			if (this.sidecarIngestInterval && typeof (this.sidecarIngestInterval as any).unref === 'function') {
				(this.sidecarIngestInterval as any).unref();
			}
		} catch (e) {
			// Swallow any errors here - defensive
		}
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

		try {
			await ingestSidecarFiles(this.dropDir, envelope, async (event) => {
				try {
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
				} catch (innerErr) {
					console.warn('[lex-pr] audit: error ingesting sidecar event (ignored)', String(innerErr));
				}
			});
		} catch (err) {
			// If dropDir doesn't exist or files raced away, ignore the ingestion error
			console.warn('[lex-pr] audit: ingestSidecarFiles failed (ignored)', String(err));
		}
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

		// Close NDJSON stream and wait for it to finish
		if (this.ndjsonStream) {
			const stream = this.ndjsonStream;
			await new Promise<void>((resolve, reject) => {
				stream.end((err?: Error) => {
					if (err) reject(err);
					else resolve();
				});
			});
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

		// Generate gate matrix if profile requires it (e.g., soc2)
		if (this.config.includeContext?.length > 0) {
			await this.generateGateMatrix();
		}

		// Create signature stub (Phase 2)
		if (this.config.requireSignature) {
			const sigPath = path.join(this.auditDir, 'audit.sig');
			fs.writeFileSync(sigPath, '# Signature stub - Phase 2 implementation pending\n');
		}

		// Optional at-rest encryption (opt-in via options.encryptionKeyHex)
		if (this.options.encryptionKeyHex) {
			// Debug: surface whether encryption key is present (non-sensitive length only)
			// (debug removed) do not log encryption key length or any sensitive material
			try {
				const key = Buffer.from(this.options.encryptionKeyHex, 'hex');
				if (key.length !== 32) {
					console.warn('[lex-pr] audit: encryptionKeyHex must be 64 hex chars (32 bytes) - skipping encryption');
				} else {
					const ndjsonPath = this.ndjsonPath;
					const src = fs.readFileSync(ndjsonPath);
					const iv = crypto.randomBytes(12);
					const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
					const enc = Buffer.concat([cipher.update(src), cipher.final()]);
					const tag = cipher.getAuthTag();
					const outPath = ndjsonPath + '.enc';
					fs.writeFileSync(outPath, Buffer.concat([iv, tag, enc]));
					// remove plaintext
					fs.unlinkSync(ndjsonPath);
				}
			} catch (e) {
				console.warn('[lex-pr] audit: encryption failed', e);
			}
		}
	}

	/**
	 * Generate gate matrix from audit events
	 */
	private async generateGateMatrix(): Promise<void> {
		// Read audit log
		const auditPath = path.join(this.auditDir, 'audit.ndjson');
		if (!fs.existsSync(auditPath)) {
			return;
		}

		let content: string;
		try {
			content = fs.readFileSync(auditPath, 'utf-8');
		} catch (e) {
			// File may have been removed between exists check and read; bail out
			console.warn('[lex-pr] audit: failed to read audit.ndjson (ignored)', String(e));
			return;
		}
		const lines = content.trim().split('\n').filter(l => l);

		const matrix: Record<string, Record<string, any>> = {};
		let totalPassed = 0;
		let totalFailed = 0;
		let totalSkipped = 0;
		let totalBlocked = 0;
		let totalGates = 0;

		// Process gate_finished events
		for (const line of lines) {
			const event = JSON.parse(line);
			if (event.event === 'gate_finished') {
				const { item, gate, status, duration_ms, error, reason } = event.payload;

				if (!matrix[item]) {
					matrix[item] = {};
				}

				matrix[item][gate] = {
					status,
					...(duration_ms !== undefined && { duration_ms }),
					...(error && { error }),
					...(reason && { reason })
				};

				totalGates++;
				if (status === 'pass') totalPassed++;
				else if (status === 'fail') totalFailed++;
				else if (status === 'skip') totalSkipped++;
				else if (status === 'blocked') totalBlocked++;
			}
		}

		const gateMatrix = {
			generated_at: new Date().toISOString(),
			session_id: this.sessionId,
			matrix,
			summary: {
				total_prs: Object.keys(matrix).length,
				total_gates: totalGates,
				passed: totalPassed,
				failed: totalFailed,
				skipped: totalSkipped,
				blocked: totalBlocked
			}
		};

		const matrixPath = path.join(this.auditDir, 'audit-gate-matrix.json');
		fs.writeFileSync(matrixPath, JSON.stringify(gateMatrix, null, 2));
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
