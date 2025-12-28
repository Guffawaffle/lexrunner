# Memory Tools: Lex vs LexRunner

**Status:** Active (AX-017)  
**Version:** 1.0.0  
**Last Updated:** 2025-12-20

---

## Overview

This document clarifies the relationship between **Lex's memory tools** and **LexRunner's executor memory tools** to reduce agent confusion when working with context recall and storage.

---

## The Two Memory Systems

### 1. Lex Memory System (Primary)

**Location:** `@smartergpt/lex` package  
**Access:** Lex MCP server (`mcp_lex_frame_*` tools)  
**Purpose:** Long-term episodic memory for AI agents

**Key Tools:**

- `mcp_lex_frame_recall` — Search Frames by reference point with Atlas Frame context
- `mcp_lex_frame_remember` — Create new Frame with validation
- `mcp_lex_frame_list` — List recent Frames
- `mcp_lex_frame_timeline` — Show Frame evolution over time

**Storage:** SQLite database in `.lex/memory.db`

**When to use:**

- ✅ General-purpose memory recall across any workflow
- ✅ Storing architectural decisions and context
- ✅ Long-term memory that persists across sessions
- ✅ Direct access to Lex memory features

### 2. LexRunner Executor Memory Tools (Wrapper)

**Location:** LexRunner MCP server (`executor_*` tools)  
**Access:** LexRunner MCP server  
**Purpose:** Executor-specific workflow integration

**Key Tools:**

- `executor_recall_context` — Senior Dev workflow recall (delegates to `lex recall` CLI)
- `executor_capture_frame` — Senior Dev frame capture (delegates to `lex remember` CLI)

**Storage:** Same as Lex (delegates to Lex CLI, which writes to `.lex/memory.db`)

**When to use:**

- ✅ Within Senior Dev executor workflow
- ✅ When you need executor-specific context preparation
- ✅ When using other executor tools (prepare_context, capture_frame)

---

## Relationship Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Decision Layer                      │
└─────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
        ▼                                    ▼
┌──────────────────┐              ┌──────────────────────┐
│   Lex MCP Server │              │ LexRunner MCP Server │
│                  │              │                      │
│ • recall         │              │ • executor_recall    │
│ • remember       │              │ • executor_capture   │
│ • list           │              │                      │
│ • timeline       │              │   (delegates to ↓)   │
└────────┬─────────┘              └──────────┬───────────┘
         │                                   │
         │                                   │
         ▼                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Lex CLI (lex recall, lex remember)        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              SQLite Database (.lex/memory.db)                │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Differences

| Aspect          | Lex MCP Tools           | LexRunner Executor Tools      |
| --------------- | ----------------------- | ----------------------------- |
| **Database**    | Same (`.lex/memory.db`) | Same (delegates to Lex)       |
| **Protocol**    | Direct MCP to Lex       | MCP → CLI wrapper → Lex       |
| **Scope**       | General-purpose memory  | Executor workflow-specific    |
| **Features**    | Full Lex feature set    | Subset with workflow context  |
| **Performance** | Direct (faster)         | CLI wrapper (slight overhead) |
| **Use Case**    | Primary memory access   | Executor integration          |

---

## Decision Guide: Which Tool Should I Use?

### Use **Lex MCP Tools** (`mcp_lex_frame_*`) when:

- ✅ You need general-purpose memory recall
- ✅ You're not in an executor workflow
- ✅ You want the full Lex feature set
- ✅ You need the best performance
- ✅ You're storing non-executor context (e.g., architectural decisions, user preferences)

**Example:**

```typescript
// Recall all frames about authentication
const frames = await callTool("mcp_lex_frame_recall", {
  reference_point: "authentication",
  limit: 10,
});
```

### Use **LexRunner Executor Tools** (`executor_recall_context`) when:

- ✅ You're in a Senior Dev executor workflow
- ✅ You need executor-specific query types (module, developer, pattern, pr)
- ✅ You're using other executor tools (prepare_context, capture_frame)
- ✅ You want executor workflow integration

**Example:**

```typescript
// Recall frames for a specific module in executor workflow
const frames = await callTool("executor_recall_context", {
  query_type: "module",
  query: "src/gates",
  limit: 10,
});
```

