# Orchestration Module

This module provides tools for planning and orchestrating batch operations on issues and PRs using graph algorithms.

It includes:
- **Batch Planner**: Kahn's algorithm for dependency-ordered batches
- **Conflict Predictor**: MIS-based conflict detection and merge simulation

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

## Mathematical Foundation

The implementation follows the principles outlined in `ANALYSIS_deterministic_math.md`:

- Topological sorting guarantees valid merge order
- Stable priority queue ensures reproducibility
- Layer batching provides natural parallelization points
- SHA256 hash enables plan verification and caching

---

## Conflict Predictor

**Conflict prediction and batch optimization for merge pyramids**

This module implements conflict graph construction, Maximal Independent Set (MIS) computation, and git merge-tree simulation for predicting merge conflicts.

### Conflict Graph (`conflictGraph.ts`)
Builds conflict graphs from PR file lists.

**Key Function**:
```typescript
buildConflictGraph(prs: PRWithFiles[]): ConflictGraph
```

**Algorithm**:
1. Create nodes for each PR
2. Add edges for PRs with shared files
3. Sort for deterministic output

### `mis.ts`
Computes Maximal Independent Set using greedy algorithm.

**Key Functions**:
```typescript
computeMIS(graph: ConflictGraph): string[]
computeAllMISBatches(graph: ConflictGraph): MISBatch[]
```

**Algorithm**:
1. Sort nodes by degree (fewest conflicts first), then by PR number
2. Greedily select nodes with no conflicts to existing MIS
3. Return maximal set

### `mergeTreeSimulator.ts`
Simulates merges using git merge-tree.

**Key Functions**:
```typescript
simulateMerge(base: string, pr1: string, pr2: string): Promise<MergeSimulationResult>
parseMergeTreeOutput(output: string): ConflictDetail[]
```

**Algorithm**:
1. Run `git merge-tree <base> <pr1> <pr2>`
2. Parse output for conflict markers
3. Return conflict details

### `conflictPredictor.ts`
Main module combining all prediction techniques.

**Key Function**:
```typescript
predictConflicts(options: PredictConflictsOptions): Promise<ConflictReport>
```

**Pipeline**:
1. Build conflict graph
2. Compute MIS batches
3. Simulate merges (optional)
4. Generate recommendations

## Types

All types are defined in `types.ts`:

- `ConflictGraph`: Graph with nodes (PRs) and edges (shared files)
- `MISBatch`: Batch of non-conflicting PRs
- `MergeSimulationResult`: Result of merge-tree simulation
- `ConflictReport`: Complete analysis report

## CLI Command

```bash
lex-pr orchestrate:predict-conflicts --prs 166,167,168
```

