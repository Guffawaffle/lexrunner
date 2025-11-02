# Audit Outputs - Phase 1: Core Foundation

This document covers **Phase 1** of the audit outputs system: NDJSON emitter, envelope structure, basic events, manifest, and summary. This provides the foundation for tamper-evident audit trails supporting SOC 2 and HIPAA 164.312(b) compliance.

## Overview

The audit system emits deterministic, machine-readable evidence of tool activity with:

- **Minimal metadata** by default (no code bodies, no secrets)
- **Profile-based configuration** (basic, soc2, hipaa-strict)
- **NDJSON event streams** with consistent envelope structure
- **Session manifests** with file hashes and integrity tracking
- **Extensible foundation** for signatures (Phase 2) and advanced features (Phase 3)

## Quick Start

### Enable Basic Audit Logging

```bash
# Execute plan with basic audit logging
lex-pr execute plan.json --audit basic

# Output appears in:
# .smartergpt.local/deliverables/weave-{timestamp}/audit/
#   ├── audit.ndjson          # All events
#   ├── audit-manifest.json   # File inventory with SHA-256 hashes
#   └── audit-summary.json    # Stats: events, durations, status
```

### Enable SOC 2 Compliance Mode

```bash
# SOC 2 profile includes git/ci/os context and gate matrix
lex-pr execute plan.json --audit soc2

# Additional outputs:
#   ├── audit-gate-matrix.json  # Pass/fail matrix for all gates
#   └── audit.sig               # Signature stub (Phase 2)
```

### Enable HIPAA Strict Mode

```bash
# HIPAA profile requires encryption key and enables PHI redaction
export LEX_AUDIT_KEY_HEX="0123...cdef"  # 64 hex chars (32 bytes)
lex-pr execute plan.json --audit hipaa-strict

# Features:
# - Paths are hashed (PII protection)
# - At-rest encryption (AES-256-GCM)
# - Strict redaction patterns
# - Output: audit.ndjson.enc (plaintext removed)
```

## Audit Profiles

### Profile Comparison

| Feature | off | basic | soc2 | hipaa-strict |
|---------|-----|-------|------|--------------|
| Event stream | ❌ | ✅ | ✅ | ✅ |
| Context (git/ci/os) | ❌ | ❌ | ✅ | ✅ |
| Gate matrix | ❌ | ❌ | ✅ | ✅ |
| Path hashing | ❌ | ❌ | ❌ | ✅ |
| PHI redaction | ❌ | ❌ | ❌ | ✅ |
| Encryption | ❌ | Optional | Optional | **Required** |
| Signature | ❌ | ❌ | Stub | Stub |
| Retention | N/A | 365 days | 730 days | 2190 days (6 years, per HIPAA 45 CFR 164.316) |

### Profile Details

#### `off` (Default)

No audit logging. Use for local development or when compliance is not required.

#### `basic`

Minimal audit logging for operational visibility:

- Events: command invocation, plan validation, gate execution, merge operations
- No context (git/ci/os)
- No gate matrix
- Default redaction: `token|secret|pass|key|auth`
- Retention: 365 days (recommendation)

**Use cases:**
- Operational troubleshooting
- Non-compliance environments
- Development/staging

#### `soc2`

Comprehensive audit logging for SOC 2 Type II compliance:

- All basic profile features
- Context: git (commit, branch, remote), ci (actor, workflow), os (platform, arch)
- Gate matrix: pass/fail status for all gates across all PRs
- Artifact references (Phase 2)
- Job IDs for CI correlation
- Signature stub (Phase 2 implementation)
- Retention: 730 days (2 years)

**Use cases:**
- SOC 2 Type II audits
- Security compliance reporting
- Change management audits

#### `hipaa-strict`

Maximum protection for HIPAA 164.312(b) compliance:

- All SOC 2 profile features
- Path hashing: All file paths are SHA-256 hashed
- PHI redaction: Automatic detection and redaction of PHI patterns (SSN, DOB, medical terms)
- Strict redaction: Extended patterns including `ssn|ein|dob`
- **Encryption required**: AES-256-GCM with 32-byte key
- Fail-closed: Invalid key causes immediate abort and plaintext scrubbing
- Retention: 2190 days (6 years, per HIPAA 45 CFR 164.316)

**Use cases:**
- HIPAA-regulated environments
- Healthcare data processing
- Maximum security posture

## Event Schema

### Envelope Structure

Every event is wrapped in a consistent envelope:

