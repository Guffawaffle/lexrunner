/**
 * Audit Event Emitter
 * 
 * Core audit event streaming with context support
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuditContext, collectContext } from './context.js';
import { generateGateMatrixFile } from './gateMatrix.js';
import { getDefaultContext } from './profiles.js';

/**
 * Tool information
 */
export interface ToolInfo {
	name: string;
	version: string;
}

/**
 * Actor information
 */
export interface ActorInfo {
	type: 'user' | 'ci' | 'system';
	name?: string;
}

/**
 * Repository information
 */
export interface RepoInfo {
	remote?: string;
	branch?: string;
	commit?: string;
}

/**
 * Event envelope structure
 */
export interface EventEnvelope {
	/** Schema version */
	schema_version: string;
	/** Event type */
	event: string;
	/** Timestamp (ISO 8601) */
	ts: string;
	/** Session ID (ULID) */
	session_id?: string;
	/** Run ID (ULID) */
	run_id?: string;
	/** Tool information */
	tool?: ToolInfo;
	/** Actor information */
	actor?: ActorInfo;
	/** Repository information */
	repo?: RepoInfo;
	/** Context metadata */
	context: AuditContext;
	/** Event payload */
	payload: any;
}

/**
 * Audit emitter options
 */
export interface AuditEmitterOptions {
	/** Audit profile name */
	profile?: string;
	/** Override context types (overrides profile defaults) */
	contextTypes?: ('git' | 'ci' | 'os')[];
	/** Audit output directory */
	dir: string;
	/** Session ID */
	sessionId?: string;
	/** Run ID */
	runId?: string;
	/** Tool information */
	tool?: ToolInfo;
}

/**
 * Audit event emitter
 */
export class AuditEmitter {
	private options: AuditEmitterOptions;
	private context: AuditContext = {};
	private auditStream?: fs.WriteStream;
	private events: EventEnvelope[] = [];

	constructor(options: AuditEmitterOptions) {
		this.options = options;
	}

	/**
	 * Initialize audit emitter
	 */
	async init(): Promise<void> {
		// Collect context
		const contextTypes = this.options.contextTypes || 
			(this.options.profile ? getDefaultContext(this.options.profile) : []);
		
		if (contextTypes.length > 0) {
			this.context = await collectContext(contextTypes);
		}

		// Create audit directory if it doesn't exist
		await fs.promises.mkdir(this.options.dir, { recursive: true });

		// Open audit stream
		const auditPath = path.join(this.options.dir, 'audit.ndjson');
		this.auditStream = fs.createWriteStream(auditPath, { flags: 'a' });
	}

	/**
	 * Emit audit event
	 */
	emit(event: string, payload: any): void {
		const envelope: EventEnvelope = {
			schema_version: '0.1.0',
			event,
			ts: new Date().toISOString(),
			session_id: this.options.sessionId,
			run_id: this.options.runId,
			tool: this.options.tool,
			actor: this.detectActor(),
			repo: this.extractRepoInfo(),
			context: this.context,
			payload,
		};

		// Store event for gate matrix generation
		this.events.push(envelope);

		// Write to audit stream (NDJSON format)
		if (this.auditStream) {
			this.auditStream.write(JSON.stringify(envelope) + '\n');
		}
	}

	/**
	 * Detect actor from environment
	 */
	private detectActor(): ActorInfo {
		if (process.env.CI === 'true') {
			return {
				type: 'ci',
				name: process.env.GITHUB_ACTOR || process.env.GITLAB_USER_LOGIN || process.env.CIRCLE_USERNAME,
			};
		}
		
		return {
			type: 'user',
		};
	}

	/**
	 * Extract repository info from context
	 */
	private extractRepoInfo(): RepoInfo {
		if (this.context.git) {
			return {
				remote: this.context.git.remote,
				branch: this.context.git.branch,
				commit: this.context.git.commit,
			};
		}
		return {};
	}

	/**
	 * Finalize audit (close stream and generate gate matrix)
	 */
	async finalize(): Promise<void> {
		// Close audit stream
		if (this.auditStream) {
			this.auditStream.end();
			await new Promise<void>((resolve) => {
				this.auditStream!.once('finish', () => resolve());
			});
		}

		// Generate gate matrix for soc2 and hipaa-strict profiles
		if (this.options.profile === 'soc2' || this.options.profile === 'hipaa-strict') {
			const auditPath = path.join(this.options.dir, 'audit.ndjson');
			const matrixPath = path.join(this.options.dir, 'audit-gate-matrix.json');
			
			try {
				await generateGateMatrixFile(auditPath, matrixPath);
			} catch (error) {
				// Gate matrix generation is optional, don't fail if it errors
				console.error('Failed to generate gate matrix:', error);
			}
		}
	}

	/**
	 * Get all emitted events
	 */
	getEvents(): EventEnvelope[] {
		return [...this.events];
	}
}

/**
 * Initialize audit emitter with options
 */
export async function initAuditEmitter(options: AuditEmitterOptions): Promise<AuditEmitter> {
	const emitter = new AuditEmitter(options);
	await emitter.init();
	return emitter;
}

/**
 * Finalize audit emitter (close streams, generate reports)
 */
export async function finalizeAudit(emitter: AuditEmitter): Promise<void> {
	await emitter.finalize();
}
