/**
 * Audit subsystem - Public API
 */

export {
	AuditEmitter,
	AuditOptions,
	AuditSummary,
	initAuditEmitter,
	emitEvent,
	finalizeAudit
} from './emitter.js';

export {
	EventEnvelope,
	EventLevel,
	Tool,
	Actor,
	Repo,
	Context,
	EventType,
	EVENT_TYPES
} from './events.js';

export {
	AuditProfile,
	AuditProfileConfig,
	AUDIT_PROFILES,
	getProfileConfig,
	mergeProfileConfig,
	DEFAULT_REDACT_REGEX,
	STRICT_REDACT_REGEX
} from './profiles.js';

export {
	redactSecrets,
	redactObject,
	redactArgv,
	hashPath,
	sanitizeEnv,
	sanitizeFileContent,
	buildContext
} from './redaction.js';

export {
	AuditManifest,
	AuditManifestEntry,
	generateManifest,
	writeManifest
} from './manifest.js';

export {
	SidecarEvent,
	discoverSidecarFiles,
	readSidecarFile,
	markSidecarProcessed,
	enrichSidecarEvent,
	ingestSidecarFiles
} from './sidecar.js';