```json
{
  "schema_version": "0.1.0",
  "event": "gate_finished",
  "ts": "2025-11-02T14:30:28Z",
  "level": "info",
  "session_id": "01JB123456789",
  "run_id": "01JB987654321",
  "tool": {
    "name": "lex-pr-runner",
    "version": "0.1.0"
  },
  "actor": {
    "type": "cli"
  },
  "repo": {
    "remote": "https://github.com/org/repo",
    "branch": "main",
    "commit": "abc123def456"
  },
  "context": {
    "git": { "commit": "abc123", "branch": "main" },
    "ci": { "actor": "github-actions", "workflow": "CI" },
    "os": { "platform": "linux", "arch": "x64" }
  },
  "payload": {
    "item": "166",
    "gate": "lint",
    "exit_code": 0,
    "duration_ms": 6200,
    "status": "pass"
  }
}
```

### Required Envelope Fields

- `schema_version`: Event schema version (semver)
- `event`: Event type (see Event Types below)
- `ts`: ISO 8601 timestamp (UTC)
- `level`: `info`, `warn`, or `error`
- `session_id`: ULID for this execution session
- `run_id`: ULID for this specific run
- `tool`: Tool name and version
- `actor`: Actor type (`cli`, `mcp`, `ci`)
- `repo`: Repository context (remote, branch, commit)
- `context`: Optional context blocks (git, ci, os)
- `payload`: Event-specific data

### Event Types

#### Core Events

| Event | Description | Payload Fields |
|-------|-------------|----------------|
| `command_invocation` | CLI command executed | `argv`, `cwd` |
| `plan_discovered` | Plan loaded and parsed | `pr_ids`, `base`, `head`, `plan_hash` |
| `plan_validated` | Plan schema validated | `schema_version`, `warnings[]` |
| `merge_order_computed` | Dependency order computed | `levels`, `items_per_level[]` |

#### Gate Events

| Event | Description | Payload Fields |
|-------|-------------|----------------|
| `gate_started` | Gate execution started | `item`, `gate` |
| `gate_finished` | Gate execution completed | `item`, `gate`, `duration_ms`, `status`, `exit_code`, `artifact_refs[]` |

**Status values:** `pass`, `fail`, `skip`, `blocked`

#### Merge Events

| Event | Description | Payload Fields |
|-------|-------------|----------------|
| `merge_dry_run_started` | Dry run merge started | `item`, `base`, `head` |
| `merge_dry_run_finished` | Dry run completed | `item`, `status`, `conflicts[]` |
| `merge_execute_started` | Real merge started | `item`, `base`, `head` |
| `merge_conflict_detected` | Conflict found during merge | `item`, `files[]` |
| `merge_finished` | Merge completed | `item`, `status`, `commit` |

#### Artifact & Summary Events

| Event | Description | Payload Fields |
|-------|-------------|----------------|
| `artifact_written` | Output artifact created | `path`, `sha256`, `bytes` |
| `error` | Error occurred | `code`, `message`, `where` |
| `run_summary` | Execution summary | `totals`, `pass_fail_matrix`, `final_status` |

## Output Files

### Directory Structure

```
.smartergpt.local/deliverables/weave-2025-11-02-143022/audit/
├── audit.ndjson              # NDJSON event stream
├── audit.schema.json         # Event envelope schema
├── audit-manifest.json       # File inventory with SHA-256 hashes
├── audit-summary.json        # Execution summary
├── audit-gate-matrix.json    # Gate pass/fail matrix (soc2, hipaa-strict)
└── audit.sig                 # Signature stub (Phase 2)
```

### `audit.ndjson`

Newline-delimited JSON event stream. Each line is a complete event envelope.

**Example:**
```json
{"schema_version":"0.1.0","event":"gate_started","ts":"2025-11-02T14:30:22Z","level":"info","session_id":"01JB123","run_id":"01JB456","tool":{"name":"lex-pr-runner","version":"0.1.0"},"actor":{"type":"cli"},"repo":{},"payload":{"item":"166","gate":"lint"}}
{"schema_version":"0.1.0","event":"gate_finished","ts":"2025-11-02T14:30:28Z","level":"info","session_id":"01JB123","run_id":"01JB456","tool":{"name":"lex-pr-runner","version":"0.1.0"},"actor":{"type":"cli"},"repo":{},"payload":{"item":"166","gate":"lint","exit_code":0,"duration_ms":6200,"status":"pass"}}
```

**Processing:**
```bash
# Extract all gate failures
cat audit.ndjson | jq 'select(.event == "gate_finished" and .payload.status == "fail")'

# Compute total duration
cat audit.ndjson | jq -s 'map(select(.event == "gate_finished") | .payload.duration_ms) | add'

# Count events by type
cat audit.ndjson | jq -s 'group_by(.event) | map({event: .[0].event, count: length})'
```

### `audit-summary.json`

High-level execution summary.

