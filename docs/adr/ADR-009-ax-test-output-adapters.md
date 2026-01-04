# ADR-009: AX Test Output Adapters

**Status:** Proposed
**Date:** 2026-01-04
**Authors:** lexrunner team

---

## Context

Test runners emit output in wildly different formats:

| Runner           | Native Output              |
| ---------------- | -------------------------- |
| Vitest           | JSON, TAP, default console |
| Jest             | JSON, JUnit XML            |
| PHPUnit          | XML, JSON                  |
| pytest           | JSON, JUnit XML            |
| go test          | JSON lines                 |
| Node test runner | TAP, spec                  |

Agents consuming test results need **consistent, actionable output** regardless of the underlying test platform. Current CI gates capture pass/fail status but lack:

1. **Structured failure details** with file:line locations
2. **`nextActions[]`** suggesting recovery steps (AX pattern)
3. **Diff context** showing expected vs actual
4. **Summary-first output** for token-efficient agent consumption

---

## Decision

LexRunner will provide a **Test Gate Adapter system** that normalizes any test runner output into an AX-compliant schema.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  lexrunner gate test                                        │
│                                                             │
│   Input Adapters          Core            Output Formats    │
│  ┌──────────────┐    ┌──────────┐    ┌──────────────┐      │
│  │ vitest-json  │───▶│          │───▶│ ax-summary   │      │
│  │ jest-json    │───▶│ Normalize│───▶│ (JSON)       │      │
│  │ junit-xml    │───▶│    to    │───▶│              │      │
│  │ tap          │───▶│ AXTest   │    └──────────────┘      │
│  │ pytest-json  │───▶│ Result   │    ┌──────────────┐      │
│  │ go-test-json │───▶│          │───▶│ pr-comment   │      │
│  │ phpunit-xml  │───▶│          │───▶│ (Markdown)   │      │
│  └──────────────┘    └──────────┘    └──────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### AXTestResult Schema (v1.0.0)

> **Design principle:** This schema is a **verifiable contract**, not just a convenient shape.
> Normalization is never a one-way door — `raw` preserves original data for auditability.

```typescript
interface AXTestResult {
  schemaVersion: "1.0.0";
  timestamp: string; // ISO 8601

  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };

  // Only populated for failures - passing tests omitted for token efficiency
  failures: AXTestFailure[];

  // Optional coverage summary (percentages, 0-100)
  coverage?: {
    linesPct: number;
    branchesPct: number;
    functionsPct: number;
    statementsPct?: number;
  };

  // Run metadata for reproducibility
  run?: {
    cwd?: string; // Working directory
    command?: string; // Exact command executed
    ci?: boolean; // Running in CI environment
    os?: string; // e.g., "linux", "darwin", "win32"
    nodeVersion?: string; // e.g., "20.10.0"
  };

  // Adapter metadata
  adapter: {
    name: string; // e.g., "vitest-json"
    version: string;
    source: string; // Original output file/stream
  };

  // Original unparsed output — normalization is never a one-way door
  raw?: string;
}

interface AXTestFailure {
  // Identity & grouping (enables flaky detection, trend analysis)
  failureId: string; // Deterministic hash of (file + name + error.type + canonicalized message)
  signature?: string; // Normalized signature with volatile values scrubbed (timestamps, ports)

  // Location
  file: string; // Relative path
  line: number; // 1-indexed
  column?: number;

  name: string; // Test name / describe path
  suite?: string; // Parent suite/describe

  error: {
    message: string;
    type?: string; // e.g., "AssertionError", "TypeError"
    stack?: string; // Human-readable stack trace
  };

  // Structured stack for agent navigation
  stackFrames?: Array<{
    file: string;
    line: number;
    column?: number;
    function?: string;
  }>;

  // Assertion details
  assertion?: {
    operator?: string; // e.g., "toBe", "toEqual", "strictEqual"
    expectedType?: string; // e.g., "string", "LexSonaError"
    actualType?: string; // e.g., "undefined", "TypeError"
  };

  diff?: {
    expected: string;
    actual: string;
    unified?: string; // Unified diff format when applicable
    contextLines?: number; // Lines of context included
  };

  // AX-compliant recovery guidance (string or structured)
  nextActions: Array<string | AXNextAction>;
  nextActionsMeta?: {
    confidence: "high" | "medium" | "low";
  };

  // Duration for identifying slow tests
  durationMs?: number;

  // Original failure data from adapter — preserves runner-specific details
  raw?: unknown;
}

// Structured next action for agent execution
interface AXNextAction {
  kind: "rerun" | "inspect" | "fix" | "doc";
  cmd?: string; // Executable command
  note: string; // Human-readable description
}
```

### CLI Interface

