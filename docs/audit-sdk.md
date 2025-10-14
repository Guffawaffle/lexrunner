# Audit SDK Documentation

## Overview

The Audit SDK provides a **simple Node.js interface** for gates to emit structured audit events using the sidecar pattern. This enables rich observability, compliance tracking, and debugging without modifying the runner's core architecture.

**Key Features:**
- 🎯 **Simple API** - Initialize, emit events, close
- 📝 **NDJSON Format** - Newline-delimited JSON for easy parsing
- 🔌 **Sidecar Pattern** - Decoupled from runner execution
- 🚫 **No-op Mode** - Gates work standalone without runner
- 🔒 **Type-safe** - Full TypeScript support with typed payloads

---

## Installation

The Audit SDK is included in the `lex-pr-runner` package:

```bash
# Already available if you have lex-pr-runner installed
npm install lex-pr-runner
```

Or import directly from the source:

```typescript
import { initAuditSDK } from 'lex-pr-runner/src/audit/sdk';
```

---

## Quick Start

### Basic Usage

```typescript
#!/usr/bin/env node
import { initAuditSDK } from 'lex-pr-runner/src/audit/sdk';

const audit = initAuditSDK('my-gate');

async function runGate() {
  try {
    // Emit custom events
    await audit.emit('gate_start', { version: '1.0.0' });
    
    // Your gate logic here
    const result = await executeGateLogic();
    
    await audit.emit('gate_complete', { result });
  } catch (error) {
    await audit.emit('gate_error', { 
      error: error instanceof Error ? error.message : String(error) 
    }, 'error');
    throw error;
  } finally {
    await audit.close();
  }
}

runGate();
```

### Environment Variables

The SDK requires two environment variables to be active:

- `LEX_AUDIT_DROP_DIR` - Directory where sidecar files are written
- `LEX_AUDIT_SESSION_ID` - Unique session identifier for this run

**If these are not set, the SDK operates in no-op mode** (all calls succeed but no files are written).

---

## API Reference

### `initAuditSDK(gateName: string): AuditSDK`

Initialize the Audit SDK for a gate.

**Parameters:**
- `gateName` - Identifier for this gate (used in events and file naming)

**Returns:** `AuditSDK` instance

**Example:**
```typescript
const audit = initAuditSDK('lint');
```

---

### `AuditSDK.emit(event: string, payload: any, level?: 'info' | 'warn' | 'error'): Promise<void>`

Emit a custom audit event.

**Parameters:**
- `event` - Event name (e.g., 'scan_complete', 'test_start')
- `payload` - Event data (any JSON-serializable object)
- `level` - Log level (default: 'info')

**Example:**
```typescript
await audit.emit('scan_complete', {
  total: 100,
  passed: 95,
  failed: 5
}, 'info');
```

---

### `AuditSDK.emitVuln(cve: string, severity: string, details?: object): Promise<void>`

Emit a vulnerability finding.

**Parameters:**
- `cve` - CVE identifier or vulnerability ID
- `severity` - One of 'critical', 'high', 'medium', 'low'
- `details` - Optional additional data (package, version, fixedIn, etc.)

**Example:**
```typescript
await audit.emitVuln('CVE-2024-1234', 'high', {
  package: 'lodash',
  version: '4.17.20',
  fixedIn: '4.17.21'
});
```

---

### `AuditSDK.emitTestResult(name: string, status: string, duration_ms?: number): Promise<void>`

Emit a test result.

**Parameters:**
- `name` - Test name or identifier
- `status` - One of 'pass', 'fail', 'skip'
- `duration_ms` - Optional test duration in milliseconds

**Example:**
```typescript
await audit.emitTestResult('unit-test-auth', 'pass', 123);
await audit.emitTestResult('integration-test-api', 'fail', 456);
await audit.emitTestResult('e2e-test-ui', 'skip');
```

---

### `AuditSDK.close(): Promise<void>`

Close the audit stream and flush remaining events.

**Must be called** when done emitting events to ensure all data is written.

**Example:**
```typescript
try {
  await audit.emit('event', {});
} finally {
  await audit.close();
}
```

---

## Event Catalog

### Standard Events

The SDK supports arbitrary custom events, but here are recommended standard events:

| Event | Description | Example Payload |
|-------|-------------|-----------------|
| `gate_start` | Gate execution begins | `{ version: '1.0.0' }` |
| `gate_complete` | Gate execution succeeds | `{ duration_ms: 1234 }` |
| `gate_error` | Gate execution fails | `{ error: 'message' }` |
| `scan_start` | Vulnerability scan begins | `{ target: 'package.json' }` |
| `scan_complete` | Vulnerability scan ends | `{ total: 100, vulnerable: 5 }` |
| `vuln_found` | Vulnerability detected | `{ cve: '...', severity: 'high' }` |
| `test_result` | Individual test result | `{ name: '...', status: 'pass' }` |
| `test_run_start` | Test suite begins | `{ suite: 'unit-tests' }` |
| `test_run_complete` | Test suite ends | `{ passed: 10, failed: 2 }` |
| `lint_start` | Linting begins | `{ files: 42 }` |
| `lint_complete` | Linting complete | `{ violations: 0 }` |
| `lint_violations` | Lint violations found | `{ count: 5, violations: [...] }` |

