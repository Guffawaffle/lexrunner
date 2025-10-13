# Audit Outputs - CI Context Blocks & Gate Matrix

> **Phase 2:** CI context blocks and per-PR gate matrix export for enhanced observability and compliance reporting.

## Overview

The audit system provides comprehensive event streaming with environment metadata collection and gate execution tracking. This enables SOC 2, HIPAA, and other compliance requirements by capturing:

- **CI context blocks**: Environment metadata (git, CI, OS)
- **Gate execution matrix**: Per-PR gate pass/fail tracking
- **Event stream**: NDJSON audit log with context

## Context Blocks

Context blocks enrich audit events with environment metadata for compliance and debugging.

### Git Context

Captures repository state at audit time:

```json
{
  "context": {
    "git": {
      "commit": "abc123def456",
      "branch": "main",
      "remote": "git@github.com:Guffawaffle/lex-pr-runner.git",
      "author": "user@example.com",
      "committer": "user@example.com",
      "message": "feat: Add audit outputs",
      "dirty": false,
      "tags": ["v1.2.3"]
    }
  }
}
```

**Fields:**
- `commit`: Current commit SHA
- `branch`: Current branch name
- `remote`: Remote repository URL (optional)
- `author`: Author email from latest commit (optional)
- `committer`: Committer email from latest commit (optional)
- `message`: Latest commit message (optional)
- `dirty`: Whether working directory has uncommitted changes
- `tags`: Tags pointing to current commit (optional)

**Source:** `git rev-parse`, `git log`, `git remote`, `git describe`

### CI Context

Captures CI environment metadata:

```json
{
  "context": {
    "ci": {
      "provider": "github-actions",
      "run_id": "1234567890",
      "run_number": "42",
      "workflow": "CI",
      "job": "build",
      "actor": "guffawaffle",
      "event_name": "pull_request",
      "ref": "refs/heads/main",
      "sha": "abc123def456"
    }
  }
}
```

**Supported CI Providers:**

#### GitHub Actions
- Provider: `github-actions`
- Environment: `GITHUB_*` variables
- Fields: `run_id`, `run_number`, `workflow`, `job`, `actor`, `event_name`, `ref`, `sha`

#### GitLab CI
- Provider: `gitlab-ci`
- Environment: `CI_*`, `GITLAB_*` variables
- Fields: `run_id` (CI_PIPELINE_ID), `run_number` (CI_PIPELINE_IID), `workflow` (CI_PIPELINE_SOURCE), `job`, `actor` (GITLAB_USER_LOGIN), `event_name`, `ref`, `sha`

#### CircleCI
- Provider: `circleci`
- Environment: `CIRCLE_*` variables
- Fields: `run_id` (CIRCLE_WORKFLOW_ID), `run_number` (CIRCLE_BUILD_NUM), `workflow`, `job`, `actor` (CIRCLE_USERNAME), `ref` (CIRCLE_BRANCH), `sha` (CIRCLE_SHA1)

#### Jenkins
- Provider: `jenkins`
- Environment: `BUILD_*`, `JOB_*` variables
- Fields: `run_id` (BUILD_ID), `run_number` (BUILD_NUMBER), `workflow` (JOB_NAME), `job`, `ref` (GIT_BRANCH), `sha` (GIT_COMMIT)

#### Generic CI
- Provider: `generic-ci` or `local`
- Fallback when CI is detected but provider unknown

### OS Context

Captures operating system information:

```json
{
  "context": {
    "os": {
      "platform": "linux",
      "release": "6.8.0-49-generic",
      "arch": "x64",
      "hostname": "runner-abcd1234",
      "user": "runner",
      "uptime": 123456,
      "loadavg": [0.5, 0.3, 0.2]
    }
  }
}
```

**Fields:**
- `platform`: Operating system platform (linux, darwin, win32)
- `release`: OS release version
- `arch`: CPU architecture (x64, arm64, arm)
- `hostname`: System hostname (optional)
- `user`: Current user (optional)
- `uptime`: System uptime in seconds (optional)
- `loadavg`: Load average (optional, Linux/Mac only)

**Source:** Node.js `os` module

## Gate Matrix

Per-PR gate execution matrix with pass/fail tracking.

### Structure

```json
{
  "generated_at": "2025-10-13T03:30:00Z",
  "session_id": "01JB...",
  "matrix": {
    "166": {
      "lint": { "status": "pass", "duration_ms": 1234 },
      "typecheck": { "status": "pass", "duration_ms": 2345 },
      "unit": { "status": "pass", "duration_ms": 3456 },
      "e2e": { "status": "skip", "reason": "Not configured" }
    },
    "167": {
      "lint": { "status": "pass", "duration_ms": 1111 },
      "typecheck": { "status": "fail", "duration_ms": 2222, "error": "Type mismatch in cli.ts:125" },
      "unit": { "status": "blocked", "reason": "typecheck failed" }
    },
    "168": {
      "lint": { "status": "pass", "duration_ms": 1000 },
      "typecheck": { "status": "pass", "duration_ms": 2000 },
      "unit": { "status": "pass", "duration_ms": 3000 }
    }
  },
  "summary": {
    "total_prs": 3,
    "total_gates": 10,
    "passed": 7,
    "failed": 1,
    "skipped": 1,
    "blocked": 1
  }
}
```

