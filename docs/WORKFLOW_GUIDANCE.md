# Workflow Guidance (LPR-037)

## Overview

The `workflow.guide` MCP tool provides context-aware guidance for lexrunner workflows, helping agents navigate complex operations by providing:

- **Next steps**: Available actions in the current workflow phase
- **Common issues**: Known problems and their solutions
- **Recommendations**: Suggested next action
- **Documentation links**: Relevant documentation for the phase

## Architecture

Following Guff's Option 1 approach from the backlog analysis, this feature:

- **Separates concerns**: Deterministic data vs. contextual guidance
- **Doesn't modify existing responses**: Guidance is opt-in via helper command
- **Maintains simplicity**: MCP server stays focused on I/O

## Workflow Phases

### 1. Initial

Starting point before any operations.

**Next steps:**

- `plan.create` (required) - Create execution plan

**Recommended action:** `plan.create`

### 2. Post-Plan-Creation

Plan has been created, ready for validation and gate execution.

**Next steps:**

- `gates.run` (required) - Execute gates to validate PRs
- `plan.validate` (optional) - Check for schema errors
- `merge.order` (optional) - Calculate dependency-based merge order

**Common issues:**

- Plan schema validation errors → Use `plan.validate`
- Unknown dependencies → Check PR dependency declarations

**Recommended action:** `gates.run`

### 3. Post-Gates-Run

Gates have been executed, check results before merge.

**Next steps:**

- `status` (required) - Check gate execution results
- `merge.apply` (optional) - Apply merge operations (use dryRun first)

**Common issues:**

- Gate failures → Check `artifacts/PR-XXX/gateName/` for logs
- PRs blocked from merge → Use `status` tool to see why

**Recommended action:** `status`

### 4. Pre-Merge

Ready to merge, perform final checks.

**Next steps:**

- `merge.apply` (required) - Apply merge operations

**Common issues:**

- Merge conflicts detected → Resolve manually or use AI conflict resolution
- Branch protection prevents merge → Ensure status checks pass and approvals obtained

**Recommended action:** `merge.apply`

### 5. Post-Merge

Merge completed successfully.

**Next steps:** None (workflow complete)

### 6. Error-Recovery

Error occurred, attempting recovery.

**Next steps:**

- `doctor` (optional) - Run diagnostics
- `status` (optional) - Check current state

**Common issues:**

- Command execution failed → Check error messages and use `doctor`

## Usage

### MCP Tool

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "workflow.guide",
    "arguments": {
      "phase": "post-plan-creation"
    }
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{
        \"phase\": \"post-plan-creation\",
        \"nextSteps\": [
          {
            \"command\": \"gates.run\",
            \"description\": \"Execute gates to validate PRs before merging\",
            \"required\": true
          },
          ...
        ],
        \"commonIssues\": [...],
        \"documentation\": \"docs/merge-weave-workflow.md\",
        \"canProceed\": true,
        \"recommendedAction\": \"gates.run\"
      }"
    }]
  }
}
```

### Programmatic Usage (TypeScript)

```typescript
import { WorkflowStateMachine } from "lexrunner/src/mcp/workflow/state-machine.js";

// Create state machine
const sm = new WorkflowStateMachine("initial");

// Get current guide
const guide = sm.getGuide();
console.log(`Recommended: ${guide.recommendedAction}`);

// Complete a step
sm.completeStep("plan.create");

// Transition to next phase
sm.transition("post-plan-creation");
```

### Stateless Helper

```typescript
import { createWorkflowGuide } from "lexrunner/src/mcp/workflow/state-machine.js";

// Get guidance without maintaining state
const guide = createWorkflowGuide("post-gates-run");
console.log(guide.nextSteps);
console.log(guide.commonIssues);
```

## API Reference

### WorkflowGuide

```typescript
interface WorkflowGuide {
  phase: string;
  nextSteps: WorkflowAction[];
  commonIssues: CommonIssue[];
  documentation?: string;
  canProceed: boolean;
  recommendedAction?: string;
}
```

### WorkflowAction

```typescript
interface WorkflowAction {
  command: string; // MCP tool command name
  description: string; // What this action does
  required: boolean; // Must be performed before proceeding
}
```

### CommonIssue

```typescript
interface CommonIssue {
  symptom: string; // Error message or symptom pattern
  solution: string; // Recommended solution
}
```

## Implementation Details

### Files Created

- `src/mcp/types/guided-response.ts` - Type definitions
- `src/mcp/workflow/state-machine.ts` - State machine and guidance logic
- `tests/workflow-state-machine.spec.ts` - State machine tests (29 tests)
- `tests/mcp-workflow-guide.spec.ts` - MCP integration tests (5 tests)

### Integration Points

1. **MCP Server** (`src/mcp/server.ts`):
   - Added `workflow.guide` tool definition
   - Added `handleWorkflowGuide` handler
   - Added `WorkflowGuideArgs` validation schema

2. **MCP Server Wrapper** (`mcp-server.mjs`):
   - Added `workflow.guide` tool entry
   - Imports `createWorkflowGuide` from built dist

3. **CLI Exports** (`src/cli.ts`):
   - Exported `createWorkflowGuide` for MCP server usage

## Testing

```bash
# Run workflow state machine tests
npm test -- tests/workflow-state-machine.spec.ts

# Run MCP integration tests
npm test -- tests/mcp-workflow-guide.spec.ts

# Manual MCP server test
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "workflow.guide", "arguments": {"phase": "post-plan-creation"}}}' | \
  node ./mcp-server.mjs
```

## Future Enhancements

While this implementation provides **stateless guidance** (Option 1 from Guff's analysis), the `GuidedMCPResponse<T>` interface in `guided-response.ts` shows how responses could be enhanced with workflow tracking in the future if needed.

This would enable:

- **Contextual prompts**: AI-generated suggestions based on current state
- **Decision points**: Branching workflows with multiple options
- **Progress tracking**: History of completed steps

However, these enhancements are **not implemented** in this phase to maintain architectural simplicity.

## Design Rationale

Per Guff's backlog analysis:

> **The Core Value Proposition:** "Agents waste tokens and time figuring out what to do next. I want the MCP to guide them through correct workflows."

This implementation:

✅ **Separates concerns** - Deterministic data ≠ guidance  
✅ **Opt-in guidance** - Call `workflow.guide` when needed  
✅ **Minimal architectural impact** - No changes to existing tools  
✅ **Deterministic** - Same phase always returns same guidance  
✅ **Testable** - Comprehensive test coverage

## Related Documentation

- [Merge Weave Workflow](./MERGE_WEAVE_USAGE_GUIDE.md) - Referenced in guidance
- [MCP CLI Parity](./MCP-CLI-PARITY.md) - MCP tool alignment
- [Terms](./TERMS.md) - Canonical terminology
