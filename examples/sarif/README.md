# SARIF Adapter Examples

This directory contains examples demonstrating the SARIF adapter functionality for vulnerability scanning integration.

## Quick Start

### Basic Usage

Run a plan with audit and SARIF enabled:

```bash
lex-pr execute --plan plan.json \
  --audit soc2 \
  --audit-sarif
```

This generates `audit-sarif.json` in the audit directory if any `vuln_found` events are detected.

### With HIPAA Encryption

```bash
export LEX_AUDIT_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
lex-pr execute --plan plan.json \
  --audit hipaa-strict \
  --audit-sarif
```

## Example: Gate Emitting Vulnerabilities

Gates can use the Audit SDK to emit vulnerability findings:

```typescript
// vuln-scan-gate.ts
import { initAuditSDK } from 'lex-pr-runner/audit-sdk';

const audit = initAuditSDK('vuln-scan');

// Emit vulnerability finding
await audit.emitVuln('CVE-2024-1234', 'high', {
  package: 'lodash',
  version: '4.17.20',
  fixedIn: '4.17.21'
});

await audit.close();
```

When the plan executes with `--audit-sarif`, these findings will be converted to SARIF format.

## SARIF Output Structure

The generated `audit-sarif.json` follows SARIF 2.1.0 specification:

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "lex-pr-runner",
          "version": "0.1.0",
          "informationUri": "https://smartergpt.dev/lex-pr-runner",
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

## GitHub Actions Integration

### Complete Workflow

```yaml
name: Security Scan with SARIF Upload

on: [push, pull_request]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 20
      
      - name: Install lex-pr-runner
        run: npm install -g lex-pr-runner
      
      - name: Run security audit with SARIF
        run: |
          lex-pr discover --state open | \
          lex-pr plan --from-github | \
          lex-pr execute --plan - \
            --audit soc2 \
            --audit-sarif \
            --audit-dir ./audit
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Upload SARIF to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: audit/audit-sarif.json
        if: always()
```

## Severity Mapping

The SARIF adapter maps vulnerability severities to SARIF levels:

| Vulnerability Severity | SARIF Level | GitHub Display |
|------------------------|-------------|----------------|
| `critical`             | `error`     | High (red)     |
| `high`                 | `error`     | High (red)     |
| `medium`               | `warning`   | Medium (yellow)|
| `low`                  | `note`      | Low (gray)     |

## Supported Platforms

The generated SARIF format is compatible with:

- ✅ **GitHub Code Scanning** - Native integration
- ✅ **GitLab SAST** - Upload via GitLab API
- ✅ **Snyk** - Import SARIF reports
- ✅ **Veracode** - Upload via API
- ✅ **Checkmarx** - SARIF import
- ✅ **SonarQube** - External issues

## Best Practices

1. **Always use with audit profiles**: Enable `--audit soc2` or higher for comprehensive tracking
2. **Enable for compliance workflows**: Required for SOC2/HIPAA audits with security gates
3. **Upload to security platforms**: Integrate with GitHub Security, GitLab, or other SAST tools
4. **Review findings regularly**: Set up automated alerts for new vulnerabilities
5. **Track remediation**: Use SARIF timestamps to measure fix time

## Troubleshooting

### SARIF file not generated

**Reason**: No `vuln_found` events in audit log

**Solution**: Ensure your gates are emitting vulnerability events using the Audit SDK:

```typescript
await audit.emitVuln('CVE-2024-1234', 'high', {...});
```

### GitHub upload fails

**Reason**: Missing permissions or invalid SARIF format

**Solution**:
1. Add `security-events: write` permission to workflow
2. Validate SARIF with: `cat audit-sarif.json | jq .`
3. Check GitHub Actions logs for specific validation errors

### Empty results array

**Reason**: All vulnerabilities filtered or no vulnerabilities found

**Solution**: This is expected - SARIF will only contain actual findings

## Documentation

For complete documentation, see:
- [Audit Compliance Guide](../../docs/audit-compliance.md)
- [Audit SDK Documentation](../../docs/audit-sdk.md)
- [SARIF 2.1.0 Specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
