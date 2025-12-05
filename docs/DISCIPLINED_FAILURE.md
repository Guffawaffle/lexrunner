# Disciplined Failure Pattern

> **Definition 3.4 (Disciplined Failure):** A failure mode where:
> 1. Uncertainty is stated explicitly before action
> 2. Actions taken are reversible (or flagged as non-reversible)
> 3. Receipts document the decision chain
> 4. Recovery path is proposed or escalation triggered

This document describes the Disciplined Failure pattern implemented in lex-pr-runner, extending the AXError pattern with governance fields for reversibility, confidence, and action receipts.

## Overview

The Disciplined Failure pattern enables agents to:

- **Fail safely**: Actions are classified by reversibility
- **Fail transparently**: Uncertainty is declared before action
- **Fail traceably**: ActionReceipts document the decision chain
- **Fail recoverably**: Recovery paths are always proposed

## Components

### 1. ActionReceipt

An ActionReceipt documents every significant action with full context:

```typescript
import { emitActionReceipt } from '../src/receipts/index.js';

emitActionReceipt({
  action: 'merge PR-123 to integration',
  rationale: 'PR dependencies satisfied, gates green',
  confidence: 'high',
  reversibility: 'reversible',
  rollbackPath: 'git reset --hard HEAD~1',
  phase: 'apply',
});
```

**Output:**
```json
{
  "event": "action_receipt",
  "schemaVersion": "1.0.0",
  "kind": "ActionReceipt",
  "action": "merge PR-123 to integration",
  "outcome": "success",
  "rationale": "PR dependencies satisfied, gates green",
  "confidence": "high",
  "reversibility": "reversible",
  "rollbackPath": "git reset --hard HEAD~1",
  "escalationRequired": false,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "phase": "apply"
}
```

### 2. UncertaintyMarker

Before taking a risky action, declare uncertainty explicitly:

```typescript
import { emitUncertaintyMarker } from '../src/receipts/index.js';

emitUncertaintyMarker({
  operation: 'merge PR-456 with active dependencies',
  uncertainties: [
    'Dependency PR-123 may have untested changes',
    'Target branch received commits since last check'
  ],
  mitigations: [
    'Will run full test suite after merge',
    'Rollback path: git reset --hard HEAD~1'
  ],
  proceedingAnyway: true,
  reason: 'Time-sensitive release; risk accepted by policy'
});
```

### 3. Governance Context for AXError

Extend AXError with governance fields via the context object:

```typescript
import { buildGovernanceContext } from '../src/receipts/index.js';
import { createAXError } from '../src/errors/index.js';

const govCtx = buildGovernanceContext({
  reversibility: 'reversible',
  rollbackPath: 'git reset --hard HEAD~1',
  confidence: 'high',
});

const error = createAXError(
  'MERGE_CONFLICT',
  'Merge conflict detected in src/cli.ts',
  ['Resolve conflicts manually', 'Re-run merge'],
  { ...otherContext, ...govCtx }
);
```

## Reversibility Levels

| Level | Description | Example |
|-------|-------------|---------|
| `reversible` | Action can be fully undone | Git merge (can reset) |
| `partially-reversible` | Some effects persist | Branch creation + commits |
| `irreversible` | Cannot be undone | Published release |

## Confidence Levels

| Level | Description | When to Use |
|-------|-------------|-------------|
| `high` | Strong expectation of success | Dependencies verified, gates green |
| `medium` | Reasonable expectation | Most dependencies ready |
| `low` | Uncertain outcome | Some unknowns present |
| `uncertain` | Unknown outcome | Experimental or new path |

## Integration Points

### Merge-Weave Operations

```typescript
// In src/weave/execute.ts
import { emitActionReceipt, emitUncertaintyMarker } from '../receipts/index.js';

// Before merge
emitUncertaintyMarker({
  operation: `merge ${pr.branch} to integration`,
  uncertainties: conflicts.length > 0 
    ? [`${conflicts.length} potential conflicts detected`] 
    : [],
  mitigations: ['Pre-flight conflict detection', 'Rollback available'],
  proceedingAnyway: true,
  reason: 'Conflicts can be resolved during merge',
});

// After merge
emitActionReceipt({
  action: `merge PR-${pr.number} to integration`,
  rationale: 'Dependencies satisfied, gates green',
  confidence: 'high',
  reversibility: 'reversible',
  rollbackPath: `git reset --hard ${previousHead}`,
  phase: 'apply',
  runId: context.runId,
  planHash: context.planHash,
});
```

### Gate Execution

```typescript
// In src/gates/run.ts
import { emitActionReceipt } from '../receipts/index.js';

// After gate execution
emitActionReceipt({
  action: `execute gate: ${gate.name}`,
  rationale: 'Required by plan policy',
  confidence: 'high',
  reversibility: 'reversible',  // Gates don't mutate state
  outcome: gate.passed ? 'success' : 'failure',
  nextActions: gate.passed 
    ? ['Continue to next gate'] 
    : ['Fix gate failures', 'Re-run gate'],
  phase: 'verify',
});
```

## Schema Reference

### ActionReceipt

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `"1.0.0"` | Yes | Schema version |
| `kind` | `"ActionReceipt"` | Yes | Receipt type |
| `action` | `string` | Yes | Description of action |
| `outcome` | `success \| failure \| partial \| deferred` | Yes | Result |
| `rationale` | `string` | Yes | Why action was taken |
| `confidence` | `high \| medium \| low \| uncertain` | Yes | Confidence level |
| `reversibility` | `reversible \| partially-reversible \| irreversible` | Yes | Rollback capability |
| `rollbackPath` | `string` | No | Rollback instructions |
| `rollbackCommand` | `string` | No | Actual rollback command |
| `nextActions` | `string[]` | No | Suggested next steps |
| `escalationRequired` | `boolean` | Yes (default: false) | Needs human review |
| `escalationReason` | `string` | No | Why escalation needed |
| `uncertaintyNotes` | `string[]` | No | Known uncertainties |
| `timestamp` | `string (ISO 8601)` | Yes | When action occurred |
| `phase` | `string` | No | Execution phase |
| `runId` | `string` | No | Correlation ID |
| `planHash` | `string` | No | Plan verification |

### UncertaintyMarker

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `operation` | `string` | Yes | Planned operation |
| `uncertainties` | `string[]` | Yes | Known unknowns |
| `mitigations` | `string[]` | Yes | Risk mitigations |
| `proceedingAnyway` | `boolean` | Yes | Whether to proceed |
| `reason` | `string` | No | Why proceeding |
| `timestamp` | `string (ISO 8601)` | No | Declaration time |

## Best Practices

1. **Always emit receipts for mutations**: Any action that changes state should emit a receipt.

2. **Declare uncertainty early**: Use UncertaintyMarker before risky operations.

3. **Include rollback paths**: Every reversible action should specify how to undo it.

4. **Escalate appropriately**: Set `escalationRequired: true` when human judgment is needed.

5. **Correlate with run context**: Include `runId` and `planHash` for traceability.

## Cross-References

- [AXError Pattern](./errors.md) - Base error handling
- [Merge-Weave State Machine](./merge-weave-state-machine.md) - Weave execution
- [Gates Documentation](./gates.md) - Gate execution

## Governance Alignment

This pattern implements Definition 3.4 (Disciplined Failure) from the coordination cost compression thesis, connecting to:

- **Receipt Protocol Schema** - Standardized action documentation
- **AXError Pattern** - Recoverable error handling with `nextActions`
- **Permission to Fail** - Bounded autonomy with accountability
