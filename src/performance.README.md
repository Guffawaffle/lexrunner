# Performance Utilities

High-throughput execution utilities for large-scale merge pyramids.

## Quick Start

```typescript
import { MemoryMonitor, OperationCache, BatchProcessor, WorkerPool } from "./performance";

// Memory monitoring with throttling
const monitor = new MemoryMonitor({
  maxMemoryMB: 2048,
  memoryThresholdPercent: 80,
});

await monitor.throttleIfNeeded(); // Waits if memory high

// Operation caching
const cache = new OperationCache<string>(3600); // 1 hour TTL
const result = await cache.execute("key", () => expensiveOperation());

// Batch processing
const processor = new BatchProcessor<Item>(50); // Batch size 50
const results = await processor.processBatches(items, processBatch);

// Worker pool management
const pool = new WorkerPool(8); // Max 8 workers
if (pool.acquire()) {
  // Do work
  pool.release();
}
```

## Modules

### MemoryMonitor

Tracks heap memory and throttles execution when threshold exceeded.

**Configuration via Policy**:

```yaml
policy:
  performance:
    maxMemoryMB: 2048
    memoryThresholdPercent: 80
    throttleOnMemory: true
```

### OperationCache

Generic cache with TTL for expensive operations.

**Features**:

- Configurable TTL
- Cache statistics
- Execute-with-cache helper

### BatchProcessor

Processes large arrays in configurable batches.

**Use cases**:

- Large plan processing (100+ PRs)
- Memory-efficient iteration
- Progress tracking

### WorkerPool

Manages concurrent worker slots with capacity tracking.

**Features**:

- Acquire/release semantics
- Capacity checking
- Wait for capacity

## Integration

Used by:

- `src/gates.ts` - Gate execution with memory throttling
- `src/mergeOrder.ts` - Dependency resolution caching
- `src/git/operations.ts` - Merge operation profiling

## Testing

```bash
npm test -- performance.spec.ts
```

23 tests covering all utilities with benchmarks.

## See Also

- [Performance & Scale Documentation](../docs/performance-scale.md)
- [Monitoring Metrics](./monitoring/metrics.ts)
