# ADR-007: Task Snapshot Contract

**Status:** Accepted
**Date:** 2025-12-19
**Deciders:** Senior Dev, PM, Lex
**Research:** `.smartergpt/deliverables/_research/snapshot-contract-feedback/`

---

## Context / Problem

The execution engine hands off bounded work to stochastic agents. Without a rigorous contract:

- Agents hallucinate missing context
- Receipts are untrusted claims
- Failures are hard to replay/audit
- Token costs are unmeasured and unoptimized

**Research conducted:** We asked 4 smaller models (o3-mini codex, Raptor mini, Claude Haiku, Gemini Flash) what they need in a task snapshot. All agreed on: context lines, source of truth, concrete examples, output schema. All admitted they'd hallucinate scope and assumptions if not constrained.

**Core insight:** The snapshot is not a prompt—it's a contract. The receipt is not truth—it's a claim. The engine is the verifier.

```
Snapshot = hints (bounded context for agent)
Receipt  = claims (what agent says it did)
Engine   = verifier (source of truth)
Audit    = learning signal (token cost + trust gaps)
```

---

## Decisions (Locked)

### Decision #1: Verification Model

**Answer: Both. Trust but verify.**

- Agent runs verification and reports result in receipt (claim)
- Engine also runs verification (evidence)
- Disagreement → flag for human review + learning signal
- Over time, data shows if we can relax engine verification for D1 tasks

**Relaxation criteria (D1 only):** Skip engine verification if:

1. Agent verification passes, AND
2. Agent's trust_gap rate over last 20 tasks < 5%, AND
3. Task procedure is in the "verified-stable" set

### Decision #2: Agent Search Capability

**Answer: Agent may search, but must log token impact.**

- Snapshot is a _hint budget_, not exhaustive
- Agent has autonomy to search for related files
- Must report search activity + cost in receipt
- Data tells us: "when we provided X, agent used Y fewer tokens"

---

## Contract Requirements (Normative)

### Provenance

| Requirement                          | Level  | Rationale                                                     |
| ------------------------------------ | ------ | ------------------------------------------------------------- |
| `repo.id`                            | MUST   | Identifies which repository                                   |
| `repo.commit_sha`                    | MUST   | Pins exact state for replay                                   |
| `repo.root`                          | MUST   | Absolute path for file operations                             |
| `snapshot_hash`                      | MUST   | SHA256 of canonical snapshot JSON (binds receipt to snapshot) |
| `source_of_truth.path`               | SHOULD | Where the canonical data lives (repo-relative)                |
| `source_of_truth.repo_id`            | SHOULD | Repository if cross-repo (defaults to snapshot repo)          |
| `source_of_truth.commit_sha`         | SHOULD | Commit if cross-repo (defaults to snapshot commit)            |
| `source_of_truth.excerpt`            | SHOULD | Concrete snippet for verification                             |
| `source_of_truth.introducing_change` | MAY    | Diff hunk that caused the change                              |

### Scope Boundary

| Requirement                | Level | Rationale                               |
| -------------------------- | ----- | --------------------------------------- |
| `scope.read_globs`         | MUST  | What agent can read                     |
| `scope.write_globs`        | MUST  | What agent can modify                   |
| `scope.deny_globs`         | MUST  | Explicit exclusions (even if empty)     |
| `scope.cross_repo_allowed` | MUST  | Whether multi-repo operations permitted |

### Failure Evidence

| Requirement                  | Level  | Rationale                         |
| ---------------------------- | ------ | --------------------------------- |
| `failure.message`            | MUST   | Short error description           |
| `failure.file_rel`           | MUST   | Repo-relative path to failed file |
| `failure.line`               | SHOULD | Line number if available          |
| `failure.runner_output_snip` | MUST   | Actual test runner output         |
| `failure.excerpt`            | SHOULD | Code context around failure       |

### Targets

| Requirement          | Level | Rationale                                         |
| -------------------- | ----- | ------------------------------------------------- |
| `targets[]`          | MUST  | Array (support multi-file edits)                  |
| `target.path_rel`    | MUST  | Repo-relative file path (portable, diff-friendly) |
| `target.hunk`        | MUST  | Anchored code context (±N lines)                  |
| `target.hunk_sha256` | MUST  | Drift detection                                   |
| `target.hint_edit`   | MAY   | Suggested find/replace                            |

