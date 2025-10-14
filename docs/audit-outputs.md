# Audit Outputs - Signing and Verification

This document covers Phase 2 of the audit outputs system: **Manifest Signatures** for tamper-evident audit trails using KMS and GPG.

## Overview

Audit manifest signing provides cryptographic proof that audit records haven't been tampered with after creation. The system supports two signing methods:

1. **KMS (Recommended)**: Cloud-based key management services (AWS KMS, GCP Cloud KMS, Azure Key Vault)
2. **GPG (Fallback)**: Local GPG signing for environments without cloud KMS access

## Signature Providers

### When to Use KMS

**Recommended for:**
- Production environments
- SOC 2 / HIPAA compliance requirements
- Automated CI/CD pipelines
- Organizations with existing cloud infrastructure

**Benefits:**
- Centralized key management
- Automatic key rotation
- Hardware security module (HSM) backing
- Built-in access controls and audit logs
- No secret management in CI/CD

**Supported Providers:**
- **AWS KMS**: `arn:aws:kms:REGION:ACCOUNT:key/KEY_ID`
- **GCP Cloud KMS**: `projects/PROJECT/locations/REGION/keyRings/RING/cryptoKeys/KEY`
- **Azure Key Vault**: `https://VAULT.vault.azure.net/keys/KEY/VERSION`

### When to Use GPG

**Recommended for:**
- Development and testing
- Organizations without cloud infrastructure
- Air-gapped environments
- Legacy systems

**Benefits:**
- Works offline
- No cloud dependency
- Standard PGP/GPG tooling
- Verifiable with public key

**Considerations:**
- Manual key management
- Private key must be securely stored
- Key rotation requires pipeline updates

## KMS Setup Guide

### AWS KMS

#### 1. Create Signing Key

```bash
aws kms create-key \
  --description "Audit manifest signing key" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec RSA_2048

# Note the KeyId from the output
export KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/abcd-1234..."
```

#### 2. Configure IAM Permissions

Create an IAM policy for the CI/CD role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:Verify",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/abcd-1234..."
    }
  ]
}
```

Attach to your CI/CD execution role:

```bash
aws iam put-role-policy \
  --role-name GitHubActionsRole \
  --policy-name AuditSigningPolicy \
  --policy-document file://kms-policy.json
```

#### 3. Configure Key Rotation

Enable automatic rotation (recommended every 365 days):

```bash
aws kms enable-key-rotation --key-id $KEY_ARN
```

#### 4. Sign Audit Manifest

```bash
lex-pr execute --plan plan.json \
  --audit soc2 \
  --audit-signer kms:$KEY_ARN
```

### GCP Cloud KMS

#### 1. Create Key Ring and Key

```bash
gcloud kms keyrings create audit-signing \
  --location us-central1

gcloud kms keys create manifest-sign-key \
  --location us-central1 \
  --keyring audit-signing \
  --purpose asymmetric-signing \
  --default-algorithm rsa-sign-pss-2048-sha256

export KEY_PATH="projects/my-project/locations/us-central1/keyRings/audit-signing/cryptoKeys/manifest-sign-key"
```

#### 2. Grant Permissions

```bash
gcloud kms keys add-iam-policy-binding manifest-sign-key \
  --location us-central1 \
  --keyring audit-signing \
  --member serviceAccount:ci-pipeline@my-project.iam.gserviceaccount.com \
  --role roles/cloudkms.signerVerifier
```

#### 3. Configure Service Account

Set up the service account in your CI/CD:

```bash
# In GitHub Actions
- uses: google-github-actions/auth@v1
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}
```

#### 4. Sign Audit Manifest

```bash
lex-pr execute --plan plan.json \
  --audit soc2 \
  --audit-signer kms:$KEY_PATH
```

### Azure Key Vault

#### 1. Create Key Vault and Key

```bash
az keyvault create \
  --name audit-vault \
  --resource-group my-rg \
  --location eastus

az keyvault key create \
  --vault-name audit-vault \
  --name manifest-signing-key \
  --kty RSA \
  --size 2048 \
  --ops sign verify

export KEY_URL="https://audit-vault.vault.azure.net/keys/manifest-signing-key"
```

#### 2. Grant Access

```bash
az keyvault set-policy \
  --name audit-vault \
  --object-id <service-principal-id> \
  --key-permissions sign verify
```

#### 3. Authenticate in CI/CD

```yaml
# In GitHub Actions
- uses: azure/login@v1
  with:
    creds: ${{ secrets.AZURE_CREDENTIALS }}
