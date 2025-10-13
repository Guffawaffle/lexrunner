/**
 * Audit module - Schema versioning and event emission
 */

export {
	CURRENT_SCHEMA_VERSION,
	SUPPORTED_MAJOR_VERSION,
	isSchemaCompatible,
	validateAuditEvent,
	migrateEvent,
	parseSchemaVersion
} from './schema.js';

export {
	AuditEmitter,
	emitEvent,
	type AuditEventEnvelope
} from './emitter.js';
