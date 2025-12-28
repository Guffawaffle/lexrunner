# LexRunner Error Codes

## Overview

LexRunner uses structured AXError format for all error responses. Each error includes:

- **code**: Stable identifier (UPPER_SNAKE_CASE)
- **message**: Human-readable description
- **context**: Optional details about the error
- **nextActions**: Array of recovery suggestions (minimum 1)

See: `src/errors/index.ts` for error code definitions and `src/errors/adapters.ts` for error constructors.

## Error Categories

### Gate Errors

#### GATE_FAILED

A gate (lint, test, typecheck, etc.) failed during execution.

**Context:**

- `gate`: Name of the failed gate
- `item`: PR or item name (optional)
- `exitCode`: Exit code from gate execution
- `artifactPath`: Path to gate artifacts

**Example nextActions:**

- Check gate output in artifacts directory
- Run gate locally to reproduce (`npm run lint`, `npm test`, etc.)
- Fix errors and push again

**Example:**

```json
{
  "code": "GATE_FAILED",
  "message": "Gate 'lint' failed for PR-123",
  "context": {
    "gate": "lint",
    "item": "PR-123",
    "exitCode": 1,
    "reversibility": "reversible"
  },
  "nextActions": ["Run 'npm run lint' locally to reproduce", "Fix lint errors and push again"]
}
```

#### GATE_NOT_FOUND

Requested gate was not found in the plan.

#### GATE_TIMEOUT

Gate execution exceeded timeout threshold.

### Merge Errors

#### MERGE_CONFLICT

Git merge conflict detected during merge operation.

**Context:**

- `item`: PR or item name
- `pr`: PR number
- `files`: Array of conflicted files
- `targetBranch`: Branch being merged into

**Example nextActions:**

- Resolve conflicts manually in the affected files
- Rebase PR on latest target branch
- List of conflicted files

**Example:**

```json
{
  "code": "MERGE_CONFLICT",
  "message": "Merge conflict for PR-456",
  "context": {
    "item": "PR-456",
    "files": ["src/cli.ts", "src/schema.ts"],
    "targetBranch": "main",
    "reversibility": "reversible",
    "rollbackPath": "git merge --abort or git reset --hard HEAD~1"
  },
  "nextActions": [
    "Resolve conflicts manually in the affected files",
    "Rebase PR-456 on main",
    "Affected files: src/cli.ts, src/schema.ts"
  ]
}
```

#### MERGE_BLOCKED

Merge is blocked by policy or dependencies.

#### MERGE_CYCLE_DETECTED

Cycle detected in merge dependency graph (alias for PLAN_CYCLE_DETECTED).

### Plan Errors

#### PLAN_VALIDATION_FAILED

Plan file failed schema validation.

**Context:**

- `errors`: Array of validation error messages
- `planPath`: Path to the plan file

**Example nextActions:**

- Review the plan file for schema violations
- Check plan file path
- List of specific errors

#### PLAN_NOT_FOUND

Plan file not found at expected location.

**Example nextActions:**

- Run 'plan.create' to generate a plan
- Check if plan file exists and is accessible
- Ensure plan.json exists in the profile runner directory

#### PLAN_CYCLE_DETECTED

Cycle detected in plan item dependencies.

**Context:**

- `cycle`: Array of item names forming the cycle

**Example nextActions:**

- Review the dependency declarations in the affected PRs
- Remove or restructure dependencies to break the cycle
- Visualization of cycle path (A → B → C → A)

**Example:**

```json
{
  "code": "PLAN_CYCLE_DETECTED",
  "message": "Dependency cycle detected: PR-1 → PR-2 → PR-3 → PR-1",
  "context": {
    "cycle": ["PR-1", "PR-2", "PR-3", "PR-1"]
  },
  "nextActions": [
    "Review the dependency declarations in the affected PRs",
    "Remove or restructure dependencies to break the cycle",
    "Cycle path: PR-1 → PR-2 → PR-3 → PR-1"
  ]
}
```

#### UNKNOWN_DEPENDENCY