```

#### 4. Sign Audit Manifest

```bash
lex-pr execute --plan plan.json \
  --audit soc2 \
  --audit-signer kms:$KEY_URL
```

## GPG Setup Guide

### 1. Generate GPG Key

```bash
# Generate key (use batch mode for automation)
cat > key-params.txt <<EOF
Key-Type: RSA
Key-Length: 2048
Name-Real: Audit Signing Bot
Name-Email: audit@example.com
Expire-Date: 2y
%no-protection
%commit
EOF

gpg --batch --generate-key key-params.txt

# Get fingerprint
export GPG_FPR=$(gpg --list-keys --with-colons audit@example.com | awk -F: '/fpr:/ {print $10; exit}')
echo "Fingerprint: $GPG_FPR"
```

### 2. Export Private Key for CI/CD

```bash
# Export private key (store securely in CI secrets)
gpg --armor --export-secret-keys $GPG_FPR > private-key.asc

# Export public key (can be committed to repo)
gpg --armor --export $GPG_FPR > public-key.asc
```

### 3. Configure CI/CD Secrets

In GitHub Actions secrets, add:
- `GPG_PRIVATE_KEY`: Contents of `private-key.asc`
- `GPG_PASSPHRASE`: Passphrase (if protected)

### 4. Import Key in CI Pipeline

```yaml
# .github/workflows/merge.yml
- name: Import GPG key
  run: |
    echo "${{ secrets.GPG_PRIVATE_KEY }}" | gpg --batch --import
    gpg --list-secret-keys

- name: Sign audit manifest
  env:
    GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
  run: |
    lex-pr execute --plan plan.json \
      --audit soc2 \
      --audit-signer gpg:${{ env.GPG_FPR }}
```

### 5. Key Rotation

When rotating keys:

1. Generate new GPG key
2. Update CI/CD secrets with new private key
3. Keep old public key for verification of historical records
4. Document rotation in audit log

## Signing Behavior

### Output Files

When signing is enabled, three files are created:

1. **`audit.sig`**: Detached signature (binary for KMS, ASCII-armored for GPG)
2. **`audit.sig.meta`**: Signature metadata (JSON)
3. **`audit.pubkey.asc`**: Public key export (GPG only)

### Signature Metadata Structure

```json
{
  "provider": "kms",
  "algorithm": "RSASSA_PSS_SHA_256",
  "key_ref": "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
  "signed_at": "2025-10-13T03:30:00Z",
  "manifest_sha256": "a3f2b9c8d1e4f5a6b7c8d9e0f1a2b3c4"
}
```

### Manifest Embedding

The `audit-manifest.json` is updated with signing metadata:

```json
{
  "files": [...],
  "metadata": {...},
  "signing": {
    "provider": "kms",
    "key_ref": "arn:aws:kms:...",
    "algorithm": "RSASSA_PSS_SHA_256",
    "signature_file": "audit.sig",
    "metadata_file": "audit.sig.meta"
  }
}
```

## Verification Guide

### CLI Verification

```bash
# Verify signature
lex-pr audit verify --manifest audit-manifest.json

# Output (success):
# ✅ Signature verified
# Provider: kms
# Key: arn:aws:kms:us-east-1:123456789012:key/abcd-1234
# Algorithm: RSASSA_PSS_SHA_256
# Signed at: 2025-10-13T03:30:00Z
# Manifest SHA-256: a3f2b9c8d1e4f5a6b7c8d9e0f1a2b3c4

# JSON output
lex-pr audit verify --manifest audit-manifest.json --format json
```

### Verify in CI/CD

```yaml
- name: Verify audit signature
  run: |
    lex-pr audit verify --manifest .smartergpt.local/deliverables/weave-*/audit/audit-manifest.json
    
- name: Upload verified manifest
  uses: actions/upload-artifact@v3
  with:
    name: verified-audit-manifest
    path: .smartergpt.local/deliverables/weave-*/audit/
```

### Local Verification (GPG)

```bash
# Manual GPG verification
gpg --verify audit.sig audit-manifest.json

# Import public key first if needed
gpg --import audit.pubkey.asc
```

### SIEM Integration

Export verification results for ingestion:

```bash
# Verify and output JSON for SIEM
lex-pr audit verify --manifest audit-manifest.json --format json | \
  jq '{event: "audit_verification", timestamp: .timestamp, status: .status, provider: .result.provider, key: .result.keyInfo}'
