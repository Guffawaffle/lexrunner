# Cluster Gate Execution & Rollback

This document describes the cluster-aware gate execution and rollback mechanism for the merge-weave workflow.

## Overview

After each cluster is resolved (merged), gates (lint, build, tests) are executed. If any gate fails:
1. The cluster patch is reverted (rollback)
2. A `.weave/merge-patch.diff` is captured
3. A failure bundle is stored in `.weave/`
4. A draft PR is opened with artifacts (optional)

## Architecture

### Core Components

- **`clusterGates.ts`**: Cluster-aware gate execution with rollback
- **`draftPR.ts`**: Draft PR creation for failed clusters
- **`git/operations.ts`**: Git operations including rollback support

### Flow

```
1. Resolve Cluster (merge PRs)
   ↓
2. Execute Gates
   ↓
3. Gates Pass? → Continue to next cluster
   |
   └─ Gates Fail? → Rollback + Store Artifacts + Draft PR
```

## Usage

### Basic Example

```typescript
import { executeClusterWithGates, ClusterContext } from "./weave/clusterGates.js";
import { ExecutionState } from "./executionState.js";
import { GitOperations } from "./git/operations.js";

// Define cluster context
const cluster: ClusterContext = {
  clusterIndex: 0,
  items: plan.items,
  baseBranch: "main",
  integrationBranch: "weave/integration-2024",
  weaveDir: ".weave",
};

// Execute cluster with gates
const result = await executeClusterWithGates(
  cluster,
  plan,
  executionState,
  gitOps,
  { skipGates: false, timeoutMs: 30000 }
);

if (!result.success) {
  console.error(`Cluster ${cluster.clusterIndex} failed`);
  console.log(`Rollback performed: ${result.rollbackPerformed}`);
  console.log(`Artifacts: ${result.artifactPaths.join(", ")}`);
}
```

## Artifacts

When a cluster fails gates, the following artifacts are stored in `.weave/`:

### 1. Merge Patch Diff
- **Path**: `.weave/cluster-{N}-merge-patch.diff`
- **Content**: Git diff showing what was merged before rollback
- **Purpose**: Review what changes caused the failure

### 2. Failure Bundle
- **Path**: `.weave/cluster-{N}-failure-bundle.json`
- **Content**: JSON with failed gates, timestamps, rollback info
- **Schema**:
  ```json
  {
    "clusterIndex": 0,
    "timestamp": "2024-12-17T07:00:00.000Z",
    "baseBranch": "main",
    "integrationBranch": "weave/integration-xyz",
    "items": ["PR-123", "PR-456"],
    "failedGates": [
      {
        "item": "PR-123",
        "gate": "test",
        "status": "fail",
        "exitCode": 1,
        "stderr": "Test failed..."
      }
    ],
    "mergePatchDiff": "diff --git ...",
    "rollbackSha": "abc123...",
    "artifactPaths": [...]
  }
  ```

### 3. Gate Artifacts
- **Path**: `.weave/cluster-{N}/gates/{item}/{gate}/`
- **Content**: Gate-specific outputs (junit.xml, coverage, etc.)

## Draft PR Creation

When gates fail, a draft PR is automatically created (if GitHub API is available):

- **Title**: `[DRAFT] Cluster {N} gate failures - {items}`
- **Body**: Includes:
  - Failure summary table
  - Links to artifacts
  - Merge patch diff preview
  - Rollback instructions
  - Next steps

The draft PR helps with:
- Team visibility of failures
- Artifact sharing
- Collaboration on fixes
- Audit trail

## Rollback Mechanism

### How Rollback Works

1. **Before cluster execution**: Capture current HEAD SHA
2. **Execute gates**: Run all gates for cluster items
3. **On failure**: 
   - Capture `git diff {base}..HEAD` as merge-patch.diff
   - Execute `git reset --hard {baseSha}`
   - Store artifacts
   - Create failure branch and draft PR

### Git Operations

The rollback uses:
- `getCurrentHead()`: Get SHA before cluster execution
- `getDiff(base, head)`: Capture merge-patch.diff
- `resetHard(sha)`: Perform rollback

### Safety

- Rollback is **deterministic** - always returns to exact pre-cluster state
- All artifacts are stored **before** rollback
- Rollback SHA is stored in failure bundle for manual recovery if needed

## Testing

Integration tests verify:
- ✅ Gates execute successfully for passing clusters
- ✅ Rollback occurs on gate failure
- ✅ Artifacts are stored in `.weave/`
- ✅ Merge-patch.diff is captured
- ✅ Failure bundle is created
- ✅ Git state is restored to pre-cluster SHA

Run tests:
```bash
npm test tests/cluster-gates-rollback.spec.ts
```

## Configuration

### Gate Timeout

Default: 30 seconds per gate
Configure via options:

```typescript
const result = await executeClusterWithGates(cluster, plan, state, git, {
  timeoutMs: 60000, // 60 seconds
});
```

### Skip Gates (Dev Mode)

```typescript
const result = await executeClusterWithGates(cluster, plan, state, git, {
  skipGates: true, // Skip all gates (not recommended)
});
```

## Error Handling

### Transient Errors
- Retryable gates (e.g., flaky tests) use policy retry configuration
- See `plan.policy.retries` for retry settings

### Permanent Errors
- Immediate failure without retry
- Rollback triggered
- Artifacts stored

### Partial Failures
- If any gate in cluster fails, entire cluster rolls back
- No partial rollback - all or nothing per cluster

## Best Practices

1. **Keep clusters small**: Easier to debug failures
2. **Review failure bundles**: Check `.weave/` artifacts
3. **Fix and retry**: Address issues in original PRs, re-run workflow
4. **Use draft PRs**: Enable team collaboration on failures
5. **Monitor timeouts**: Adjust `timeoutMs` for slow gates

## Future Enhancements

- [ ] Automatic retry with exponential backoff
- [ ] Cluster-level conflict prediction before merge
- [ ] Parallel gate execution within cluster
- [ ] Smart rollback (partial rollback for independent failures)
- [ ] Integration with GitHub Checks API
