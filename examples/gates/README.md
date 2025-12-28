# Gate Examples with Audit SDK

This directory contains example gates demonstrating how to use the Audit SDK for structured audit logging.

## Examples

### Node.js Gates (TypeScript)

#### 1. Vulnerability Scanner (`vuln-scanner.ts`)

Demonstrates vulnerability scanning with audit event emission:

- Scans for vulnerabilities using npm audit
- Emits individual vulnerability findings
- Provides scan summary with severity breakdown

**Usage:**

```bash
tsx examples/gates/vuln-scanner.ts [package.json]
```

**With audit enabled:**

```bash
export LEX_AUDIT_DROP_DIR=/tmp/audit
export LEX_AUDIT_SESSION_ID=session-123
tsx examples/gates/vuln-scanner.ts
```

#### 2. Linter Gate (`lint-gate.ts`)

Demonstrates linting with audit logging:

- Runs TypeScript linter
- Emits lint violations
- Reports duration and error details

**Usage:**

```bash
tsx examples/gates/lint-gate.ts
```

#### 3. Test Runner (`test-runner.ts`)

Demonstrates test execution with audit events:

- Runs test suite
- Emits individual test results
- Reports test summary

**Usage:**

```bash
tsx examples/gates/test-runner.ts
```

### Bash Gates

#### 4. Bash Lint Gate (`lint-gate.sh`)

Demonstrates sidecar pattern in bash:

- Direct NDJSON writing
- Conditional audit (only when env vars set)
- Simple event emission

**Usage:**

```bash
chmod +x examples/gates/lint-gate.sh
./examples/gates/lint-gate.sh
```

## Running Examples

### Without Audit (Standalone)

Examples work without audit environment variables:

```bash
tsx examples/gates/vuln-scanner.ts
tsx examples/gates/lint-gate.ts
tsx examples/gates/test-runner.ts
```

### With Audit Enabled

Set up audit environment:

```bash
# Create audit drop directory
mkdir -p /tmp/audit-drop

# Set environment variables
export LEX_AUDIT_DROP_DIR=/tmp/audit-drop
export LEX_AUDIT_SESSION_ID=session-$(date +%s)

# Run gate
tsx examples/gates/vuln-scanner.ts

# Check sidecar file
ls -la /tmp/audit-drop/
cat /tmp/audit-drop/vuln.*.ndjson
```

## Expected Output

### Sidecar File Format

When audit is enabled, gates write to:

```
{LEX_AUDIT_DROP_DIR}/{gateName}.{pid}.ndjson
```

**Example content:**

```json
{"event":"scan_start","ts":"2024-10-13T12:00:00Z","level":"info","gate":"vuln","payload":{"target":"package.json","scanner":"npm-audit"}}
{"event":"vuln_found","ts":"2024-10-13T12:00:01Z","level":"warn","gate":"vuln","payload":{"cve":"CVE-2024-1234","severity":"high","package":"lodash","version":"4.17.20","fixedIn":"4.17.21"}}
{"event":"scan_complete","ts":"2024-10-13T12:00:02Z","level":"info","gate":"vuln","payload":{"total":10,"vulnerable":1,"severity_breakdown":{"critical":0,"high":1,"medium":0,"low":0}}}
```

## Testing Examples

You can test example gates with temporary audit directories:

```bash
#!/bin/bash
TEMP_AUDIT=$(mktemp -d)
export LEX_AUDIT_DROP_DIR="$TEMP_AUDIT"
export LEX_AUDIT_SESSION_ID="test-session"

# Run gate
tsx examples/gates/vuln-scanner.ts

# Inspect output
echo "Sidecar files:"
ls -la "$TEMP_AUDIT"

echo -e "\nContent:"
cat "$TEMP_AUDIT"/*.ndjson | jq '.'

# Cleanup
rm -rf "$TEMP_AUDIT"
```

## Integration with Runner

In production, the runner:

1. Sets `LEX_AUDIT_DROP_DIR` and `LEX_AUDIT_SESSION_ID`
2. Runs gates (which write sidecar files)
3. Periodically ingests sidecar files
4. Enriches with envelope (session, repo, context)
5. Appends to main `audit.ndjson`
6. Renames sidecar to `.done`

## See Also

- [Audit SDK Documentation](../../docs/audit-sdk.md)
- [API Reference](../../src/audit/sdk/types.ts)
- [Tests](../../tests/audit/sdk.spec.ts)