### Invariants

| Requirement           | Level  | Rationale                                            |
| --------------------- | ------ | ---------------------------------------------------- |
| `invariants[]`        | SHOULD | Behavioral constraints (anti-brittleness)            |
| Semantic over numeric | -      | e.g., "Prefer semantic assertion over numeric count" |
| Scope limits          | -      | e.g., "Do not change production code"                |
| Ordering constraints  | -      | e.g., "Keep tool ordering unchanged"                 |
| Canonical source      | -      | e.g., "Registry is source of truth"                  |

### Verification Expectations

| Requirement                            | Level  | Rationale                          |
| -------------------------------------- | ------ | ---------------------------------- |
| `verification.cmd`                     | MUST   | Command to run                     |
| `verification.expect.exit_code`        | MUST   | Expected exit code (usually 0)     |
| `verification.expect.must_include`     | SHOULD | Strings that must appear in output |
| `verification.expect.must_not_include` | SHOULD | Strings that must not appear       |

### Truncation Policy

| Requirement                            | Level | Rationale                                        |
| -------------------------------------- | ----- | ------------------------------------------------ |
| `budget.max_bytes`                     | MAY   | Token budget hint                                |
| `budget.truncated_fields`              | MUST  | List of fields that were dropped (even if empty) |
| Fail-fast on required field truncation | MUST  | Never truncate MUST fields                       |
| Optional fields may drop               | MAY   | But must be listed in `truncated_fields`         |

---

## Consequences

### Positive

- **Replay/audit:** Any snapshot + receipt can be replayed and verified
- **Hallucination prevention:** Anchored hunks + hashes detect drift
- **Cost optimization:** Token tracking enables data-driven hint improvement
- **Trust calibration:** Engine verification catches agent overconfidence

### Negative

- **Higher upfront work:** Engine must compute hunks, hashes, and scope
- **Schema complexity:** More fields to validate and maintain
- **Storage cost:** Audit logs grow with verification records

### Neutral

- **Learning opportunity:** Trust gaps become training data for LexSona

---

## Appendix A: Snapshot Schema (v1)

```typescript
interface TaskSnapshot_v1 {
  // Schema version
  schema_version: "1.0.0";

  // Identity
  task_id: string; // Unique identifier
  procedure: string; // "post-merge-fix", "fanout-issue", etc.
  determinism: "D1" | "D2" | "D3";
  snapshot_hash: string; // SHA256 of canonical snapshot (receipt must echo)

  // Provenance (MUST)
  repo: {
    id: string; // "owner/name"
    root: string; // Absolute path (engine-local, not contract-canonical)
    commit_sha: string; // Pinned state
  };

  // Scope boundary (MUST)
  scope: {
    read_globs: string[]; // What agent can read
    write_globs: string[]; // What agent can modify
    deny_globs: string[]; // Explicit exclusions
    cross_repo_allowed: boolean;
  };

  // Failure evidence (MUST)
  failure: {
    message: string; // Short description
    file_rel: string; // Repo-relative path
    line?: number; // Line number if known
    runner_output_snip: string; // Actual output
    excerpt?: string; // Code context
  };

  // Targets (MUST, array)
  targets: Array<{
    path_rel: string; // Repo-relative path (portable)
    hunk: string; // Anchored context
    hunk_sha256: string; // Drift detection
    hint_edit?: {
      // Optional suggestion
      find: string;
      replace: string;
    };
  }>;

  // Invariants (SHOULD) - anti-brittleness constraints
  invariants?: string[]; // e.g., "Prefer semantic assertion over numeric count"

  // Source of truth (SHOULD)
  source_of_truth?: {
    kind: "symbol" | "file" | "registry";
    path_rel: string; // Repo-relative path
    repo_id?: string; // Defaults to snapshot repo if omitted
    commit_sha?: string; // Defaults to snapshot commit if omitted
    excerpt: string;
    lexmap_module_id?: string;
    introducing_change?: {
      commit_sha: string;
      diff_hunk: string;
    };
  };

  // Verification expectations (MUST)
  verification: {
    cmd: string;
    expect: {
      exit_code: number;
      must_include?: string[];
      must_not_include?: string[];
    };
  };

  // Budget/truncation (MUST)
  budget: {
    max_bytes?: number;
    truncated_fields: string[]; // Empty if nothing truncated
  };

  // Output contract
  receipt_schema_id: string; // e.g., "TaskReceipt_v1"
}
```

