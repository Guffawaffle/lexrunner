/**
 * Security Module - Enterprise Security Features
 * 
 * Exports all security-related functionality:
 * - Authentication and authorization
 * - Audit logging and compliance
 * - Secrets management
 * - Security scanning
 * - Policy enforcement
 */

export {
	// Authentication
	AuthContext,
	AuthProvider,
	GitHubTokenAuthProvider,
	AuthenticationManager,
} from './authentication.js';

export {
	// Authorization
	Permission,
	Role,
	ROLES,
	AUTOPILOT_LEVEL_PERMISSIONS,
	AuthorizationService,
} from './authorization.js';

export {
	// Compliance & Audit
	SecureAuditEntry,
	ComplianceFormat,
	ComplianceReport,
	MergeAuditData,
	EnterpriseAuditService,
} from './compliance.js';

export {
	// Secrets Management
	SecretMetadata,
	Secret,
	SecretProvider,
	EnvironmentSecretProvider,
	SecretsManager,
	secretsManager,
	// Secrets Scanning
	SecretPattern,
	DetectedSecret,
	SECRET_PATTERNS,
	PlanSecretsScanner,
} from './secrets.js';

export {
	// Security Scanning
	Severity,
	Vulnerability,
	SecurityScanResult,
	SecurityPolicy,
	DEFAULT_SECURITY_POLICY,
	SecurityScanner,
	NpmAuditScanner,
	SecurityScanningService,
} from './scanning.js';

export {
	// Policy Enforcement
	ApprovalRequirement,
	ReviewPolicy,
	BranchProtection,
	MergeRestriction,
	CompliancePolicy,
	DEFAULT_COMPLIANCE_POLICY,
	EnforcementResult,
	PRApprovalStatus,
	CompliancePolicyService,
} from './policy.js';

export {
	// Command Validation
	CommandWhitelist,
	CommandValidationError,
	CommandValidator,
	getCommandValidator,
	resetCommandValidator,
} from './commandValidator.js';
