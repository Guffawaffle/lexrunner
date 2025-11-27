# RunStore Contract v1.0.0

> **Status:** Frozen for 1.0.0
> **Last Updated:** 2025-11-27
> **Schema Version:** `1.0.0`

This document defines the persistence contract for Runs. All implementations of `RunStore` must conform to this specification.

---

## Schema Version

```typescript
export const RUN_STORE_SCHEMA_VERSION = "1.0.0";
```

Implementations MUST:
- Store this version in the database
- Refuse to open databases with incompatible major versions
- Provide clear error messages for version mismatches

---

## ID Format

- **Type:** ULID (Universally Unique Lexicographically Sortable Identifier)
- **Encoding:** 26-character Crockford Base32
- **Properties:** Lexicographically sortable by creation time

Example: `01ARZ3NDEKTSV4RRFFQ69G5FAV`

---

## Timestamp Format

- **Format:** ISO 8601 UTC
- **Precision:** Milliseconds
- **Example:** `2025-11-27T06:45:14.123Z`

All timestamps MUST be stored and returned in UTC.

---

## Run Record

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `runId` | ULID | Unique identifier |
| `planId` | string | Reference to the plan being executed |
| `state` | RunState | Current lifecycle state |
| `createdAt` | ISO 8601 | Creation time (UTC) |
| `updatedAt` | ISO 8601 | Last modification time (UTC) |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `metadata` | object | `{}` | Arbitrary key-value pairs |
| `artifacts` | string[] | `[]` | Paths to generated artifacts |
| `parentRunId` | ULID | `null` | For nested/child runs |
| `error` | object | `null` | Error details if failed |

---

## Lifecycle States

```
pending → running → completed | failed | cancelled
```

| State | Description | Terminal |
|-------|-------------|----------|
| `pending` | Run created, not yet started | No |
| `running` | Run actively executing | No |
| `completed` | Run finished successfully | Yes |
| `failed` | Run terminated with error | Yes |
| `cancelled` | Run stopped by user | Yes |

### State Transitions

```
pending ────→ running ────→ completed
                │
                ├──────────→ failed
                │
                └──────────→ cancelled
```

Invalid transitions MUST throw an error.

### Cross-Repo Mapping (LexRunner ↔ Lex)

| RunStore | FrameStore | Notes |
|----------|------------|-------|
| `pending` | `created` | Initial state |
| `running` | `active` | In-progress work |
| `completed` | `archived` | Terminal success |
| `failed` | `archived` | Terminal failure |
| `cancelled` | `archived` | User-terminated |

---

## Interface Contract

```typescript
interface RunStore {
  createRun(run: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, updates: Partial<RunRecord>): Promise<void>;
  listRuns(options?: ListRunsOptions): Promise<RunRecord[]>;
  getRunsByState(state: RunState): Promise<RunRecord[]>;
  close(): Promise<void>;
}
```

### Invariants

1. `createRun` fails if runId already exists (no upsert)
2. `getRun` returns `null` for non-existent IDs (no throw)
3. `updateRun` throws if run doesn't exist
4. `updateRun` validates state transitions
5. `listRuns` returns empty array for no matches (no throw)
6. `close` is safe to call multiple times

---

## Step Outcomes

Runs contain steps, each with an outcome:

```typescript
interface StepOutcome {
  stepId: string;
  gateName: string;
  status: 'pass' | 'fail' | 'skip' | 'blocked';
  duration_ms: number;
  artifacts?: string[];
  error?: { code: string; message: string };
}
```

---

## Receipts

Terminal runs generate receipts:

```typescript
interface Receipt {
  runId: string;
  planId: string;
  finalState: 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string;
  duration_ms: number;
  steps: StepOutcome[];
  summary: string;
}
```

---

## Change Protocol

Changes to this contract require:

1. [ ] Schema migration plan documented
2. [ ] Version bump (SemVer)
   - Patch: additive optional fields
   - Minor: additive required fields with defaults
   - Major: breaking changes
3. [ ] Cross-repo notification (Lex) if shared concept
4. [ ] Chief Architect explicit approval
5. [ ] Migration tested on production-like data

---

## Migration Strategy

For 1.0.0, the migration path is:

1. Check schema version on database open
2. If version < 1.0.0: offer to reset (dev) or fail with clear message (prod)
3. If version > 1.0.0 (future): fail with "upgrade LexRunner" message

Post-1.0.0: proper migrations via numbered SQL files in `migrations/`.
