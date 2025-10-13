# Orchestration Module

Tools for pyramid orchestration (Phase 3) - automating batch PR workflows.

## Features

### Agent Assigner (`orchestrate:assign-batch`)

Bulk-assign GitHub Copilot agents to batched issues with:
- **Rate limiting handling**: Exponential backoff (10s, 20s, 40s, 80s) with max 4 retries
- **Error handling**: Graceful skip on already-assigned issues
- **Stagger control**: Configurable delay between assignments (default: 5s)
- **Dry-run mode**: Preview assignments without making API calls
- **JSON output**: Machine-readable results for automation

## Usage

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

#### Basic Assignment
```bash
# Assign agents to specific issues
lex-pr orchestrate:assign-batch --issues 156,157,160 --repo owner/repo

# Output:
# Agent Assignment (batch-1760355715525)
# ========================================
# ✅ owner/repo#156: assigned at 2025-10-13T02:00:00Z
# ✅ owner/repo#157: assigned at 2025-10-13T02:00:05Z
# ✅ owner/repo#160: assigned at 2025-10-13T02:00:10Z
#
# Summary: 3 assigned, 0 skipped, 0 failed
```

#### Dry Run
```bash
# Preview assignments without executing
lex-pr orchestrate:assign-batch --issues 156,157,160 --repo owner/repo --dry-run

# Output:
# Dry-Run: Would assign 3 issue(s)
# - owner/repo#156
# - owner/repo#157
# - owner/repo#160
```

#### From Batch Plan
```bash
# Load issues from batch plan JSON
lex-pr orchestrate:assign-batch --batch batch-plan.json --repo owner/repo

# batch-plan.json format:
{
  "items": [
    { "issueNumber": 156 },
    { "issueNumber": 157 },
    { "issueNumber": 160 }
  ]
}
```

#### JSON Output
```bash
# Get machine-readable results
lex-pr orchestrate:assign-batch --issues 156,157 --repo owner/repo --json

# Output:
{
  "assignedAt": "2025-10-13T02:00:00Z",
  "batchId": "batch-1760355715525",
  "results": [
    {
      "agentUrl": "https://github.com/owner/repo/issues/156",
      "assignedAt": "2025-10-13T02:00:00Z",
      "issueNumber": 156,
      "status": "success"
    },
    {
      "agentUrl": "https://github.com/owner/repo/issues/157",
      "assignedAt": "2025-10-13T02:00:05Z",
      "issueNumber": 157,
      "status": "success"
    }
  ],
  "summary": {
    "assigned": 2,
    "failed": 0,
    "skipped": 0
  }
}
```

#### Custom Stagger
```bash
# Wait 10 seconds between assignments (avoid rate limits)
lex-pr orchestrate:assign-batch --issues 156,157,160 --stagger 10
```

## Programmatic API

### Types

```typescript
export interface AssignmentResult {
  issueNumber: number;
  status: 'success' | 'skipped' | 'failed';
  assignedAt?: string;
  agentUrl?: string;
  reason?: string;
  error?: string;
}

export interface AssignmentLog {
  batchId: string;
  assignedAt: string;
  results: AssignmentResult[];
  summary: {
    assigned: number;
    skipped: number;
    failed: number;
  };
}

export interface AssignmentOptions {
  repo: string;
  dryRun?: boolean;
  stagger?: number;
}
```

### Functions

#### `assignAgentsToBatch()`

```typescript
import { assignAgentsToBatch } from './orchestration';

async function assignFn(repo: string, issueNumber: number) {
  // Your GitHub Copilot agent assignment implementation
  return { url: `https://github.com/${repo}/issues/${issueNumber}` };
}

const log = await assignAgentsToBatch(
  [156, 157, 160],
  {
    repo: 'owner/repo',
    dryRun: false,
    stagger: 5,
  },
  assignFn
);

console.log(log.summary); // { assigned: 3, skipped: 0, failed: 0 }
```

#### `formatAssignmentLog()`

```typescript
import { formatAssignmentLog } from './orchestration';

const humanReadable = formatAssignmentLog(log, 'owner/repo');
console.log(humanReadable);
// Agent Assignment (batch-123)
// ========================================
// ✅ owner/repo#156: assigned at 2025-10-13T02:00:00Z
// ...
```

## Error Handling

### Rate Limiting (HTTP 429)
- **Initial backoff**: 10 seconds
- **Exponential increase**: 2x each retry (10s → 20s → 40s → 80s)
- **Max retries**: 4
- **Result**: Failed with "Max retries exceeded" if all retries exhausted

### Already Assigned
- **Detection**: Error message contains "already assigned" or "Agent already exists"
- **Result**: Skipped with reason "Issue already assigned"

### Other Errors
- **Behavior**: Fail immediately, no retries
- **Result**: Failed with error message

## Integration Workflow

```bash
# Full orchestration pipeline

# 1. Analyze PRs (future: orchestrate:analyze)
# lex-pr orchestrate:analyze --json > analysis.json

# 2. Plan batches (future: orchestrate:plan-batch)
# lex-pr orchestrate:plan-batch --input analysis.json --json > batch-plan.json

# 3. Assign agents (current)
lex-pr orchestrate:assign-batch --batch batch-plan.json --json > assignment-log.json

# 4. Monitor progress (future: orchestrate:monitor)
# lex-pr orchestrate:monitor --batch batch1 --wait
```

## Testing

Run tests:
```bash
npm test -- agentAssigner.spec.ts
```

Test coverage:
- ✅ Dry-run mode
- ✅ Successful assignments
- ✅ Rate limiting with retry
- ✅ Already assigned (skip)
- ✅ Permanent errors
- ✅ Max retries exceeded
- ✅ Stagger delays
- ✅ Mixed results (success/skip/fail)
- ✅ Human-readable formatting
- ✅ JSON output formatting

## Future Enhancements

- [ ] **orchestrate:analyze** - Analyze PRs and dependencies
- [ ] **orchestrate:plan-batch** - Generate batch plans from analysis
- [ ] **orchestrate:monitor** - Monitor assigned agent progress
- [ ] GitHub API integration for real agent assignment (currently uses mock)
- [ ] Batch plan schema validation
- [ ] Progress tracking and reporting
