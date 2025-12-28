# Conflict Predictor

**Mathematical conflict prediction using graph theory and git merge-tree simulation**

The Conflict Predictor is a core orchestration tool that predicts merge conflicts before they occur, enabling safe parallel merges and optimal batch planning.

## Overview

The conflict predictor combines three techniques:

1. **Conflict Graph Construction**: Models PRs and file overlaps as an undirected graph
2. **Maximal Independent Set (MIS)**: Finds maximal sets of PRs with no conflicts
3. **git merge-tree Simulation**: Validates predictions with actual merge simulation

## Mathematical Foundation

### Conflict Graph

**Definition**: An undirected graph `G = (V, E)` where:

- **Vertices (V)**: Pull requests (PRs)
- **Edges (E)**: Pairs of PRs that modify the same files

**Properties**:

- Edge weight: Number of shared files
- Deterministic construction: Nodes sorted by PR number, edges by (from, to) pairs

**Example**:

```
PRs:
  #166: modifies [src/cli.ts, src/util.ts]
  #167: modifies [src/cli.ts, src/gates.ts]
  #168: modifies [src/gates.ts, README.md]

Graph:
  Nodes: [166, 167, 168]
  Edges:
    166 ↔ 167 (shared: src/cli.ts)
    167 ↔ 168 (shared: src/gates.ts)
```

### Maximal Independent Set (MIS)

**Definition**: A set `S ⊆ V` such that:

1. **Independent**: No two vertices in `S` are adjacent (no edge between them)
2. **Maximal**: Cannot add any more vertices without violating independence

**Greedy Algorithm** (deterministic):

```
1. Sort vertices by degree (ascending), then by PR number
2. MIS = ∅
3. For each vertex v in sorted order:
     If v has no neighbor in MIS:
       Add v to MIS
4. Return MIS
```

**Time Complexity**: O(|V| + |E|)

**Example** (from above graph):

```
Degrees:
  166: degree 1 (connected to 167)
  167: degree 2 (connected to 166, 168)
  168: degree 1 (connected to 167)

Sorted: [166, 168, 167]  (by degree, then number)

Greedy selection:
  - Add 166 to MIS (no conflicts yet)
  - Add 168 to MIS (no edge to 166)
  - Cannot add 167 (conflicts with 166 and 168)

Result: MIS = {166, 168}
```

## Implementation

### Conflict Graph Builder

```typescript
import { buildConflictGraph } from "./orchestration/conflictGraph.js";

const prs = [
  { number: 166, files: ["src/cli.ts", "src/util.ts"] },
  { number: 167, files: ["src/cli.ts", "src/gates.ts"] },
];

const graph = buildConflictGraph(prs);
// {
//   nodes: ["166", "167"],
//   edges: [{ from: "166", to: "167", sharedFiles: ["src/cli.ts"] }]
// }
```

### MIS Computation

```typescript
import { computeMIS, computeAllMISBatches } from "./orchestration/mis.js";

// Single MIS
const mis = computeMIS(graph);
// ["166", "168"]

// All batches (iterative MIS removal)
const batches = computeAllMISBatches(graph);
// [
//   { id: "mis-1", prs: ["166", "168"], reason: "No shared files" },
//   { id: "mis-2", prs: ["167"], reason: "Conflicts with #166, #168" }
// ]
```

### Merge-Tree Simulation

```typescript
import { simulateMerge } from "./orchestration/mergeTreeSimulator.js";

const result = await simulateMerge("main", "pr-166-head", "pr-167-head");
// {
//   status: "conflict",
//   conflicts: [
//     { file: "src/cli.ts", lines: "125-140", type: "both-modified" }
//   ]
// }
```

### Complete Prediction

```typescript
import { predictConflicts } from "./orchestration/index.js";

const report = await predictConflicts({
  prs: [
    { number: 166, files: ["src/cli.ts"], head: "abc123" },
    { number: 167, files: ["src/cli.ts"], head: "def456" },
  ],
  baseBranch: "main",
  skipMergeTreeSimulation: false,
});

console.log(report.recommendations.safeBatch);
// ["166"] or ["167"] (one will conflict)
```

## CLI Usage

### Basic Usage

```bash
# Predict conflicts for PRs
lex-pr orchestrate:predict-conflicts --prs 166,167,168

# JSON output
lex-pr --json orchestrate:predict-conflicts --prs 166,167,168 > conflicts.json

# Skip merge-tree (faster, file-based only)
lex-pr orchestrate:predict-conflicts --prs 166,167,168 --skip-merge-tree
```

### Output Interpretation

**Human-Readable Output**:

- 📊 **Conflict Graph**: Shows PR pairs with shared files
- 🔀 **MIS Batches**: Safe parallel groups
- 🧪 **Merge Simulation**: git merge-tree results (if not skipped)
- 💡 **Recommendations**: Actionable merge strategy

**JSON Output**:

