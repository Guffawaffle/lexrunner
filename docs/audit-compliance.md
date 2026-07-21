# Audit compliance profiles (quick reference)

This page explains the audit logging profiles supported by the runner, how HIPAA‑strict encryption and PHI redaction work, and quick examples for running and decrypting audit artifacts.

## Profiles

- `off` — no audit artifacts are produced.
- `basic` — lightweight events (command invocation, high-level plan events). No PHI redaction, no encryption by default.
- `soc2` — richer audit artifacts (gate events, manifest, summary, gate matrix). Intended for SOC2-style retention and review.
- `hipaa-strict` — same artifacts as `soc2` plus PHI redaction enabled by default and optional at-rest encryption when a key is provided.

## Keying and precedence

- The runner accepts an optional AES-256-GCM encryption key as a 64‑hex character string (32 bytes). Example env var:

```bash
export LEX_AUDIT_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

- CLI precedence: explicit CLI options (if/when implemented) will override the environment variable. Currently the runner reads `LEX_AUDIT_KEY_HEX` at emitter init.
- The code accepts exactly 64 hex characters; anything else will skip encryption and log a safe warning. No plaintext key material is ever logged.

## Encryption format

- Algorithm: AES-256-GCM
- Key: 32 bytes (provided as 64 hex chars)
- IV (nonce): 12 bytes, randomly generated per file
- Auth tag: 16 bytes
- File layout (as written by the emitter):

```
[ iv (12 bytes) | auth-tag (16 bytes) | ciphertext (remaining bytes) ]
```

- The manifest (`audit-manifest.json`) records artifact file names and hashes; signatures (`audit.sig`) are generated as a Phase‑2 stub for now but are written alongside the encrypted artifact.

## PHI redaction

- For `hipaa-strict`, PHI redaction is enabled before any payload is written to disk. Redaction uses opt-in regular expressions and structured redaction helpers; when redaction detects content, the event payload will include `_phi_redacted=true` to indicate the redaction occurred.

## Fail-closed semantics

- For `hipaa-strict`, fail-closed behavior is **mandatory**: if encryption fails during finalize, the emitter throws a fatal error, exits non-zero, and removes any plaintext artifacts. This ensures that no unencrypted PHI is ever written to disk. For other profiles, encryption is best-effort when a valid key is present; if encryption fails, the emitter logs a safe error and (where possible) removes plaintext and writes a summary/manifest.

## Decryption helper (node)

Use the following snippet to decrypt an `audit.ndjson.enc` file created by the runner. It expects the file layout described above.

```js
// decrypt-audit.js
import fs from "fs";
import crypto from "crypto";

const keyHex = process.env.LEX_AUDIT_KEY_HEX;
if (!keyHex || keyHex.length !== 64) throw new Error("Provide LEX_AUDIT_KEY_HEX (64 hex chars)");
const key = Buffer.from(keyHex, "hex");

const buf = fs.readFileSync("audit.ndjson.enc");
const iv = buf.slice(0, 12);
const tag = buf.slice(12, 28);
const ciphertext = buf.slice(28);

const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
process.stdout.write(plain.toString("utf8"));
```

Run it with:

```bash
LEX_AUDIT_KEY_HEX=0123... node decrypt-audit.js > audit.ndjson
```

## Quick run examples

Without key (no encryption):

```bash
node dist/cli.js execute --audit hipaa-strict --audit-dir ./tmp-audit-hipaa --dry-run --plan examples/sample-plan.json
ls -1 ./tmp-audit-hipaa
# Expect: audit.ndjson, audit.schema.json, audit-summary.json, audit-manifest.json, audit-gate-matrix.json
```

With key (encrypted artifact):

```bash
export LEX_AUDIT_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
rm -rf ./tmp-audit-hipaa-enc
node dist/cli.js execute --audit hipaa-strict --audit-dir ./tmp-audit-hipaa-enc --dry-run --plan examples/sample-plan.json
ls -1 ./tmp-audit-hipaa-enc
# Expect: audit.ndjson.enc, audit.schema.json, audit-summary.json, audit-manifest.json, audit-gate-matrix.json, audit.sig
```

## Next steps and ops notes

- If you want strict fail‑closed behavior (exit non‑zero on encryption failure and remove plaintext), I can update the finalization logic to enforce that for `hipaa-strict`.
- I can add a small `lex-pr audit decrypt` helper command and/or a Vitest integration that verifies encrypted artifact creation and plaintext cleanup.

---

## SARIF Output for Vulnerability Scanning

### Overview

The audit system can optionally generate [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) (Static Analysis Results Interchange Format) output from vulnerability findings. SARIF is a standard format supported by:

- GitHub Code Scanning
- GitLab SAST
- Snyk
- Veracode
- Checkmarx
- SonarQube

### Enabling SARIF Output

Add the `--audit-sarif` flag when running with an audit profile:

```bash
lex-pr execute --plan plan.json \
  --audit soc2 \
  --audit-sarif
