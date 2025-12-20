# Senior Dev Executor — Memory Integration

This document describes how the Senior Dev executor integrates with Lex memory for context accumulation and pattern recognition.

> **📘 Memory Tools Overview:** For a complete explanation of the relationship between Lex memory tools and LexRunner executor tools, see [MEMORY_TOOLS.md](../../docs/MEMORY_TOOLS.md).

## Overview

The Senior Dev executor uses Lex frames to:
1. **Recall** prior reviews for context
2. **Capture** new review sessions as frames
3. **Build** developer and module histories

**Note:** The `executor_recall_context` and `executor_capture_frame` tools are **wrappers** around the Lex CLI (`lex recall`, `lex remember`). They delegate to the same Lex memory system used by the Lex MCP server's `mcp_lex_frame_*` tools.

## Frame Schema

Each review session emits a frame with the following structure:

```yaml
reference_point: "PR-42 review src/gates"
summary_caption: "Gate validation improvements with edge case handling"
module_scope:
  - "src/gates"
  - "tests/gates"
status_snapshot:
  next_action: "Merge after CI passes"
  blockers:
    - "Flaky test in gateReportValidation.spec.ts"
keywords:
  - "senior-dev"
  - "review"
  - "pr-42"
  - "should-fix"
  - "developer:alice"
branch: "feature/gate-improvements"
jira: "LEX-456"
```

## Recall Patterns

### Pattern A: Module-Based Recall

Query frames related to a specific module:

```bash
lex recall "reviews for src/gates"
```

Returns prior reviews of the same module, enabling:
- Consistency with previous decisions
- Pattern recognition across PRs
- Teaching point accumulation

### Pattern B: Developer-Based Recall

Query frames by developer:

```bash
lex recall --keyword "developer:alice"
```

Returns reviews involving a specific developer for:
- Mentorship tracking
- Growth patterns
- Common issues

### Pattern C: Pattern Mining

Query the pattern library:

```bash
lex list_frames --keyword pattern
```

Returns pattern frames that capture recurring issues:
- Anti-patterns to watch for
- Best practices to encourage
- Codebase-specific conventions

### Pattern D: PR-Specific Recall

Query frames for a specific PR:

```bash
lex recall "PR-42 review"
```

Returns all frames from a specific PR review.

## Capture Workflow

### Step 1: Build Frame Payload

```typescript
const framePayload: FramePayload = {
  reference_point: `PR-${pr_number} review ${module}`,
  summary_caption: summary,
  module_scope: [module],
  status_snapshot: {
    next_action: nextAction,
    blockers: blockers.length > 0 ? blockers : undefined,
  },
  keywords: [
    "senior-dev",
    "review",
    `pr-${pr_number}`,
    severity,
    `developer:${developer}`,
  ],
  branch: getCurrentBranch(),
  jira: jiraTicket,
};
```

### Step 2: Write to Lex

```bash
lex remember \
  --reference-point "PR-42 review src/gates" \
  --summary "Gate validation improvements" \
  --next "Merge after CI passes" \
  --modules src/gates \
  --keywords senior-dev,review,pr-42,should-fix \
  --branch feature/gate-improvements \
  --jira LEX-456
```

### Step 3: Verify Capture

```bash
lex recall "PR-42 review src/gates"
```

## Keyword Conventions

| Prefix | Purpose | Example |
|--------|---------|---------|
| `pr-{n}` | Link to PR number | `pr-42` |
| `developer:{name}` | Developer association | `developer:alice` |
| `pattern:{name}` | Pattern classification | `pattern:error-handling` |
| Severity | Review severity | `blocker`, `must-fix`, `should-fix`, `nit`, `praise` |

## Integration with Recall Phase

```typescript
// In recallSeniorDevContext
switch (query_type) {
  case "module":
    // Query frames for this module
    frames = await lexRecall(`reviews for ${query}`);
    suggestedPrompt = "prompts/code-review.prompt.md";
    break;
    
  case "developer":
    // Query frames for this developer
    frames = await lexRecall(`--keyword developer:${query}`);
    suggestedPrompt = "prompts/mentorship-feedback.prompt.md";
    break;
    
  case "pattern":
    // Query pattern library
    frames = await lexListFrames("--keyword pattern");
    suggestedPrompt = "prompts/pattern-recognition.prompt.md";
    break;
}
```

## Best Practices

1. **Always capture** — Every review should produce a frame
2. **Use consistent reference points** — `PR-{n} review {module}` format
3. **Tag with severity** — Enables filtering by importance
4. **Include developer** — Enables mentorship tracking
5. **Link to Jira** — Maintains traceability

## Example: Full Review Cycle

```bash
# 1. Prepare context
lexrunner senior-dev prepare-context --pr 42

# 2. Recall prior reviews for affected modules
lexrunner senior-dev recall-context --module src/gates

# 3. (Model performs review using recalled context)

# 4. Capture the review session
lexrunner senior-dev capture-frame \
  --pr 42 \
  --module src/gates \
  --summary "Gate validation improvements" \
  --next-action "Merge after CI" \
  --severity should-fix \
  --developer alice
```

## Relationship with Lex MCP Tools

The Senior Dev executor tools (`executor_recall_context`, `executor_capture_frame`) are **wrappers** around the Lex CLI. They provide executor-specific workflow integration but ultimately delegate to the same Lex memory system.

### Key Points

1. **Same Database:** Both executor tools and Lex MCP tools (`mcp_lex_frame_recall`, `mcp_lex_frame_remember`) access the same SQLite database (`.lex/memory.db`)

2. **CLI Wrapper:** Executor tools call the `lex` CLI, which writes to the Lex memory store

3. **When to Use Which:**
   - **Use executor tools** (`executor_recall_context`) when working within the Senior Dev workflow
   - **Use Lex MCP tools** (`mcp_lex_frame_recall`) for direct, general-purpose memory access with better performance

4. **Consistency:** For best results, choose one interface and use it consistently. Don't mix executor tools and Lex MCP tools unless necessary.

### Example: Equivalent Operations

Using executor tools:
```bash
# Recall via executor wrapper
lexrunner senior-dev recall-context --module src/gates
```

Using Lex MCP tools directly:
```bash
# Recall via Lex CLI (same result, more direct)
lex recall "reviews for src/gates"
```

Both access the same memory, but Lex MCP tools are more direct and performant.

For a complete guide on choosing the right memory tool, see [MEMORY_TOOLS.md](../../docs/MEMORY_TOOLS.md).

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design
- [QUICK_START.md](./QUICK_START.md) — Getting started
- [Lex Documentation](https://github.com/Guffawaffle/lex) — Memory system