See [CLI Reference](../../docs/cli.md#orchestratepredict-conflicts) for details.

## Testing

Run tests:
```bash
npm test -- tests/conflictGraph.spec.ts tests/mis.spec.ts tests/mergeTreeSimulator.spec.ts tests/conflictPredictor.spec.ts
```

**Test Coverage**:
- Conflict graph: 8 tests
- MIS: 11 tests
- Merge-tree: 10 tests
- Integration: 8 tests

## Examples

### Basic Usage

```typescript
import { predictConflicts } from "./orchestration/index.js";

const report = await predictConflicts({
  prs: [
    { number: 166, files: ["src/cli.ts"] },
    { number: 167, files: ["src/cli.ts"] }
  ],
  baseBranch: "main"
});

console.log(report.recommendations);
// { safeBatch: ["166"], sequential: ["167"] }
```

### With Merge-Tree

```typescript
const prHeads = new Map([
  ["166", "abc123"],
  ["167", "def456"]
]);

const report = await predictConflicts({
  prs: [...],
  baseBranch: "main",
  prHeads,
  skipMergeTreeSimulation: false
});

// Check merge simulation results
for (const [pair, result] of Object.entries(report.mergeTreeSimulation)) {
  if (result.status === 'conflict') {
    console.log(`Conflict in ${pair}:`, result.conflicts);
  }
}
```

## Algorithm Details

### Conflict Graph Construction

**Input**: Array of PRs with file lists
**Output**: Undirected graph

**Complexity**: O(n² × f) where n = PRs, f = avg files per PR

**Determinism**:
- Nodes sorted by PR number
- Edges sorted by (from, to)
- Shared files sorted alphabetically

### MIS Greedy Algorithm

**Input**: Conflict graph
**Output**: Maximal independent set

**Complexity**: O(n + e) where e = edges

**Properties**:
- Maximal (not necessarily maximum)
- Deterministic (fixed sort order)
- Approximation factor: depends on graph structure

### Merge-Tree Simulation

**Input**: Base branch, two PR heads
**Output**: Clean merge or conflict details

**Complexity**: O(git merge-tree)

**Reliability**:
- Exact same algorithm as git merge
- Detects all actual merge conflicts
- May have false positives (safe)

## Design Decisions

### Why Greedy MIS?

**Alternatives considered**:
1. **Exact MIS** (NP-hard): Too slow for large graphs
2. **Approximation algorithms**: More complex, similar results
3. **Greedy**: Fast, simple, deterministic

**Trade-off**: Greedy may not find the *largest* independent set, but finds a *maximal* one quickly and deterministically.

### Why File-Level Granularity?

**Alternatives**:
1. **Line-level**: More accurate but requires patch parsing
2. **Semantic**: Requires code analysis (imports, etc.)
3. **File-level**: Fast, simple, good enough

**Trade-off**: File-level is conservative (may predict conflicts that don't occur) but fast and reliable.

### Why Optional Merge-Tree?

**Reasons**:
1. Performance: git merge-tree can be slow
2. Availability: Requires git repo with all branches
3. File-based analysis is often sufficient

**Recommendation**: Use merge-tree when:
- Accuracy is critical
- Git repo is available
- Performance is acceptable

## Future Work

- [ ] Weighted MIS (prioritize by PR size/age)
- [ ] Line-level conflict detection
- [ ] Semantic conflict analysis
- [ ] Historical conflict learning
- [ ] Parallel merge-tree simulation

## References

- [Conflict Predictor Documentation](../../docs/conflict-predictor.md)
- [Issue #175](https://github.com/Guffawaffle/lex-pr-runner/issues/175)
- Graph Theory: Maximal Independent Set
- Git internals: merge-tree command

---

## Future Enhancements

Planned features (from Epic #171):

1. **Issue Analyzer** (Feature 1) - Analyze overlap/risk scores
2. **Agent Assigner** (Feature 3) - Assign agents to batches
3. **Integration** - Connect with GitHub API for live data
```

---

## Agent Assigner

**Bulk-assign GitHub Copilot agents to batched issues**

### Overview

The Agent Assigner implements bulk assignment of GitHub Copilot agents to issues with robust error handling and rate limiting.

**Key Features:**
- Rate limiting with exponential backoff (10s, 20s, 40s, 80s max, 4 retries)
- Graceful handling of already-assigned issues
- Configurable stagger delay between assignments (default: 5s)
- Dry-run mode for previewing assignments
- JSON output for automation

### CLI Command

```bash
lex-pr orchestrate:assign-batch [options]

Options:
  --batch <file>       Batch plan JSON file
  --issues <numbers>   Comma-separated issue numbers (e.g., 156,157,160)
  --repo <owner/repo>  GitHub repository (default: auto-detect)
  --dry-run            Show what would be assigned without actually doing it
  --stagger <seconds>  Wait N seconds between assignments (default: 5)
  --json               Output results as JSON (global flag)
```

### Examples

**Basic Assignment:**
```bash
lex-pr orchestrate:assign-batch --issues 156,157,160 --repo owner/repo
```

**Dry Run:**
```bash
lex-pr orchestrate:assign-batch --issues 156,157,160 --repo owner/repo --dry-run
```

**JSON Output:**
```bash
lex-pr orchestrate:assign-batch --issues 156,157,160 --json
```

### Implementation

See `src/orchestration/agentAssigner.ts` for the core implementation.

**Main Function:**
```typescript
export async function assignAgentsToBatch(
  options: AssignAgentsOptions
): Promise<AssignmentResult>
```

**Error Handling:**
- `AlreadyAssignedError` - Issue already has an agent
- `RateLimitError` - GitHub API rate limit hit (auto-retry)
- `UnexpectedError` - Other failures (logged and skipped)

### Testing

See `tests/agent-assigner.spec.ts` and `tests/cli-agent-assigner.spec.ts` for comprehensive test coverage.