**Example:**
```json
{
  "schemaVersion": "1.0.0",
  "timestamp": "2025-11-02T14:35:00Z",
  "sessionId": "01JB123456789",
  "runId": "01JB987654321",
  "profile": "soc2",
  "totalEvents": 127,
  "eventsByType": {
    "command_invocation": 1,
    "plan_discovered": 1,
    "plan_validated": 1,
    "merge_order_computed": 1,
    "gate_started": 42,
    "gate_finished": 42,
    "merge_execute_started": 14,
    "merge_finished": 14,
    "run_summary": 1
  },
  "duration": 123456,
  "finalStatus": "success"
}
```

### `audit-manifest.json`

File inventory with SHA-256 integrity hashes.

**Example:**
```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2025-11-02T14:35:00Z",
  "sessionId": "01JB123456789",
  "files": [
    {
      "name": "audit.ndjson",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "bytes": 524288
    },
    {
      "name": "audit-summary.json",
      "sha256": "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f",
      "bytes": 1024
    }
  ],
  "totalBytes": 525312,
  "totalFiles": 2
}
```

### `audit-gate-matrix.json` (soc2, hipaa-strict)

Pass/fail matrix for all gates across all PRs.

**Example:**
```json
{
  "generated_at": "2025-11-02T14:35:00Z",
  "session_id": "01JB123456789",
  "matrix": {
    "166": {
      "lint": { "status": "pass", "duration_ms": 1234 },
      "typecheck": { "status": "pass", "duration_ms": 2345 },
      "unit": { "status": "pass", "duration_ms": 3456 }
    },
    "167": {
      "lint": { "status": "pass", "duration_ms": 1111 },
      "typecheck": { "status": "fail", "duration_ms": 2222, "error": "Type mismatch" },
      "unit": { "status": "blocked", "reason": "typecheck failed" }
    }
  },
  "summary": {
    "total_prs": 2,
    "total_gates": 6,
    "passed": 4,
    "failed": 1,
    "skipped": 0,
    "blocked": 1
  }
}
```

## CLI Flags

### Global Flags

```bash
lex-pr --audit-profile <profile> [command]
```

**Options:**
- `--audit-profile <profile>`: Audit profile (off|basic|soc2|hipaa-strict) [default: off]
- `--audit-key <hex>`: Encryption key (64 hex chars, 32 bytes) - overrides `LEX_AUDIT_KEY_HEX` env var

**Example:**
```bash
# Enable basic audit for all commands
lex-pr --audit-profile basic execute plan.json

# Enable HIPAA audit with encryption
export LEX_AUDIT_KEY_HEX="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
lex-pr --audit-profile hipaa-strict execute plan.json
```

### Command-Specific Flags

```bash
lex-pr execute plan.json --audit <profile> [options]
```

**Options:**
- `--audit <profile>`: Audit profile (off|basic|soc2|hipaa-strict) [default: off]
- `--audit-dir <path>`: Output directory [default: `<deliverables>/audit`]
- `--audit-include-env <keys>`: Comma-separated env var names to include
- `--audit-redact <regex>`: Custom redaction regex pattern
- `--audit-hash-paths`: Hash file paths (overrides profile default)
- `--audit-context <types>`: Context blocks (git,ci,os) - overrides profile default
- `--audit-sample <percent>`: Sampling percentage for noisy gates [default: 100]
- `--audit-retain-days <days>`: Retention hint in days

**Examples:**
```bash
# Basic audit to custom directory
lex-pr execute plan.json --audit basic --audit-dir /tmp/audit

# Include specific environment variables
lex-pr execute plan.json --audit soc2 --audit-include-env CI,GITHUB_ACTOR,RUNNER_OS

# Override context to only git
lex-pr execute plan.json --audit soc2 --audit-context git

# Custom redaction pattern
lex-pr execute plan.json --audit basic --audit-redact 'token|password|apikey'

# Sample 50% of gate events (for high-volume workloads)
lex-pr execute plan.json --audit basic --audit-sample 50
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LEX_AUDIT_KEY_HEX` | Encryption key (64 hex chars) | `0123...cdef` |
| `LEX_AUDIT_PHI` | Enable PHI redaction (1=on) | `1` |
| `LEX_AUDIT_DROP_DIR` | Sidecar file drop directory (auto-set) | `/tmp/lex-audit-session-{id}` |
| `LEX_AUDIT_SESSION_ID` | Session ID (auto-set) | `01JB123456789` |

## Security & Compliance

### Secret Redaction

All audit profiles apply redaction to prevent secrets from being logged.

**Default patterns (basic, soc2):**
```
token|secret|pass|key|auth
```

**Strict patterns (hipaa-strict):**
```
token|secret|pass|key|auth|api[_-]?key|bearer|credential|pwd|ssn|ein|dob
```

**Custom redaction:**
```bash
lex-pr execute plan.json --audit basic --audit-redact 'my_secret|custom_token'
```

### PHI Redaction (HIPAA)