---

## Appendix B: Receipt Schema (v1)

```typescript
interface TaskReceipt_v1 {
  // Schema version
  schema_version: "1.0.0";

  // Identity (echo from snapshot)
  task_id: string;
  snapshot_hash: string; // MUST echo snapshot's hash (prevents floating receipts)

  // Claims (what agent says it did)
  claims: {
    success: boolean;
    patch?: string; // Unified diff
    files_touched: string[]; // Repo-relative paths
    rationale: string; // Why this fix
    confidence: "high" | "medium" | "low";
    invariants_respected?: string[]; // Which invariants were followed
    assumptions_made: Array<{
      // Structured for learning
      type: "scope" | "codebase" | "env" | "intent" | "dependency" | "test";
      text: string;
      validated?: boolean;
      evidence?: string;
    }>;
  };

  // Search activity (if agent searched)
  search_activity: Array<{
    query: string;
    method?: string; // "grep", "ripgrep", "tsserver", "semantic", etc.
    roots: string[]; // Where searched (repo-relative)
    results_count?: number;
    time_ms?: number;
  }>;

  // Cost tracking
  cost: {
    token_usage?: {
      input: number;
      output: number;
      total: number;
    };
    tool_calls_count?: number;
    elapsed_ms?: number;
  };

  // Agent's verification attempt (still a claim)
  agent_verification?: {
    cmd_ran: boolean;
    exit_code?: number;
    output_snip?: string;
  };

  // Blockers (if not successful)
  blockers: string[];
}
```

---

## Appendix C: Engine Verification Record (v1)

Separate from receipt—this is the engine's proof.

```typescript
interface EngineVerification_v1 {
  // Identity
  task_id: string;
  timestamp: string; // ISO 8601

  // Hash binding (audit trail)
  snapshot_hash: string; // From original snapshot
  receipt_hash: string; // SHA256 of receipt JSON

  // Verification result
  verified: boolean;

  // What engine ran
  cmd_ran: string;
  exit_code: number;
  stdout_snip: string;
  stderr_snip: string;

  // Patch verification
  patch_hash?: string; // SHA256 of applied patch bytes (not empty string!)
  patch_applied: boolean;

  // Comparison with agent claim
  agent_claimed: boolean; // What agent said
  trust_gap: boolean; // agent_claimed !== verified

  // Failures detected
  failures: Array<{
    type: string;
    message: string;
    file?: string;
    line?: number;
  }>;
}
```

---

## Appendix D: Example Trio (Golden Fixture)

### Snapshot

**Note:** Examples use placeholder hashes. Real systems MUST hash the actual content bytes.

```json
{
  "schema_version": "1.0.0",
  "task_id": "fix-tool-count-2025-12-19-001",
  "procedure": "post-merge-fix",
  "determinism": "D1",
  "snapshot_hash": "sha256:abc123...PLACEHOLDER",
  "repo": {
    "id": "Guffawaffle/lexrunner",
    "root": "/srv/lex-mcp/lexrunner",
    "commit_sha": "81102f1452a3ad0428879c32a02ede2771df63fc"
  },
  "scope": {
    "read_globs": ["**/*.ts", "**/*.json"],
    "write_globs": ["tests/**/*.spec.ts"],
    "deny_globs": ["node_modules/**", "dist/**"],
    "cross_repo_allowed": false
  },
  "failure": {
    "message": "Expected 6, received 7",
    "file_rel": "tests/unit/weave/metrics-schema.spec.ts",
    "line": 45,
    "runner_output_snip": "FAIL tests/unit/weave/metrics-schema.spec.ts\n  ✕ should have correct tool count (3ms)\n    expect(received).toBe(expected)\n    Expected: 6\n    Received: 7",
    "excerpt": "it('should have correct tool count', () => {\n  expect(tools.length).toBe(6);\n});"
  },
  "invariants": [
    "Prefer semantic assertion over numeric count when possible",
    "Registry INTERVENTION_CATALOG is source of truth for tool count"
  ],
  "targets": [
    {
      "path_rel": "tests/unit/weave/metrics-schema.spec.ts",
      "hunk": "describe('tool registry', () => {\n  it('should have correct tool count', () => {\n    expect(tools.length).toBe(6);\n  });\n\n  it('should include validate_remember', () => {",
      "hunk_sha256": "sha256:def456...PLACEHOLDER",
      "hint_edit": {
        "find": "expect(tools.length).toBe(6)",
        "replace": "expect(tools.length).toBe(7)"
      }
    }
  ],
  "source_of_truth": {
    "kind": "registry",
    "path_rel": "src/weave/metrics/schema.ts",
    "excerpt": "export const INTERVENTION_CATALOG = {\n  // ... 19 interventions including validate_remember\n}",
    "introducing_change": {
      "commit_sha": "81102f1452a3ad0428879c32a02ede2771df63fc",
      "diff_hunk": "+  'validate_remember': { ... }"
    }
  },
  "verification": {
    "cmd": "npm test -- tests/unit/weave/metrics-schema.spec.ts",
    "expect": {
      "exit_code": 0,
      "must_include": ["PASS"],
      "must_not_include": ["FAIL", "Expected: 6"]
    }
  },
  "budget": {
    "max_bytes": 8000,
    "truncated_fields": []
  },
  "receipt_schema_id": "TaskReceipt_v1"
}
```