Plan item references a dependency that doesn't exist in the plan.

**Context:**

- `item`: Item that has the unknown dependency
- `dependency`: Name of the unknown dependency
- `availableItems`: List of available items in the plan

**Example nextActions:**

- Check that the dependency is included in the plan
- Verify the dependency reference spelling
- List of available items

### GitHub Errors

#### GITHUB_API_ERROR

Generic GitHub API request failure.

**Context:**

- `status`: HTTP status code
- `endpoint`: API endpoint that failed
- `message`: Error message from GitHub

**Example nextActions:**

- Check the GitHub API status page
- Retry the operation after a brief wait
- Review endpoint details

#### GITHUB_RATE_LIMIT

GitHub API rate limit exceeded.

**Context:**

- `status`: 429
- `retryAfter`: Seconds to wait before retrying

**Example nextActions:**

- Wait specified time before retrying
- Consider using a GitHub App token for higher limits
- Reduce API call frequency

#### GITHUB_AUTH_ERROR

GitHub authentication failed (invalid/expired token).

**Context:**

- `status`: 401 or 403

**Example nextActions:**

- Check that GITHUB_TOKEN is set and valid
- Verify the token has required permissions
- Run `gh auth status` to check authentication

### Git Errors

#### GIT_OPERATION_FAILED

Git operation (checkout, merge, etc.) failed.

**Context:**

- `operation`: Name of the git operation
- `command`: Git command that failed
- `message`: Error message

**Example nextActions:**

- Check git status for uncommitted changes
- Ensure you're on the correct branch
- Review git output for details

#### GIT_CONFLICT

Git conflict during operation.

### Weave Errors

#### WEAVE_LOCK_CONFLICT

Lock file conflict detected (stale or in use).

**Context:**

- `lockFile`: Path to lock file
- `expectedVersion`: Expected lock version
- `actualVersion`: Actual lock version

**Example nextActions:**

- Remove stale lock file
- Wait for other weave operation to complete
- Verify no concurrent weave processes are running

#### WEAVE_STATE_INVALID

Invalid state transition in weave state machine.

**Context:**

- `currentState`: Current weave state
- `event`: Event that was attempted
- `availableEvents`: Valid events for current state

**Example nextActions:**

- Check current weave state
- Review available transitions
- Use 'reset' event to return to idle state

#### WEAVE_PREFLIGHT_FAILED

Preflight merge simulation failed.

**Context:**

- `itemBranch`: Branch being merged
- `targetBranch`: Target branch
- `originalError`: Error message

**Example nextActions:**

- Verify source and target branches exist
- Run 'git fetch' to update remote references
- Check git repository status

### Configuration Errors

#### CONFIG_INVALID

Configuration file is invalid.

**Example nextActions:**

- Check configuration file syntax
- Ensure all required fields are present
- Validate against schema

#### PROFILE_NOT_FOUND

Profile directory not found.

**Example nextActions:**

- Run 'local.init' to create a local profile
- Set LEX_PR_PROFILE_DIR environment variable
- Ensure .smartergpt/ or .smartergpt.local/ exists

#### WRITE_PROTECTION_ERROR

Write operation blocked by profile protection.

**Context:**

- `operation`: Operation that was blocked

**Example nextActions:**

- Use a local overlay profile for write operations
- Set role to 'local' or 'ci' in manifest.yaml
- Run 'local.init' to create a writable profile

### Run Lifecycle Errors

#### RUN_NOT_FOUND

Run not found by runId.

**Context:**

- `runId`: ID of the run that was not found

**Example nextActions:**

- List available runs with: lex-pr runs list
- Check .lexrunner/runs/ directory for artifacts

#### RUN_ALREADY_COMPLETE

Run is already complete and cannot be modified.

#### RUN_STATE_INVALID

Run state is invalid for the requested operation.

### Resource Errors

#### BUDGET_EXCEEDED

Budget limit exceeded (tokens, time, operations, etc.).

### Security Errors

#### SECURITY_POLICY_VIOLATION

Operation violated security policy.