```

Example SIEM payload:

```json
{
  "event": "audit_verification",
  "timestamp": "2025-10-13T03:30:00Z",
  "status": "verified",
  "provider": "kms",
  "key": "arn:aws:kms:us-east-1:123456789012:key/abcd-1234"
}
```

## Retention Policy

### Public Keys and Verification Data

**Recommended retention:**
- **SOC 2**: 1 year minimum
- **HIPAA**: 6 years minimum
- **Financial services**: 7 years typical

**Storage recommendations:**
1. Commit `audit.pubkey.asc` (GPG) to repository
2. Store KMS key ARNs in compliance documentation
3. Archive signatures with audit manifests
4. Maintain key rotation history

### Key Archival

When rotating keys:

```bash
# Archive old public key
mkdir -p audit/keys/archived
mv audit.pubkey.asc audit/keys/archived/audit-key-2025-01-01.asc
git add audit/keys/archived/
git commit -m "Archive audit signing key (rotated)"
```

## Security Best Practices

### KMS

1. **Enable key rotation**: Automatic yearly rotation
2. **Use separate keys**: Don't reuse encryption keys for signing
3. **Restrict permissions**: Principle of least privilege
4. **Enable CloudTrail**: Log all KMS operations
5. **Use resource tags**: Track key usage and ownership

### GPG

1. **Use strong keys**: RSA 2048+ or ECC
2. **Set expiration**: 2-year maximum
3. **Protect private keys**: Encrypt with passphrase
4. **Revoke compromised keys**: Publish revocation certificate
5. **Backup keys securely**: Use hardware security module or vault

## Troubleshooting

### KMS Signing Fails

```bash
# Check AWS credentials
aws sts get-caller-identity

# Verify key exists and permissions
aws kms describe-key --key-id $KEY_ARN
aws kms get-key-policy --key-id $KEY_ARN --policy-name default

# Test signing directly
echo "test" | aws kms sign \
  --key-id $KEY_ARN \
  --message-type RAW \
  --signing-algorithm RSASSA_PSS_SHA_256 \
  --message fileb:///dev/stdin
```

### GPG Signing Fails

```bash
# Check GPG version
gpg --version

# List available keys
gpg --list-secret-keys

# Test signing
echo "test" | gpg --clearsign --local-user $GPG_FPR
```

### Verification Fails

```bash
# Check manifest hash
sha256sum audit-manifest.json

# Verify metadata matches
cat audit.sig.meta | jq .manifest_sha256

# Check signature file exists
ls -lh audit.sig audit.sig.meta
```

## Example Workflows

### Complete Signing Workflow (AWS)

```bash
#!/bin/bash
set -e

# Configuration
PLAN_FILE="plan.json"
KMS_KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/abcd-1234"
AUDIT_LEVEL="soc2"

# Execute with signing
lex-pr execute \
  --plan "$PLAN_FILE" \
  --audit "$AUDIT_LEVEL" \
  --audit-signer "kms:$KMS_KEY_ARN"

# Verify signature
lex-pr audit verify --manifest audit-manifest.json

# Archive results
tar czf "audit-$(date +%Y%m%d-%H%M%S).tar.gz" \
  audit-manifest.json \
  audit.sig \
  audit.sig.meta

echo "Audit manifest signed and verified successfully"
```

### Complete Signing Workflow (GPG)

```bash
#!/bin/bash
set -e

# Configuration
PLAN_FILE="plan.json"
GPG_FPR="ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234"
AUDIT_LEVEL="basic"

# Import GPG key (if not already imported)
if [ -n "$GPG_PRIVATE_KEY" ]; then
  echo "$GPG_PRIVATE_KEY" | gpg --batch --import
fi

# Execute with signing
lex-pr execute \
  --plan "$PLAN_FILE" \
  --audit "$AUDIT_LEVEL" \
  --audit-signer "gpg:$GPG_FPR"

# Verify signature
lex-pr audit verify --manifest audit-manifest.json

# Archive with public key
tar czf "audit-$(date +%Y%m%d-%H%M%S).tar.gz" \
  audit-manifest.json \
  audit.sig \
  audit.sig.meta \
  audit.pubkey.asc

echo "Audit manifest signed and verified successfully"
```

## Related Documentation

- [Phase 1: Core Emitter](./audit-outputs.md) - Audit manifest generation
- [Security Implementation](./SECURITY_IMPLEMENTATION.md) - Overall security architecture
- [CI/CD Integration](./ci-cd-integration.md) - Pipeline setup examples