- Structured data for automation
- Deterministic key ordering (canonical JSON)
- Includes timestamps and metadata

## Use Cases

### 1. Batch Planning

**Problem**: Given 10 PRs, which can merge in parallel?

**Solution**:

```bash
lex-pr orchestrate:predict-conflicts --prs 100,101,102,103,104,105,106,107,108,109 --json | \
  jq '.recommendations.safeBatch[]'
```

**Result**: List of PR numbers that can merge simultaneously.

### 2. Merge Pyramid Optimization

**Problem**: Minimize merge pyramid depth by maximizing parallelism.

**Solution**:

1. Run conflict predictor on all PRs
2. Use MIS batches as Kahn layers
3. Execute batches in parallel, layers sequentially

**Benefits**:

- Reduces total merge time
- Minimizes conflict resolution overhead
- Predictable merge order

### 3. CI/CD Integration

**Problem**: Prevent merge conflicts in automated pipelines.

**Solution**:

```yaml
# GitHub Actions example
- name: Predict Conflicts
  run: |
    lex-pr orchestrate:predict-conflicts --prs ${{ env.PR_NUMBERS }} --json > conflicts.json

- name: Check Safe Merge
  run: |
    SAFE_BATCH=$(jq -r '.recommendations.safeBatch[]' conflicts.json)
    if [[ -z "$SAFE_BATCH" ]]; then
      echo "⚠️ No safe parallel merges available"
      exit 1
    fi
```

### 4. Conflict Avoidance

**Problem**: Detect conflicts before merge attempts.

**Solution**:

```bash
# Pre-merge check
lex-pr orchestrate:predict-conflicts --prs $PR_NUMBER,$TARGET_PR

# If conflicts detected:
# - Review shared files
# - Coordinate with other PR authors
# - Rebase or merge sequentially
```

## Algorithm Properties

### Correctness

**Theorem**: The greedy MIS algorithm returns a maximal independent set.

**Proof sketch**:

1. **Independence**: By construction, no two vertices in MIS are adjacent
2. **Maximality**: Cannot add any vertex without creating an edge to a vertex in MIS

**Note**: MIS is not necessarily _maximum_ (largest possible), but is _maximal_ (cannot be extended).

### Determinism

**Guaranteed properties**:

- Same input → same output (deterministic sorting)
- Platform-independent (no time/random-based ordering)
- Version-stable (algorithm documented and tested)

**Implementation**:

```typescript
// Deterministic sorting
const sorted = [...graph.nodes].sort((a, b) => {
  const degA = neighbors.get(a)!.size;
  const degB = neighbors.get(b)!.size;
  if (degA !== degB) return degA - degB; // Degree first
  return parseInt(a) - parseInt(b); // PR number second
});
```

### Performance

**Time Complexity**:

- Conflict graph: O(|V|² × F) where F = avg files per PR
- MIS computation: O(|V| + |E|)
- Merge-tree: O(|E| × M) where M = git merge-tree cost

**Space Complexity**: O(|V| + |E|)

**Scalability**:

- Tested with 100+ PRs
- Graph operations dominate (merge-tree optional)
- Parallelizable merge simulations

## Testing

### Unit Tests

```bash
# Run all conflict predictor tests
npm test -- tests/conflictGraph.spec.ts tests/mis.spec.ts tests/mergeTreeSimulator.spec.ts

# Test coverage
npm test -- --coverage
```

**Test categories**:

- Conflict graph construction (8 tests)
- MIS computation (11 tests)
- Merge-tree parsing (10 tests)
- Integration tests (8 tests)

### Test Scenarios

**Graph Shapes**:

- Empty graph (no conflicts)
- Complete graph (all conflict)
- Star graph (central node conflicts with all)
- Linear chain (alternating conflicts)
- Arbitrary graphs

**Edge Cases**:

- Single PR
- No PRs
- Identical file lists
- Renamed files

## Limitations

1. **File-level granularity**: Cannot detect line-level conflicts without merge-tree
2. **Static analysis**: Based on file lists, not actual changes
3. **No semantic analysis**: Doesn't understand code logic or dependencies
4. **git merge-tree required**: For precise conflict detection (optional but recommended)

## Future Enhancements

1. **Line-level analysis**: Parse patch files for finer granularity
2. **Semantic conflict detection**: Analyze imports, function calls
3. **Historical conflict data**: Learn from past merge conflicts
4. **Weighted MIS**: Prioritize PRs by size, priority, or age
5. **GitHub API integration**: Auto-fetch PR file lists

## References

- **Kahn's Algorithm**: Topological sorting (used for dependency layers)
- **Graph Theory**: Maximal Independent Set problem
- **git merge-tree**: Git's three-way merge simulation
- **Issue #175**: Original feature specification

## See Also

- [CLI Reference](./cli.md#orchestratepredict-conflicts) - Command usage
- [Merge Weave Analysis](./merge-weave-analysis.md) - Merge strategy
- [Architecture](./architecture.md) - System design
