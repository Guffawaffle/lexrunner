# LR-TSF-001: Execution Trace → Constraint Attribution - Implementation Summary

## Completed Work

### 1. Core Attribution Infrastructure

#### `src/runs/attribution.ts`

- Created `AttributionTracker` class to track constraint applications
- Supports logging constraint ID, statement, source, action, and target
- Provides methods for:
  - `getAttributions()` - Get full attribution records
  - `getFrameAttributions()` - Get simplified attributions for frames
  - `getLogEntries()` - Get NDJSON-ready log entries
  - `clear()` - Clear all attributions

#### `src/runs/context.ts`

- Created `ExecutionContext` interface with embedded `AttributionTracker`
- Helper function `logAttribution()` for easy attribution logging
- Factory function `createExecutionContext()` for creating contexts

### 2. Frame Integration

#### `src/frames/types.ts`

- Enhanced `ExecutionFrameMetadataSchema` with `governed_by` field
- Updated `MergeWeaveFrameInput` interface to accept `governedBy` attributions
- Schema includes: `constraintId`, `source`, and `action` for each attribution

#### `src/frames/emitter.ts`

- Updated `emitMergeWeaveFrame()` to include attribution metadata
- Frames now capture which constraints governed the execution

### 3. Storage

#### `src/runs/storage.ts`

- Added `writeAttributions()` helper function
- Stores attributions in `.lexrunner/runs/{runId}/attributions.ndjson`
- NDJSON format for easy streaming and parsing

### 4. CLI Command

#### `src/commands/explain.ts`

- New `explain` command for querying constraint attributions
- Features:
  - Search by query string (case-insensitive)
  - Filter by specific run ID with `--run-id`
  - JSON output support with `--json`
  - Graceful handling when no runs directory exists
- Output shows: run ID, timestamp, action, target, constraint ID, source, and statement

#### `src/cli.ts`

- Registered `explain` command with main CLI program

### 5. Testing

#### `tests/unit/runs/attribution.spec.ts`

- 11 comprehensive unit tests covering:
  - Single and multiple attribution logging
  - Frame attribution generation
  - Log entry format
  - Constraint source tracking (baseline/persona/learned)
  - Immutability guarantees
- All tests passing ✅

### 6. Documentation

#### `docs/attribution-README.md`

- Comprehensive documentation covering:
  - Overview and core components
  - Usage examples for all APIs
  - Integration example showing full workflow
  - Storage format specification
  - Frame output format
  - CLI usage examples

### 7. Exports

#### `src/runs/index.ts`

- Exported all attribution types and functions:
  - `ConstraintSource`, `ConstraintAttribution`, `AttributionLogEntry`, `FrameAttribution`
  - `AttributionTracker`, `createAttributionTracker`
  - `ExecutionContext`, `createExecutionContext`, `logAttribution`
  - `writeAttributions`

## Key Features Implemented

### Attribution Tracking

✅ Log constraint applications during execution
✅ Track constraint ID, statement, source, action, and target
✅ Support for three constraint sources: baseline, persona, learned

### Frame Emission

✅ Frames include `governed_by` metadata
✅ Shows which constraints governed each execution
✅ Compatible with existing frame structure

### Storage

✅ NDJSON format for attributions
✅ Stored in run artifacts directory
✅ Easy to query and parse

### Explain Command

✅ Query attributions by keyword search
✅ Filter by run ID
✅ JSON output support
✅ User-friendly error messages

## Testing Results

- **Unit Tests**: 11/11 passing ✅
- **Build**: Successful ✅
- **Lint**: No issues ✅
- **Type Check**: Successful ✅

## Usage Example

```typescript
import { ulid } from "ulid";
import { createExecutionContext, logAttribution } from "./runs/index.js";
import { writeAttributions, ensureRunDir } from "./runs/storage.js";
import { emitMergeWeaveFrame } from "./frames/emitter.js";

// Create execution context
const runId = ulid();
const context = createExecutionContext(runId);

// Log attribution during gate execution
logAttribution(
  context,
  "merge-gates-required",
  "All PRs must pass lint gate before merging",
  "baseline",
  "ran lint gate on PR-123",
  "PR-123"
);

// Save attributions to disk
ensureRunDir(runId);
const logEntries = context.attributionTracker.getLogEntries();
writeAttributions(runId, logEntries);

// Emit frame with attribution
const frameResult = await emitMergeWeaveFrame({
  runId,
  mergedPRs: ["#123"],
  conflictsResolved: 0,
  gatesPassed: ["lint"],
  durationMs: 5000,
  outcome: "success",
  targetBranch: "main",
  governedBy: context.attributionTracker.getFrameAttributions(),
});
```

## CLI Usage

```bash
# Query attributions
$ lexrunner explain "lint gate"

🔍 Found 1 attribution(s):

Run: 01JFZG7X2T3K4M5N6P7Q8R9S0W
  Timestamp: 2026-01-02T05:00:00.000Z
  Action: ran lint gate on PR-123
  Target: PR-123
  Constraint: merge-gates-required (baseline)
  Statement: All PRs must pass lint gate before merging

# Filter by run
$ lexrunner explain "merge" --run-id 01JFZG...

# JSON output
$ lexrunner explain "gate" --json
```

## Files Created

1. `src/runs/attribution.ts` - Attribution tracking core
2. `src/runs/context.ts` - Execution context with attribution
3. `src/commands/explain.ts` - Explain CLI command
4. `tests/unit/runs/attribution.spec.ts` - Unit tests
5. `docs/attribution-README.md` - Comprehensive documentation

## Files Modified

1. `src/frames/types.ts` - Added `governed_by` to frame metadata schema
2. `src/frames/emitter.ts` - Include attribution in frame emission
3. `src/runs/index.ts` - Export attribution APIs
4. `src/runs/storage.ts` - Add `writeAttributions()` helper
5. `src/cli.ts` - Register explain command

## Acceptance Criteria Status

- [x] Frames include `governedBy` metadata
- [x] Attribution logging infrastructure in place
- [x] `lexrunner explain` command works
- [x] Attributions can be stored in run artifacts
- [x] Source tracking (baseline/persona/learned)
- [x] Unit tests for attribution tracking
- [x] `npm run build` passes
- [x] `npm test` passes (attribution tests)
- [x] Comprehensive documentation

## Notes

The feature is fully implemented and ready for integration into merge-weave workflows. The next step would be to integrate attribution tracking into the actual merge-weave execution flow (e.g., in `src/commands/merge.ts` or `src/commands/weave.ts`) and add the `--show-attribution` flag to display attributions during execution.

The current implementation provides all the necessary infrastructure and can be used immediately by any workflow that wants to track constraint attributions.