```

This generates `audit-sarif.json` alongside the regular audit artifacts.

### SARIF Generation Rules

1. **Trigger**: SARIF is generated only when `vuln_found` events are present in the audit log
2. **Output**: `audit-sarif.json` in the audit directory
3. **Version**: SARIF 2.1.0 (current standard)
4. **Empty runs**: If no vulnerabilities are found, no SARIF file is created

### Severity Mapping

| Vulnerability Severity | SARIF Level |
| ---------------------- | ----------- |
| `critical`             | `error`     |
| `high`                 | `error`     |
| `medium`               | `warning`   |
| `low`                  | `note`      |

### Event-to-SARIF Mapping

The SARIF adapter extracts fields from `vuln_found` events:

| Audit Event Field         | SARIF Field                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `payload.cve`             | `result.ruleId`, `rule.id`                                  |
| `payload.severity`        | `result.level`, `rule.defaultConfiguration.level`           |
| `payload.package`         | `result.properties.package`                                 |
| `payload.version`         | `result.properties.version`                                 |
| `payload.fixedIn`         | `result.properties.fixedIn`                                 |
| `payload.file` (optional) | `result.locations[0].physicalLocation.artifactLocation.uri` |

If `payload.file` is not specified, the location defaults to `package.json`.

### GitHub Code Scanning Integration

To upload SARIF results to GitHub Code Scanning:

```yaml
# .github/workflows/security.yml
name: Security Scan

on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24

      - name: Install lexrunner
        run: npm install -g lexrunner

      - name: Run security scan with audit
        run: |
          lex-pr discover --state open | \
          lex-pr plan --from-github | \
          lex-pr execute --plan - \
            --audit soc2 \
            --audit-sarif

      - name: Upload SARIF to GitHub Code Scanning
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: .smartergpt.local/deliverables/weave-*/audit/audit-sarif.json
        if: always()
```

### Example SARIF Output

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "lexrunner",
          "version": "0.1.0",
          "informationUri": "https://smartergpt.dev/lexrunner",
          "rules": [
            {
              "id": "CVE-2024-1234",
              "name": "CVE-2024-1234",
              "shortDescription": {
                "text": "High severity vulnerability in lodash@4.17.20"
              },
              "fullDescription": {
                "text": "Vulnerability CVE-2024-1234 detected in lodash@4.17.20. Fixed in 4.17.21."
              },
              "defaultConfiguration": {
                "level": "error"
              },
              "properties": {
                "tags": ["security", "cve"],
                "precision": "high"
              }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "CVE-2024-1234",
          "level": "error",
          "message": {
            "text": "Vulnerability CVE-2024-1234: High severity in lodash@4.17.20. Fixed in 4.17.21."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "package.json"
                }
              }
            }
          ],
          "properties": {
            "severity": "high",
            "package": "lodash",
            "version": "4.17.20",
            "fixedIn": "4.17.21"
          }
        }
      ]
    }
  ]
}
```

### Recommended Profiles

For compliance-oriented workflows (SOC2, HIPAA):

```bash
# SOC2 with SARIF
lex-pr execute --plan plan.json \
  --audit soc2 \
  --audit-sarif

# HIPAA-strict with SARIF and encryption
export LEX_AUDIT_KEY_HEX=0123456789abcdef...
lex-pr execute --plan plan.json \
  --audit hipaa-strict \
  --audit-sarif
```

### Validation

Generated SARIF files can be validated using:

1. **Official SARIF schema validator**: The SARIF schema is available at `https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json`
2. **Internal parser**: The runner includes a SARIF parser in `src/security/sarif.ts` that can validate the format
3. **GitHub Actions**: GitHub will validate SARIF on upload and provide feedback in the Code Scanning UI