---

## Sidecar File Format

Events are written to NDJSON (newline-delimited JSON) files:

**File Path:** `{LEX_AUDIT_DROP_DIR}/{gateName}.{pid}.ndjson`

**Format:**
```json
{"event":"gate_start","ts":"2024-10-13T12:00:00Z","level":"info","gate":"lint","payload":{"version":"1.0.0"}}
{"event":"lint_complete","ts":"2024-10-13T12:00:02Z","level":"info","gate":"lint","payload":{"violations":0}}
```

**Fields:**
- `event` - Event name
- `ts` - ISO 8601 timestamp
- `level` - Log level ('info', 'warn', 'error')
- `gate` - Gate name
- `payload` - Event data

---

## Non-Node Gates

For gates written in other languages (bash, Python, Go, etc.), you can write to the sidecar contract directly:

### Bash Example

```bash
#!/bin/bash
# gates/lint-gate.sh

GATE_NAME="lint"
SIDECAR_FILE="$LEX_AUDIT_DROP_DIR/$GATE_NAME.$$.ndjson"

emit_event() {
  local event="$1"
  local payload="$2"
  local level="${3:-info}"
  local ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"event\":\"$event\",\"ts\":\"$ts\",\"level\":\"$level\",\"gate\":\"$GATE_NAME\",\"payload\":$payload}" >> "$SIDECAR_FILE"
}

# Check if audit is enabled
if [[ -n "$LEX_AUDIT_DROP_DIR" && -n "$LEX_AUDIT_SESSION_ID" ]]; then
  emit_event "lint_start" '{"files":42}'
fi

# Run linting
if npm run lint; then
  [[ -n "$SIDECAR_FILE" ]] && emit_event "lint_complete" '{"violations":0}'
  exit 0
else
  violations=$(parse_lint_output)
  [[ -n "$SIDECAR_FILE" ]] && emit_event "lint_violations" "{\"count\":$violations}"
  exit 1
fi
```

### Python Example

```python
#!/usr/bin/env python3
import os
import json
import sys
from datetime import datetime

class AuditSDK:
    def __init__(self, gate_name):
        self.gate_name = gate_name
        self.drop_dir = os.environ.get('LEX_AUDIT_DROP_DIR')
        self.session_id = os.environ.get('LEX_AUDIT_SESSION_ID')
        
        if self.drop_dir and self.session_id:
            self.sidecar_path = os.path.join(
                self.drop_dir, 
                f"{gate_name}.{os.getpid()}.ndjson"
            )
            self.file = open(self.sidecar_path, 'a')
        else:
            self.file = None
    
    def emit(self, event, payload, level='info'):
        if not self.file:
            return
        
        entry = {
            'event': event,
            'ts': datetime.utcnow().isoformat() + 'Z',
            'level': level,
            'gate': self.gate_name,
            'payload': payload
        }
        self.file.write(json.dumps(entry) + '\n')
        self.file.flush()
    
    def close(self):
        if self.file:
            self.file.close()

# Usage
audit = AuditSDK('vuln')
try:
    audit.emit('scan_start', {'target': 'requirements.txt'})
    # ... scan logic ...
    audit.emit('scan_complete', {'total': 50, 'vulnerable': 2})
finally:
    audit.close()
```

---

## Examples

### Example 1: Vulnerability Scanner

```typescript
#!/usr/bin/env node
import { initAuditSDK } from 'lex-pr-runner/src/audit/sdk';
import { execSync } from 'child_process';

const audit = initAuditSDK('vuln');

async function scanVulnerabilities(packageJsonPath: string) {
  try {
    await audit.emit('scan_start', { 
      target: packageJsonPath,
      scanner: 'npm-audit'
    });
    
    const output = execSync('npm audit --json', { encoding: 'utf-8' });
    const auditData = JSON.parse(output);
    
    // Emit each vulnerability
    for (const [id, vuln] of Object.entries(auditData.vulnerabilities)) {
      await audit.emitVuln(vuln.cves?.[0] || id, vuln.severity, {
        package: vuln.name,
        version: vuln.range,
        fixedIn: vuln.fixAvailable?.version
      });
    }
    
    await audit.emit('scan_complete', {
      total: Object.keys(auditData.vulnerabilities).length,
      vulnerable: auditData.metadata.vulnerabilities.total,
      severity_breakdown: auditData.metadata.vulnerabilities
    });
    
    process.exit(auditData.metadata.vulnerabilities.total > 0 ? 1 : 0);
  } catch (error) {
    await audit.emit('scan_error', { 
      error: error instanceof Error ? error.message : String(error) 
    }, 'error');
    process.exit(2);
  } finally {
    await audit.close();
  }
}

scanVulnerabilities(process.argv[2] || 'package.json');
```

### Example 2: Test Runner

