# AX (Agent Experience) Compliance

**AX** is the set of principles and guarantees that make Lex tools work reliably for AI agents.

This document describes the AX philosophy, compliance requirements, and current status for LexRunner.

---

## Philosophy

> When an AI agent uses a tool, three things must be true:
>
> 1. **Structured Output** — The response is machine-parseable, not just human-readable
> 2. **Recoverable Errors** — When something fails, the agent knows what went wrong and what to try next
> 3. **Surface Parity** — What works via CLI also works via MCP, with identical semantics

AX is the contract that ensures these three properties hold across the Lex ecosystem.

---

## AX Guarantees

### 2.1 Structured Output (`--json`)

Every CLI command that produces output MUST support a `--json` flag that:

- Outputs valid JSON (parseable by any JSON parser)
- Uses a consistent envelope format
- Includes machine-readable type information

**Envelope format:**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "version": "0.6.0",
    "timestamp": "2025-01-04T12:00:00Z"
  }
}
```

**Error envelope:**

```json
{
  "success": false,
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "Plan file not found at specified path",
    "context": { "path": "plan.json" },
    "nextActions": [
      "Run 'lex-pr weave plan' to generate a plan",
      "Check that the file path is correct"
    ]
  }
}
```

### 2.2 Recoverable Errors (AXError Schema)

All errors MUST follow the AXError schema:

```typescript
interface AXError {
  code: string; // UPPER_SNAKE_CASE, stable across versions
  message: string; // Human-readable description
  context?: object; // Machine-readable context (IDs, paths, etc.)
  nextActions: string[]; // At least one recovery suggestion
}
```

**Why this matters:** An agent that encounters an error can:

1. Parse the `code` to decide programmatic handling
2. Extract `context` for retry logic
3. Try `nextActions` in sequence

### 2.3 Surface Parity (MCP ↔ CLI)

For every MCP tool, there SHOULD be a CLI equivalent with identical semantics.
For every CLI command, there SHOULD be an MCP tool with identical semantics.

**Rationale:**

- Agents may use either surface depending on context
- Humans debug via CLI, agents orchestrate via MCP
- Testing one surface validates the other

---

## LexRunner Compliance Matrix

### CLI Commands

| Command              | `--json` | AXError | MCP Equivalent   | Status                |
| -------------------- | -------- | ------- | ---------------- | --------------------- |
| `weave discover`     | ✅       | ✅      | `discover`       | ✅ Compliant          |
| `weave plan`         | ✅       | ✅      | `plan_create`    | ✅ Compliant          |
| `weave status`       | ✅       | ✅      | `weave_status`   | ✅ Compliant          |
| `weave apply`        | ✅       | ✅      | `merge_apply`    | ✅ Compliant          |
| `gate run`           | ✅       | ✅      | `gates_run`      | ✅ Compliant          |
| `merge`              | ✅       | ✅      | `merge_apply`    | ✅ Compliant          |
| `merge-order`        | ✅       | ✅      | `merge_order`    | ✅ Compliant          |
| `doctor`             | ✅       | ✅      | `doctor`         | ✅ Compliant          |
| `config:inspect`     | ✅       | ✅      | `config_show`    | ✅ Compliant          |
| `metrics`            | ✅       | ✅      | `metrics`        | ✅ Compliant          |
| `fanout analyze`     | ✅       | ✅      | `fanout_analyze` | ✅ Compliant          |
| `fanout harvest`     | ✅       | ✅      | `fanout_harvest` | ✅ Compliant          |
| `init`               | ✅       | ✅      | `local_init`     | ✅ Compliant          |
| `schema validate`    | ✅       | ✅      | `plan_validate`  | ✅ Compliant          |
| `governance:report`  | ✅       | ✅      | —                | ⚠️ Missing MCP        |
| `governance:cleanup` | ✅       | ✅      | —                | ⚠️ Missing MCP        |
| `plan-review`        | ⚠️       | ✅      | —                | ⚠️ Interactive        |
| `plan-diff`          | ⚠️       | ✅      | —                | ⚠️ Needs `--json`     |
| `autopilot`          | ⚠️       | ✅      | —                | ⚠️ Needs `--json`     |
| `explain`            | ⚠️       | ✅      | —                | ⚠️ Needs verification |
| `idea`               | N/A      | ✅      | —                | Interactive           |
| `senior-dev`         | ⚠️       | ✅      | `executor_*`     | ⚠️ Partial            |
| `budget`             | ⚠️       | ✅      | —                | ⚠️ Needs verification |
| `security *`         | ✅       | ✅      | —                | ⚠️ Missing MCP        |
| `counter-examples`   | ⚠️       | ✅      | —                | ⚠️ Needs verification |
| `deliverables:*`     | ✅       | ✅      | —                | ⚠️ Missing MCP        |
| `token-report`       | ⚠️       | ✅      | —                | ⚠️ Needs verification |

### MCP Tools

| Tool                   | Has CLI              | AXError | Status         |
| ---------------------- | -------------------- | ------- | -------------- |
| `plan_create`          | ✅ `weave plan`      | ✅      | ✅ Compliant   |
| `pr_list`              | ✅ `discover`        | ✅      | ✅ Compliant   |
| `plan_validate`        | ✅ `schema validate` | ✅      | ✅ Compliant   |
| `plan_analyze`         | —                    | ✅      | ⚠️ Missing CLI |
| `gates_run`            | ✅ `gate run`        | ✅      | ✅ Compliant   |
| `merge_apply`          | ✅ `weave apply`     | ✅      | ✅ Compliant   |
| `local_init`           | ✅ `init`            | ✅      | ✅ Compliant   |
| `profile_resolve`      | ⚠️                   | ✅      | ⚠️ Partial CLI |
| `health`               | ✅ `doctor`          | ✅      | ✅ Compliant   |
| `discover`             | ✅ `weave discover`  | ✅      | ✅ Compliant   |
| `weave_status`         | ✅ `weave status`    | ✅      | ✅ Compliant   |
| `doctor`               | ✅ `doctor`          | ✅      | ✅ Compliant   |
| `merge_order`          | ✅ `merge-order`     | ✅      | ✅ Compliant   |
| `config_show`          | ✅ `config:inspect`  | ✅      | ✅ Compliant   |
| `workflow_guide`       | —                    | ✅      | ⚠️ Missing CLI |
| `metrics`              | ✅ `metrics`         | ✅      | ✅ Compliant   |
| `executor_*`           | ⚠️ `senior-dev`      | ✅      | ⚠️ Partial     |
| `start_run`            | —                    | ✅      | ⚠️ Missing CLI |
| `get_status`           | —                    | ✅      | ⚠️ Missing CLI |
| `list_artifacts`       | —                    | ✅      | ⚠️ Missing CLI |
| `run_decision`         | —                    | ✅      | ⚠️ Missing CLI |
| `create_task_snapshot` | —                    | ✅      | ⚠️ Missing CLI |
| `submit_task_receipt`  | —                    | ✅      | ⚠️ Missing CLI |
| `get_task_status`      | —                    | ✅      | ⚠️ Missing CLI |
| `list_pending_tasks`   | —                    | ✅      | ⚠️ Missing CLI |
| `fanout_harvest`       | ✅                   | ✅      | ✅ Compliant   |
| `fanout_analyze`       | ✅                   | ✅      | ✅ Compliant   |

---

## Error Codes Reference

LexRunner defines these error code categories:

| Category         | Prefix       | Examples                                   |
| ---------------- | ------------ | ------------------------------------------ |
| Plan errors      | `PLAN_*`     | `PLAN_NOT_FOUND`, `PLAN_VALIDATION_FAILED` |
| Gate errors      | `GATE_*`     | `GATE_EXECUTION_FAILED`, `GATE_TIMEOUT`    |
| Merge errors     | `MERGE_*`    | `MERGE_CONFLICT`, `MERGE_CYCLE_DETECTED`   |
| GitHub errors    | `GITHUB_*`   | `GITHUB_API_ERROR`, `GITHUB_RATE_LIMIT`    |
| Config errors    | `CONFIG_*`   | `CONFIG_NOT_FOUND`, `CONFIG_INVALID`       |
| Write protection | `WRITE_*`    | `WRITE_PROTECTION_VIOLATION`               |
| Internal errors  | `INTERNAL_*` | `INTERNAL_ERROR`                           |

All error codes are exported from `src/errors/index.ts` and re-use the AXError schema from `@smartergpt/lex`.

---

## Implementing AX Compliance

### For CLI Commands

```typescript
import { createAXError, AXErrorException } from "../errors/index.js";

