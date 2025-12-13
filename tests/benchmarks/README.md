# Performance Benchmark Suite

Performance regression test suite for tracking critical operation performance over time.

## Overview

This benchmark suite measures performance of:
- **Core Algorithms**: Topological sort, plan parsing, dependency resolution
- **I/O Operations**: File operations, git operations
- **End-to-End Workflows**: Plan generation, gate execution, merge weave

## Running Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Run specific benchmark file
npm run benchmark -- core/topologicalSort.bench.ts

# Compare against baseline
npm run benchmark:ci
```

## Baseline Management

Baseline performance metrics are stored in `baselines/baseline.json`. These represent expected performance for the current version.

To update baselines after performance improvements:
```bash
npm run benchmark:baseline
```

## CI Integration

The `benchmark:ci` script compares current performance against committed baselines:
- ✅ **Pass**: Performance within 20% of baseline
- ⚠️ **Warning**: Performance degraded 10-20%
- ❌ **Fail**: Performance degraded >20%

## Report Formats

Benchmarks generate two report types:
1. **JSON Report** (`benchmarks/results/latest.json`): Machine-readable metrics
2. **Markdown Report** (`benchmarks/results/latest.md`): Human-readable summary

## Benchmark Structure

```
tests/benchmarks/
├── README.md                    # This file
├── index.ts                     # Main runner
├── core/                        # Core algorithm benchmarks
│   ├── topologicalSort.bench.ts
│   ├── planParser.bench.ts
│   └── dependencyResolver.bench.ts
├── io/                          # I/O operation benchmarks
│   ├── fileOperations.bench.ts
│   └── gitOperations.bench.ts
├── workflows/                   # End-to-end benchmarks
│   └── endToEnd.bench.ts
├── baselines/                   # Committed baseline metrics
│   └── baseline.json
└── utils/                       # Benchmark utilities
    └── reporter.ts              # Report generation
```

## Adding New Benchmarks

```typescript
import { describe, bench } from 'vitest';
import { myFunction } from '../../src/myModule';

describe('My Operation Performance', () => {
  bench('operation with small input', () => {
    myFunction(smallInput);
  });
  
  bench('operation with large input', () => {
    myFunction(largeInput);
  });
});
```

## Performance Targets

Current performance targets (baseline):
- Topological sort (10 nodes): < 1ms
- Topological sort (100 nodes): < 5ms
- Topological sort (500 nodes): < 50ms
- Plan parsing (small): < 2ms
- Plan parsing (large): < 20ms
- File read/write: < 10ms
- Git operations: < 100ms

## Determinism

All benchmarks use deterministic fixtures to ensure reproducible results. Random data generation is not allowed in benchmarks.