---

## Anti-Pattern: Don't Store in One, Recall from Another (Split Brain)

❌ **Bad:**

```typescript
// Store in Lex
await callTool("mcp_lex_frame_remember", { ... });

// Later, try to recall via executor (same DB, will work but confusing)
const frames = await callTool("executor_recall_context", { ... });
```

✅ **Good:**

```typescript
// If using Lex for storage, use Lex for recall
await callTool("mcp_lex_frame_remember", { ... });
const frames = await callTool("mcp_lex_frame_recall", { ... });

// OR: If using executor workflow, use executor tools consistently
await callTool("executor_capture_frame", { ... });
const frames = await callTool("executor_recall_context", { ... });
```

---

## Migration Path: Deprecation Plan

**Current Status:** Both tools are supported  
**Future Direction:** Lex MCP tools are primary; executor tools may be simplified

### Phase 1 (Current - v0.1.x)

- ✅ Both Lex MCP and LexRunner executor tools available
- ✅ Documentation clarifies relationship
- ✅ No deprecation warnings

### Phase 2 (Planned - v0.2.x)

- Evaluate usage patterns
- Consider simplifying `executor_recall_context` to just call `mcp_lex_frame_recall`
- Add deprecation warnings if appropriate

### Phase 3 (Future - v1.0.x)

- Consolidate to single memory interface
- Executor tools become thin wrappers or removed
- Migration guide provided

---

## Technical Details

### How `executor_recall_context` Works

```typescript
// executor_recall_context implementation (simplified)
async function recallSeniorDevContext(input) {
  // Delegates to Lex CLI
  const result = runCommand("lex", ["recall", `reviews for ${input.query}`]);

  // Parses and returns frames
  return {
    frames: parseFramesFromLexOutput(result.output),
    query_type: input.query_type,
    // ...
  };
}
```

**Key Point:** This is a **wrapper** around `lex recall`, not a separate memory system.

### How `mcp_lex_frame_recall` Works

```typescript
// Lex MCP server implementation (simplified)
async function handleRecall(args) {
  // Direct database query
  const frames = await this.frameStore.searchFrames({
    referencePoint: args.reference_point,
    limit: args.limit,
  });

  // Returns frames with Atlas Frame context
  return { frames, atlasFrame };
}
```

**Key Point:** This is a **direct** database query with full Lex features.

---

## Common Questions

### Q: Do these tools access the same database?

**A:** Yes. Both access `.lex/memory.db`. LexRunner executor tools delegate to the `lex` CLI, which writes to the same database as the Lex MCP server.

### Q: Which tool should I use for new code?

**A:** Prefer **Lex MCP tools** (`mcp_lex_frame_*`) for general-purpose memory. Use **executor tools** only within executor workflows where workflow integration is needed.

### Q: Can I store with one and recall with the other?

**A:** Yes, but **don't**. While they access the same database, mixing them creates confusion. Choose one memory interface and use it consistently.

### Q: Why have two tools if they access the same database?

**A:** `executor_recall_context` provides executor-specific workflow integration (query types, parsing, prompt suggestions). However, this may be simplified in the future to reduce redundancy.

### Q: What if I don't have Lex installed?

**A:** LexRunner executor tools require the `lex` CLI to be installed and available in PATH. If `lex` is not available, executor tools will fail. Use Lex MCP tools instead if you only have the Lex package.

---

## Related Documentation

- [Lex Memory Integration](../executors/senior-dev/MEMORY_INTEGRATION.md) — Senior Dev executor memory patterns
- [Lex Frame Contract](../src/executors/README_FRAME_CONTRACT.md) — Executor Frame requirements
- [Lex Public API](./LEX_PUBLIC_API.md) — Lex API surface for LexRunner
- [Lex MCP Server](https://github.com/Guffawaffle/lex/docs/MCP_SERVER.md) — Lex MCP server documentation

---

## Changelog

### v1.0.0 (2025-12-20)

- ✅ Initial documentation of memory tools relationship
- ✅ Clarified Lex vs LexRunner executor tools
- ✅ Added decision guide and anti-patterns
- ✅ Documented migration path