```bash
# Explicit adapter (REQUIRED in CI mode for determinism)
lexrunner gate test --adapter=vitest --input=test-results.json

# Strict mode: require explicit adapter, fail on ambiguity
lexrunner gate test --strict --input=test-results.json
# Error: --adapter required in strict mode

# Auto-detect from file extension/content (local DX only, warns in CI)
lexrunner gate test --input=test-results.json
# Warning: Auto-detected adapter 'vitest-json'. Use --adapter for CI.

# Pipe mode (for integration)
vitest run --reporter=json | lexrunner gate test --adapter=vitest

# Output formats
lexrunner gate test --input=results.json --output=ax-summary.json
lexrunner gate test --input=results.json --format=markdown > pr-comment.md

# Include raw output for auditability
lexrunner gate test --adapter=vitest --input=results.json --include-raw
```

> **CI Recommendation:** Always use `--adapter` explicitly or `--strict` mode.
> Auto-detect is convenient for local development but can silently choose
> the wrong parser if output formats evolve between runner versions.

### Adapter Interface

```typescript
interface TestAdapter {
  name: string;
  version: string;

  // File extensions this adapter handles
  extensions: string[];

  // Content detection (for auto-detect)
  detect(content: string): boolean;

  // Parse raw output into normalized form
  parse(input: string | Buffer): AXTestResult;
}
```

### Built-in Adapters (v1.0.0)

| Adapter        | Priority | Rationale                                    |
| -------------- | -------- | -------------------------------------------- |
| `junit-xml`    | P0       | Universal CI lingua franca across ecosystems |
| `vitest-json`  | P0       | LexSona, LexRunner use Vitest                |
| `jest-json`    | P0       | Huge footprint, close to Vitest patterns     |
| `node-tap`     | P1       | Lex uses Node test runner with TAP           |
| `pytest-json`  | P1       | Very common in mixed stacks                  |
| `go-test-json` | P2       | Extremely structured, popular in infra repos |
| `phpunit-xml`  | P2       | Enterprise/legacy usage                      |

> **Note:** TAP is worth having but is one of the messier formats.
> Treat as "best effort + raw preservation" for edge cases.

### `nextActions[]` Generation

Adapters generate contextual suggestions based on failure patterns.
Actions can be strings (for display) or structured objects (for execution).

#### Rerun Templates (Per-Runner)

Each adapter provides runner-specific rerun commands:

| Runner  | Rerun Template                             |
| ------- | ------------------------------------------ |
| Vitest  | `vitest run -t "<name>"`                   |
| Jest    | `jest -t "<name>" --runInBand`             |
| pytest  | `pytest -k "<expr>" -q`                    |
| go test | `go test ./... -run "<regex>"`             |
| PHPUnit | `phpunit --filter "<name>"`                |
| Node    | `node --test --test-name-pattern="<name>"` |

#### Common Failure Patterns

```typescript
const FAILURE_PATTERNS: Record<string, PatternHandler> = {
  // Assertion failures
  "snapshot-mismatch": {
    detect: (msg) => msg.includes("snapshot") || msg.includes("toMatchSnapshot"),
    actions: [
      { kind: "fix", cmd: "npm test -- -u", note: "Update snapshots" },
      { kind: "inspect", note: "Verify snapshot changes are intentional" },
    ],
    confidence: "high",
  },

  // Module resolution
  "module-not-found": {
    detect: (msg) => msg.includes("Cannot find module") || msg.includes("ERR_MODULE_NOT_FOUND"),
    actions: [
      { kind: "inspect", note: "Verify import path is correct" },
      { kind: "inspect", note: "Check tsconfig paths configuration" },
      { kind: "fix", cmd: "npm install", note: "Reinstall dependencies" },
      { kind: "inspect", note: "Check for workspace hoisting issues" },
    ],
    confidence: "high",
  },

  // Timeouts
  timeout: {
    detect: (msg) => msg.includes("timeout") || msg.includes("exceeded"),
    actions: [
      { kind: "inspect", note: "Identify slow async operation" },
      { kind: "fix", note: "Consider using fake timers" },
      { kind: "fix", note: "Increase test timeout if legitimately slow" },
    ],
    confidence: "medium",
  },

  // Unhandled promises
  "unhandled-promise": {
    detect: (msg) => msg.includes("unhandled") && msg.includes("promise"),
    actions: [
      { kind: "fix", note: "Await the promise or return it from test" },
      { kind: "fix", note: "Add error handler to promise chain" },
    ],
    confidence: "high",
  },

  // Port/network collisions
  "port-in-use": {
    detect: (msg) => msg.includes("EADDRINUSE") || msg.includes("address already in use"),
    actions: [
      { kind: "fix", note: "Use random port allocation" },
      { kind: "fix", note: "Ensure proper teardown in afterEach/afterAll" },
      { kind: "inspect", note: "Check for leaked server instances" },
    ],
    confidence: "high",
  },

  // Time/date flakes
  "date-flake": {
    detect: (msg) => msg.includes("Date") || msg.includes("timestamp") || msg.includes("timezone"),
    actions: [
      { kind: "fix", note: "Use frozen time (vi.useFakeTimers, jest.useFakeTimers)" },
      { kind: "fix", note: "Avoid locale-sensitive date formatting in assertions" },
    ],
    confidence: "medium",
  },

  // Order dependence
  "order-dependent": {
    detect: (msg, ctx) => ctx?.passedInIsolation === false,
    actions: [
      { kind: "fix", note: "Reset shared state in beforeEach" },
      { kind: "inspect", note: "Run with --sequence.shuffle to detect order dependence" },
    ],
    confidence: "low",
  },

  // Null/undefined access
  "type-error-null": {
    detect: (msg, ctx) =>
      ctx?.error?.type === "TypeError" &&
      (msg.includes("undefined") || msg.includes("null") || msg.includes("Cannot read")),
    actions: [
      { kind: "fix", note: "Add null/undefined guard clause" },
      { kind: "fix", note: "Use optional chaining (?.)" },
      { kind: "inspect", note: "Trace to first non-test frame in stack" },
    ],
    confidence: "high",
  },
};
```

