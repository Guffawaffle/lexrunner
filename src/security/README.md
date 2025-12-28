# Security & Compliance Module

Enterprise-grade security and compliance features for production deployment in regulated environments.

## Overview

The security module provides comprehensive security controls that integrate with enterprise identity providers and compliance frameworks while maintaining the deterministic execution model.

## Features

### 1. Authentication & Authorization

**Authentication:**

- GitHub token validation
- Identity provider integration hooks
- Token lifecycle management
- Multi-method support (token, OAuth, SSO)

**Authorization (RBAC):**

- Role-based access control
- Permission-based autopilot level restrictions
- Fine-grained operation permissions
- Role hierarchy support

### 2. Audit Logging & Compliance

**Enhanced Audit Trail:**

- Digital signatures for audit entries
- Tamper detection with cryptographic hashes
- Secure audit entry storage
- Actor tracking and correlation IDs

**Compliance Reporting:**

- SOX (Sarbanes-Oxley) format
- SOC2 compliance format
- CSV export for analysis
- JSON/JSONL for programmatic access

### 3. Secrets Management

**Secure Credential Handling:**

- Environment variable integration
- Secret provider abstraction
- Automatic secret rotation detection
- Secret redaction for logs
- Cache management with expiry

### 4. Security Scanning

**Vulnerability Detection:**

- npm audit integration
- SARIF format support
- Severity-based policy enforcement
- Automated gate failure on threshold violations

### 5. Command Whitelist & Hallucination Detection

**Command Validation:**

- Whitelist enforcement for gate commands
- Shell operator blocking
- Argument validation (allow/deny lists)
- Command length restrictions
- Hallucination tracking and escalation
- Dry-run mode for testing

See [Command Whitelist Documentation](../../docs/command-whitelist.md) for details.

## Usage

- NPM audit integration
- CVE tracking
- CVSS scoring
- Policy-based blocking (critical/high/medium/low)
- Detailed vulnerability reporting

### 5. Policy Enforcement

**Compliance Policies:**

- Approval requirements
- Branch protection rules
- Merge strategy restrictions
- Force push blocking
- Review policy enforcement

## Usage

### Basic Setup

```typescript
import {
  AuthenticationManager,
  AuthorizationService,
  EnterpriseAuditService,
  SecretsManager,
  SecurityScanningService,
  CompliancePolicyService,
} from "./security";

// Initialize authentication
const authManager = new AuthenticationManager();
const authContext = await authManager.initialize();

// Setup authorization
const authService = new AuthorizationService();

// Check autopilot level permission
if (authService.canExecuteAutopilotLevel(authContext, 4)) {
  // Execute level 4 autopilot
}
```

### Authentication

```typescript
import { AuthenticationManager, GitHubTokenAuthProvider } from "./security";

// Using default provider (GitHub token from env)
const authManager = new AuthenticationManager();

// Or provide custom token
const provider = new GitHubTokenAuthProvider("ghp_...");
const authManager = new AuthenticationManager(provider);

// Initialize and get context
const context = await authManager.initialize();
console.log(`Authenticated as: ${context.user}`);
console.log(`Roles: ${context.roles.join(", ")}`);
```

### Authorization

```typescript
import { AuthorizationService, Permission } from "./security";

const authService = new AuthorizationService();

// Check specific permission
if (authService.hasPermission(context, Permission.MERGE)) {
  // User can merge
}

// Get max autopilot level
const maxLevel = authService.getMaxAutopilotLevel(context);
console.log(`User can execute up to level ${maxLevel}`);

// Enforce permission (throws if denied)
authService.enforce(context, Permission.CREATE_PR);
authService.enforceAutopilotLevel(context, 3);
```

### Audit Logging

```typescript
import { EnterpriseAuditService, ComplianceFormat } from "./security";

// Initialize with optional signing key
const auditService = new EnterpriseAuditService(process.env.AUDIT_SIGNING_KEY);

// Log secure audit entry
const entry = auditService.logSecure(
  "gate_execution",
  "passed",
  { gateType: "lint", prId: "PR-101" },
  authContext,
  correlationId
);

// Log merge operation
const mergeEntry = auditService.logMergeOperation(
  {
    prNumbers: [101, 102],
    targetBranch: "main",
    mergeStrategy: "squash",
    gateResults: { lint: "passed", test: "passed" },
    decision: "approved",
  },
  authContext
);

// Generate compliance report
const report = auditService.generateComplianceReport(
  ComplianceFormat.SOC2,
  "2024-01-01T00:00:00Z",
  "2024-12-31T23:59:59Z"
);

// Export report to file
auditService.exportReport(report, "/path/to/report.json");
```

