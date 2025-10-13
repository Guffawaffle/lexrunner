# Audit Output Documentation

## Overview

The lex-pr-runner audit system provides immutable logging of decisions and actions for compliance and troubleshooting. Audit events are emitted in NDJSON (newline-delimited JSON) format with schema versioning and backward compatibility.

## Schema Versioning

### Current Version

**Current Schema Version:** `1.0.0`

All audit events include a `schema_version` field following semantic versioning (MAJOR.MINOR.PATCH).

### Versioning Rules

- **Patch (x.y.Z):** Additive, optional fields only. Documentation changes or clarifications. No consumer changes needed.
- **Minor (x.Y.0):** Additive required fields with safe defaults. Consumers may need updates but old versions still parse.
- **Major (X.0.0):** Breaking changes to structure or semantics. Consumers must update.

### Schema Evolution Examples

| Version | Change | Impact |
|---------|--------|--------|
| `1.0.0` | Initial release (Phase 3) | N/A |
| `1.1.0` | Add `context.container` block | Minor: new optional field |
| `1.2.0` | Add `event: "policy_violation"` | Minor: new event type |
| `2.0.0` | Rename `actor.type` to `actor.role` | Major: breaking |

## Event Structure

### Event Envelope

Every audit event follows this structure:

```json
{
  "schema_version": "1.0.0",
  "event": "gate_finished",
  "ts": "2025-10-13T11:30:00.123Z",
  "level": "info",
  "session_id": "session-abc123",
  "run_id": "run-def456",
  "tool": {
    "name": "lex-pr-runner",
    "version": "0.1.0"
  },
  "actor": {
    "type": "cli",
    "user": "developer@example.com"
  },
  "repo": {
    "remote": "https://github.com/org/repo",
    "branch": "main",
    "commit": "abc123def456"
  },
  "payload": {
    "gate": "lint",
    "item": "feature-a",
    "status": "pass",
    "duration_ms": 1234
  }
}
```

### Required Fields

- `schema_version` (string): Semantic version of the schema (e.g., "1.0.0")
- `event` (string): Event type (see Event Types below)
- `ts` (string): ISO 8601 timestamp when event occurred
- `session_id` (string): Unique identifier for the user session
- `run_id` (string): Unique identifier for this execution run
- `tool` (object): Tool information
  - `name` (string): Tool name (e.g., "lex-pr-runner")
  - `version` (string): Tool version (e.g., "0.1.0")
- `actor` (object): Actor information
  - `type` (string): Actor type ("cli", "mcp", or "ci")
  - `user` (string, optional): User identifier
- `repo` (object): Repository context (may be empty)
  - `remote` (string, optional): Git remote URL
  - `branch` (string, optional): Current branch
  - `commit` (string, optional): Current commit SHA
- `payload` (object): Event-specific data

### Optional Fields

- `level` (string): Severity level ("info", "warn", "error"). Defaults to "info"
- `context` (object): Additional context
  - `git` (object): Git-specific context
  - `ci` (object): CI/CD environment context
  - `os` (object): Operating system context

## Event Types

The following event types are currently supported:

### Planning & Validation
- `command_invocation`: CLI/MCP command was invoked
- `plan_discovered`: Plan file was discovered and loaded
- `plan_validated`: Plan structure was validated

### Dependency Analysis
- `merge_order_computed`: Dependency order was calculated

### Gate Execution
- `gate_started`: Gate execution began
- `gate_finished`: Gate execution completed

### Merge Operations
- `merge_dry_run_started`: Dry run merge simulation started
- `merge_dry_run_finished`: Dry run merge simulation finished
- `merge_execute_started`: Actual merge execution started
- `merge_conflict_detected`: Merge conflict was detected
- `merge_finished`: Merge operation completed

### Artifacts & Errors
- `artifact_written`: Artifact file was written
- `error`: Error occurred during execution
- `run_summary`: Summary of entire run

## Compatibility Checking

### Consumer Code

Consumers should check schema compatibility before parsing events:

```typescript
import { isSchemaCompatible } from 'lex-pr-runner/audit/schema';
import * as fs from 'fs';
import * as readline from 'readline';

async function parseAuditLog(ndjsonPath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(ndjsonPath),
  });
  
  for await (const line of rl) {
    const event = JSON.parse(line);
    
    // Check compatibility
    if (!isSchemaCompatible(event.schema_version, 1)) {
      console.warn(`Skipping event with unsupported schema: ${event.schema_version}`);
      continue;
    }
    
    // Process event
    if (event.event === 'gate_finished') {
      console.log(`Gate ${event.payload.gate} for PR ${event.payload.item}: ${event.payload.status}`);
    }
  }
}
```

### Helper Function

```typescript
/**
 * Check if consumer can parse this schema version.
 * 
 * @param schemaVersion - Version from audit event
 * @param supportedMajor - Major version consumer supports
 * @returns true if compatible, false if breaking
 */
export function isSchemaCompatible(
  schemaVersion: string,
  supportedMajor: number
): boolean;
```

**Usage:**
```typescript
// Check if event is compatible with version 1.x.x
if (isSchemaCompatible(event.schema_version, 1)) {
  // Safe to process
}

// Check if event is compatible with version 2.x.x
if (isSchemaCompatible(event.schema_version, 2)) {
  // Safe to process with v2 schema
}
```

## Validation

### Programmatic Validation

```typescript
import { validateAuditEvent } from 'lex-pr-runner/audit/schema';

const result = validateAuditEvent(event);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}
```

### JSON Schema Validation

The audit system includes JSON Schema validation for stricter checking:

```typescript
import { AuditEmitter } from 'lex-pr-runner/audit';

const emitter = new AuditEmitter({
  sessionId: 'session-123',
  runId: 'run-456',
  toolName: 'lex-pr-runner',
  toolVersion: '0.1.0',
  actorType: 'cli',
  outputPath: '/path/to/audit.ndjson',
  validateBeforeWrite: true  // Enable schema validation
});

// This will validate against JSON schema before writing
await emitter.emit('gate_finished', {
  gate: 'lint',
  item: 'feature-a',
  status: 'pass',
  duration_ms: 1234
});
```

## Migration (Future)

When breaking changes occur in major version bumps, migration functions will be provided:

```typescript
/**
 * Migrate audit event from schema v1 to v2.
 * (Example for future use)
 */
export function migrateV1toV2(eventV1: any): any {
  const eventV2 = { ...eventV1 };
  
  // Breaking change: rename actor.type → actor.role
  if (eventV2.actor?.type) {
    eventV2.actor.role = eventV2.actor.type;
    delete eventV2.actor.type;
  }
  
  eventV2.schema_version = '2.0.0';
  return eventV2;
}
```

## Output Format

### NDJSON Format

Audit events are written in NDJSON (Newline Delimited JSON) format, with one event per line:

```
{"schema_version":"1.0.0","event":"gate_started",...}
{"schema_version":"1.0.0","event":"gate_finished",...}
{"schema_version":"1.0.0","event":"merge_finished",...}
```

This format allows:
- Streaming processing of large logs
- Easy appending of new events
- Line-by-line parsing without loading entire file

### File Location

Audit events can be written to:
- File path specified via `outputPath` option
- Console output (always logged for visibility)

## Example Usage

### Basic Emitter Setup

```typescript
import { AuditEmitter } from 'lex-pr-runner/audit';

const emitter = new AuditEmitter({
  sessionId: 'unique-session-id',
  runId: 'unique-run-id',
  toolName: 'lex-pr-runner',
  toolVersion: '0.1.0',
  actorType: 'cli',
  outputPath: '.smartergpt/runner/audit.ndjson'
});

// Emit events
await emitter.emit('plan_validated', {
  itemCount: 5,
  target: 'main'
});

await emitter.emit('gate_started', {
  gate: 'lint',
  item: 'feature-a'
}, 'info');

await emitter.emit('gate_finished', {
  gate: 'lint',
  item: 'feature-a',
  status: 'pass',
  duration_ms: 1234
});
```

### Parsing Audit Logs

```typescript
import * as fs from 'fs';
import * as readline from 'readline';

async function analyzeAuditLog(filePath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath)
  });

  const stats = {
    totalEvents: 0,
    gatesPassed: 0,
    gatesFailed: 0,
    errors: 0
  };

  for await (const line of rl) {
    const event = JSON.parse(line);
    stats.totalEvents++;

    if (event.event === 'gate_finished') {
      if (event.payload.status === 'pass') {
        stats.gatesPassed++;
      } else {
        stats.gatesFailed++;
      }
    } else if (event.event === 'error') {
      stats.errors++;
    }
  }

  return stats;
}
```

### Filtering Events

```typescript
async function findFailedGates(filePath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath)
  });

  const failedGates = [];

  for await (const line of rl) {
    const event = JSON.parse(line);
    
    if (event.event === 'gate_finished' && event.payload.status === 'fail') {
      failedGates.push({
        item: event.payload.item,
        gate: event.payload.gate,
        timestamp: event.ts
      });
    }
  }

  return failedGates;
}
```

## Schema Registry

### JSON Schema Location

The canonical JSON schema is located at:
- `schemas/audit-events.schema.json` (current version)
- `schemas/audit-events.v1.0.0.schema.json` (versioned copy for archival)

### Schema URI

The schema is identified by:
- `$id`: `https://smartergpt.dev/schemas/audit-events/v1.0.0.json`
- `version`: `1.0.0`

Future major versions will be stored as separate files:
- `schemas/audit-events.v2.0.0.schema.json`
- `schemas/audit-events.v3.0.0.schema.json`

## Best Practices

### For Event Emitters

1. **Always include schema_version**: Ensure every event has the `schema_version` field
2. **Validate before writing**: Enable `validateBeforeWrite` for production systems
3. **Use consistent IDs**: Maintain consistent `session_id` and `run_id` throughout a run
4. **Include timestamps**: Always use ISO 8601 format for timestamps
5. **Provide context**: Include relevant `repo` and `context` information

### For Event Consumers

1. **Check compatibility first**: Always use `isSchemaCompatible()` before parsing
2. **Handle unknown events gracefully**: Skip or log events with unknown types
3. **Parse line-by-line**: Use streaming for large audit logs
4. **Handle missing optional fields**: Don't assume optional fields are present
5. **Future-proof your code**: Design parsers to handle new event types and fields

### Error Handling

```typescript
async function robustEventParser(filePath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath)
  });

  for await (const line of rl) {
    try {
      const event = JSON.parse(line);
      
      // Check schema compatibility
      if (!isSchemaCompatible(event.schema_version, 1)) {
        console.warn(`Unsupported schema version: ${event.schema_version}`);
        continue;
      }

      // Process event
      processEvent(event);
    } catch (error) {
      console.error(`Failed to parse line: ${line}`, error);
      // Continue processing other lines
    }
  }
}
```

## Related Documentation

- [Gate Report Schema](./schemas.md) - Gate execution report schema
- [Error Taxonomy](./errors.md) - Error handling and codes
- [Autopilot Levels](./autopilot.md) - Artifact versioning in autopilot mode

## Future Enhancements

- CLI command for validating audit logs: `lex-pr audit validate --ndjson audit.ndjson`
- Built-in analytics and reporting tools
- Event filtering and aggregation utilities
- Schema migration tools for major version upgrades
