# Secret Rotation Guide

This guide provides patterns, best practices, and recommended cadences for rotating secrets in lexrunner.

## Overview

Secret rotation is a critical security practice that limits the exposure window of compromised credentials. This guide helps teams implement effective rotation policies.

## Rotation Cadences

### Recommended Schedules

| Secret Type | Recommended Rotation | Maximum Age | Risk Level |
|-------------|---------------------|-------------|------------|
| GitHub Personal Access Tokens (PAT) | 90 days | 180 days | High |
| API Keys (External Services) | 90 days | 180 days | High |
| Database Credentials | 60 days | 120 days | Critical |
| Signing Keys (AUDIT_SIGNING_KEY) | 180 days | 365 days | Critical |
| Service Account Tokens | 90 days | 180 days | High |
| Development/Testing Secrets | 180 days | 365 days | Medium |

### Compliance Requirements

Different compliance frameworks may mandate specific rotation schedules:

- **SOX (Sarbanes-Oxley)**: 90-day rotation for production credentials
- **PCI-DSS**: 90-day rotation for payment processing systems
- **SOC 2**: Risk-based rotation (typically 90 days)
- **HIPAA**: 90-day rotation for healthcare data access
- **ISO 27001**: Risk-based rotation policy documented in ISMS

## Rotation Patterns

### Pattern 1: Automated Check + Manual Rotation

Use the built-in security CLI to detect when rotation is needed:

```bash
# Check rotation status
lex-pr security check-rotation GITHUB_TOKEN API_KEY --max-age 90

# JSON output for automation
lex-pr security check-rotation GITHUB_TOKEN --format json
```

**Exit codes:**
- `0` - All secrets within policy (no action needed)
- `1` - Findings detected (rotation needed)
- `2` - Internal error (investigate)

### Pattern 2: Pre-Flight Validation

Integrate rotation checks into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Check Secret Rotation
  run: |
    lex-pr security check-rotation GITHUB_TOKEN --max-age 90
  continue-on-error: true  # Warn but don't block
```

### Pattern 3: Scheduled Rotation Script

Use the example rotation script for automated checks:

```bash
# Run rotation check
npm run cli -- tsx scripts/rotate-secrets-example.ts

# Or use built tsx
tsx scripts/rotate-secrets-example.ts
```

## Rotation Workflow

### Step 1: Detection

```bash
# Check which secrets need rotation
lex-pr security check-rotation GITHUB_TOKEN API_KEY DATABASE_URL --max-age 90
```

### Step 2: Generate New Secret

Generate a new secret in the appropriate system:

- **GitHub PAT**: Settings → Developer settings → Personal access tokens
- **API Keys**: Service provider's dashboard
- **Database**: Database management tools or scripts

### Step 3: Update Environment

```bash
# Update environment variable
export LEX_PR_GITHUB_TOKEN="ghp_new_token_here"

# Or update in secrets vault
# vault write secret/lex-pr GITHUB_TOKEN=ghp_new_token_here
```

### Step 4: Validate New Secret

```bash
# Verify the new secret works
lex-pr security validate-secrets GITHUB_TOKEN

# Test with a safe operation
lex-pr discover --dry-run
```

### Step 5: Revoke Old Secret

Immediately revoke the old secret after validating the new one:

- **GitHub PAT**: Delete from GitHub settings
- **API Keys**: Revoke via service provider
- **Database**: Drop user or change password

### Step 6: Update Documentation

Track rotation in your security documentation:

```markdown
## Last Rotation

- GITHUB_TOKEN: 2024-01-15 (by: alice@example.com)
- API_KEY: 2024-01-20 (by: bob@example.com)
```

## Secret Storage Best Practices

### Environment Variables

```bash
# Use LEX_PR_ prefix for consistency
export LEX_PR_GITHUB_TOKEN="ghp_..."
export LEX_PR_API_KEY="key_..."
export LEX_PR_AUDIT_SIGNING_KEY="base64_key_..."
```

### Secrets Vault Integration

The `SecretsManager` supports custom providers:

```typescript
import { SecretsManager, SecretProvider } from './src/security/secrets.js';

// Implement vault provider
class VaultProvider implements SecretProvider {
  async getSecret(id: string) {
    // Fetch from vault
  }
}