HIPAA-strict profile automatically detects and redacts:

- Social Security Numbers (SSN)
- Date of Birth (DOB)
- Employee Identification Numbers (EIN)
- Medical record numbers
- Common PHI patterns

**Example:**
```json
// Before redaction
{"patient_id": "123-45-6789", "dob": "1990-01-01"}

// After redaction
{"patient_id": "***REDACTED***", "dob": "***REDACTED***", "_phi_redacted": true}
```

### Path Hashing (HIPAA)

HIPAA-strict profile hashes all file paths to protect PII:

**Example:**
```json
// Before hashing
{"path": "/projects/patient-data/john-doe/results.csv"}

// After hashing
{"path": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
```

### At-Rest Encryption (HIPAA)

HIPAA-strict profile requires AES-256-GCM encryption:

1. Set encryption key (32 bytes, 64 hex chars):
   ```bash
   export LEX_AUDIT_KEY_HEX="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   ```

2. Run with HIPAA profile:
   ```bash
   lex-pr execute plan.json --audit hipaa-strict
   ```

3. Output is encrypted:
   ```
   audit/
   ├── audit.ndjson.enc     # Encrypted (AES-256-GCM)
   ├── audit-summary.json   # Plaintext (no PHI)
   └── audit-manifest.json  # Plaintext (file hashes)
   ```

4. Decrypt for analysis:
   ```bash
   # Decryption script (Phase 2)
   lex-pr audit decrypt audit.ndjson.enc --key-hex $LEX_AUDIT_KEY_HEX
   ```

**Fail-closed behavior:**
- Invalid key → immediate abort, plaintext scrubbed, `audit.error.json` written
- Missing key → immediate abort, no plaintext written
- Encryption failure → immediate abort, partial files scrubbed

## Determinism

Audit outputs are deterministic for the same execution:

- **Stable event ordering**: Events are emitted in execution order
- **Canonical JSON**: Objects use sorted keys (via `canonicalJSONStringify`)
- **No random data**: Session IDs and run IDs can be overridden for testing
- **Fixed timestamps**: Use `--audit-session-id` and `--audit-run-id` for reproducible tests

**Example (testing):**
```typescript
const emitter = await initAuditEmitter({
  profile: 'basic',
  dir: '/tmp/audit',
  sessionId: 'test-session-123',
  runId: 'test-run-456',
  tool: { name: 'lex-pr-runner', version: '0.1.0' }
});
```

## Performance

Audit overhead is minimal:

- **NDJSON streaming**: Append-only writes, no buffering
- **Lazy context**: Git/CI/OS context collected once during init
- **Sampling**: Use `--audit-sample` to reduce volume for noisy gates
- **Async finalization**: Summary/manifest written after main execution

**Benchmarks:**
- Basic profile: <1% overhead
- SOC2 profile: <2% overhead
- HIPAA profile: <3% overhead (includes encryption)

## Troubleshooting

### No audit files generated

**Check:**
1. Is audit profile enabled? (not `off`)
   ```bash
   lex-pr execute plan.json --audit basic
   ```

2. Check output directory exists:
   ```bash
   ls -la .smartergpt.local/deliverables/weave-*/audit/
   ```

3. Verify permissions on deliverables directory

### HIPAA encryption fails

**Error:** `HIPAA: encryption key required and must be 64 hex chars`

**Solution:**
```bash
# Generate valid key
export LEX_AUDIT_KEY_HEX=$(openssl rand -hex 32)
echo "Key: $LEX_AUDIT_KEY_HEX" > /secure/location/audit-key.txt

# Use key
lex-pr execute plan.json --audit hipaa-strict
```

**Error:** `HIPAA: encryption failed; scrubbed plaintext and aborting`

**Solution:**
1. Check key is valid 64 hex chars
2. Ensure sufficient disk space
3. Check file permissions on audit directory

### Gate matrix not generated

**Check:**
1. Profile must be `soc2` or `hipaa-strict` (not `basic`)
2. Verify `gate_finished` events are being emitted:
   ```bash
   cat audit.ndjson | jq 'select(.event == "gate_finished")'
   ```

### Events not appearing in NDJSON

**Check:**
1. Sampling rate: `--audit-sample 100` (default)
2. Profile is not `off`
3. Finalization completed (summary exists)

## Next Steps

- **Phase 2**: Manifest signatures (KMS, GPG) - See [Phase 2 documentation](#phase-2-signatures-and-verification) below
- **Phase 3**: Schema versioning, Node SDK, SARIF export
- **Integration**: CI/CD pipelines, monitoring systems, compliance dashboards

---

# Phase 2: Signatures and Verification

This section covers Phase 2 of the audit outputs system: **Manifest Signatures** for tamper-evident audit trails using KMS and GPG.

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