### Gate Statuses

- **`pass`**: Gate executed successfully
- **`fail`**: Gate failed with error
- **`skip`**: Gate skipped (not configured or optional)
- **`blocked`**: Gate blocked by dependency failure

### Fields

**Per-gate:**
- `status`: Gate execution status
- `duration_ms`: Execution duration in milliseconds (optional)
- `error`: Error message if failed (optional)
- `reason`: Skip/block reason (optional)

**Summary:**
- `total_prs`: Number of PRs in matrix
- `total_gates`: Total gate executions
- `passed`: Count of passed gates
- `failed`: Count of failed gates
- `skipped`: Count of skipped gates
- `blocked`: Count of blocked gates

### Generation

Gate matrix is generated during `finalizeAudit()` for profiles:
- `soc2`: Generates gate matrix
- `hipaa-strict`: Generates gate matrix
- `basic`: No gate matrix (audit events only)

**Source:** Aggregates `gate_started` and `gate_finished` events from `audit.ndjson`

## Audit Profiles

Profiles define default context collection behavior.

### Profile: basic

```typescript
{
  name: 'basic',
  defaultContext: [],
  description: 'Basic audit logging without context metadata'
}
```

- **No context by default**
- No gate matrix generation
- Minimal audit output for development

### Profile: soc2

```typescript
{
  name: 'soc2',
  defaultContext: ['git', 'ci'],
  description: 'SOC 2 compliance audit with git and CI context'
}
```

- **Includes:** Git context, CI context
- **Excludes:** OS context
- Generates gate matrix
- Suitable for SOC 2 Type II compliance

### Profile: hipaa-strict

```typescript
{
  name: 'hipaa-strict',
  defaultContext: ['git', 'ci'],
  description: 'HIPAA strict compliance (excludes OS to avoid sensitive hostnames)'
}
```

- **Includes:** Git context, CI context
- **Excludes:** OS context (avoids leaking sensitive hostnames)
- Generates gate matrix
- Suitable for HIPAA compliance

## Event Envelope Structure

All audit events follow this schema:

```json
{
  "schema_version": "0.1.0",
  "event": "gate_finished",
  "ts": "2025-10-13T03:30:00Z",
  "session_id": "01JB...",
  "run_id": "01JB...",
  "tool": {
    "name": "lex-pr-runner",
    "version": "x.y.z"
  },
  "actor": {
    "type": "ci",
    "name": "guffawaffle"
  },
  "repo": {
    "remote": "git@...",
    "branch": "main",
    "commit": "abc123"
  },
  "context": {
    "git": { /* ... */ },
    "ci": { /* ... */ },
    "os": { /* ... */ }
  },
  "payload": {
    "item": 167,
    "gate": "typecheck",
    "status": "fail",
    "duration_ms": 2222
  }
}
```

### Fields

- `schema_version`: Event schema version
- `event`: Event type (e.g., `gate_started`, `gate_finished`)
- `ts`: ISO 8601 timestamp
- `session_id`: Session identifier (ULID)
- `run_id`: Run identifier (ULID)
- `tool`: Tool information (name, version)
- `actor`: Actor information (type: user/ci/system, name)
- `repo`: Repository information (remote, branch, commit)
- `context`: Environment context (git, ci, os)
- `payload`: Event-specific data

## Usage

### CLI Integration

**Flag:** `--audit <profile>`

Enables audit logging with specified profile:

```bash
lex-pr execute --plan batch3-plan.json --audit soc2
```

**Flag:** `--audit-context <types>`

Override profile context (comma-separated):

```bash
# Override to only OS context
lex-pr execute --plan plan.json --audit basic --audit-context os

# Include all context types
lex-pr execute --plan plan.json --audit basic --audit-context git,ci,os
```

### With CI Context (GitHub Actions)

```bash
# In GitHub Actions workflow
lex-pr execute --plan batch3-plan.json \
  --audit soc2 \
  --audit-context git,ci

# Output: .smartergpt.local/deliverables/weave-<ts>/audit/audit.ndjson
# Each event includes:
# "context": {
#   "git": { "commit": "abc123", "branch": "main", ... },
#   "ci": { "provider": "github-actions", "run_id": "1234567890", ... }
# }
```