### Secrets Management

```typescript
import { SecretsManager, secretsManager } from "./security";

// Get secret (returns null if not found)
const apiKey = await secretsManager.getSecret("API_KEY");

// Require secret (throws if not found)
const token = await secretsManager.requireSecret("GITHUB_TOKEN");

// Validate required secrets
const validation = await secretsManager.validateSecrets([
  "GITHUB_TOKEN",
  "API_KEY",
  "DATABASE_URL",
]);

if (!validation.valid) {
  console.error(`Missing secrets: ${validation.missing.join(", ")}`);
}

// Get GitHub token from standard locations
const ghToken = await secretsManager.getGitHubToken();

// Redact secrets from logs
const sanitized = secretsManager.redactSecret(logMessage, secretValue);

// Check if rotation needed
if (await secretsManager.checkRotationNeeded("API_KEY", 90)) {
  console.warn("API_KEY needs rotation (>90 days old)");
}
```

### Security Scanning

```typescript
import { SecurityScanningService, Severity } from "./security";

// Initialize with custom policy
const scanService = new SecurityScanningService({
  blockCritical: true,
  blockHigh: true,
  maxMedium: 5,
  maxLow: 10,
});

// Run all scanners
const results = await scanService.scanAll("./project-dir");

// Evaluate against policy
for (const result of results) {
  const evaluation = scanService.evaluatePolicy(result);

  if (!evaluation.passed) {
    console.error("Security scan failed!");
    evaluation.violations.forEach((v) => console.error(`- ${v}`));
  }
}

// Generate report
const report = scanService.generateReport(results);
console.log(report);
```

### Policy Enforcement

```typescript
import { CompliancePolicyService, DEFAULT_COMPLIANCE_POLICY } from "./security";

// Initialize with custom policy
const policyService = new CompliancePolicyService({
  reviewPolicy: {
    ...DEFAULT_COMPLIANCE_POLICY.reviewPolicy,
    approvalRequirement: {
      minApprovals: 2,
      requireCodeOwners: true,
      dismissStaleApprovals: true,
    },
  },
});

// Check approval policy
const prStatus = {
  prNumber: 101,
  approvals: [
    { reviewer: "alice", timestamp: new Date() },
    { reviewer: "bob", timestamp: new Date() },
  ],
  requestedReviewers: [],
  hasCodeOwnerApproval: true,
};

const approvalResult = policyService.checkApprovalPolicy(prStatus, authContext);
if (!approvalResult.allowed) {
  console.error("Approval policy violations:");
  approvalResult.violations.forEach((v) => console.error(`- ${v}`));
}

// Check branch protection
const branchResult = policyService.checkBranchProtection("main", authContext);

// Comprehensive merge check
const mergeResult = policyService.checkMergeOperation(prStatus, "main", "squash", authContext);

if (mergeResult.allowed) {
  // Proceed with merge
} else {
  // Block merge
  console.error("Merge blocked by policy");
}
```

## Roles and Permissions

### Predefined Roles

| Role             | Permissions                                 | Max Autopilot Level |
| ---------------- | ------------------------------------------- | ------------------- |
| `viewer`         | READ                                        | 0                   |
| `developer`      | READ, ARTIFACTS, ANNOTATE                   | 2                   |
| `integrator`     | READ, ARTIFACTS, ANNOTATE, CREATE_PR        | 3                   |
| `releaseManager` | READ, ARTIFACTS, ANNOTATE, CREATE_PR, MERGE | 4                   |
| `admin`          | All permissions                             | 4                   |

### Permission Types

- `READ` - View plans and reports
- `ARTIFACTS` - Generate artifacts (Level 1)
- `ANNOTATE` - Add PR comments and status (Level 2)
- `CREATE_PR` - Create integration branches and PRs (Level 3)
- `MERGE` - Execute full automation with merges (Level 4)
- `ADMIN` - Administrative access

## Compliance Formats

### SOX (Sarbanes-Oxley)

Structured audit report with:

- Operation-based grouping
- Actor tracking
- Timestamp audit trail
- Detailed metadata

### SOC2

Compliance report with:

- Access control events
- Change management events
- Security monitoring
- Audit trail documentation

### CSV

Spreadsheet-compatible format:

- Timestamp, Operation, Decision, Actor
- Correlation ID tracking
- Metadata in JSON format

### JSON/JSONL

Machine-readable formats:

- Full audit entry data
- Programmatic access
- Log aggregation support

## Environment Variables

### Authentication

- `GITHUB_TOKEN` - GitHub personal access token
- `GH_TOKEN` - Alternative GitHub token
- `GITHUB_PAT` - GitHub PAT

### Audit

- `AUDIT_SIGNING_KEY` - HMAC signing key for audit entries
- `GITHUB_ACTOR` - Actor identifier for audit trail

### Secrets (with LEX*PR* prefix)

- `LEX_PR_<SECRET_NAME>` - Secret values

## Security Best Practices

1. **Use environment variables** for sensitive credentials
2. **Enable audit signing** in production with `AUDIT_SIGNING_KEY`
3. **Configure strict policies** for protected branches
4. **Require code owner approval** for critical paths
5. **Run security scans** before merging
6. **Rotate secrets regularly** (check with `checkRotationNeeded`)
7. **Use minimum required permissions** (principle of least privilege)
8. **Review audit logs** regularly for compliance
9. **Export compliance reports** for audit purposes
10. **Validate all required secrets** before execution

## Integration with Autopilot

The security module integrates seamlessly with the autopilot system:

```typescript
import { AutopilotConfig } from "./autopilot";
import { AuthorizationService } from "./security";

// Check if user can execute requested autopilot level
const authService = new AuthorizationService();
const requestedLevel = config.maxLevel;

if (!authService.canExecuteAutopilotLevel(authContext, requestedLevel)) {
  const maxAllowed = authService.getMaxAutopilotLevel(authContext);
  throw new Error(`User cannot execute level ${requestedLevel}. Maximum allowed: ${maxAllowed}`);
}
```

## Testing

Comprehensive test coverage in `tests/security-*.spec.ts`:

```bash
# Run all security tests
npm test -- tests/security

# Run specific test file
npm test -- tests/security-authentication.spec.ts
npm test -- tests/security-authorization.spec.ts
npm test -- tests/security-compliance.spec.ts
npm test -- tests/security-secrets.spec.ts
npm test -- tests/security-policy.spec.ts
npm test -- tests/security-scanning.spec.ts
```

## CLI Usage

The security module provides CLI commands for common security operations:

### Token Rotation Checks

```bash
# Check if secrets need rotation (default 90 days)
lex-pr security check-rotation GITHUB_TOKEN

# Check multiple secrets with custom age threshold
lex-pr security check-rotation GITHUB_TOKEN API_KEY --max-age 60

# Example output:
# 🔐 Checking secret rotation status (max age: 90 days)...
# ⚠️  GITHUB_TOKEN: Needs rotation (>90 days old)
# ✓ API_KEY: Within rotation window
```

### Plan Secrets Scanning

```bash
# Scan plan file for accidentally exposed secrets
lex-pr security scan-plan plan.json

# Example output:
# 🔍 Scanning plan for exposed secrets: plan.json
# ⚠️  Found 1 potential secret(s):
# - github_token: GitHub Personal Access Token
#   Line 9, Column 18
#   Context: "token": "ghp_****...****"
# ⚠️  Please remove these secrets before committing!
```

### Secret Validation

```bash
# Validate that required secrets are present
lex-pr security validate-secrets GITHUB_TOKEN DATABASE_URL

# Example output:
# 🔐 Validating required secrets...
# ✅ All required secrets are present
#   ✓ GITHUB_TOKEN
#   ✓ DATABASE_URL
```

## API Reference

See individual module documentation:

- [Authentication](./authentication.ts) - Auth providers and token management
- [Authorization](./authorization.ts) - RBAC and permissions
- [Compliance](./compliance.ts) - Audit logging and reporting
- [Secrets](./secrets.ts) - Credential management
- [Scanning](./scanning.ts) - Vulnerability detection
- [Policy](./policy.ts) - Compliance enforcement

## Related Documentation

- [Safety Framework](../autopilot/safety/README.md) - Operational safety controls
- [Monitoring & Audit](../monitoring/README.md) - Base audit trail
- [Autopilot Levels](../../docs/autopilot-levels.md) - Automation levels