#### COMMAND_VALIDATION_FAILED

Command failed security validation.

#### SECURITY_AUTH_FAILED

Authentication failed.

**Example nextActions:**

- Check that credentials are valid
- Verify required permissions
- Check authentication status

#### SECURITY_UNAUTHORIZED

User is not authorized for operation.

**Context:**

- `user`: Username
- `permission`: Required permission
- `roles`: Current user roles
- `level`: Required authorization level
- `maxLevel`: User's maximum level

#### SECURITY_COMMAND_BLOCKED

Command is blocked by security policy.

**Context:**

- `command`: Blocked command
- `reason`: Why it was blocked (not_whitelisted, dangerous_args, shell_operators, too_long, hallucination_threshold)

#### SECURITY_COMPLIANCE_VIOLATION

Operation violates compliance requirements (SOC2, HIPAA, etc.).

#### SECURITY_SECRET_DETECTED

Secret was detected in content.

#### SECURITY_SECRET_NOT_FOUND

Required secret not found.

#### SECURITY_SARIF_PARSE_ERROR

SARIF file parsing failed.

#### SECURITY_SCAN_FAILED

Security scan failed.

**Context:**

- `scanner`: Name of security scanner (e.g., npm-audit)
- `directory`: Directory that was scanned

### Generic Errors

#### INTERNAL_ERROR

Internal error - unexpected condition.

**Example nextActions:**

- Review the error details and retry
- Check logs for more context

#### INVALID_INPUT

Invalid input parameters.

## Usage Examples

### In MCP Tools

MCP tools use the `throwMcpAXError()` helper to throw structured errors:

```typescript
import { throwMcpAXError, planNotFoundError } from "../errors/index.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Example: Plan not found
if (!fs.existsSync(planPath)) {
  throwMcpAXError(ErrorCode.InvalidParams, planNotFoundError(planPath));
}

// Example: Cycle detected
if (error instanceof CycleError) {
  const cycle = extractCycleFromError(error);
  throwMcpAXError(ErrorCode.InvalidParams, cycleDetectedError({ cycle }));
}
```

### In Gate Execution

Gate failures use `wrapGateFailure()` and can be converted to AXError:

```typescript
import { wrapGateFailure, failurePayloadToAXError } from "./runs/failures.js";

const gateResult = await executeGate(gate, policy, artifactDir);
if (gateResult.status === "fail") {
  const payload = wrapGateFailure(gateResult, { runId: "run-123" });
  const axError = failurePayloadToAXError(payload, "PR-123");

  // axError is now in AX format with code, message, nextActions
  console.error(JSON.stringify(axError, null, 2));
}
```

### Direct Error Creation

Use adapter functions to create AXErrors directly:

```typescript
import { gateFailedError, mergeConflictError } from "../errors/adapters.js";

// Gate failure
const error = gateFailedError({
  gate: "lint",
  item: "PR-123",
  exitCode: 1,
  artifactPath: "artifacts/PR-123/lint/",
});

// Merge conflict
const error = mergeConflictError({
  item: "PR-456",
  files: ["src/cli.ts", "src/schema.ts"],
  targetBranch: "main",
});
```

## Error Code Stability

Error codes are **stable identifiers** that agents can rely on for automated error handling. Once published, error codes follow semantic versioning:

- **MAJOR**: Removing or significantly changing an error code
- **MINOR**: Adding new error codes
- **PATCH**: Clarifying nextActions or context fields

Agents should:

1. Check the `code` field to identify the error type
2. Parse `context` for structured error details
3. Present `nextActions` to users for recovery guidance
4. Use `message` for human-readable summary

## Related Documentation

- [AX-CONTRACT.md](../AX-CONTRACT.v0.1.yaml) - AX compliance requirements
- [src/errors/index.ts](../src/errors/index.ts) - Error code definitions
- [src/errors/adapters.ts](../src/errors/adapters.ts) - Error adapter functions
- [tests/ax-error-adapters.spec.ts](../tests/ax-error-adapters.spec.ts) - Error adapter tests