### Receipt

```json
{
  "schema_version": "1.0.0",
  "task_id": "fix-tool-count-2025-12-19-001",
  "snapshot_hash": "sha256:abc123...PLACEHOLDER",
  "claims": {
    "success": true,
    "patch": "--- a/tests/unit/weave/metrics-schema.spec.ts\n+++ b/tests/unit/weave/metrics-schema.spec.ts\n@@ -43,7 +43,7 @@\n describe('tool registry', () => {\n   it('should have correct tool count', () => {\n-    expect(tools.length).toBe(6);\n+    expect(tools.length).toBe(7);\n   });",
    "files_touched": ["tests/unit/weave/metrics-schema.spec.ts"],
    "rationale": "Updated assertion to match new tool count after validate_remember was added",
    "confidence": "high",
    "invariants_respected": ["Registry INTERVENTION_CATALOG is source of truth for tool count"],
    "assumptions_made": [
      { "type": "test", "text": "No other tests rely on exact tool count", "validated": false },
      {
        "type": "codebase",
        "text": "validate_remember is the only new tool",
        "validated": true,
        "evidence": "git diff shows single addition"
      }
    ]
  },
  "search_activity": [],
  "cost": {
    "token_usage": {
      "input": 1200,
      "output": 350,
      "total": 1550
    },
    "tool_calls_count": 2,
    "elapsed_ms": 4500
  },
  "agent_verification": {
    "cmd_ran": true,
    "exit_code": 0,
    "output_snip": "PASS tests/unit/weave/metrics-schema.spec.ts"
  },
  "blockers": []
}
```

### Engine Verification

```json
{
  "task_id": "fix-tool-count-2025-12-19-001",
  "timestamp": "2025-12-19T00:45:00Z",
  "snapshot_hash": "sha256:abc123...PLACEHOLDER",
  "receipt_hash": "sha256:789xyz...PLACEHOLDER",
  "verified": true,
  "cmd_ran": "npm test -- tests/unit/weave/metrics-schema.spec.ts",
  "exit_code": 0,
  "stdout_snip": "PASS tests/unit/weave/metrics-schema.spec.ts\n  ✓ should have correct tool count (2ms)\n  ✓ should include validate_remember (1ms)",
  "stderr_snip": "",
  "patch_hash": "sha256:fedcba...PLACEHOLDER",
  "patch_applied": true,
  "agent_claimed": true,
  "trust_gap": false,
  "failures": []
}
```

---

## Path Convention

All contract paths are **repo-relative** (portable, diff-friendly):

- `failure.file_rel`, `target.path_rel`, `source_of_truth.path_rel`
- `repo.root` is the only absolute path (engine-local, for resolution)
- All globs are relative to `repo.root`

---

## Related

- ADR-001: Plan JSON as frozen input (similar contract philosophy)
- ADR-003: Gate uniform execution (verification pattern)
- Issue #609: Model tier handoff metrics (audit logging)
- Research: `.smartergpt/deliverables/_research/snapshot-contract-feedback/`
- Lex Review: 2025-12-19 (snapshot_hash binding, invariants, path convention)