```typescript
#!/usr/bin/env node
import { initAuditSDK } from 'lex-pr-runner/src/audit/sdk';
import { execSync } from 'child_process';

const audit = initAuditSDK('test');

async function runTests() {
  try {
    await audit.emit('test_run_start', { 
      suite: 'unit-tests',
      framework: 'vitest'
    });
    
    const startTime = Date.now();
    
    try {
      const output = execSync('npm run test:unit -- --reporter=json', { 
        encoding: 'utf-8' 
      });
      const results = JSON.parse(output);
      
      // Emit individual test results
      for (const test of results.tests) {
        await audit.emitTestResult(
          test.name, 
          test.status, 
          test.duration
        );
      }
      
      const duration = Date.now() - startTime;
      
      await audit.emit('test_run_complete', {
        passed: results.passed,
        failed: results.failed,
        skipped: results.skipped,
        duration_ms: duration
      });
      
      process.exit(results.failed > 0 ? 1 : 0);
    } catch (error) {
      await audit.emit('test_run_failed', { 
        error: error instanceof Error ? error.message : String(error) 
      }, 'error');
      process.exit(1);
    }
  } finally {
    await audit.close();
  }
}

runTests();
```

### Example 3: Linter Integration

```typescript
#!/usr/bin/env node
import { initAuditSDK } from 'lex-pr-runner/src/audit/sdk';
import { execSync } from 'child_process';

const audit = initAuditSDK('lint');

async function runLinter() {
  try {
    await audit.emit('lint_start', { 
      tool: 'eslint',
      config: '.eslintrc.json'
    });
    
    try {
      execSync('npm run lint', { stdio: 'pipe' });
      await audit.emit('lint_complete', { violations: 0 });
      process.exit(0);
    } catch (error: any) {
      const violations = parseLintOutput(error.stdout);
      
      await audit.emit('lint_violations', { 
        count: violations.length,
        violations: violations.slice(0, 10) // First 10 for brevity
      }, 'warn');
      
      process.exit(1);
    }
  } finally {
    await audit.close();
  }
}

function parseLintOutput(output: string): any[] {
  // Parse lint output into structured violations
  // Implementation depends on linter format
  return [];
}

runLinter();
```

---

## Integration with Runner

The runner periodically ingests sidecar files and enriches them with envelope metadata:

1. **Gate writes** to `{dropDir}/{gateName}.{pid}.ndjson`
2. **Runner reads** sidecar files periodically
3. **Runner stamps** with session, tool, repo, context
4. **Runner appends** to `audit.ndjson` (main audit log)
5. **Runner renames** sidecar to `.done` to mark processed

**No changes needed in runner for SDK support** — SDK follows existing sidecar contract.

---

## Best Practices

### 1. Always Close the SDK

```typescript
try {
  await audit.emit('event', {});
} finally {
  await audit.close(); // Ensures data is flushed
}
```

### 2. Use Standard Event Names

Prefer standard event names from the event catalog for consistency across gates.

### 3. Include Contextual Metadata

```typescript
await audit.emit('gate_start', {
  version: '1.0.0',
  config: configPath,
  environment: process.env.NODE_ENV
});
```

### 4. Handle Errors Gracefully

```typescript
try {
  await runGateLogic();
} catch (error) {
  await audit.emit('gate_error', { 
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  }, 'error');
  throw error;
}
```

### 5. Use Appropriate Log Levels

- `info` - Normal operational events
- `warn` - Important findings (vulnerabilities, failures)
- `error` - Critical errors that prevent gate execution

---

## Troubleshooting

### No sidecar files created

**Cause:** Environment variables not set

**Solution:** Ensure `LEX_AUDIT_DROP_DIR` and `LEX_AUDIT_SESSION_ID` are set when running with the runner

### Partial data in sidecar files

**Cause:** SDK not closed properly

**Solution:** Always call `await audit.close()` in a finally block

### Invalid JSON in sidecar files

**Cause:** Payload contains non-serializable data

**Solution:** Ensure all payloads are JSON-serializable (no circular references, functions, etc.)

---

## TypeScript Support

The SDK is fully typed for TypeScript users:

```typescript
import { 
  initAuditSDK, 
  AuditSDK, 
  VulnFoundPayload,
  TestResultPayload 
} from 'lex-pr-runner/src/audit/sdk';

const audit: AuditSDK = initAuditSDK('my-gate');

// Typed payloads
const vulnPayload: VulnFoundPayload = {
  cve: 'CVE-2024-1234',
  severity: 'high',
  package: 'lodash',
  version: '4.17.20',
  fixedIn: '4.17.21'
};

await audit.emit<VulnFoundPayload>('vuln_found', vulnPayload, 'warn');
```

---

## Future Enhancements

The SDK may be published as a separate package in the future:

```bash
npm install @lex-pr-runner/audit-sdk
```

This would enable:
- Independent versioning
- Smaller dependency footprint
- Easier adoption for external gates

---

## Related Documentation

- [Epic #189: Audit Outputs for Change Management & Compliance](../issues/189)
- [Phase 1: Core Emitter](../issues/190)
- [Monitoring & Audit Trail](./monitoring-examples.md)
- [Security & Compliance](./SECURITY_IMPLEMENTATION.md)