// Success path
if (opts.json) {
  console.log(
    JSON.stringify({
      success: true,
      data: result,
      meta: { version: VERSION, timestamp: new Date().toISOString() },
    })
  );
} else {
  console.log(formatHuman(result));
}

// Error path
throw new AXErrorException(
  "PLAN_NOT_FOUND",
  `Plan file not found: ${path}`,
  ["Run 'lex-pr weave plan' to generate a plan", "Check that the path is correct"],
  { path }
);
```

### For MCP Handlers

```typescript
import { mcpToolError, throwMcpAXError } from "./errors.js";

// Error path - use helper
throwMcpAXError(
  ErrorCode.InvalidParams,
  mcpToolError("PLAN_NOT_FOUND", "Plan file not found", { path })
);
```

---

## Gaps and Roadmap

### P1: Critical for 1.0.1

1. **Run lifecycle CLI** — Add `lex-pr run` commands for start/status/list/decide
2. **Task handoff CLI** — Add `lex-pr task` commands for ADR-007 support
3. **`--json` verification** — Audit remaining commands for proper JSON output

### P2: Desired for 1.1.0

1. **Governance MCP tools** — `governance_report`, `governance_cleanup`
2. **Security MCP tools** — `security_check_rotation`, `security_scan_plan`
3. **Plan analysis CLI** — `lex-pr analyze` for conflict/dependency analysis

### P3: Nice to have

1. **Interactive command JSON modes** — Non-interactive variants of `plan-review`, `idea`
2. **Deliverables MCP** — `deliverables_list`, `deliverables_cleanup`

---

## Testing AX Compliance

```bash
# Verify --json output is valid JSON
lex-pr weave discover --json | jq .

# Verify error structure
lex-pr weave apply --plan nonexistent.json --json 2>&1 | jq .error

# Verify MCP tool parity
# Compare: lex-pr weave discover --json
# With:    mcp_lexrunner_discover via MCP client
```

---

## Related Documentation

- [AX Contract](../AX-CONTRACT.md) — Ecosystem-wide AX guarantees
- [Error Codes](./ERROR_CODES.md) — Full error code reference
- [MCP Server](../README.mcp.md) — MCP tool documentation
- [Lex AXError](https://github.com/Guffawaffle/lex/blob/main/docs/AX-CONTRACT.md) — Core AXError specification

---

_Last updated: 2025-01-04_
_Audit: LexRunner v0.6.0 → v1.0.1_
