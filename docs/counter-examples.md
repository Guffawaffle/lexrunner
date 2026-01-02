# Counter-Example Capture (LR-TSF-003)

Automatic failure capture for learning loop closure. When gates fail, lexrunner can prompt to record the failure as a counter-example, which can later feed into constraint refinement.

## Overview

Counter-examples are structured records of execution failures that include:

- What failed (gate, merge, validation)
- Execution context (plan, run ID, constraints, scope)
- User classification (transient, gap, false-positive, unknown)
- Related constraints for learning

## Usage

### During Execution

When a gate fails during execution, lexrunner can be configured to prompt for counter-example recording:

```bash
# Interactive mode - prompts after each failure
lexrunner merge-weave --plan plan.json --record-failures interactive

# Auto mode - automatically records as 'unknown'
lexrunner merge-weave --plan plan.json --record-failures auto

# Disabled (default)
lexrunner merge-weave --plan plan.json
```

### Interactive Prompt

When a gate fails with `--record-failures interactive`, you'll see:

```
❌ Gate Failure Detected

Gate: test
Error: Coverage below 80%

Would you like to record this failure as a counter-example?
This helps improve future constraint derivation.

[1] Yes - Transient failure (don't learn from this)
[2] Yes - Constraint gap (should have caught this)
[3] Yes - False positive (constraint too strict)
[4] No - Skip recording

Choose option [1-4]:
```

### Listing Counter-Examples

```bash
# List all recorded counter-examples (table format)
lexrunner counter-examples list

# List in JSON format
lexrunner counter-examples list --format json
```

### Viewing Details

```bash
# Show details of a specific counter-example
lexrunner counter-examples show <id>
```

### Exporting for Analysis

```bash
# Export as JSON
lexrunner counter-examples export --format json

# Export as CSV
lexrunner counter-examples export --format csv

# Export to file
lexrunner counter-examples export --format json --output counter-examples.json
```

## Storage

Counter-examples are stored in `.lexrunner/counter-examples/`:

```
.lexrunner/counter-examples/
├── 2026-01-02-test-gate-gate.json
├── 2026-01-02-build-gate.json
└── index.json
```

## Counter-Example Schema

Each counter-example includes:

```typescript
{
  id: string;              // Unique identifier (ULID)
  timestamp: string;       // ISO 8601 timestamp

  failure: {
    type: "gate" | "merge" | "validation";
    target: string;        // Gate name, PR number, etc.
    error: string;         // Error message
    exitCode?: number;     // Process exit code
  };

  context: {
    plan: string;          // Plan file path
    runId: string;         // Execution run ID
    activeConstraints: string[];
    scope: string[];
  };

  classification: {
    type: "transient" | "gap" | "false-positive" | "unknown";
    description: string;   // User-provided description
    suggestedAction?: string;
  };

  relatedConstraints: string[];  // Inferred related constraints
  shouldLearn: boolean;          // Whether to use for learning (false for transient)
}
```

## Classification Types

- **transient**: Temporary failures (network issues, flaky tests) - not used for learning
- **gap**: Missing constraints that should have caught this
- **false-positive**: Constraint is too strict and should be relaxed
- **unknown**: Auto-recorded without user input

## Integration with LexSona

Counter-examples with `shouldLearn: true` can be fed into LexSona for rule learning:

```typescript
import { listCounterExamples } from "lexrunner/learning/storage";

const counterExamples = listCounterExamples().filter((ce) => ce.shouldLearn);

// Feed to LexSona for constraint refinement
```

## CLI Options

| Option                          | Description                                          |
| ------------------------------- | ---------------------------------------------------- |
| `--record-failures`             | Enable counter-example recording (default: disabled) |
| `--record-failures interactive` | Prompt user for classification                       |
| `--record-failures auto`        | Auto-record as 'unknown'                             |
| `--no-record-failures`          | Explicitly disable                                   |

## Examples

### Example 1: Record a test coverage gap

```bash
$ lexrunner merge-weave --plan plan.json --record-failures interactive

ERROR: Gate 'test' failed for PR-123

Would you like to record this failure as a counter-example?
[2] Yes - Constraint gap (should have caught this)

Describe what constraint gap this reveals: Missing test coverage requirement
Suggested action: Add test-coverage-required constraint

✓ Recorded counter-example: gap
  Stored in: .lexrunner/counter-examples/2026-01-02-test-gate.json
```

### Example 2: Auto-record all failures

```bash
$ lexrunner merge-weave --plan plan.json --record-failures auto

ERROR: Gate 'lint' failed for PR-456
✓ Recorded counter-example: unknown
  Stored in: .lexrunner/counter-examples/2026-01-02-lint-gate.json
```

### Example 3: Export for analysis

```bash
$ lexrunner counter-examples export --format csv > analysis.csv
$ cat analysis.csv
ID,Timestamp,Failure Type,Target,Classification,Should Learn,File Path
01HK...,2026-01-02T04:30:00Z,gate,test,gap,true,2026-01-02-test-gate.json
01HK...,2026-01-02T04:35:00Z,gate,lint,transient,false,2026-01-02-lint-gate.json
```

## Future Enhancements

- Automatic pattern detection across counter-examples
- Integration with LexSona for automated rule refinement
- Counter-example deduplication
- Trend analysis and reporting