const secretsManager = new SecretsManager(new VaultProvider());
```

### CI/CD Secrets

Store secrets in your CI/CD platform's secure storage:

- **GitHub Actions**: Repository Secrets
- **GitLab CI**: CI/CD Variables (Protected, Masked)
- **Jenkins**: Credentials Plugin
- **CircleCI**: Project Environment Variables

## Automation Integration

### Cron Job Example

```bash
#!/bin/bash
# /etc/cron.weekly/check-secret-rotation

cd /path/to/lexrunner
lex-pr security check-rotation GITHUB_TOKEN API_KEY --format json > /tmp/rotation-check.json

if [ $? -eq 1 ]; then
  # Send alert
  mail -s "Secret Rotation Required" team@example.com < /tmp/rotation-check.json
fi
```

### Monitoring Integration

```typescript
import { checkRotation } from './src/commands/security.js';

async function monitorRotation() {
  const result = await checkRotation(['GITHUB_TOKEN', 'API_KEY'], 90);
  
  if (result.status === 'findings') {
    // Send to monitoring system
    await sendAlert({
      severity: 'warning',
      message: `${result.findings.summary.needsRotation.length} secrets need rotation`,
      details: result.findings
    });
  }
}
```

## Emergency Rotation

### When to Rotate Immediately

Rotate secrets immediately if:

1. **Compromise suspected** - Secret may have been exposed
2. **Team member departure** - Employee with access leaves
3. **Security incident** - Breach detected in related systems
4. **Accidental exposure** - Secret committed to version control
5. **Vendor breach** - Third-party service compromised

### Emergency Rotation Checklist

- [ ] Generate new secret immediately
- [ ] Update all environments (production, staging, dev)
- [ ] Validate new secret works
- [ ] Revoke old secret
- [ ] Review audit logs for unauthorized usage
- [ ] Document incident and rotation
- [ ] Scan codebase for hardcoded secrets
- [ ] Review access logs

## Troubleshooting

### Secret Not Found

```
Error: Secret LEX_PR_GITHUB_TOKEN not found
```

**Solution:**
```bash
# Verify environment variable is set
echo $LEX_PR_GITHUB_TOKEN

# Or check available secrets
lex-pr security validate-secrets GITHUB_TOKEN
```

### Rotation Check False Positive

If rotation check reports incorrect age:

1. Check secret metadata:
   ```typescript
   const secret = await secretsManager.getSecret('GITHUB_TOKEN');
   console.log(secret.metadata);
   ```

2. Verify `lastRotated` or `createdAt` timestamp
3. Update metadata if needed (provider-specific)

### Vault Integration Issues

For vault provider errors:

```bash
# Test vault connectivity
vault status

# Verify secret path
vault read secret/lex-pr/GITHUB_TOKEN

# Check token permissions
vault token lookup
```

## Audit Trail

All rotation activities should be logged:

```typescript
import { EnterpriseAuditService } from './src/security/compliance.js';

const audit = new EnterpriseAuditService(process.env.AUDIT_SIGNING_KEY);

audit.logSecure(
  'secret_rotated',
  'completed',
  {
    secretId: 'GITHUB_TOKEN',
    rotatedBy: 'alice@example.com',
    rotatedAt: new Date().toISOString()
  },
  authContext
);
```

## Related Documentation

- [SECURITY_IMPLEMENTATION.md](../SECURITY_IMPLEMENTATION.md) - Security features overview
- [scripts/rotate-secrets-example.ts](../../scripts/rotate-secrets-example.ts) - Example rotation script
- [src/security/secrets.ts](../../src/security/secrets.ts) - SecretsManager implementation
- [src/commands/security.ts](../../src/commands/security.ts) - Security CLI commands

## Quick Reference

```bash
# Check rotation status
lex-pr security check-rotation GITHUB_TOKEN --max-age 90

# Validate secrets exist
lex-pr security validate-secrets GITHUB_TOKEN API_KEY

# JSON output (for automation)
lex-pr security check-rotation GITHUB_TOKEN --format json

# Example rotation script
tsx scripts/rotate-secrets-example.ts
```

## Support

For questions or issues:

1. Check [troubleshooting guide](../troubleshooting.md)
2. Review [security implementation docs](../SECURITY_IMPLEMENTATION.md)
3. Open an issue on GitHub
