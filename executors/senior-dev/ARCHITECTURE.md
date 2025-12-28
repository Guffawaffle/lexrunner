# Senior Dev Executor — Architecture

> **Version:** 1.0.0  
> **Status:** Canonical  
> **Location:** `executors/senior-dev/` (docs + prompts) + `src/executors/seniorDev/` (TypeScript)

## Overview

The Senior Dev executor implements a structured code review workflow that leverages Lex memory for context accumulation and pattern recognition. It follows the Jordan-mode protocol: deterministic preparation, a single stochastic model call, and frame emission as receipt.

## Core Responsibilities

1. **Deterministic Artifact Gathering** (Prep Phase)
   - Run lint, typecheck, and tests
   - Capture PR metadata and diffs
   - Recall relevant frames from Lex memory

2. **Stochastic Analysis** (Stochastic Phase)
   - Apply selected prompt template
   - Perform code review with mentorship focus
   - Generate structured findings

3. **Frame Emission** (Receipt Phase)
   - Write review session to Lex memory
   - Include severity, blockers, next actions
   - Link to related modules and patterns

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Senior Dev Executor                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Phase 1: Prep (Deterministic)                   │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  • prepareReviewContext()                                            │   │
│  │    - Run lint, typecheck, tests                                      │   │
│  │    - Capture diff and PR metadata                                    │   │
│  │    - Detect affected modules                                         │   │
│  │                                                                      │   │
│  │  • recallSeniorDevContext()                                          │   │
│  │    - Query Lex for related frames                                    │   │
│  │    - Find patterns for this module                                   │   │
│  │    - Suggest appropriate prompt                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  Phase 2: Stochastic (Model Call)                    │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  • Select mode → prompt template                                     │   │
│  │  • Execute at most ONE model call                                    │   │
│  │  • Parse structured response                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Phase 3: Receipt (Frame Emit)                     │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  • captureSeniorDevFrame()                                           │   │
│  │    - Build reference point: "PR-123 review src/module"               │   │
│  │    - Write frame to Lex via `lex remember`                           │   │
│  │    - Include keywords, severity, next_action                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Modes

The executor supports multiple modes, each optimized for a specific use case:

| Mode             | Prompt                          | Purpose                                  |
| ---------------- | ------------------------------- | ---------------------------------------- |
| `triage`         | `pr-analysis.prompt.md`         | Quick PR assessment before deep review   |
| `deep_review`    | `code-review.prompt.md`         | Detailed code analysis with findings     |
| `pattern_mining` | `pattern-recognition.prompt.md` | Identify recurring issues across reviews |
| `mentorship`     | `mentorship-feedback.prompt.md` | Synthesize developer growth over time    |

## Tool Budget

### Allowed Tools

- **Read-only operations:** `grep_search`, `read_file`, `list_dir`, `get_errors`
- **Git operations:** `gh pr view`, `git diff`
- **Quality gates:** `npm run lint`, `npm run typecheck`, `npm test`
- **Lex memory:** `lex recall`, `lex remember`

### Denied Tools

- **Write operations:** `create_file`, `replace_string_in_file`, `run_in_terminal`
- **Destructive operations:** `git push`, `git merge`, `rm -rf`

### Limits

- Maximum tool calls: 50
- Maximum output tokens: 8000

## Guardrails

### Scope

- **Allowed paths:** `src/**`, `tests/**`, `docs/**`
- **Denied paths:** `node_modules/**`, `.git/**`, `*.env`, `secrets/**`

### Epistemic

- IDK responses are allowed (`allowIDK: true`)
- Escalation at medium-risk or above

### Audit

- Normal logging level
- Frame schema: `senior-dev-review`

## Authorities

| Authority          | Granted | Purpose                                            |
| ------------------ | ------- | -------------------------------------------------- |
| `codeReview`       | ✅      | Can perform code review operations                 |
| `framePersistence` | ✅      | Can persist frames to Lex memory                   |
| `keystoneIssues`   | ✅      | Can implement keystone issues on umbrella branches |

## File Layout

```
executors/senior-dev/
├── ARCHITECTURE.md          # This file
├── executor-manifest.yaml   # Contract definition
├── MEMORY_INTEGRATION.md    # Lex memory patterns
├── QUICK_START.md           # Getting started guide
├── README.md                # Overview and navigation
├── examples/
│   └── sample-review-session.md
├── prompts/
│   ├── code-review.prompt.md
│   ├── mentorship-feedback.prompt.md
│   ├── pattern-recognition.prompt.md
│   └── pr-analysis.prompt.md
└── scripts/
    ├── capture-review-frame.sh
    ├── prepare-review-context.sh
    └── recall-context.sh

src/executors/seniorDev/
├── core.ts                  # Implementation
├── index.ts                 # Module exports
└── types.ts                 # Type definitions
```

## Integration Points

### CLI Commands

- `lexrunner senior-dev prepare-context --pr <number>`
- `lexrunner senior-dev recall-context --module <path>`
- `lexrunner senior-dev capture-frame --pr <number> --module <path>`

### MCP Tools

- `senior-dev.prepare_context` — Gather artifacts
- `senior-dev.recall_context` — Query Lex memory
- `senior-dev.capture_frame` — Write review receipt

## Related Documentation

- [Executor Authoring Guide](../../docs/executor-authoring.md)
- [Executor Decoupling](../../docs/executor-decoupling.md)
- [Memory Integration](./MEMORY_INTEGRATION.md)
- [Quick Start](./QUICK_START.md)

## IP Note

This executor implements the **review role**. It does NOT own:

- Merge plans or merge ordering (LexRunner orchestration)
- Gate sequencing or policy enforcement (LexRunner gates)
- Fan-out/fan-in coordination (LexRunner batch planning)

Those concerns remain in the LexRunner orchestration layer.