### With Gate Matrix

```bash
lex-pr execute --plan batch3-plan.json --audit soc2

# Output: .smartergpt.local/deliverables/weave-<ts>/audit/audit-gate-matrix.json
cat .smartergpt.local/deliverables/weave-<ts>/audit/audit-gate-matrix.json | jq '.summary'
# {
#   "total_prs": 3,
#   "total_gates": 10,
#   "passed": 7,
#   "failed": 1,
#   "skipped": 1,
#   "blocked": 1
# }
```

## Output Files

### audit.ndjson

NDJSON (newline-delimited JSON) audit log with one event per line.

**Location:** `<audit-dir>/audit.ndjson`

**Format:**
```
{"schema_version":"0.1.0","event":"gate_started",...}
{"schema_version":"0.1.0","event":"gate_finished",...}
{"schema_version":"0.1.0","event":"merge_completed",...}
```

### audit-gate-matrix.json

Per-PR gate execution matrix with summary statistics.

**Location:** `<audit-dir>/audit-gate-matrix.json`

**Generated for:** `soc2`, `hipaa-strict` profiles

**Not generated for:** `basic` profile

## Programmatic API

```typescript
import {
  initAuditEmitter,
  finalizeAudit,
  type AuditEmitterOptions,
} from './audit/index.js';

// Initialize emitter
const emitter = await initAuditEmitter({
  profile: 'soc2',
  dir: '/path/to/audit',
  sessionId: '01JB...',
  runId: '01JB...',
  tool: { name: 'lex-pr-runner', version: '0.1.0' },
});

// Emit events
emitter.emit('gate_started', { item: '166', gate: 'lint' });
emitter.emit('gate_finished', { 
  item: '166', 
  gate: 'lint', 
  status: 'pass',
  duration_ms: 1234,
});

// Finalize (close streams, generate gate matrix)
await finalizeAudit(emitter);
```

### Context Collection

```typescript
import { collectContext } from './audit/context.js';

// Collect specific context types
const context = await collectContext(['git', 'ci', 'os']);

console.log(context.git?.commit);    // Current commit
console.log(context.ci?.provider);   // CI provider
console.log(context.os?.platform);   // OS platform
```

### Gate Matrix Generation

```typescript
import { generateGateMatrix, generateGateMatrixFile } from './audit/gateMatrix.js';

// From events array
const events = [
  { event: 'gate_finished', ts: '...', payload: { item: '166', gate: 'lint', status: 'pass' } },
  // ...
];
const matrix = generateGateMatrix(events);

// From NDJSON file
await generateGateMatrixFile(
  '/path/to/audit.ndjson',
  '/path/to/audit-gate-matrix.json'
);
```

## Compliance Interpretation

### SOC 2 Type II

**Requirements met:**
- Change tracking (git context)
- CI/CD audit trail (CI context)
- Gate execution matrix (pass/fail tracking)
- Tamper-evident event stream (NDJSON append-only)

**Profile:** `soc2`

**Context:** `git`, `ci` (excludes OS)

### HIPAA

**Requirements met:**
- Audit logging (event stream)
- Access control tracking (actor information)
- Change management (git + CI context)
- Privacy protection (excludes OS to avoid sensitive hostnames)

**Profile:** `hipaa-strict`

**Context:** `git`, `ci` (excludes OS)

### Custom Compliance

For custom compliance needs, use `basic` profile with explicit context:

```bash
# Minimal audit (no context)
lex-pr execute --audit basic

# Custom context selection
lex-pr execute --audit basic --audit-context git,os
```

## Troubleshooting

### Context Not Appearing

**Problem:** Events have empty `context: {}`

**Solution:** Ensure profile or `--audit-context` flag is set:
```bash
# Use profile with default context
lex-pr execute --audit soc2

# Or explicit context types
lex-pr execute --audit basic --audit-context git,ci
```

### Gate Matrix Not Generated

**Problem:** `audit-gate-matrix.json` file missing

**Cause:** Only generated for `soc2` and `hipaa-strict` profiles

**Solution:** Use appropriate profile:
```bash
lex-pr execute --audit soc2  # Generates gate matrix
```

### CI Provider Not Detected

**Problem:** `context.ci.provider` shows `local` instead of expected CI

**Cause:** CI environment variables not set

**Verify:**
```bash
# GitHub Actions
echo $GITHUB_ACTIONS  # Should be "true"

# GitLab CI
echo $GITLAB_CI  # Should be "true"

# CircleCI
echo $CIRCLECI  # Should be "true"

# Jenkins
echo $JENKINS_URL  # Should be set
```

## Related

- Epic #189: Audit Outputs for Change Management & Compliance
- Issue #190: Phase 1 - Core Emitter (dependency)
- Issue #191: Phase 2 - Signatures (sibling)
