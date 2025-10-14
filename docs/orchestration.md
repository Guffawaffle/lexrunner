# Orchestration Commands

The orchestration commands provide tools for planning and managing batch operations on issues and PRs, particularly for merge pyramid workflows.

## orchestrate:plan-batch

Generate a deterministic batch plan using Kahn's algorithm for topological sorting.

### Usage

```bash
# From issue analyzer output
lex-pr orchestrate:plan-batch --input analysis.json --json > batch-plan.json

# Explicit issue list
lex-pr orchestrate:plan-batch --issues 156,157,160,161,164

# With JSON output
lex-pr orchestrate:plan-batch --issues 156,157,160 --json
```

### Options

- `--issues <numbers>` - Comma-separated issue/PR numbers (e.g., 156,157,160)
- `--input <file>` - Input JSON file with analyzed issues
- `--json` - Output JSON format instead of human-readable

Either `--issues` or `--input` must be provided.

### Input Format

When using `--input`, the JSON file should contain an array of nodes:

```json
[
  {
    "id": "156",
    "type": "issue",
    "dependencies": [],
    "metadata": {
      "score": 1.2,
      "createdAt": "2025-10-13T00:56:27Z",
      "issueNumber": 156
    }
  },
  {
    "id": "161",
    "type": "issue",
    "dependencies": ["156"],
    "metadata": {
      "score": 0.5,
      "createdAt": "2025-10-13T00:56:47Z",
      "issueNumber": 161
    }
  }
]
```

The input can also be wrapped in objects with keys like `nodes`, `issues`, or provided as a direct array.

### Output Format

#### Human-Readable Output

```
Batch Plan (Kahn's Algorithm)
============================

Batch 1 (layer 0):
  - #160: score 0.8
  - #156: score 1.2

Batch 2 (layer 1):
  - #161: score 0.5, depends on 156

Algorithm: kahn_topological_sort
Plan Hash: sha256:30bf34c315d894338928a8a22dacf3eed267b0aeb1d50a34ccd50b38a7ea3451
Deterministic: true
```

#### JSON Output

With `--json` flag:

```json
{
  "planVersion": "1.0.0",
  "algorithm": "kahn_topological_sort",
  "deterministic": true,
  "planHash": "sha256:30bf34c315d894338928a8a22dacf3eed267b0aeb1d50a34ccd50b38a7ea3451",
  "batches": [
    {
      "id": "batch1",
      "layer": 0,
      "items": [
        {
          "id": "160",
          "type": "issue",
          "dependencies": [],
          "metadata": {
            "score": 0.8,
            "createdAt": "2025-10-13T00:56:37Z",
            "issueNumber": 160
          }
        },
        {
          "id": "156",
          "type": "issue",
          "dependencies": [],
          "metadata": {
            "score": 1.2,
            "createdAt": "2025-10-13T00:56:27Z",
            "issueNumber": 156
          }
        }
      ]
    },
    {
      "id": "batch2",
      "layer": 1,
      "items": [
        {
          "id": "161",
          "type": "issue",
          "dependencies": ["156"],
          "metadata": {
            "score": 0.5,
            "createdAt": "2025-10-13T00:56:47Z",
            "issueNumber": 161
          }
        }
      ]
    }
  ]
}
```

### Algorithm

The command uses **Kahn's algorithm** for topological sorting with a **stable priority queue** to ensure deterministic ordering.

#### Deterministic Ordering

Nodes are ordered using a three-level priority system:

1. **Primary**: `score` (lower score = higher priority)
2. **Secondary**: `createdAt` (older first)
3. **Tertiary**: `prNumber` or `issueNumber` (lower first)

This ensures that running the command multiple times with the same input always produces the same output.

#### Layer-Based Batching

The output batches correspond to Kahn's layers:

- **Batch 1 (layer 0)**: Nodes with no dependencies
- **Batch 2 (layer 1)**: Nodes depending only on layer 0
- **Batch N (layer N-1)**: Nodes depending only on layers 0..N-2

#### Cycle Detection

If the dependency graph contains cycles, the command will fail with exit code 2:

```bash
Error: Cycle detected in dependency graph
Dependency cycle detected involving: A, B, C
```

### Exit Codes

- `0` - Success
- `1` - Unexpected error
- `2` - Validation error (cycle detected, unknown dependency)

### Examples

#### Linear Chain (A → B → C)

```bash
lex-pr orchestrate:plan-batch --input linear-chain.json
```

Produces 3 batches, one per layer.

#### Tree Structure (A → B, A → C)

```bash
lex-pr orchestrate:plan-batch --input tree.json
```

Produces 2 batches:
- Batch 1: A
- Batch 2: B, C (parallel)

#### Diamond Structure (A → B → D, A → C → D)

```bash
lex-pr orchestrate:plan-batch --input diamond.json
```

Produces 3 batches:
- Batch 1: A
- Batch 2: B, C (parallel)
- Batch 3: D

#### Disconnected Components

The algorithm handles disconnected graphs correctly, placing nodes with no dependencies in the same initial batch.

### Plan Hash

The `planHash` field contains a SHA256 hash of the canonical JSON representation of the plan (excluding the hash itself). This can be used to:

- Verify plan reproducibility
- Track plan versions
- Detect changes in batch computation

Two plans with identical content will always produce the same hash, ensuring deterministic behavior.

### Integration

This command is designed to work with:

- **Issue Analyzer** (Feature 1): Consumes analysis output
- **Conflict Predictor** (Feature 5): Operates on Kahn layers
- **Agent Assigner** (Feature 3): Assigns agents to batches

### Related

- [Kahn's Algorithm](https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm)
- See `src/orchestration/batchPlanner.ts` for implementation details
- See `tests/batch-planner.spec.ts` for comprehensive test examples
