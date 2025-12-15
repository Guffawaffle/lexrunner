# Tool-Grounded Mode Enforcement

This document describes the enforcement rules for tool-grounded modes in lexrunner.

## Overview

When a run is active with `mode: "senior-dev"` or `mode: "tool-grounded"`, orchestration must flow through `lexrunner.*` tools. This ensures:

- Consistent, auditable decision-making
- Proper gate enforcement
- Safe merge operations
- Clear violation tracking

## Enforcement Rules

### Required Tool Usage

Once `lexrunner.startRun` returns a `runId`, the model **MUST**:

| Tool | Purpose |
|------|---------|
| `lexrunner.getStatus` | Understand run state |
| `lexrunner.submitDecision` | Make orchestration decisions |
| `lexrunner.listArtifacts` | Inspect artifacts |

### Forbidden Actions

The model **MUST NOT** during an active run:

| Action | Violation Type |
|--------|----------------|
| `git merge`, `git push`, `git rebase` | `DIRECT_GIT_COMMAND` |
| `gh pr merge`, `gh pr create` | `DIRECT_GH_COMMAND` / `DIRECT_MERGE` |
| Modify `.github/workflows/` or CI configs | `MODIFY_CI_CONFIG` |
| Skip gates without proper decision | `BYPASS_GATES` |
| Skip policy checks without rationale | `SKIP_POLICY` |
| Use forbidden persona actions | `FORBIDDEN_ACTION` |

## Violation Types

### DIRECT_GIT_COMMAND

Triggered when executing forbidden git commands during an active run:

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "DIRECT_GIT_COMMAND",
  "command": "git push origin main",
  "context": "Attempted during active run",
  "severity": "warning"
}
```

**Forbidden commands:**
- `git merge`
- `git push`
- `git rebase`
- `git cherry-pick`
- `git reset --hard`
- `git checkout -B`

### DIRECT_GH_COMMAND

Triggered when executing forbidden GitHub CLI commands:

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "DIRECT_GH_COMMAND",
  "command": "gh pr close 42",
  "context": "Attempted during active run",
  "severity": "warning"
}
```

**Forbidden commands:**
- `gh pr merge`
- `gh pr close`
- `gh pr create`

### DIRECT_MERGE

A specialized violation for merge operations (elevated severity):

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "DIRECT_MERGE",
  "command": "git merge PR-123",
  "context": "Attempted during active run",
  "severity": "error"
}
```

### BYPASS_GATES

Triggered when attempting to skip gates without proper decision workflow:

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "BYPASS_GATES",
  "context": "Skipped lint gate without rationale",
  "severity": "error"
}
```

### MODIFY_CI_CONFIG

Triggered when modifying CI/CD configuration during a run:

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "MODIFY_CI_CONFIG",
  "command": "edit .github/workflows/ci.yml",
  "context": "CI config modified during active run",
  "severity": "critical"
}
```

**Protected paths:**
- `.github/workflows/`
- `.gitlab-ci.yml`
- `Jenkinsfile`
- `.circleci/`
- `azure-pipelines.yml`

### SKIP_POLICY

Triggered when skipping policy checks without proper rationale:

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "SKIP_POLICY",
  "context": "Skipped approval requirement",
  "severity": "warning"
}
```

### FORBIDDEN_ACTION

Triggered when using an action forbidden under the current persona:

```json
{
  "timestamp": "2025-11-26T12:34:56.789Z",
  "runId": "01JDXYZ...",
  "violation": "FORBIDDEN_ACTION",
  "command": "force-push",
  "context": "Action 'force-push' forbidden under senior-dev persona",
  "severity": "critical"
}
```

## Severity Levels

| Level | Description | Impact |
|-------|-------------|--------|
| `warning` | Logged but does not block | Soft enforcement only |
| `error` | Should block under hard enforcement | Blocks in hard mode |
| `critical` | Always blocks, may abort run | Always blocks |

### Default Severity by Violation Type

| Violation Type | Default Severity |
|----------------|------------------|
| `DIRECT_GIT_COMMAND` | warning |
| `DIRECT_GH_COMMAND` | warning |
| `DIRECT_MERGE` | error |
| `BYPASS_GATES` | error |
| `MODIFY_CI_CONFIG` | critical |
| `SKIP_POLICY` | warning |
| `FORBIDDEN_ACTION` | critical |

## Enforcement Modes

