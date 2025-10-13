# Orchestration Module

This module provides tools for planning and orchestrating batch operations on issues and PRs using graph algorithms.

## Components

### Batch Planner (`batchPlanner.ts`)

Implements Kahn's algorithm for deterministic topological sorting of dependency graphs.

**Key Features:**
- Stable priority queue with deterministic ordering
- Cycle detection with helpful error messages
- SHA256 hash for plan reproducibility
- Layer-based batching (natural parallelization boundaries)

**Types:**
- `Node` - Issue or PR with dependencies and metadata
- `Batch` - A layer of nodes that can be processed in parallel
- `BatchPlan` - Complete plan with algorithm metadata and hash

**Main Function:**
```typescript
export function computeBatches(nodes: Node[]): BatchPlan
```

**Error Handling:**
- `CycleError` - Thrown when dependency graph contains cycles
- `UnknownDependencyError` - Thrown when dependency references don't exist

### Priority Queue (`../util/minHeap.ts`)

Generic MinHeap implementation with custom comparator for stable priority ordering.

**API:**
```typescript
const pq = new MinHeap<T>((a, b) => compareFunction);
pq.push(value);
pq.pop();      // Returns minimum element
pq.peek();     // View minimum without removing
pq.size();     // Number of elements
pq.isEmpty();  // Check if empty
```

## Algorithm Details

### Kahn's Algorithm

1. Build adjacency list and compute in-degrees
2. Initialize priority queue with 0 in-degree nodes
3. Layer-by-layer processing:
   - Pop all nodes from current layer (same priority level)
   - For each popped node, decrement neighbor in-degrees
   - Push neighbors with 0 in-degree to priority queue
4. If processed count < total nodes, throw cycle error

### Deterministic Ordering

The comparator function ensures stable, reproducible ordering:

```typescript
const compareFn = (a: Node, b: Node): number => {
  // Primary: score (lower = higher priority)
  if (a.metadata.score !== b.metadata.score) {
    return a.metadata.score - b.metadata.score;
  }
  // Secondary: createdAt (older first)
  if (a.metadata.createdAt !== b.metadata.createdAt) {
    return a.metadata.createdAt.localeCompare(b.metadata.createdAt);
  }
  // Tertiary: number (lower first)
  return (a.metadata.prNumber || a.metadata.issueNumber || 0) - 
         (b.metadata.prNumber || b.metadata.issueNumber || 0);
};
```

## Usage

### Basic Example

```typescript
import { computeBatches, Node } from './orchestration/batchPlanner.js';

const nodes: Node[] = [
  {
    id: 'A',
    type: 'issue',
    dependencies: [],
    metadata: { score: 1.0, createdAt: '2025-10-13T00:00:00Z', issueNumber: 1 }
  },
  {
    id: 'B',
    type: 'issue',
    dependencies: ['A'],
    metadata: { score: 0.5, createdAt: '2025-10-13T00:01:00Z', issueNumber: 2 }
  }
];

const plan = computeBatches(nodes);

console.log(plan.batches);
// [
//   { id: 'batch1', layer: 0, items: [nodeA] },
//   { id: 'batch2', layer: 1, items: [nodeB] }
// ]
```

### Cycle Detection

```typescript
const cyclic: Node[] = [
  { id: 'A', dependencies: ['B'], ... },
  { id: 'B', dependencies: ['A'], ... }
];

try {
  computeBatches(cyclic);
} catch (error) {
  if (error instanceof CycleError) {
    console.error('Cycle detected:', error.message);
    // "Dependency cycle detected involving: A, B"
  }
}
```

## Testing

See `tests/batch-planner.spec.ts` for comprehensive test coverage:

- Linear chains (A → B → C)
- Tree structures (A → B, A → C)
- Diamond patterns (A → B → D, A → C → D)
- Disconnected components
- Cycle detection
- Determinism verification

## Future Enhancements

Planned features (from Epic #171):

1. **Issue Analyzer** (Feature 1) - Analyze overlap/risk scores
2. **Conflict Predictor** (Feature 5) - Predict merge conflicts
3. **Agent Assigner** (Feature 3) - Assign agents to batches
4. **Integration** - Connect with GitHub API for live data

## Mathematical Foundation

The implementation follows the principles outlined in `ANALYSIS_deterministic_math.md`:

- Topological sorting guarantees valid merge order
- Stable priority queue ensures reproducibility
- Layer batching provides natural parallelization points
- SHA256 hash enables plan verification and caching
