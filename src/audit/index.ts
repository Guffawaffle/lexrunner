/**
 * Audit Module - CI Context Blocks & Gate Matrix
 * 
 * Provides audit event streaming with context collection and gate matrix generation
 */

export {
	// Context types
	type GitContext,
	type CIContext,
	type OSContext,
	type AuditContext,
	// Context collection
	collectContext,
} from './context.js';

export {
	// Gate matrix types
	type GateStatus,
	type GateResult,
	type GateMatrix,
	type EventEnvelope as GateMatrixEvent,
	// Gate matrix generation
	generateGateMatrix,
	generateGateMatrixFile,
} from './gateMatrix.js';

export {
	// Profile types
	type AuditProfile,
	// Profiles
	AUDIT_PROFILES,
	getAuditProfile,
	getDefaultContext,
} from './profiles.js';

export {
	// Emitter types
	type ToolInfo,
	type ActorInfo,
	type RepoInfo,
	type EventEnvelope,
	type AuditEmitterOptions,
	// Emitter
	AuditEmitter,
	initAuditEmitter,
	finalizeAudit,
} from './emitter.js';
