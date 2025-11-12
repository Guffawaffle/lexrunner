# Conflict Clustering

**Parser-lite conflict clustering with rename and whitespace awareness**

## Overview

The conflict clustering feature groups merge conflicts by file and affected symbols (functions, classes, interfaces, etc.), helping to understand the scope and nature of conflicts before resolving them.

## Features

- **Parser-lite symbol extraction**: Extracts symbols from TypeScript/JavaScript code using regex patterns
- **Rename detection**: Identifies potential renames by comparing normalized function signatures
- **Whitespace normalization**: Compares code without whitespace differences
- **File + symbol grouping**: Clusters conflicts by affected files and symbols
- **Deterministic output**: Stable JSON ordering for reproducibility

## Usage

### CLI

```bash
# Enable conflict clustering
lex-pr orchestrate:predict-conflicts --prs 166,167,168 --enable-clustering

# Write clustered conflicts to .weave/conflicts.json
lex-pr orchestrate:predict-conflicts --prs 166,167,168 \
  --enable-clustering --write-weave-conflicts

# JSON output with clustering details
lex-pr --json orchestrate:predict-conflicts --prs 166,167,168 \
  --enable-clustering > report.json
```

### Programmatic API

```typescript
import {
  clusterConflicts,
  generateClusteredReport,
  writeConflictsJson
} from "./orchestration/conflictClustering.js";

// Example: Cluster conflicts from merge-tree simulation
const conflicts = [
  { file: "src/example.ts", lines: "10-20", type: "both-modified" },
  { file: "src/utils.ts", lines: "5-15", type: "both-modified" }
];

// Generate clustered report
const report = await generateClusteredReport(conflicts, "main", "/path/to/repo");

// Write to .weave/conflicts.json
await writeConflictsJson(report, ".weave");
```

## Output Format

### `.weave/conflicts.json`

```json
{
  "analyzedAt": "2025-11-10T08:00:00.000Z",
  "baseBranch": "main",
  "clusters": [
    {
      "file": "src/example.ts",
      "symbols": ["calculateTotal", "ShoppingCart"],
      "conflictType": "both-modified",
      "details": {
        "lineRange": "10-20",
        "affectedSymbols": [
          {
            "name": "calculateTotal",
            "type": "function",
            "line": 12,
            "signature": "export function calculatetotal(items:item[]):number"
          }
        ]
      }
    }
  ],
  "summary": {
    "totalClusters": 1,
    "fileCount": 1,
    "symbolCount": 2,
    "conflictTypes": {
      "both-modified": 1
    }
  }
}
```

### Human-Readable Output

```
🔬 Conflict Clustering Analysis:
  Analyzed 2 conflict cluster(s) across 2 file(s)
  Affected 3 symbol(s)

  Top Conflict Clusters:
  ⚠️ src/example.ts (both-modified)
    Lines: 10-20
    Symbols: calculateTotal, ShoppingCart

  🔄 src/utils.ts (rename)
    Lines: 5-15
    Symbols: oldHelper, newHelper

  Conflict Type Breakdown:
    - both-modified: 1
    - rename: 1
```

## Conflict Types

- **both-modified**: Standard merge conflict (both sides modified)
- **rename**: Detected potential rename (same signature, different name)
- **whitespace**: Primarily whitespace differences
- **mixed**: Combination of multiple conflict types

## Symbol Extraction

Supports TypeScript/JavaScript symbols:

- Function declarations: `function name() {}`
- Arrow functions: `const name = () => {}`
- Classes: `class Name {}`
- Interfaces: `interface Name {}`
- Types: `type Name = ...`
- Imports: `import { x } from "..."`
- Exports: `export { x }`

## Rename Detection

Two symbols are considered potential renames if:
1. Same symbol type (e.g., both functions)
2. Different names
3. Identical signatures after removing the name

Example:
```typescript
// Likely a rename
function oldCalculate(x: number): number { return x * 2; }
function newCalculate(x: number): number { return x * 2; }
```

## Whitespace Normalization

Normalization rules:
- Line endings: `\r\n` → `\n`
- Tabs: `\t` → `  ` (2 spaces)
- Trailing whitespace: removed
- Multiple spaces: collapsed to single space in signatures
- Case-insensitive for signature comparison

## Integration with Conflict Predictor

The conflict clustering integrates with the existing conflict prediction system:

```typescript
import { predictConflicts } from "./orchestration/conflictPredictor.js";

const report = await predictConflicts({
  prs: [
    { number: 166, files: ["src/cli.ts"], head: "abc123" },
    { number: 167, files: ["src/cli.ts"], head: "def456" }
  ],
  baseBranch: "main",
  prHeads: new Map([["166", "abc123"], ["167", "def456"]]),
  enableClustering: true,
  writeWeaveConflicts: true
});

// Access clustered report
console.log(report.clusteredReport);
```

## Testing

Run conflict clustering tests:

```bash
# Unit tests
npm test -- tests/conflictClustering.spec.ts

# Integration tests
npm test -- tests/conflictPredictor.spec.ts

# E2E tests
npm test -- tests/conflictClustering-e2e.spec.ts

# All conflict-related tests
npm test -- tests/conflict*.spec.ts
```

## Limitations

1. **Language support**: Currently optimized for TypeScript/JavaScript
2. **Parser-lite approach**: Uses regex, not a full AST parser
3. **Symbol proximity**: Uses line-based proximity (5-line buffer)
4. **Rename heuristics**: May produce false positives for similar signatures

## Future Enhancements

- Support for additional languages (Python, Go, Rust, etc.)
- AST-based parsing for higher accuracy
- Symbol dependency analysis
- Conflict resolution suggestions
- ML-based rename detection

## Related Documentation

- [Conflict Predictor](./conflict-predictor.md)
- [Merge-Tree Simulator](./MERGE_WEAVE_SUMMARY.md)
- [CLI Reference](./cli.md)
