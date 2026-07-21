# Audit SDK Documentation

## Overview

The Audit SDK provides **two distinct APIs**:

1. **Gate SDK** - For gates to emit audit events (sidecar pattern)
2. **Consumer SDK** - For third-party tools to consume audit outputs (Phase 3A)

**Key Features:**

- 🎯 **Simple API** - Initialize, emit events, close (Gate SDK)
- 📖 **Parser & Query** - Read, validate, and filter audit events (Consumer SDK)
- 📝 **NDJSON Format** - Newline-delimited JSON for easy parsing
- 🔌 **Sidecar Pattern** - Decoupled from runner execution
- 🚫 **No-op Mode** - Gates work standalone without runner
- 🔒 **Type-safe** - Full TypeScript support with typed payloads
- ✅ **Schema Validation** - Zod schemas for all 14 event types
- 🔍 **Query Builder** - Fluent API for filtering events
- 📊 **Statistics** - Built-in event aggregation and analysis

---

## Table of Contents

- [Consumer SDK (Phase 3A)](#consumer-sdk-phase-3a) - **NEW: Parse and query audit outputs**
  - [Installation](#installation-consumer-sdk)
  - [Quick Start](#quick-start-consumer-sdk)
  - [API Reference](#consumer-sdk-api-reference)
  - [Examples](#consumer-sdk-examples)
- [Gate SDK](#gate-sdk) - Emit audit events from gates
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [API Reference](#api-reference)
  - [Examples](#examples)

---

# Consumer SDK (Phase 3A)

> **New in Phase 3A:** Third-party tools can now consume lexrunner audit outputs with full TypeScript support, schema validation, and query capabilities.

## Installation (Consumer SDK)

```bash
npm install @smartergpt/lexrunner
```

Import the published consumer SDK subpath:

```typescript
import {
  readAuditNDJSON,
  filterEvents,
  computeStatistics,
  validateAuditManifest,
  EventQuery,
  type AuditEvent,
} from "@smartergpt/lexrunner/audit-sdk";
```

Or use the types and parsers directly:

```typescript
import { parseAuditEvent, type AuditEvent } from "@smartergpt/lexrunner/audit-sdk";
import { parseAuditManifest } from "@smartergpt/lexrunner/audit-sdk";
```

## Quick Start (Consumer SDK)

### Example 1: Read and Filter Events

```typescript
import { readAuditNDJSON, filterEvents } from "@smartergpt/lexrunner/audit-sdk";

// Read all events from audit output
for await (const event of readAuditNDJSON("./audit.ndjson")) {
  if (event.event === "gate_finished" && event.payload.status === "fail") {
    console.log(`Failed gate: ${event.payload.gate} (item: ${event.payload.item})`);
  }
}
```

### Example 2: Load into Memory and Query

```typescript
import { readAuditNDJSONSync, EventQuery } from "@smartergpt/lexrunner/audit-sdk";

// Load all events into memory
const events = await readAuditNDJSONSync("./audit.ndjson");

// Use fluent query API
const failedGates = new EventQuery(events)
  .byEventType("gate_finished")
  .byGateStatus("fail")
  .byLevel("error")
  .execute();

console.log(`Found ${failedGates.length} failed gates`);
```

### Example 3: Compute Statistics

```typescript
import { readAuditNDJSONSync, computeStatistics } from "@smartergpt/lexrunner/audit-sdk";

const events = await readAuditNDJSONSync("./audit.ndjson");
const stats = computeStatistics(events);

console.log(`Total events: ${stats.totalEvents}`);
console.log(`Failed gates: ${stats.gateStats.failed}`);
console.log(`Successful merges: ${stats.mergeStats.success}`);
console.log(`Time range: ${stats.timeRange.start} to ${stats.timeRange.end}`);
```

### Example 4: Validate Manifest

```typescript
import { validateAuditManifest } from "@smartergpt/lexrunner/audit-sdk";
import * as fs from "fs";

const manifestData = JSON.parse(fs.readFileSync("./audit-manifest.json", "utf8"));

try {
  const manifest = validateAuditManifest(manifestData);
  console.log(`Valid manifest: ${manifest.files.length} files, ${manifest.totalBytes} bytes`);
} catch (error) {
  console.error("Invalid manifest:", error);
}
```

## Consumer SDK API Reference

### Parsing Functions

#### `readAuditNDJSON(filePath: string): AsyncIterable<AuditEvent>`

Read audit events from an NDJSON file (async iterable).

**Example:**

```typescript
for await (const event of readAuditNDJSON("./audit.ndjson")) {
  console.log(event.event, event.ts);
}
```

#### `readAuditNDJSONSync(filePath: string): Promise<AuditEvent[]>`

Read all audit events from an NDJSON file into an array.

**Example:**

```typescript
const events = await readAuditNDJSONSync("./audit.ndjson");
console.log(`Loaded ${events.length} events`);
```

#### `parseAuditEventLine(line: string): AuditEvent`

Parse a single NDJSON line into a validated audit event.

**Example:**

```typescript
const event = parseAuditEventLine('{"schema_version":"1.0.0",...}');
```

#### `parseAuditNDJSONString(content: string): AuditEvent[]`

Parse NDJSON content from a string.

**Example:**

```typescript
const events = parseAuditNDJSONString(ndjsonContent);
```

### Validation Functions

#### `validateAuditManifest(manifest: unknown): AuditManifest`

Validate an audit manifest. Throws on validation error.

**Example:**

```typescript
const manifest = validateAuditManifest(manifestData);
console.log(`Total bytes: ${manifest.totalBytes}`);
```

#### `validateAuditManifestSafe(manifest: unknown)`

Validate an audit manifest (safe version that returns result object).

**Example:**

```typescript
const result = validateAuditManifestSafe(manifestData);
if (result.success) {
  console.log("Valid manifest:", result.data);
} else {
  console.error("Validation errors:", result.error);
}
```

#### `validateAuditEvent(event: unknown): AuditEvent`

Validate a single audit event. Throws on validation error.

#### `isSchemaCompatible(schemaVersion: string, majorVersion?: number): boolean`

Check if a schema version is compatible with a given major version.

**Example:**

```typescript
if (!isSchemaCompatible(event.schema_version, 1)) {
  console.warn(`Incompatible schema version: ${event.schema_version}`);
}
```

### Query Functions

#### `filterEvents(events: AuditEvent[], filter: EventFilter): AuditEvent[]`

Filter audit events by criteria.

**Filter Options:**

- `eventType` - Filter by event type(s)
- `level` - Filter by level(s)
- `sessionId` - Filter by session ID
- `runId` - Filter by run ID
- `item` - Filter by item (for gate/merge events)
- `gate` - Filter by gate name
- `gateStatus` - Filter by gate status(es)
- `timeRange` - Filter by timestamp range

**Example:**

```typescript
const failedGates = filterEvents(events, {
  eventType: "gate_finished",
  gateStatus: "fail",
  level: "error",
});
```

#### `EventQuery`

Fluent query builder for filtering events.

**Methods:**

- `byEventType(type)` - Filter by event type
- `byLevel(level)` - Filter by level
- `bySessionId(sessionId)` - Filter by session ID
- `byRunId(runId)` - Filter by run ID
- `byItem(item)` - Filter by item
- `byGate(gate)` - Filter by gate name
- `byGateStatus(status)` - Filter by gate status
- `byTimeRange(start, end)` - Filter by time range
- `execute()` - Execute query and return results
- `count()` - Count matching events
- `first()` - Get first matching event
- `exists()` - Check if any events match

**Example:**

```typescript
const query = new EventQuery(events)
  .byEventType("gate_finished")
  .byGateStatus(["fail", "error"])
  .byTimeRange("2024-11-01T00:00:00Z", "2024-11-02T23:59:59Z");

console.log(`Count: ${query.count()}`);
console.log(`First: ${query.first()?.payload.gate}`);
console.log(`Exists: ${query.exists()}`);

const results = query.execute();
```

#### `computeStatistics(events: AuditEvent[])`

Compute statistics from audit events.

**Returns:**

```typescript
{
  totalEvents: number;
  eventTypes: Record<string, number>;
  levels: {
    info: number;
    warn: number;
    error: number;
  }
  gateStats: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
  }
  mergeStats: {
    total: number;
    success: number;
    conflict: number;
    errored: number;
  }
  timeRange: {
    start: string;
    end: string;
  }
}
```

**Example:**

```typescript
const stats = computeStatistics(events);
console.log(`Total events: ${stats.totalEvents}`);
console.log(`Gate pass rate: ${(stats.gateStats.passed / stats.gateStats.total) * 100}%`);
```

## Consumer SDK Examples

### Example 1: CI/CD Integration - Report Failed Gates

```typescript
import { readAuditNDJSONSync, filterEvents } from "@smartergpt/lexrunner/audit-sdk";

async function reportFailedGates() {
  const events = await readAuditNDJSONSync("./audit.ndjson");

  const failedGates = filterEvents(events, {
    eventType: "gate_finished",
    gateStatus: ["fail", "error"],
  });

  if (failedGates.length > 0) {
    console.error(`❌ ${failedGates.length} gate(s) failed:`);
    for (const event of failedGates) {
      console.error(`  - ${event.payload.gate} (item ${event.payload.item})`);
    }
    process.exit(1);
  } else {
    console.log("✅ All gates passed");
  }
}

reportFailedGates();
```

### Example 2: Generate HTML Report

```typescript
import {
  readAuditNDJSONSync,
  computeStatistics,
  filterEvents,
} from "@smartergpt/lexrunner/audit-sdk";
import * as fs from "fs";

async function generateReport() {
  const events = await readAuditNDJSONSync("./audit.ndjson");
  const stats = computeStatistics(events);

  const failedGates = filterEvents(events, {
    eventType: "gate_finished",
    gateStatus: "fail",
  });

  const html = `
<!DOCTYPE html>
<html>
<head><title>Audit Report</title></head>
<body>
  <h1>Audit Report</h1>
  <h2>Summary</h2>
  <ul>
    <li>Total Events: ${stats.totalEvents}</li>
    <li>Gates Passed: ${stats.gateStats.passed}</li>
    <li>Gates Failed: ${stats.gateStats.failed}</li>
    <li>Merge Success: ${stats.mergeStats.success}</li>
  </ul>
  <h2>Failed Gates</h2>
  <ul>
    ${failedGates.map((e) => `<li>${e.payload.gate} (item ${e.payload.item})</li>`).join("\n")}
  </ul>
</body>
</html>
  `;

  fs.writeFileSync("audit-report.html", html);
  console.log("Report generated: audit-report.html");
}

generateReport();
```

### Example 3: SIEM Integration - Export to JSON

```typescript
import { readAuditNDJSONSync, filterEvents } from "@smartergpt/lexrunner/audit-sdk";
import * as fs from "fs";

async function exportToSIEM() {
  const events = await readAuditNDJSONSync("./audit.ndjson");

  // Filter high-priority events
  const criticalEvents = filterEvents(events, {
    level: ["warn", "error"],
  });

  // Transform to SIEM format
  const siemEvents = criticalEvents.map((event) => ({
    timestamp: event.ts,
    severity: event.level,
    source: "lexrunner",
    event_type: event.event,
    session_id: event.session_id,
    details: event.payload,
  }));

  fs.writeFileSync("siem-export.json", JSON.stringify(siemEvents, null, 2));
  console.log(`Exported ${siemEvents.length} events to SIEM`);
}

exportToSIEM();
```

### Example 4: Compliance Dashboard - Aggregate Metrics

```typescript
import {
  readAuditNDJSONSync,
  EventQuery,
  computeStatistics,
} from "@smartergpt/lexrunner/audit-sdk";

async function complianceDashboard() {
  const events = await readAuditNDJSONSync("./audit.ndjson");
  const stats = computeStatistics(events);

  // Compute metrics
  const totalGates = stats.gateStats.total;
  const passRate =
    totalGates > 0 ? ((stats.gateStats.passed / totalGates) * 100).toFixed(2) : "N/A";

  const mergeConflicts = new EventQuery(events).byEventType("merge_conflict_detected").count();

  const errors = new EventQuery(events).byLevel("error").count();

  // Generate dashboard
  console.log("=== Compliance Dashboard ===");
  console.log(`Session ID: ${events[0]?.session_id || "N/A"}`);
  console.log(`Time Range: ${stats.timeRange.start} to ${stats.timeRange.end}`);
  console.log("");
  console.log("Gate Execution:");
  console.log(`  Total: ${totalGates}`);
  console.log(`  Passed: ${stats.gateStats.passed}`);
  console.log(`  Failed: ${stats.gateStats.failed}`);
  console.log(`  Pass Rate: ${passRate}%`);
  console.log("");
  console.log("Merge Operations:");
  console.log(`  Total: ${stats.mergeStats.total}`);
  console.log(`  Success: ${stats.mergeStats.success}`);
  console.log(`  Conflicts: ${mergeConflicts}`);
  console.log("");
  console.log(`Total Errors: ${errors}`);
}

complianceDashboard();
```

### Example 5: Filter by Time Range

```typescript
import { readAuditNDJSONSync, filterEvents } from "@smartergpt/lexrunner/audit-sdk";

async function eventsInTimeRange() {
  const events = await readAuditNDJSONSync("./audit.ndjson");

  const filtered = filterEvents(events, {
    timeRange: {
      start: "2024-11-02T00:00:00Z",
      end: "2024-11-02T23:59:59Z",
    },
  });

  console.log(`Events in date range: ${filtered.length}`);
}

eventsInTimeRange();
```

### Example 6: Type-Safe Event Handling

```typescript
import { readAuditNDJSONSync, type GateFinishedEvent } from "@smartergpt/lexrunner/audit-sdk";

async function analyzeGatePerformance() {
  const events = await readAuditNDJSONSync("./audit.ndjson");

  // Type-safe filtering
  const gateEvents = events.filter((e): e is GateFinishedEvent => e.event === "gate_finished");

  // Calculate average duration per gate
  const durationsByGate: Record<string, number[]> = {};

  for (const event of gateEvents) {
    const gate = event.payload.gate;
    const duration = event.payload.duration_ms;

    if (!durationsByGate[gate]) {
      durationsByGate[gate] = [];
    }
    durationsByGate[gate].push(duration);
  }

  console.log("Average gate durations:");
  for (const [gate, durations] of Object.entries(durationsByGate)) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    console.log(`  ${gate}: ${avg.toFixed(0)}ms`);
  }
}

analyzeGatePerformance();
```

---

# Gate SDK

The Gate SDK implementation is currently repository-internal and is not a supported package
export. The examples below apply to contributors working from a LexRunner checkout; adapt the
relative source path to the location of the local script. Package consumers should use the
published Consumer SDK above.

## Installation

From a LexRunner checkout, install repository dependencies:

```bash
npm ci
```

Then import the internal implementation from source:

```typescript
import { initAuditSDK } from "./src/audit/sdk/index.js";
```

---

## Quick Start

### Basic Usage

```typescript
#!/usr/bin/env node
import { initAuditSDK } from "./src/audit/sdk/index.js";

const audit = initAuditSDK("my-gate");

async function runGate() {
  try {
    // Emit custom events
    await audit.emit("gate_start", { version: "1.0.0" });

    // Your gate logic here
    const result = await executeGateLogic();

    await audit.emit("gate_complete", { result });
  } catch (error) {
    await audit.emit(
      "gate_error",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "error"
    );
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
const audit = initAuditSDK("lint");
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
await audit.emit(
  "scan_complete",
  {
    total: 100,
    passed: 95,
    failed: 5,
  },
  "info"
);
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
await audit.emitVuln("CVE-2024-1234", "high", {
  package: "lodash",
  version: "4.17.20",
  fixedIn: "4.17.21",
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
await audit.emitTestResult("unit-test-auth", "pass", 123);
await audit.emitTestResult("integration-test-api", "fail", 456);
await audit.emitTestResult("e2e-test-ui", "skip");
```

---

### `AuditSDK.close(): Promise<void>`

Close the audit stream and flush remaining events.

**Must be called** when done emitting events to ensure all data is written.

**Example:**

```typescript
try {
  await audit.emit("event", {});
} finally {
  await audit.close();
}
```

---

## Event Catalog

### Standard Events

The SDK supports arbitrary custom events, but here are recommended standard events:

| Event               | Description               | Example Payload                    |
| ------------------- | ------------------------- | ---------------------------------- |
| `gate_start`        | Gate execution begins     | `{ version: '1.0.0' }`             |
| `gate_complete`     | Gate execution succeeds   | `{ duration_ms: 1234 }`            |
| `gate_error`        | Gate execution fails      | `{ error: 'message' }`             |
| `scan_start`        | Vulnerability scan begins | `{ target: 'package.json' }`       |
| `scan_complete`     | Vulnerability scan ends   | `{ total: 100, vulnerable: 5 }`    |
| `vuln_found`        | Vulnerability detected    | `{ cve: '...', severity: 'high' }` |
| `test_result`       | Individual test result    | `{ name: '...', status: 'pass' }`  |
| `test_run_start`    | Test suite begins         | `{ suite: 'unit-tests' }`          |
| `test_run_complete` | Test suite ends           | `{ passed: 10, failed: 2 }`        |
| `lint_start`        | Linting begins            | `{ files: 42 }`                    |
| `lint_complete`     | Linting complete          | `{ violations: 0 }`                |
| `lint_violations`   | Lint violations found     | `{ count: 5, violations: [...] }`  |

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
import { initAuditSDK } from "./src/audit/sdk/index.js";
import { execSync } from "child_process";

const audit = initAuditSDK("vuln");

async function scanVulnerabilities(packageJsonPath: string) {
  try {
    await audit.emit("scan_start", {
      target: packageJsonPath,
      scanner: "npm-audit",
    });

    const output = execSync("npm audit --json", { encoding: "utf-8" });
    const auditData = JSON.parse(output);

    // Emit each vulnerability
    for (const [id, vuln] of Object.entries(auditData.vulnerabilities)) {
      await audit.emitVuln(vuln.cves?.[0] || id, vuln.severity, {
        package: vuln.name,
        version: vuln.range,
        fixedIn: vuln.fixAvailable?.version,
      });
    }

    await audit.emit("scan_complete", {
      total: Object.keys(auditData.vulnerabilities).length,
      vulnerable: auditData.metadata.vulnerabilities.total,
      severity_breakdown: auditData.metadata.vulnerabilities,
    });

    process.exit(auditData.metadata.vulnerabilities.total > 0 ? 1 : 0);
  } catch (error) {
    await audit.emit(
      "scan_error",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "error"
    );
    process.exit(2);
  } finally {
    await audit.close();
  }
}

scanVulnerabilities(process.argv[2] || "package.json");
```

### Example 2: Test Runner

```typescript
#!/usr/bin/env node
import { initAuditSDK } from "./src/audit/sdk/index.js";
import { execSync } from "child_process";

const audit = initAuditSDK("test");

async function runTests() {
  try {
    await audit.emit("test_run_start", {
      suite: "unit-tests",
      framework: "vitest",
    });

    const startTime = Date.now();

    try {
      const output = execSync("npm run test:unit -- --reporter=json", {
        encoding: "utf-8",
      });
      const results = JSON.parse(output);

      // Emit individual test results
      for (const test of results.tests) {
        await audit.emitTestResult(test.name, test.status, test.duration);
      }

      const duration = Date.now() - startTime;

      await audit.emit("test_run_complete", {
        passed: results.passed,
        failed: results.failed,
        skipped: results.skipped,
        duration_ms: duration,
      });

      process.exit(results.failed > 0 ? 1 : 0);
    } catch (error) {
      await audit.emit(
        "test_run_failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "error"
      );
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
import { initAuditSDK } from "./src/audit/sdk/index.js";
import { execSync } from "child_process";

const audit = initAuditSDK("lint");

async function runLinter() {
  try {
    await audit.emit("lint_start", {
      tool: "eslint",
      config: ".eslintrc.json",
    });

    try {
      execSync("npm run lint", { stdio: "pipe" });
      await audit.emit("lint_complete", { violations: 0 });
      process.exit(0);
    } catch (error: any) {
      const violations = parseLintOutput(error.stdout);

      await audit.emit(
        "lint_violations",
        {
          count: violations.length,
          violations: violations.slice(0, 10), // First 10 for brevity
        },
        "warn"
      );

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
  await audit.emit("event", {});
} finally {
  await audit.close(); // Ensures data is flushed
}
```

### 2. Use Standard Event Names

Prefer standard event names from the event catalog for consistency across gates.

### 3. Include Contextual Metadata

```typescript
await audit.emit("gate_start", {
  version: "1.0.0",
  config: configPath,
  environment: process.env.NODE_ENV,
});
```

### 4. Handle Errors Gracefully

```typescript
try {
  await runGateLogic();
} catch (error) {
  await audit.emit(
    "gate_error",
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "error"
  );
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
  TestResultPayload,
} from "./src/audit/sdk/index.js";

const audit: AuditSDK = initAuditSDK("my-gate");

// Typed payloads
const vulnPayload: VulnFoundPayload = {
  cve: "CVE-2024-1234",
  severity: "high",
  package: "lodash",
  version: "4.17.20",
  fixedIn: "4.17.21",
};

await audit.emit<VulnFoundPayload>("vuln_found", vulnPayload, "warn");
```

---

## Future Enhancements

The SDK may be published as a separate package in the future:

```bash
npm install @lexrunner/audit-sdk
```

This would enable:

- Independent versioning
- Smaller dependency footprint
- Easier adoption for external gates

---

## Related Documentation

- [Epic #189: Audit Outputs for Change Management & Compliance](https://github.com/Guffawaffle/lexrunner/issues/189)
- [Phase 1: Core Emitter](https://github.com/Guffawaffle/lexrunner/issues/190)
- [Monitoring & Audit Trail](./monitoring-examples.md)
- [Security & Compliance](./SECURITY_IMPLEMENTATION.md)