### Soft Enforcement (Current)

- Violations are logged to `failures.ndjson`
- Violations appear in `StatusResponse.riskFlags`
- Warnings are emitted in run summary
- Operations are **not blocked**

### Hard Enforcement (Future)

- Violations block the operation
- Run may be aborted for critical violations
- Explicit handling required before proceeding

## Risk Flags

Violations are reflected in `StatusResponse.riskFlags`:

```json
{
  "runId": "01JDXYZ...",
  "state": "executing",
  "riskFlags": [
    "violations:3",
    "error-violations:1",
    "direct-merge-attempted"
  ]
}
```

### Available Risk Flags

| Flag Pattern | Description |
|--------------|-------------|
| `violations:{n}` | Total violation count |
| `critical-violations:{n}` | Critical severity count |
| `error-violations:{n}` | Error severity count |
| `direct-merge-attempted` | DIRECT_MERGE violation occurred |
| `gates-bypassed` | BYPASS_GATES violation occurred |
| `ci-config-modified` | MODIFY_CI_CONFIG violation occurred |

## Violation Logging

All violations are logged to the run's `failures.ndjson` file:

```
.lexrunner/runs/{runId}/failures.ndjson
```

Each line is a JSON object:

```json
{"timestamp":"2025-11-26T12:34:56.789Z","runId":"01JDXYZ...","violation":"DIRECT_GIT_COMMAND","command":"git merge main","context":"Attempted during active run","severity":"warning","blocked":false}
```

## Configuration

Enforcement can be configured via `EnforcementConfig`:

```typescript
interface EnforcementConfig {
  /** Enforcement mode: "soft" or "hard" */
  mode: "soft" | "hard";
  
  /** Modes that require enforcement */
  enforcedModes: string[];
  
  /** Git commands that trigger violations */
  forbiddenGitCommands: string[];
  
  /** GH CLI commands that trigger violations */
  forbiddenGhCommands: string[];
  
  /** Paths that trigger CI config violations */
  protectedCiPaths: string[];
}
```

### Default Configuration

```typescript
{
  mode: "soft",
  enforcedModes: ["senior-dev", "tool-grounded"],
  forbiddenGitCommands: [
    "git merge",
    "git push",
    "git rebase",
    "git cherry-pick",
    "git reset --hard",
    "git checkout -B"
  ],
  forbiddenGhCommands: [
    "gh pr merge",
    "gh pr close",
    "gh pr create"
  ],
  protectedCiPaths: [
    ".github/workflows/",
    ".gitlab-ci.yml",
    "Jenkinsfile",
    ".circleci/",
    "azure-pipelines.yml"
  ]
}
```

## API Reference

### checkAndLogViolation

Check a command for violations and optionally log them:

```typescript
import { checkAndLogViolation } from "./runs/enforcement.js";

const violation = checkAndLogViolation(
  "01JDXYZ...",           // runId
  "git merge main",       // command
  {
    mode: "senior-dev",   // run mode
    log: true,            // log to failures.ndjson
    context: "...",       // optional context
  }
);

if (violation) {
  console.log(`Violation: ${violation.violation} (${violation.severity})`);
}
```

### getViolations

Retrieve all violations for a run:

```typescript
import { getViolations } from "./runs/enforcement.js";

const violations = getViolations("01JDXYZ...", baseDir);
console.log(`Total violations: ${violations.length}`);
```

### generateViolationRiskFlags

Generate risk flags for StatusResponse:

```typescript
import { getViolations, generateViolationRiskFlags } from "./runs/enforcement.js";

const violations = getViolations(runId, baseDir);
const riskFlags = generateViolationRiskFlags(violations);
// ["violations:3", "error-violations:1", "direct-merge-attempted"]
```

## Integration with StatusResponse

The `buildStatusResponse` function automatically includes violation risk flags when a `baseDir` is provided:

```typescript
import { buildStatusResponse } from "./runs/statusBuilder.js";

const status = buildStatusResponse(runState, { baseDir: "/path/to/repo" });
// status.riskFlags will include violation flags
```

## Related Documentation

- [Tool-Grounded Prompt](./tool-grounded-prompt.md) - System prompt for tool-grounded mode
- [Tool-Grounded Run-Centric](./tool-grounded-run-centric.md) - Run-centric architecture overview
- [Safety Mechanisms](../SAFETY_MECHANISMS.md) - Safety guards and protections
