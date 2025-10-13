# Orchestration Module

**Conflict prediction and batch optimization for merge pyramids**

This module implements conflict graph construction, Maximal Independent Set (MIS) computation, and git merge-tree simulation for predicting merge conflicts.

## Modules

### `conflictGraph.ts`
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