---

## Consequences

### Positive

- **Universal interface** — One schema for all test runners
- **Agent-optimized** — Summary-first, failures-only, actionable
- **Extensible** — Community can contribute adapters
- **CI integration** — Emit PR comments, artifacts automatically

### Negative

- **Adapter maintenance** — Each runner version may need updates
- **Lossy normalization** — Some runner-specific details may be lost
- **Parse complexity** — Some formats (TAP) are ambiguous

### Mitigations

- Adapter versioning tied to runner versions
- `raw` field in schema (both top-level and per-failure) preserves original data
- `failureId` and `signature` fields enable cross-run correlation
- Strict parsing with fallback to generic failure + raw preservation
- `--strict` mode in CI prevents silent adapter mismatches

---

## Implementation Phases

### Phase 1: Internal Gold Standard

Make Lex ecosystem tests emit AX-compliant output natively:

- Configure Vitest reporters in LexSona/LexRunner
- Add post-process script to Lex (Node test runner)
- Validate all CI gates emit `ax-summary.json`

### Phase 2: LexRunner Gate Command

Ship `lexrunner gate test` with core adapters:

- `vitest-json`, `node-tap`, `junit-xml`
- CLI with pipe support
- Markdown output for PR comments

### Phase 3: Ecosystem Expansion

- Additional adapters (pytest, go, phpunit)
- Adapter registry/plugin system
- Historical failure analysis (patterns across runs)

---

## Monetization Considerations

| Model             | Description                                           |
| ----------------- | ----------------------------------------------------- |
| **OSS Core**      | Base adapters (vitest, jest, junit) always free       |
| **Adapter Packs** | Enterprise adapters (pytest, go, dotnet) as paid tier |
| **Cloud API**     | Hosted endpoint: POST output → GET AX summary         |
| **Analytics**     | Failure pattern detection, flaky test identification  |

---

## References

- [AX.md](../AX.md) — Agent Experience design principles
- [ADR-003](ADR-003-gate-uniform-execution.md) — Gate uniform execution
- [gates.md](../gates.md) — Gate specification
- [AGENTS.md](/AGENTS.md) — Runner operating principles

---

## Appendix: Naming Decision

**Schema name:** `AXTestResult` (internal consistency with AX vocabulary)

**Public documentation:** Describe as "Agent-optimized test report (AX)" to be self-documenting.

**Alternative considered:** `AgentTestReport` — more self-documenting but loses brand continuity.

**Decision:** Keep `AXTestResult` for schema/code, use "Agent-optimized" in user-facing docs.

---

## Changelog

- **2026-01-04:** Initial proposal
- **2026-01-04:** Incorporated Lex feedback:
  - Added `raw` field at both top-level and per-failure
  - Added `failureId` and `signature` for failure identity/grouping
  - Added `stackFrames[]` for structured stack traces
  - Added `assertion` details and enhanced `diff` with unified format
  - Added `run` metadata for reproducibility
  - Made `nextActions` support structured objects with `kind`
  - Added `nextActionsMeta.confidence` for guidance weighting
  - Clarified `coverage` units as percentages
  - Added `--strict` mode recommendation for CI
  - Expanded adapter priority rationale
  - Added per-runner rerun templates
  - Expanded failure pattern library
- [AGENTS.md](/AGENTS.md) — Runner operating principles
